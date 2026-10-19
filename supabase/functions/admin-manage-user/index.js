import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const secretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY');
  const authorization = request.headers.get('Authorization') || '';
  const jwt = authorization.replace(/^Bearer\s+/i, '');
  if (!supabaseUrl || !publicKey || !secretKey) return response({ error: 'Server Supabase keys are not configured.' }, 500);
  if (!jwt) return response({ error: 'Sign in as an administrator first.' }, 401);

  const callerClient = createClient(supabaseUrl, publicKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(jwt);
  if (callerError || !callerData?.user) return response({ error: 'Your session is invalid or expired.' }, 401);

  const adminClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const [{ data: callerProfile, error: profileError }, { data: callerAuthResult, error: callerAuthError }] = await Promise.all([
    adminClient.from('users').select('role, status').eq('id', callerData.user.id).maybeSingle(),
    adminClient.auth.admin.getUserById(callerData.user.id),
  ]);
  const bannedUntil = callerAuthResult?.user?.banned_until ? new Date(callerAuthResult.user.banned_until) : null;
  if (profileError || callerAuthError || String(callerProfile?.role || '').toUpperCase() !== 'ADMIN'
    || String(callerProfile?.status || 'ACTIVE').toUpperCase() !== 'ACTIVE'
    || (bannedUntil && bannedUntil.getTime() > Date.now())) {
    return response({ error: 'Administrator access is required.' }, 403);
  }

  try {
    const body = await request.json();
    const { action, userId } = body || {};

    if (action === 'list') {
      const { data: profileRows, error: listError } = await adminClient.from('users').select('*').order('full_name', { ascending: true });
      if (listError) throw listError;
      const allAuthUsers = [];
      for (let page = 1; page <= 50; page += 1) {
        const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        allAuthUsers.push(...(data?.users || []));
        if ((data?.users || []).length < 1000) break;
      }
      const metadataById = Object.fromEntries(allAuthUsers.map((authUser) => [authUser.id, authUser.user_metadata || {}]));
      const users = (profileRows || []).map((profile) => ({
        ...profile,
        employee_id_number: profile.employee_id_number || metadataById[profile.id]?.employee_id_number || null,
        student_id_number: profile.student_id_number || metadataById[profile.id]?.student_id_number || null,
        department_code: profile.department_code || metadataById[profile.id]?.department_code || null,
        department_name: profile.department_name || metadataById[profile.id]?.department_name || null,
        program_code: profile.program_code || metadataById[profile.id]?.program_code || null,
        program_name: profile.program_name || metadataById[profile.id]?.program_name || null,
        year_level: profile.year_level || metadataById[profile.id]?.year_level || null,
        is_suspended: Boolean(metadataById[profile.id]?.is_suspended),
      }));
      return response({ users });
    }

    if (!['create', 'update', 'deactivate', 'activate', 'approve', 'assign', 'delete'].includes(action)) return response({ error: 'Unsupported account action.' }, 400);

    if (action === 'create') {
      const { fullName, email, role, employeeId, officeId, departmentId } = body;
      const normalizedRole = String(role || '').toUpperCase();
      if (!fullName?.trim() || !email?.trim() || !['STAFF', 'ADMIN'].includes(normalizedRole)) {
        return response({ error: 'Name, email, and a STAFF or ADMIN role are required.' }, 400);
      }
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail.endsWith('@wlcormoc.edu.ph') && !normalizedEmail.endsWith('@gmail.com')) {
        return response({ error: 'Staff and Admin accounts must use @wlcormoc.edu.ph or @gmail.com.' }, 400);
      }
      if (normalizedRole === 'STAFF' && !officeId) return response({ error: 'A staff office assignment is required.' }, 400);
      if (normalizedRole === 'STAFF' && ['DEAN', 'ADVISER'].includes(body.officeCode) && !departmentId) return response({ error: 'A department is required for Dean and Adviser assignments.' }, 400);
      const inviteOptions = {
        // Public signup metadata is untrusted. The profile role is applied
        // below by this admin-authorized function after Auth creates the user.
        // Any temporary Auth-trigger profile is the least privileged pending
        // staff role; the trigger must never create an admin as a student.
        data: { full_name: fullName.trim(), role: 'STAFF', ...(employeeId ? { employee_id_number: employeeId.trim() } : {}) },
        ...(Deno.env.get('ADMIN_INVITE_REDIRECT_URL') ? { redirectTo: Deno.env.get('ADMIN_INVITE_REDIRECT_URL') } : {}),
      };
      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email.trim(), inviteOptions);
      if (error) throw error;
      const authUser = data?.user;
      if (!authUser?.id) throw new Error('Supabase Auth did not return the new user ID.');
      const { error: insertError } = await adminClient.from('users').upsert({
        id: authUser.id,
        email: email.trim(),
        full_name: fullName.trim(),
        role: normalizedRole,
        employee_id_number: employeeId?.trim() || null,
        status: normalizedRole === 'STAFF' ? 'PENDING_APPROVAL' : 'ACTIVE',
      }, { onConflict: 'id' });
      if (insertError) {
        await adminClient.auth.admin.deleteUser(authUser.id);
        throw insertError;
      }
      if (normalizedRole === 'STAFF' && officeId) {
        const { error: assignmentError } = await adminClient.from('staff_office_assignments').insert({ user_id: authUser.id, office_id: officeId, department_id: departmentId || null });
        if (assignmentError) {
          await adminClient.auth.admin.deleteUser(authUser.id);
          throw assignmentError;
        }
        const { error: activationError } = await adminClient.from('users').update({ status: 'ACTIVE' }).eq('id', authUser.id);
        if (activationError) {
          await adminClient.auth.admin.deleteUser(authUser.id);
          throw activationError;
        }
      }
      return response({ userId: authUser.id });
    }

    if (!userId) return response({ error: 'A target user ID is required.' }, 400);
    if (userId === callerData.user.id && ['deactivate', 'delete'].includes(action)) return response({ error: 'You cannot suspend or delete your own administrator account.' }, 400);

    if (action === 'delete') {
      // Remove the Auth identity first. Clean-install schemas cascade this to
      // public.users; older deployed schemas may lack that FK and leave an
      // orphan profile behind, so explicitly remove the profile as well.
      const { data: targetResult, error: targetError } = await adminClient.auth.admin.getUserById(userId);
      if (targetError && targetError.status !== 404) throw targetError;
      if (targetResult?.user) {
        const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(userId);
        if (authDeleteError) throw authDeleteError;
      }

      const { error: profileDeleteError } = await adminClient.from('users').delete().eq('id', userId);
      if (profileDeleteError) {
        throw new Error(`Auth account is deleted, but its OLClear profile could not be removed: ${profileDeleteError.message}`);
      }
      return response({ userId, deleted: true });
    }

    const { data: targetResult, error: targetError } = await adminClient.auth.admin.getUserById(userId);
    if (targetError && targetError.status !== 404) throw targetError;
    let target = targetResult?.user || null;
    let identityRestored = false;
    if (!target && action === 'assign') {
      const { data: orphanProfile, error: orphanProfileError } = await adminClient
        .from('users')
        .select('id, email, full_name, employee_id_number, role, status')
        .eq('id', userId)
        .maybeSingle();
      if (orphanProfileError) throw orphanProfileError;
      if (!orphanProfile || String(orphanProfile.role || '').toUpperCase() !== 'STAFF') {
        return response({ error: 'The selected Auth user was not found, and its staff profile could not be restored.' }, 404);
      }
      if (String(orphanProfile.status || '').toUpperCase() !== 'ACTIVE') {
        return response({ error: 'This staff profile has no Auth identity and is not active. Activate or approve it before reassignment.' }, 409);
      }

      // Preserve the existing profile UUID so assignments and historical records
      // remain attached. The random password is never returned or emailed; the
      // staff member must use the normal password recovery flow to sign in.
      const temporaryPassword = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
      const { data: restoredAuth, error: restoreAuthError } = await adminClient.auth.admin.createUser({
        id: orphanProfile.id,
        email: orphanProfile.email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: {
          full_name: orphanProfile.full_name,
          role: 'STAFF',
          employee_id_number: orphanProfile.employee_id_number,
        },
      });
      if (restoreAuthError) {
        return response({ error: `The staff profile was found, but its Auth identity could not be restored: ${restoreAuthError.message}` }, 409);
      }
      target = restoredAuth?.user || null;
      if (!target?.id) return response({ error: 'Supabase Auth did not confirm the restored staff identity.' }, 500);
      identityRestored = true;
    }
    if (!target) return response({ error: 'The selected Auth user was not found.' }, 404);

    if (action === 'assign') {
      const { data: profile, error: staffProfileError } = await adminClient
        .from('users')
        .select('id, role, status')
        .eq('id', userId)
        .maybeSingle();
      if (staffProfileError) throw staffProfileError;
      if (!profile || String(profile.role || '').toUpperCase() !== 'STAFF') {
        return response({ error: 'Only staff accounts can be assigned to signatory offices.' }, 400);
      }
      if (String(profile.status || '').toUpperCase() !== 'ACTIVE') {
        return response({ error: 'Approve the pending staff account before changing its assignment.' }, 409);
      }

      const { officeId, departmentId } = body;
      if (!officeId) return response({ error: 'Choose a signatory office.' }, 400);
      const { data: office, error: officeError } = await adminClient
        .from('offices')
        .select('id, code')
        .eq('id', officeId)
        .maybeSingle();
      if (officeError) throw officeError;
      if (!office?.id) return response({ error: 'Choose a valid signatory office.' }, 400);
      const departmentSpecific = ['DEAN', 'ADVISER'].includes(office.code);
      if (departmentSpecific && !departmentId) {
        return response({ error: 'A department is required for Dean and Adviser assignments.' }, 400);
      }
      if (departmentSpecific) {
        const { data: department, error: departmentError } = await adminClient
          .from('academic_departments')
          .select('id')
          .eq('id', departmentId)
          .maybeSingle();
        if (departmentError) throw departmentError;
        if (!department) return response({ error: 'Choose a valid academic department for this office.' }, 400);
      }

      const assignment = { office_id: office.id, department_id: departmentSpecific ? departmentId : null };
      const { data: existing, error: assignmentLookupError } = await adminClient
        .from('staff_office_assignments')
        .select('user_id')
        .eq('user_id', userId);
      if (assignmentLookupError) throw assignmentLookupError;
      const result = existing?.length
        ? await adminClient.from('staff_office_assignments').update(assignment).eq('user_id', userId).select('user_id')
        : await adminClient.from('staff_office_assignments').insert({ user_id: userId, ...assignment });
      if (result.error) throw result.error;
      if (existing?.length && !result.data?.length) {
        const { error: insertError } = await adminClient.from('staff_office_assignments').insert({ user_id: userId, ...assignment });
        if (insertError) throw insertError;
      }
      return response({ userId, assigned: true, officeCode: office.code, departmentId: assignment.department_id, identityRestored });
    }

    if (action === 'approve') {
      const { data: profile, error: staffProfileError } = await adminClient
        .from('users')
        .select('id, role, status, requested_office_id, requested_department_id')
        .eq('id', userId)
        .maybeSingle();
      if (staffProfileError) throw staffProfileError;
      if (!profile || String(profile.role || '').toUpperCase() !== 'STAFF') {
        return response({ error: 'Only staff accounts can be approved.' }, 400);
      }
      if (String(profile.status || '').toUpperCase() !== 'PENDING_APPROVAL') {
        return response({ error: 'This staff account is no longer pending approval.' }, 409);
      }
      const officeId = body.officeId || profile.requested_office_id;
      const departmentId = body.departmentId || profile.requested_department_id;
      if (!officeId) return response({ error: 'A signatory office assignment is required.' }, 400);
      const { data: office, error: officeError } = await adminClient
        .from('offices')
        .select('id, code')
        .eq('id', officeId)
        .maybeSingle();
      if (officeError) throw officeError;
      if (!office?.id) return response({ error: 'Choose a valid signatory office.' }, 400);
      if (['DEAN', 'ADVISER'].includes(office.code) && !departmentId) {
        return response({ error: 'A department is required for Dean and Adviser assignments.' }, 400);
      }
      if (['DEAN', 'ADVISER'].includes(office.code)) {
        const { data: department, error: departmentError } = await adminClient
          .from('academic_departments')
          .select('id')
          .eq('id', departmentId)
          .maybeSingle();
        if (departmentError) throw departmentError;
        if (!department) return response({ error: 'Choose a valid academic department for this office.' }, 400);
      }

      const assignment = { office_id: office.id, department_id: ['DEAN', 'ADVISER'].includes(office.code) ? departmentId : null };
      const { data: currentAssignments, error: assignmentLookupError } = await adminClient
        .from('staff_office_assignments')
        .select('user_id, office_id, department_id')
        .eq('user_id', userId);
      if (assignmentLookupError) throw assignmentLookupError;
      if (currentAssignments?.length) {
        const { data: updatedAssignments, error: assignmentError } = await adminClient
          .from('staff_office_assignments')
          .update(assignment)
          .eq('user_id', userId)
          .select('user_id');
        if (assignmentError) throw assignmentError;
        if (!updatedAssignments?.length) {
          const { error: assignmentInsertError } = await adminClient.from('staff_office_assignments').insert({ user_id: userId, ...assignment });
          if (assignmentInsertError) throw assignmentInsertError;
        }
      } else {
        const { error: assignmentError } = await adminClient
          .from('staff_office_assignments')
          .insert({ user_id: userId, ...assignment });
        if (assignmentError) throw assignmentError;
      }

      const { data: activatedProfile, error: activationError } = await adminClient
        .from('users')
        .update({ status: 'ACTIVE' })
        .eq('id', userId)
        .eq('status', 'PENDING_APPROVAL')
        .select('id')
        .maybeSingle();
      if (activationError || !activatedProfile) {
        const { error: deleteRollbackError } = await adminClient.from('staff_office_assignments').delete().eq('user_id', userId);
        const assignmentRollback = !deleteRollbackError && currentAssignments?.length
          ? await adminClient.from('staff_office_assignments').insert(currentAssignments)
          : { error: deleteRollbackError || null };
        const rollbackError = assignmentRollback.error;
        if (rollbackError) {
          return response({ error: `Staff approval failed (${activationError?.message || 'account status changed'}); the previous office assignment could not be restored (${rollbackError.message}).` }, 500);
        }
        if (activationError) throw activationError;
        return response({ error: 'This staff account was already approved or changed. Its previous office assignment was restored; refresh and try again.' }, 409);
      }
      return response({ userId, approved: true, officeCode: office.code });
    }

    if (action === 'deactivate' || action === 'activate') {
      const suspended = action === 'deactivate';
      const { data: targetProfile, error: targetProfileError } = await adminClient
        .from('users').select('id, status').eq('id', userId).maybeSingle();
      if (targetProfileError) throw targetProfileError;
      if (!targetProfile) return response({ error: 'The selected OLClear profile was not found.' }, 404);

      const currentStatus = String(targetProfile.status || 'ACTIVE').toUpperCase();
      const savedStatus = String(target.app_metadata?.olclear_status_before_suspend || '').toUpperCase();
      const nextStatus = suspended
        ? 'SUSPENDED'
        : currentStatus === 'SUSPENDED'
          ? ['ACTIVE', 'PENDING_APPROVAL'].includes(savedStatus) ? savedStatus : 'ACTIVE'
          : currentStatus;
      const nextAppMetadata = { ...(target.app_metadata || {}) };
      if (suspended) nextAppMetadata.olclear_status_before_suspend = currentStatus === 'SUSPENDED'
        ? (['ACTIVE', 'PENDING_APPROVAL'].includes(savedStatus) ? savedStatus : 'ACTIVE')
        : currentStatus;
      else delete nextAppMetadata.olclear_status_before_suspend;

      const { error: profileStatusError } = await adminClient.from('users')
        .update({ status: nextStatus }).eq('id', userId);
      if (profileStatusError) throw profileStatusError;

      const { error: authStatusError } = await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: suspended ? '876000h' : 'none',
        user_metadata: { ...(target.user_metadata || {}), is_suspended: suspended },
        app_metadata: nextAppMetadata,
      });
      if (authStatusError) {
        const { error: rollbackError } = await adminClient.from('users')
          .update({ status: currentStatus }).eq('id', userId);
        if (rollbackError) {
          return response({ error: `Auth suspension failed (${authStatusError.message}) and the profile status rollback also failed (${rollbackError.message}).` }, 500);
        }
        throw authStatusError;
      }
      return response({ userId, is_suspended: suspended, status: nextStatus });
    }

    const { fullName, email, role, employeeId, studentIdNumber, password, officeId, departmentId } = body;
    const { data: currentProfile, error: currentProfileError } = await adminClient
      .from('users').select('*').eq('id', userId).maybeSingle();
    if (currentProfileError) throw currentProfileError;
    if (!currentProfile) return response({ error: 'The OLClear profile was not found.' }, 404);

    const currentRole = String(currentProfile.role || '').toUpperCase();
    const nextRole = String(role || currentRole).toUpperCase();
    if (!['STUDENT', 'STAFF', 'ADMIN'].includes(nextRole)) return response({ error: 'Choose a valid account role.' }, 400);
    if (nextRole === 'STUDENT' && currentRole !== 'STUDENT') {
      return response({ error: 'Register student accounts through the student registration form so academic records can be validated.' }, 400);
    }
    if (fullName !== undefined && !String(fullName).trim()) return response({ error: 'A full name is required.' }, 400);
    if (password && password.length < 8) return response({ error: 'Password must contain at least 8 characters.' }, 400);

    const nextEmail = email?.trim() || currentProfile.email || target.email;
    if (nextEmail) {
      const normalizedEmail = nextEmail.toLowerCase();
      const validDomain = nextRole === 'STUDENT'
        ? normalizedEmail.endsWith('@wlcormoc.edu.ph')
        : normalizedEmail.endsWith('@wlcormoc.edu.ph') || normalizedEmail.endsWith('@gmail.com');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || !validDomain) {
        return response({ error: nextRole === 'STUDENT' ? 'Student accounts must use a valid @wlcormoc.edu.ph email.' : 'Staff and Admin accounts must use a valid @wlcormoc.edu.ph or @gmail.com email.' }, 400);
      }
    }

    let nextAssignment = null;
    if (nextRole === 'STAFF') {
      if (!officeId) return response({ error: 'A staff office assignment is required.' }, 400);
      const { data: office, error: officeError } = await adminClient.from('offices').select('id, code').eq('id', officeId).maybeSingle();
      if (officeError) throw officeError;
      if (!office) return response({ error: 'Choose a valid staff office.' }, 400);
      const departmentRequired = ['DEAN', 'ADVISER'].includes(String(office.code).toUpperCase());
      if (departmentRequired && !departmentId) return response({ error: 'A department is required for Dean and Adviser assignments.' }, 400);
      if (departmentRequired) {
        const { data: department, error: departmentError } = await adminClient.from('academic_departments').select('id').eq('id', departmentId).maybeSingle();
        if (departmentError) throw departmentError;
        if (!department) return response({ error: 'Choose a valid academic department.' }, 400);
      }
      nextAssignment = { office_id: office.id, department_id: departmentRequired ? departmentId : null };
    }

    const { data: currentAssignments, error: currentAssignmentsError } = await adminClient
      .from('staff_office_assignments').select('user_id, office_id, department_id').eq('user_id', userId);
    if (currentAssignmentsError) throw currentAssignmentsError;

    const profileChanges = {};
    if (fullName !== undefined) profileChanges.full_name = String(fullName).trim();
    if (email?.trim()) profileChanges.email = nextEmail;
    if (role !== undefined) profileChanges.role = nextRole;
    if (employeeId !== undefined) profileChanges.employee_id_number = employeeId ? String(employeeId).trim() : null;
    if (studentIdNumber !== undefined) profileChanges.student_id_number = studentIdNumber ? String(studentIdNumber).trim() : null;
    if (currentRole !== nextRole && nextRole === 'ADMIN' && String(currentProfile.status || '').toUpperCase() === 'PENDING_APPROVAL') {
      profileChanges.status = 'ACTIVE';
    }

    const rollbackDatabase = async () => {
      const { error: profileRollbackError } = await adminClient.from('users').update({
        full_name: currentProfile.full_name,
        email: currentProfile.email,
        role: currentProfile.role,
        status: currentProfile.status,
        employee_id_number: currentProfile.employee_id_number,
        student_id_number: currentProfile.student_id_number,
      }).eq('id', userId);
      const { error: deleteAssignmentsError } = await adminClient.from('staff_office_assignments').delete().eq('user_id', userId);
      const assignmentRollback = currentAssignments?.length
        ? await adminClient.from('staff_office_assignments').insert(currentAssignments)
        : { error: null };
      return profileRollbackError || deleteAssignmentsError || assignmentRollback.error || null;
    };

    if (Object.keys(profileChanges).length) {
      const { data: savedProfile, error: profileUpdateError } = await adminClient.from('users')
        .update(profileChanges).eq('id', userId).select('id').maybeSingle();
      if (profileUpdateError) throw profileUpdateError;
      if (!savedProfile) return response({ error: 'The OLClear profile changed before the update completed. Refresh and retry.' }, 409);
    }

    let assignmentError = null;
    if (nextAssignment) {
      if (currentAssignments?.length) {
        const result = await adminClient.from('staff_office_assignments').update(nextAssignment)
          .eq('user_id', userId).select('user_id');
        assignmentError = result.error;
        if (!assignmentError && !result.data?.length) {
          const insertResult = await adminClient.from('staff_office_assignments').insert({ user_id: userId, ...nextAssignment });
          assignmentError = insertResult.error;
        }
      } else {
        const result = await adminClient.from('staff_office_assignments').insert({ user_id: userId, ...nextAssignment });
        assignmentError = result.error;
      }
    } else if (currentAssignments?.length) {
      const result = await adminClient.from('staff_office_assignments').delete().eq('user_id', userId);
      assignmentError = result.error;
    }
    if (assignmentError) {
      const rollbackError = await rollbackDatabase();
      return response({ error: rollbackError
        ? `Staff assignment failed (${assignmentError.message}); profile rollback also failed (${rollbackError.message}).`
        : assignmentError.message }, rollbackError ? 500 : 400);
    }

    const nextMetadata = { ...(target.user_metadata || {}) };
    nextMetadata.full_name = fullName === undefined ? nextMetadata.full_name : String(fullName).trim();
    nextMetadata.role = nextRole;
    if (nextRole === 'STAFF') nextMetadata.employee_id_number = employeeId === undefined ? currentProfile.employee_id_number : employeeId ? String(employeeId).trim() : null;
    if (nextRole === 'STUDENT') nextMetadata.student_id_number = studentIdNumber === undefined ? currentProfile.student_id_number : studentIdNumber ? String(studentIdNumber).trim() : null;
    const authChanges = { user_metadata: nextMetadata };
    if (email?.trim() && nextEmail.toLowerCase() !== String(target.email || '').toLowerCase()) {
      authChanges.email = nextEmail;
      authChanges.email_confirm = true;
    }
    if (password) authChanges.password = password;
    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(userId, authChanges);
    if (authUpdateError) {
      const rollbackError = await rollbackDatabase();
      return response({ error: rollbackError
        ? `Auth update failed (${authUpdateError.message}); profile rollback also failed (${rollbackError.message}).`
        : authUpdateError.message }, rollbackError ? 500 : 400);
    }
    return response({ userId, updated: true });
  } catch (error) {
    return response({ error: error?.message || 'The admin account operation failed.' }, 400);
  }
});
