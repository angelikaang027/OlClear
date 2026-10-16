import { supabase } from './supabase.js';

const DEPARTMENT_TABLE = 'academic_departments';
const PROGRAM_TABLE = 'programs';
const OFFICE_TABLE = 'offices';

function throwIfError(error) {
  if (error) throw error;
}

function isRlsViolation(error) {
  return error?.code === '42501' || /row-level security|RLS policy/i.test(error?.message || '');
}

function isExistingAccount(error) {
  return /already registered|identity_already_exists/i.test(error?.message || '')
    || error?.code === 'identity_already_exists';
}

async function upsertProfileWithSessionRetry(profile, signupSession) {
  let { error } = await supabase.from('users').upsert(profile, { onConflict: 'id' });
  if (!error || !isRlsViolation(error)) return error;

  let session = signupSession;
  if (!session) {
    const { data } = await supabase.auth.getSession();
    session = data?.session;
  }

  // Never retry with a session belonging to a different signed-in account.
  if (session?.user?.id !== profile.id || !session.access_token || !session.refresh_token) {
    return error;
  }

  const { error: sessionError } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (sessionError) return error;

  ({ error } = await supabase.from('users').upsert(profile, { onConflict: 'id' }));
  return error;
}

function profileInsertMessage(error) {
  if (isRlsViolation(error)) {
    return 'Your account was created, but database access rules blocked its profile. Do not register again with this email; ask an administrator to configure a secure profile-insert policy or signup trigger.';
  }
  return `Your authentication account was created, but its profile could not be saved: ${error.message}`;
}

async function getProgramByCode(code, departmentId) {
  try {
    const { data, error } = await supabase
      .from(PROGRAM_TABLE)
      .select('id, code, name')
      .eq('code', code)
      .eq('department_id', departmentId)
      .maybeSingle();

    // Program catalog/RLS problems should not prevent creating the account.
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

async function getOfficeIdByCode(code) {
  const { data, error } = await supabase
    .from(OFFICE_TABLE)
    .select('id')
    .eq('code', code)
    .maybeSingle();
  throwIfError(error);
  if (!data?.id) throw new Error(`Office "${code}" was not found. Please contact the administrator.`);
  return data.id;
}

export async function getAcademicDepartments() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Check EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }
  const { data, error } = await supabase
    .from(DEPARTMENT_TABLE)
    .select('id, code, name')
    .order('code', { ascending: true });
  throwIfError(error);
  return data || [];
}

export async function getAcademicPrograms() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Check EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }
  const { data, error } = await supabase
    .from(PROGRAM_TABLE)
    .select('id, code, name, academic_level, department_id')
    .order('code', { ascending: true });
  throwIfError(error);
  return data || [];
}

export async function fetchStaffAssignments(userId) {
  if (!supabase) {
    throw new Error('Supabase is not configured. Check EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  }
  const { data, error } = await supabase
    .from('staff_office_assignments')
    .select('office_id, department_id, offices(code, name)')
    .eq('user_id', userId);
  throwIfError(error);
  return data || [];
}

/** Verifies an email OTP and clears the local Auth session before login. */
export async function verifyEmailOtp(email, token, type = 'signup') {
  if (!supabase) {
    throw new Error('Email verification is unavailable. Check the app Supabase configuration.');
  }

  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedToken = String(token || '').trim();
  if (!normalizedEmail || !normalizedToken) {
    throw new Error('Enter your email address and verification code.');
  }

  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email: normalizedEmail,
      token: normalizedToken,
      type,
    });

    if (error) {
      const message = String(error.message || '').toLowerCase();
      const alreadyVerified = message.includes('already confirmed')
        || message.includes('already registered')
        || message.includes('already verified');
      // Recovery OTPs must establish a recovery session for updateUser().
      // Treating an already-verified response as success here would sign out
      // that session and leave ResetPassword without authorization to proceed.
      if (!alreadyVerified || type === 'recovery') throw error;

      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      throwIfError(signOutError);
      return { success: true, alreadyVerified: true };
    }

    if (type !== 'recovery') {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      throwIfError(signOutError);
    }
    return { success: true, alreadyVerified: false, data };
  } catch (error) {
    console.error('Verify OTP Error:', error);
    throw error;
  }
}

async function getDepartmentByCode(code) {
  const { data, error } = await supabase
    .from(DEPARTMENT_TABLE)
    .select('id, code, name')
    .eq('code', code)
    .maybeSingle();
  throwIfError(error);
  if (!data?.id) {
    throw new Error(`Department “${code}” was not found in ${DEPARTMENT_TABLE}.`);
  }
  return data;
}

/**
 * Creates a Supabase Auth user and their application profile.
 * Expected lookup schema: academic_departments has id, code, name;
 * programs have id, code, and department_id; offices have id, code, and name;
 * staff_office_assignments has user_id,
 * office_id, and nullable department_id.
 */
export async function registerAccount(registration) {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to the app environment, then restart Expo.');
  }
  // Empty role state defaults to STUDENT before it reaches the database enum.
  const requestedRole = registration?.role;
  const role = requestedRole && String(requestedRole).trim() !== ''
    ? String(requestedRole).trim().toUpperCase()
    : 'STUDENT';
  if (!['STUDENT', 'STAFF'].includes(role)) {
    throw new Error('Administrator accounts can only be created by an active administrator.');
  }

  const normalizedEmail = String(registration.email || '').trim().toLowerCase();
  const fullName = String(registration.fullName || '').trim();
  const personId = String(registration.studentIdNumber ?? registration.personId ?? '').trim();
  const departmentCode = String(registration.department || '').trim().toUpperCase() || null;
  const programCode = String(registration.program || '').trim() || null;
  let programName = String(registration.programName || '').trim() || null;
  const officeCode = String(registration.office || '').trim().toUpperCase() || null;
  const yearLevel = String(registration.yearLevel || '').trim() || null;
  const formattedAcademicLevel = registration.academicLevel
    ? String(registration.academicLevel).trim().toUpperCase().replace(/\s+/g, '_')
    : 'UNDERGRADUATE';
  if (!normalizedEmail || !fullName) {
    throw new Error('Enter your full name and email address.');
  }
  const emailDomainAllowed = role === 'STUDENT'
    ? normalizedEmail.endsWith('@wlcormoc.edu.ph')
    : normalizedEmail.endsWith('@wlcormoc.edu.ph') || normalizedEmail.endsWith('@gmail.com');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || !emailDomainAllowed) {
    throw new Error(role === 'STUDENT'
      ? 'Student accounts must use a valid @wlcormoc.edu.ph email address.'
      : 'Staff accounts must use a valid @wlcormoc.edu.ph or @gmail.com email address.');
  }

  let departmentId = null;
  let departmentName = null;
  let programId = null;
  let requestedOfficeId = null;

  // Resolve foreign keys before creating an Auth user, so invalid selections
  // do not leave an account that cannot be retried.
  if (role === 'STUDENT') {
    const departmentRow = await getDepartmentByCode(departmentCode);
    departmentId = departmentRow.id;
    departmentName = departmentRow.name;
    const programRow = await getProgramByCode(programCode, departmentId);
    if (!programRow?.id) throw new Error('The selected program is not in the College catalog. Ask an administrator to add it, then try again.');
    programId = programRow.id;
    programName = programRow.name || programName;
  }
  if (role === 'STAFF') {
    if (!officeCode) throw new Error('Choose the office you are requesting access to.');
    requestedOfficeId = await getOfficeIdByCode(officeCode);
    if (['DEAN', 'ADVISER'].includes(officeCode)) {
      if (!departmentCode) throw new Error('Choose the department for your requested office.');
      const departmentRow = await getDepartmentByCode(departmentCode);
      departmentId = departmentRow.id;
      departmentName = departmentRow.name;
    }
  }

  const userMetadata = {
    email: normalizedEmail,
    full_name: fullName,
    role,
    ...(role === 'STUDENT' ? {
      student_id_number: personId || null,
      department_id: departmentId,
      department_code: departmentCode,
      department_name: departmentName,
      program_id: programId,
      program_code: programCode,
      program_name: programName,
      academic_level: formattedAcademicLevel,
      year_level: yearLevel,
      is_graduating: Boolean(registration.graduating),
    } : {}),
    ...(role === 'STAFF' ? {
      employee_id_number: personId || null,
      status: 'PENDING_APPROVAL',
      requested_office_id: requestedOfficeId,
      requested_office_code: officeCode,
      requested_department_id: departmentId,
      requested_department_code: departmentCode,
    } : {}),
  };
  const { data, error: signUpError } = await supabase.auth.signUp({
    email: normalizedEmail,
    password: registration.password,
    options: {
      data: userMetadata,
    },
  });
  if (isExistingAccount(signUpError)) {
    throw new Error('An account with this email already exists. Please log in instead.');
  }
  throwIfError(signUpError);

  const authUser = data?.user;
  if (!authUser?.id) {
    throw new Error('Supabase did not return a user account. Please try again.');
  }

  const userProfile = {
    id: authUser.id,
    email: normalizedEmail,
    full_name: fullName,
    role,
    ...(role === 'STAFF' ? {
      status: 'PENDING_APPROVAL',
      requested_office_id: requestedOfficeId,
      requested_department_id: departmentId,
    } : {}),
  };

  if (role === 'STUDENT') {
    Object.assign(userProfile, {
      student_id_number: personId || null,
      academic_level: formattedAcademicLevel,
      department_id: departmentId,
      program_id: programId,
      year_level: yearLevel,
      is_graduating: Boolean(registration.graduating),
    });
  }

  // The database trigger runs with elevated privileges, so email-confirmation
  // signups (which have no client session yet) do not attempt an RLS-blocked
  // profile insert from the app.
  if (!data.session) {
    return { user: authUser, session: null, role, status: role === 'STAFF' ? 'PENDING_APPROVAL' : 'ACTIVE' };
  }

  // Supabase may return an empty identities array for an existing Auth user.
  // Recover only after authenticating with the submitted password, and only
  // when that user's application profile is still missing.
  if (Array.isArray(authUser.identities) && authUser.identities.length === 0) {
    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: registration.password,
    });
    if (loginError || loginData?.user?.id !== authUser.id) {
      throw new Error('An account with this email already exists. Please log in instead.');
    }

    const { data: existingProfile, error: profileLookupError } = await supabase
      .from('users')
      .select('id')
      .eq('id', authUser.id)
      .maybeSingle();
    if (profileLookupError) throw new Error(profileInsertMessage(profileLookupError));
    if (existingProfile) {
      throw new Error('An account with this email already exists. Please log in instead.');
    }

    const profileError = await upsertProfileWithSessionRetry(userProfile, loginData.session);
    if (profileError) throw new Error(profileInsertMessage(profileError));

    return {
      user: loginData.user,
      session: loginData.session,
      role,
      status: role === 'STAFF' ? 'PENDING_APPROVAL' : 'ACTIVE',
    };
  }

  const { data: existingProfile, error: profileLookupError } = await supabase
    .from('users')
    .select('id')
    .eq('id', authUser.id)
    .maybeSingle();

  // The database trigger is the primary profile creator. Only write from the
  // client when no profile is visible (or lookup is blocked by RLS).
  if (!existingProfile || profileLookupError) {
    const profileError = await upsertProfileWithSessionRetry(userProfile, data.session);
    if (profileError) throw new Error(profileInsertMessage(profileError));
  }

  return { user: authUser, session: data.session, role, status: role === 'STAFF' ? 'PENDING_APPROVAL' : 'ACTIVE' };
}

/** Compatibility wrapper for older student signup callers. */
export async function registerStudentAccount(formData) {
  return registerAccount({ ...formData, role: 'STUDENT' });
}
