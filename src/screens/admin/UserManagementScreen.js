import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Mail, Pencil, Search, ShieldOff, Trash2, UserPlus, Users, X } from 'lucide-react-native';
import { supabase } from '../../api/supabase.js';
import { OFFICES } from '../../constants/offices.js';
import { AdminButton, AdminConfirmModal, AdminField, AdminPage, AdminRow, AdminSelect, DataNote, Panel, SectionTitle, DEPARTMENT_FALLBACKS, ADMIN_COLORS } from './AdminUI.js';

const ROLE_TABS = [{ value: 'ALL', label: 'All' }, { value: 'STUDENT', label: 'Students' }, { value: 'STAFF', label: 'Staff' }, { value: 'ADMIN', label: 'Admins' }];
function approvalStatus(user) {
  const status = String(user?.status || '').toUpperCase();
  if (['ACTIVE', 'APPROVED'].includes(status) || user?.is_approved === true) return 'ACTIVE';
  if (status === 'PENDING_APPROVAL' || user?.is_approved === false) return 'PENDING_APPROVAL';
  return status;
}

export function UserManagementScreen({ navigation, embedded = false }) {
  const { width } = useWindowDimensions();
  const [users, setUsers] = useState([]);
  const [role, setRole] = useState('STAFF');
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('All departments');
  const [programFilter, setProgramFilter] = useState('All programs');
  const [yearFilter, setYearFilter] = useState('All year levels');
  const [assignVisible, setAssignVisible] = useState(false);
  const [accountVisible, setAccountVisible] = useState(false);
  const [editingAccount, setEditingAccount] = useState(null);
  const [accountName, setAccountName] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accountRole, setAccountRole] = useState('STAFF');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountOffice, setAccountOffice] = useState('');
  const [accountDepartment, setAccountDepartment] = useState('');
  const [pendingUserAction, setPendingUserAction] = useState(null);
  const [page, setPage] = useState(0);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [selectedOffice, setSelectedOffice] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [departments, setDepartments] = useState(DEPARTMENT_FALLBACKS);
  const [officeRows, setOfficeRows] = useState([]);
  const [assignmentByUser, setAssignmentByUser] = useState({});
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setFallback(true); return; }
    const [managedUsersResult, joinedUserResult, departmentResult, officeResult, assignmentResult] = await Promise.all([
      supabase.functions.invoke('admin-manage-user', { body: { action: 'list' } }),
      supabase.from('users').select('*, academic_departments(id, code, name), programs(id, code, name, academic_level)').order('full_name', { ascending: true }),
      supabase.from('academic_departments').select('id, code, name').order('code'),
      supabase.from('offices').select('id, code, name'),
      supabase.from('staff_office_assignments').select('user_id, office_id, department_id, offices(code, name), academic_departments(code, name)'),
    ]);
    let userResult = joinedUserResult;
    if (userResult.error) {
      userResult = await supabase.from('users').select('*').order('full_name', { ascending: true });
    }
    if (userResult.error) { setFallback(true); return; }
    const depRows = departmentResult.error || !departmentResult.data?.length ? DEPARTMENT_FALLBACKS : departmentResult.data;
    const offRows = officeResult.error || !officeResult.data?.length ? OFFICES : officeResult.data;
    setDepartments(depRows); setOfficeRows(offRows);
    if (!assignmentResult.error) {
      const assignments = {};
      (assignmentResult.data || []).forEach((assignment) => { assignments[assignment.user_id] = assignment; });
      setAssignmentByUser(assignments);
    }
    const departmentMap = Object.fromEntries(depRows.map((item) => [item.id, item.code]));
    const liveUsers = managedUsersResult.error
      ? userResult.data
      : (managedUsersResult.data?.users || userResult.data).map((row) => {
        const joinedRow = userResult.data.find((profile) => profile.id === row.id);
        return joinedRow ? { ...joinedRow, ...row } : row;
      });
    setUsers(liveUsers.map((item) => ({
      ...item,
      department_code: item.department_code || item.academic_departments?.code || departmentMap[item.department_id],
      department_name: item.department_name || item.academic_departments?.name,
      program_code: item.program_code || item.programs?.code,
      program_name: item.program_name || item.programs?.name,
    })));
    setFallback(Boolean(managedUsersResult.error || joinedUserResult.error || departmentResult.error || officeResult.error || assignmentResult.error));
  }, []);
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);

  const visibleUsers = useMemo(() => users.filter((item) => {
    if (role !== 'ALL' && String(item.role || '').toUpperCase() !== role) return false;
    const query = search.trim().toLowerCase();
    if (query && !`${item.full_name || ''} ${item.email || ''} ${item.student_id_number || ''} ${item.employee_id_number || ''}`.toLowerCase().includes(query)) return false;
    if ((role === 'STUDENT' || role === 'ALL') && departmentFilter !== 'All departments' && item.department_code !== departmentFilter) return false;
    if ((role === 'STUDENT' || role === 'ALL') && programFilter !== 'All programs' && item.program_code !== programFilter) return false;
    if ((role === 'STUDENT' || role === 'ALL') && yearFilter !== 'All year levels' && item.year_level !== yearFilter) return false;
    return true;
  }), [users, role, search, departmentFilter, programFilter, yearFilter]);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(visibleUsers.length / pageSize));
  const displayedUsers = visibleUsers.slice(page * pageSize, (page + 1) * pageSize);

  const departmentSpecific = ['DEAN', 'ADVISER'].includes(selectedOffice);
  const selectedOfficeRow = officeRows.find((item) => item.code === selectedOffice);
  const selectedDepartmentRow = departments.find((item) => item.code === selectedDepartment);
  const selectedStaffUser = users.find((item) => item.id === selectedStaff);
  const selectedStaffIsPending = approvalStatus(selectedStaffUser) === 'PENDING_APPROVAL';
  const editRoleOptions = editingAccount
    ? String(editingAccount.role || '').toUpperCase() === 'STUDENT' ? ['STUDENT'] : ['STAFF', 'ADMIN']
    : ['STAFF', 'ADMIN'];
  const requestedOffice = officeRows.find((item) => item.id === selectedStaffUser?.requested_office_id);
  const requestedDepartment = departments.find((item) => item.id === selectedStaffUser?.requested_department_id);
  const assign = async () => {
    if (!selectedStaff || !selectedOffice || (departmentSpecific && !selectedDepartment)) { Alert.alert('Assignment incomplete', 'Choose a staff member, office, and required department.'); return; }
    if (!supabase || !selectedOfficeRow?.id) { Alert.alert('Unavailable', 'Connect Supabase and load office IDs before saving an assignment.'); return; }
    setBusy(true);
    try {
      if (selectedStaffIsPending) {
        const { data, error } = await supabase.functions.invoke('admin-manage-user', { body: {
          action: 'approve',
          userId: selectedStaff,
          officeId: selectedOfficeRow.id,
          departmentId: departmentSpecific ? selectedDepartmentRow?.id || null : null,
        } });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        if (data?.approved !== true) throw new Error('The server did not confirm staff approval. Refresh and try again.');
        const approvedStaffId = selectedStaff;
        const approvedAssignment = {
          user_id: approvedStaffId,
          office_id: selectedOfficeRow.id,
          department_id: departmentSpecific ? selectedDepartmentRow?.id || null : null,
          offices: selectedOfficeRow,
          academic_departments: departmentSpecific ? selectedDepartmentRow : null,
        };
        setUsers((current) => current.map((item) => item.id === approvedStaffId
          ? { ...item, status: 'ACTIVE', is_approved: true }
          : item));
        setAssignmentByUser((current) => ({ ...current, [approvedStaffId]: approvedAssignment }));
        setAssignVisible(false);
        setSelectedStaff('');
        setSelectedOffice('');
        setSelectedDepartment('');
        Alert.alert('Staff approved', 'The staff account is active and assigned to the selected signatory office.');
        return;
      }
      const { data, error } = await supabase.functions.invoke('admin-manage-user', { body: {
        action: 'assign',
        userId: selectedStaff,
        officeId: selectedOfficeRow.id,
        departmentId: departmentSpecific ? selectedDepartmentRow?.id || null : null,
      } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.assigned !== true) throw new Error('The server did not confirm the staff reassignment. Refresh and try again.');
      setAssignmentByUser((current) => ({ ...current, [selectedStaff]: { user_id: selectedStaff, office_id: selectedOfficeRow.id, department_id: departmentSpecific ? selectedDepartmentRow?.id || null : null, offices: selectedOfficeRow, academic_departments: departmentSpecific ? selectedDepartmentRow : null } }));
      setAssignVisible(false); setSelectedStaff(''); setSelectedOffice(''); setSelectedDepartment('');
      Alert.alert('Assignment saved', 'The staff member has been reassigned to the selected office.');
    } catch (cause) { Alert.alert('Could not assign staff', cause.message); await load(); }
    finally { setBusy(false); }
  };

  const openAccount = (account = null) => {
    setEditingAccount(account);
    setAccountName(account?.full_name || ''); setAccountEmail(account?.email || '');
    setAccountId(account?.student_id_number || account?.employee_id_number || account?.id_number || '');
    const assignment = account ? assignmentByUser[account.id] : null;
    setAccountRole(String(account?.role || 'STAFF').toUpperCase()); setAccountPassword('');
    setAccountOffice(officeRows.find((item) => item.id === assignment?.office_id)?.code || '');
    setAccountDepartment(departments.find((item) => item.id === assignment?.department_id)?.code || '');
    setAccountVisible(true);
  };

  const saveAccount = async () => {
    if (!accountName.trim() || !accountEmail.trim() || !accountRole) { Alert.alert('Missing details', 'Enter the name, email, and account role.'); return; }
    const departmentRequired = ['DEAN', 'ADVISER'].includes(accountOffice);
    if (accountRole === 'STAFF' && (!accountOffice || (departmentRequired && !accountDepartment))) { Alert.alert('Office assignment required', 'Choose an office and, for a Dean or Adviser, an academic department.'); return; }
    const selectedCreateOffice = officeRows.find((item) => item.code === accountOffice);
    const selectedCreateDepartment = departments.find((item) => item.code === accountDepartment);
    if (accountRole === 'STAFF' && (!selectedCreateOffice?.id || (departmentRequired && !selectedCreateDepartment?.id))) { Alert.alert('Reference data unavailable', 'Load the office and department records from Supabase before assigning this staff account.'); return; }
    if (!supabase) { Alert.alert('Supabase unavailable', 'Account changes require a connected Supabase project.'); return; }
    setBusy(true);
    if (editingAccount) setUsers((current) => current.map((item) => item.id === editingAccount.id ? {
      ...item,
      full_name: accountName.trim(),
      email: accountEmail.trim(),
      role: accountRole,
      student_id_number: accountRole === 'STUDENT' ? accountId.trim() || null : item.student_id_number,
      employee_id_number: accountRole !== 'STUDENT' ? accountId.trim() || null : item.employee_id_number,
    } : item));
    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-user', { body: {
        action: editingAccount ? 'update' : 'create',
        userId: editingAccount?.id || null,
        fullName: accountName.trim(), email: accountEmail.trim(), role: accountRole,
        employeeId: accountRole === 'STUDENT' ? null : accountId.trim() || null, password: accountPassword || null,
        studentIdNumber: accountRole === 'STUDENT' ? accountId.trim() || null : null,
        officeCode: accountOffice,
        officeId: selectedCreateOffice?.id || null,
        departmentId: selectedCreateDepartment?.id || null,
      } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setAccountVisible(false); await load();
      Alert.alert(editingAccount ? 'Account updated' : 'Account created', 'The account, Auth identity, and staff assignment were saved.');
    } catch (cause) { Alert.alert('Account action unavailable', `${cause.message || 'Request failed'}. Deploy the admin-manage-user Supabase Edge Function to create or update Auth accounts securely.`); await load(); }
    finally { setBusy(false); }
  };

  const confirmUserAction = (account, action) => setPendingUserAction({ account, action });
  const runConfirmedUserAction = async () => {
    if (!pendingUserAction) return;
    const { account, action } = pendingUserAction;
    setBusy(true);
    setUsers((current) => action === 'delete' ? current.filter((item) => item.id !== account.id) : current.map((item) => item.id === account.id ? { ...item, is_suspended: true } : item));
    try {
      const { data, error } = await supabase.functions.invoke('admin-manage-user', { body: { action, userId: account.id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPendingUserAction(null);
    } catch (cause) { Alert.alert('Action unavailable', `${cause.message || 'Request failed'}. Ensure admin-manage-user is deployed.`); await load(); }
    finally { setBusy(false); }
  };

  const resetPassword = async (account) => {
    if (!supabase) { Alert.alert('Supabase unavailable', 'Password reset requires a connected Supabase project.'); return; }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(account.email);
      if (error) Alert.alert('Could not send reset email', error.message);
      else Alert.alert('Reset email sent', `Password reset instructions were sent to ${account.email}.`);
    } catch (error) { Alert.alert('Could not send reset email', error.message || 'Check your connection and try again.'); }
  };

  return <AdminPage navigation={navigation} embedded={embedded} onRefresh={load} title="User management" subtitle="Accounts and signatory assignments" rightAction={<View style={styles.headerActions}><Pressable onPress={() => openAccount()} style={styles.add}><UserPlus size={17} color="#FFFFFF" /><Text style={styles.addText}>Create</Text></Pressable><Pressable onPress={() => setAssignVisible(true)} style={[styles.add, styles.assignAdd]}><Text style={styles.addText}>Assign</Text></Pressable></View>}>
    {fallback ? <DataNote>Some live account or reference data could not be read. Only records returned by Supabase are shown.</DataNote> : null}
    <View style={styles.tabs}>{ROLE_TABS.map((tab) => <Pressable key={tab.value} onPress={() => { setRole(tab.value); setPage(0); }} style={[styles.tab, role === tab.value && styles.tabActive]}><Text style={[styles.tabText, role === tab.value && styles.tabTextActive]}>{tab.label}</Text></Pressable>)}</View>
    <View style={styles.search}><Search size={17} color={ADMIN_COLORS.muted} /><AdminField label="" value={search} onChangeText={(value) => { setSearch(value); setPage(0); }} placeholder="Search name, email, or ID" /></View>
    {role === 'STUDENT' || role === 'ALL' ? <View style={[styles.filters, width >= 700 && styles.filtersWide]}><AdminSelect label="Department" value={departmentFilter} options={['All departments', ...departments.map((department) => department.code).filter(Boolean)]} onChange={(value) => { setDepartmentFilter(value); setPage(0); }} /><AdminSelect label="Program" value={programFilter} options={['All programs', ...[...new Set(users.map((u) => u.program_code).filter(Boolean))]]} onChange={(value) => { setProgramFilter(value); setPage(0); }} /><AdminSelect label="Year level" value={yearFilter} options={['All year levels', '1st Year', '2nd Year', '3rd Year', '4th Year', 'Grade 11', 'Grade 12']} onChange={(value) => { setYearFilter(value); setPage(0); }} /></View> : null}
    <SectionTitle>{ROLE_TABS.find((tab) => tab.value === role)?.label} <Text>({visibleUsers.length})</Text></SectionTitle>
    <View style={[styles.userGrid, width >= 600 && styles.userGridWide]}>{displayedUsers.length ? displayedUsers.map((item) => {
      const id = item.student_id_number || item.employee_id_number || item.id?.slice(0, 8) || '—';
      const assignment = assignmentByUser[item.id];
      const userRole = String(item.role || '').toUpperCase();
      const userStatus = approvalStatus(item);
      const relation = Array.isArray(assignment?.offices) ? assignment.offices[0] : assignment?.offices;
      const officeLabel = relation?.name || item.offices?.name || item.office_name || item.office_code || 'No office assigned';
      const staffId = item.employee_id || item.employee_id_number || 'ID';
      const requestedOffice = officeRows.find((office) => office.id === item.requested_office_id);
      const requestedDepartment = departments.find((department) => department.id === item.requested_department_id);
      const detail = userRole === 'STUDENT'
        ? [id, item.academic_departments?.code || item.department_code || item.department_name, item.programs?.code || item.program_code || item.program_name, item.year_level, item.email].filter(Boolean).join(' · ')
        : userRole === 'STAFF'
          ? `${staffId} · ${officeLabel}${userStatus === 'PENDING_APPROVAL' && requestedOffice ? ` · Requested: ${requestedOffice.name}${requestedDepartment ? ` (${requestedDepartment.code})` : ''}` : ''} · ${item.email || ''}`
          : `${id} · ${item.email || ''}`;
      return <Panel key={item.id} style={[styles.userCard, width >= 600 && styles.userCardWide]}><AdminRow title={item.full_name || item.email || 'Unnamed account'} detail={detail} right={<View style={styles.badgeStack}><View style={styles.accountBadge}><Text style={styles.accountBadgeText}>{userRole}</Text></View>{userRole === 'STAFF' && userStatus === 'PENDING_APPROVAL' ? <View style={[styles.pendingBadge, styles.statusPendingBadge]}><Text style={styles.statusBadgeText}>PENDING APPROVAL</Text></View> : null}{userRole === 'STAFF' && userStatus === 'ACTIVE' ? <View style={[styles.approvedBadge, styles.statusActiveBadge]}><Text style={styles.statusBadgeText}>ACTIVE</Text></View> : null}{item.is_suspended ? <View style={styles.suspendedBadge}><Text style={styles.suspendedText}>SUSPENDED</Text></View> : null}</View>} /><View style={styles.userActions}><Pressable onPress={() => openAccount(item)} style={styles.action}><Pencil size={14} color={ADMIN_COLORS.green} /><Text style={styles.actionText}>Edit</Text></Pressable>{userRole === 'STAFF' ? <Pressable onPress={() => { setSelectedStaff(item.id); const currentAssignment = assignmentByUser[item.id]; const office = officeRows.find((row) => row.id === currentAssignment?.office_id); const requested = officeRows.find((row) => row.id === item.requested_office_id); setSelectedOffice(office?.code || (userStatus === 'PENDING_APPROVAL' ? requested?.code : '') || ''); setSelectedDepartment(departments.find((row) => row.id === currentAssignment?.department_id)?.code || (userStatus === 'PENDING_APPROVAL' ? departments.find((row) => row.id === item.requested_department_id)?.code : '') || ''); setAssignVisible(true); }} style={[styles.action, userStatus === 'PENDING_APPROVAL' && styles.approveAction]}><Users size={14} color={userStatus === 'PENDING_APPROVAL' ? '#FFFFFF' : ADMIN_COLORS.green} /><Text style={[styles.actionText, userStatus === 'PENDING_APPROVAL' && styles.approveActionText]}>{userStatus === 'PENDING_APPROVAL' ? 'Approve & assign' : 'Reassign'}</Text></Pressable> : null}<Pressable onPress={() => resetPassword(item)} style={styles.action}><Mail size={14} color={ADMIN_COLORS.green} /><Text style={styles.actionText}>Reset password</Text></Pressable><Pressable onPress={() => item.is_suspended ? supabase.functions.invoke('admin-manage-user', { body: { action: 'activate', userId: item.id } }).then(({ error }) => { if (error) throw error; setUsers((current) => current.map((userRow) => userRow.id === item.id ? { ...userRow, is_suspended: false } : userRow)); }).catch((error) => Alert.alert('Could not reactivate account', error.message)) : confirmUserAction(item, 'deactivate')} style={styles.action}><ShieldOff size={14} color={ADMIN_COLORS.amber} /><Text style={[styles.actionText, styles.warningText]}>{item.is_suspended ? 'Reactivate' : 'Suspend'}</Text></Pressable><Pressable onPress={() => confirmUserAction(item, 'delete')} style={styles.action}><Trash2 size={14} color={ADMIN_COLORS.red} /><Text style={[styles.actionText, styles.dangerText]}>Delete</Text></Pressable></View></Panel>;
    }) : <Panel style={styles.empty}><Users size={24} color="#AAB5AB" /><Text style={styles.emptyText}>No matching accounts.</Text></Panel>}</View>
    <View style={styles.pagination}><Text style={styles.paginationLabel}>Page {page + 1} of {pageCount}</Text><View style={styles.paginationButtons}><Pressable disabled={page === 0} onPress={() => setPage((value) => Math.max(0, value - 1))} style={[styles.pageButton, page === 0 && styles.pageDisabled]}><Text style={styles.pageText}>Previous</Text></Pressable><Pressable disabled={page + 1 >= pageCount} onPress={() => setPage((value) => Math.min(pageCount - 1, value + 1))} style={[styles.pageButton, page + 1 >= pageCount && styles.pageDisabled]}><Text style={styles.pageText}>Next</Text></Pressable></View></View>
    <SectionTitle>Staff assignment guidance</SectionTitle><Panel><Text style={styles.helper}>Department Dean and Organization Adviser are department-specific assignments. Staff access should be controlled with Supabase Row Level Security policies as well as these assignment records.</Text></Panel>
    <Modal visible={assignVisible} transparent animationType="slide" onRequestClose={() => setAssignVisible(false)}><View style={styles.modalBackdrop}><ScrollView style={styles.modalCard} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="always"><View style={styles.modalHeader}><Text style={styles.modalTitle}>{selectedStaffIsPending ? 'Approve and assign staff' : 'Assign staff to office'}</Text><Pressable onPress={() => setAssignVisible(false)}><X size={21} color={ADMIN_COLORS.muted} /></Pressable></View>{selectedStaffIsPending ? <DataNote>{requestedOffice ? `Requested access: ${requestedOffice.name}${requestedDepartment ? ` · ${requestedDepartment.code}` : ''}. Review the request or choose another office before approval.` : 'This staff member did not specify an office. Select an office to approve access.'}</DataNote> : null}<AdminSelect label="Staff member" value={selectedStaffUser?.full_name || ''} options={users.filter((item) => String(item.role || '').toUpperCase() === 'STAFF').map((item) => item.full_name || item.email)} onChange={(name) => { const staff = users.find((item) => (item.full_name || item.email) === name); const assignment = staff ? assignmentByUser[staff.id] : null; const requested = staff ? officeRows.find((item) => item.id === staff.requested_office_id) : null; setSelectedStaff(staff?.id || ''); setSelectedOffice(officeRows.find((item) => item.id === assignment?.office_id)?.code || (approvalStatus(staff) === 'PENDING_APPROVAL' ? requested?.code : '') || ''); setSelectedDepartment(departments.find((item) => item.id === assignment?.department_id)?.code || (approvalStatus(staff) === 'PENDING_APPROVAL' ? departments.find((item) => item.id === staff?.requested_department_id)?.code : '') || ''); }} placeholder="Choose staff account" /><AdminSelect label={selectedStaffIsPending ? 'Office to approve' : 'Signatory office'} value={OFFICES.find((item) => item.code === selectedOffice)?.name || ''} options={OFFICES.map((item) => item.name)} onChange={(name) => { setSelectedOffice(OFFICES.find((item) => item.name === name)?.code || ''); setSelectedDepartment(''); }} placeholder="Choose office" />{departmentSpecific ? <AdminSelect label="Assigned department (required)" value={selectedDepartment} options={departments.map((item) => item.code)} onChange={setSelectedDepartment} placeholder="Choose department" /> : null}<AdminButton title={selectedStaffIsPending ? 'Approve & assign' : 'Save assignment'} onPress={assign} loading={busy} /><AdminButton title="Cancel" secondary onPress={() => setAssignVisible(false)} /></ScrollView></View></Modal>
    <Modal visible={accountVisible} transparent animationType="slide" onRequestClose={() => setAccountVisible(false)}><View style={styles.modalBackdrop}><ScrollView style={styles.modalCard} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="always"><View style={styles.modalHeader}><Text style={styles.modalTitle}>{editingAccount ? 'Edit account' : 'Create staff/admin account'}</Text><Pressable onPress={() => setAccountVisible(false)}><X size={21} color={ADMIN_COLORS.muted} /></Pressable></View><AdminField label="Full name" value={accountName} onChangeText={setAccountName} placeholder="Full name" /><AdminField label="Email" value={accountEmail} onChangeText={setAccountEmail} placeholder="name@wlcormoc.edu.ph" /><AdminField label={accountRole === 'STUDENT' ? 'Student ID' : 'Employee ID'} value={accountId} onChangeText={setAccountId} placeholder="Account ID (optional)" /><AdminSelect label="Role" value={accountRole} options={editRoleOptions} onChange={(value) => { setAccountRole(value); setAccountOffice(''); setAccountDepartment(''); }} />{accountRole === 'STAFF' ? <><AdminSelect label="Assigned office" value={OFFICES.find((item) => item.code === accountOffice)?.name || ''} options={OFFICES.map((item) => item.name)} onChange={(name) => { const code = OFFICES.find((item) => item.name === name)?.code || ''; setAccountOffice(code); setAccountDepartment(''); }} placeholder="Choose office" />{['DEAN', 'ADVISER'].includes(accountOffice) ? <AdminSelect label="Assigned department" value={accountDepartment} options={departments.map((item) => item.code)} onChange={setAccountDepartment} placeholder="Choose department" /> : null}</> : null}{editingAccount ? <AdminField label="New password (optional)" value={accountPassword} onChangeText={setAccountPassword} placeholder="Leave empty to keep current password" /> : null}<DataNote>New accounts receive an invitation email. Account creation, edits, suspension, and Auth deletion use the deployed `admin-manage-user` Edge Function.</DataNote><AdminButton title={editingAccount ? 'Save account' : 'Create account & send invite'} onPress={saveAccount} loading={busy} /><AdminButton title="Cancel" secondary onPress={() => setAccountVisible(false)} /></ScrollView></View></Modal>
    <AdminConfirmModal visible={Boolean(pendingUserAction)} title={pendingUserAction?.action === 'delete' ? 'Delete user account?' : 'Suspend user account?'} message={pendingUserAction?.action === 'delete' ? `This permanently deletes ${pendingUserAction?.account?.full_name || pendingUserAction?.account?.email} and may affect linked clearance history.` : `${pendingUserAction?.account?.full_name || pendingUserAction?.account?.email} will be blocked from signing in until reactivated.`} confirmLabel={pendingUserAction?.action === 'delete' ? 'Delete account' : 'Suspend account'} destructive onCancel={() => setPendingUserAction(null)} onConfirm={runConfirmedUserAction} busy={busy} />
  </AdminPage>;
}

const styles = StyleSheet.create({
  statusPendingBadge: { backgroundColor: '#ca8a04' },
  statusActiveBadge: { backgroundColor: '#16a34a' },
  statusBadgeText: { color: '#FFFFFF', fontWeight: '900', fontSize: 8 },
  approveAction: { backgroundColor: '#16a34a' },
  approveActionText: { color: '#FFFFFF' },
  headerActions: { flexDirection: 'row', gap: 6 }, add: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: ADMIN_COLORS.green, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 11 }, assignAdd: { backgroundColor: '#426A4A' }, addText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12 }, tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, backgroundColor: '#E9EEE6', padding: 4, borderRadius: 13, marginBottom: 12 }, tab: { flex: 1, minWidth: 66, minHeight: 41, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3, borderRadius: 10 }, tabActive: { backgroundColor: '#FFFFFF', elevation: 1 }, tabText: { color: ADMIN_COLORS.muted, fontSize: 11, fontWeight: '800', textAlign: 'center' }, tabTextActive: { color: ADMIN_COLORS.green }, search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: ADMIN_COLORS.line, borderRadius: 12, paddingHorizontal: 11, paddingTop: 11 }, filters: { marginTop: 11 }, filtersWide: { flexDirection: 'row', gap: 12 }, userGrid: { gap: 1 }, userGridWide: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }, userCard: { width: '100%' }, userCardWide: { width: '49%' }, badgeStack: { alignItems: 'flex-end', gap: 4 }, accountBadge: { backgroundColor: '#EAF0E6', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10 }, accountBadgeText: { color: ADMIN_COLORS.green, fontSize: 10, fontWeight: '900' }, pendingBadge: { backgroundColor: '#FFF3D9', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8 }, pendingText: { color: ADMIN_COLORS.amber, fontWeight: '900', fontSize: 8 }, approvedBadge: { backgroundColor: '#E4F3E6', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8 }, approvedText: { color: '#287344', fontWeight: '900', fontSize: 8 }, suspendedBadge: { backgroundColor: '#FCE9E6', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8 }, suspendedText: { color: ADMIN_COLORS.red, fontWeight: '900', fontSize: 8 }, userActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, borderTopWidth: 1, borderTopColor: ADMIN_COLORS.line, paddingTop: 9, marginTop: 5 }, action: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 9, backgroundColor: '#F0F3EE' }, actionText: { color: ADMIN_COLORS.green, fontSize: 10, fontWeight: '900' }, warningText: { color: ADMIN_COLORS.amber }, dangerText: { color: ADMIN_COLORS.red }, pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }, paginationLabel: { color: ADMIN_COLORS.muted, fontSize: 12 }, paginationButtons: { flexDirection: 'row', gap: 7 }, pageButton: { backgroundColor: '#EAF0E6', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9 }, pageDisabled: { opacity: 0.45 }, pageText: { color: ADMIN_COLORS.green, fontSize: 11, fontWeight: '900' }, empty: { minHeight: 110, justifyContent: 'center', alignItems: 'center', gap: 10 }, emptyText: { color: ADMIN_COLORS.muted, fontSize: 13 }, helper: { color: ADMIN_COLORS.muted, fontSize: 13, lineHeight: 19 }, reset: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 7, backgroundColor: '#EAF0E6', borderRadius: 9 }, resetText: { color: ADMIN_COLORS.green, fontSize: 11, fontWeight: '900' }, modalBackdrop: { flex: 1, backgroundColor: 'rgba(13,35,19,0.5)', justifyContent: 'center', alignItems: 'center', padding: 17 }, modalCard: { width: '100%', maxWidth: 550, maxHeight: '94%', backgroundColor: '#FFFFFF', borderRadius: 19, padding: 17 }, modalContent: { paddingBottom: 5 }, modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 }, modalTitle: { color: ADMIN_COLORS.ink, fontWeight: '900', fontSize: 20 },
});
