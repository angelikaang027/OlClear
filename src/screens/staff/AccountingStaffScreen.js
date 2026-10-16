import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, Platform, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Check, ChevronDown, CircleDollarSign, FileText, Image as ImageIcon, LogOut, Menu, Search, ShieldAlert, User, X } from 'lucide-react-native';
import { ConfirmSignOutModal } from '../../components/ConfirmSignOutModal.js';
import { createProofPreviewUrl } from '../../api/studentApi.js';
import { fetchOfficePendingProofs, proofClearanceItemId } from '../../api/staffApi.js';
import { supabase } from '../../api/supabase.js';
import { useAuth } from '../../context/AuthContext.js';
import { AccountingLedgerEditorScreen } from './AccountingLedgerEditorScreen.js';

const LEVELS = ['HIGH_SCHOOL', 'UNDERGRADUATE', 'POSTGRADUATE'];
const STATUSES = ['ALL', 'PENDING', 'APPROVED', 'HOLD / REJECTED'];

const relation = (value) => Array.isArray(value) ? value[0] || null : value || null;
const money = (amount) => `₱${Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const levelLabel = (value) => ({ HIGH_SCHOOL: 'High School', UNDERGRADUATE: 'Undergraduate', POSTGRADUATE: 'Postgraduate' }[value] || value || 'Level not set');
const statusTone = (status) => status === 'APPROVED' ? styles.green : ['HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'].includes(status) ? styles.red : styles.amber;
const isMissingColumn = (error, column) => {
  const message = String(error?.message || '').toLowerCase();
  return (error?.code === '42703' || error?.code === 'PGRST204' || /schema cache|does not exist|could not find/i.test(message))
    && new RegExp(`(^|[^a-z0-9_])${column}($|[^a-z0-9_])`).test(message);
};
const isClearancePaperProof = (proof) => {
  const joinedItem = Array.isArray(proof?.clearance_items) ? proof.clearance_items[0] : proof?.clearance_items;
  const clearanceItemId = proof?.clearance_item_id || proof?.item_id || joinedItem?.id;
  const storageParts = String(proof?.storage_path || '').split('/');
  return String(proof?.document_type || '').toUpperCase() === 'CLEARANCE_PAPER'
    && String(proof?.file_name || '').toLowerCase().startsWith('clearance-paper-')
    && String(storageParts[0] || '').toLowerCase() === String(proof?.student_id || '').toLowerCase()
    && String(storageParts[1] || '').toLowerCase() === String(clearanceItemId || '').toLowerCase()
    && String(storageParts[2] || '').toLowerCase().includes('clearance-paper-');
};
const normalizeItem = (item) => {
  const request = relation(item.clearance_requests);
  const student = relation(request?.users);
  const department = relation(student?.academic_departments);
  const program = relation(student?.programs);
    return { ...item, request: { ...request, student: { ...student, academic_departments: department, programs: program } }, proofs: [], ledger: null };
};

export function AccountingStaffScreen({ navigation }) {
  const { user, profile, signOut } = useAuth();
  const staffUserId = user?.id;
  const staffRole = String(profile?.role || 'EMPLOYEE').toUpperCase();
  const { width } = useWindowDimensions();
  const [rows, setRows] = useState([]);
  const [period, setPeriod] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [error, setError] = useState('');
  const [staffProfile, setStaffProfile] = useState(profile || null);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('All departments');
  const [levelFilter, setLevelFilter] = useState('All levels');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [filterMenu, setFilterMenu] = useState(null);
  const [selected, setSelected] = useState(null);
  const [selectedProof, setSelectedProof] = useState(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const [signOutModalVisible, setSignOutModalVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [remark, setRemark] = useState('');
  const [balanceInput, setBalanceInput] = useState('');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [ledgerEditorVisible, setLedgerEditorVisible] = useState(false);

  const loadQueue = useCallback(async (refresh = false) => {
    if (!supabase) { setFallback(true); setError('Supabase is not configured.'); setLoading(false); setRefreshing(false); return; }
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const { error: periodActivationError } = await supabase.rpc('activate_due_clearance_period');
      if (periodActivationError) throw periodActivationError;
      const [{ data: office, error: officeError }, { data: activePeriod, error: periodError }, profileResult] = await Promise.all([
        supabase.from('offices').select('id, code, name').eq('code', 'ACCOUNTING').maybeSingle(),
        supabase.from('clearance_periods').select('*')
          .or('status.eq.ACTIVE,is_active.eq.true')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        staffUserId
          ? supabase.from('users').select('*, offices(id, name, code)').eq('id', staffUserId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (officeError) throw officeError;
      let loadedPeriod = activePeriod;
      if (periodError && isMissingColumn(periodError, 'status')) {
        const activeOnly = await supabase.from('clearance_periods').select('*')
          .eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (activeOnly.error) throw activeOnly.error;
        loadedPeriod = activeOnly.data;
      } else if (periodError && isMissingColumn(periodError, 'is_active')) {
        const statusOnly = await supabase.from('clearance_periods').select('*')
          .eq('status', 'ACTIVE').order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (statusOnly.error) throw statusOnly.error;
        loadedPeriod = statusOnly.data;
      } else if (periodError) {
        throw periodError;
      }
      if (!office?.id) throw new Error('The ACCOUNTING office is not configured in the offices table.');
      let userProfile = profileResult.data;
      if (profileResult.error && /relationship|foreign key|schema cache|could not find/i.test(String(profileResult.error.message || ''))) {
        const plainProfile = await supabase.from('users').select('*').eq('id', staffUserId).maybeSingle();
        if (plainProfile.error) throw plainProfile.error;
        userProfile = plainProfile.data;
      } else if (profileResult.error) {
        throw profileResult.error;
      }
      userProfile = userProfile || profile || null;
      setStaffProfile(userProfile);
      const currentRole = String(userProfile?.role || profile?.role || staffRole).toUpperCase();
      const { data: assignment, error: assignmentError } = staffUserId && currentRole === 'STAFF'
        ? await supabase.from('staff_office_assignments').select('office_id')
          .eq('user_id', staffUserId).eq('office_id', office.id).maybeSingle()
        : { data: null, error: null };
      if (assignmentError) throw assignmentError;
      const authorized = currentRole === 'STAFF' && Boolean(assignment?.office_id);
      if (!authorized) throw new Error('Your account is not assigned to the Accounting Office. Contact the system administrator.');
      setPeriod(loadedPeriod || null);

      const queueSelect = `
        id, office_id, status, remarks, updated_at, balance_amount, official_receipt_number, processed_at, processed_by,
        clearance_requests!clearance_request_id!inner (
          id, student_id, academic_level,
          users ( id, full_name, student_id_number, email, department_id, program_id,
            academic_departments ( code, name ), programs ( code, name ) )
        )
      `;
      const buildQueueQuery = (periodColumn) => {
        let query = supabase.from('clearance_items').select(queueSelect)
          .eq('office_id', office.id)
          .order('updated_at', { ascending: false })
          .limit(500);
        if (activePeriod?.id && periodColumn) query = query.eq(`clearance_requests.${periodColumn}`, activePeriod.id);
        return query;
      };
      let queueResult = await buildQueueQuery(loadedPeriod?.id ? 'clearance_period_id' : null);
      if (queueResult.error && loadedPeriod?.id && isMissingColumn(queueResult.error, 'clearance_period_id')) {
        queueResult = await buildQueueQuery('period_id');
      }
      const { data: items, error: itemsError } = queueResult;
      if (itemsError) throw itemsError;
      const normalized = (items || []).map(normalizeItem);
      const itemIds = normalized.map((item) => item.id).filter(Boolean);
      const studentIds = [...new Set(normalized.map((item) => item.request?.student_id).filter(Boolean))];
      const [proofRows, ledgerResult, paymentResult] = await Promise.all([
        fetchOfficePendingProofs(
          { ...userProfile, role: currentRole, assigned_office_id: currentRole === 'ADMIN' ? userProfile?.assigned_office_id : office.id },
          { clearanceItemIds: itemIds },
        ),
        studentIds.length ? supabase.from('student_ledgers').select('*').in('student_id', studentIds).order('created_at', { ascending: false }) : Promise.resolve({ data: [], error: null }),
        studentIds.length ? supabase.from('student_payments').select('*').in('student_id', studentIds).order('payment_date', { ascending: false }) : Promise.resolve({ data: [], error: null }),
      ]);
      // Ledgers are optional in this deployment; retain the review queue if that table is not installed.
      const ledgers = ledgerResult.error ? [] : ledgerResult.data || [];
      const payments = paymentResult.error ? [] : paymentResult.data || [];
      const newestLedgerByStudent = {};
      ledgers.forEach((ledger) => { if (!newestLedgerByStudent[ledger.student_id]) newestLedgerByStudent[ledger.student_id] = ledger; });
      setRows(normalized.map((item) => ({ ...item,
        proofs: proofRows.filter((proof) => proofClearanceItemId(proof) === item.id),
        ledger: newestLedgerByStudent[item.request?.student_id] || null,
        payments: payments.filter((payment) => payment.student_id === item.request?.student_id),
      })));
      setFallback(false);
      setError('');
    } catch (cause) {
      setRows([]);
      setFallback(true);
      setError(cause?.message || 'Could not load the Accounting review queue.');
    } finally { setLoading(false); setRefreshing(false); }
  }, [staffUserId, staffRole, profile]);

  useFocusEffect(useCallback(() => { loadQueue(); }, [loadQueue]));
  useEffect(() => {
    if (!supabase) return undefined;
    const channel = supabase.channel('accounting-clearance-queue')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clearance_items' }, () => loadQueue(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clearance_proofs' }, () => loadQueue(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadQueue]);

  const visibleRows = useMemo(() => rows.filter((row) => {
    const student = row.request?.student || {};
    const department = student.academic_departments?.code || '';
    const q = search.trim().toLowerCase();
    const matchedSearch = !q || `${student.full_name || ''} ${student.student_id_number || ''} ${student.email || ''}`.toLowerCase().includes(q);
    const matchedDepartment = departmentFilter === 'All departments' || department === departmentFilter;
    const matchedLevel = levelFilter === 'All levels' || row.request?.academic_level === levelFilter;
    const hasClearancePaper = (row.proofs || []).some(isClearancePaperProof);
    const matchedStatus = statusFilter === 'ALL' || (statusFilter === 'APPROVED' && row.status === 'APPROVED') || (statusFilter === 'PENDING' && !['APPROVED', 'HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'].includes(row.status)) || (statusFilter === 'HOLD / REJECTED' && ['HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'].includes(row.status));
    return hasClearancePaper && matchedSearch && matchedDepartment && matchedLevel && matchedStatus;
  }), [rows, search, departmentFilter, levelFilter, statusFilter]);
  const departmentOptions = useMemo(() => [...new Set(rows
    .map((row) => row.request?.student?.academic_departments?.code)
    .filter(Boolean))].sort((a, b) => a.localeCompare(b)), [rows]);
  const metrics = useMemo(() => ({
    pending: rows.filter((row) => ['PENDING', 'SUBMITTED', 'IN_PROGRESS'].includes(row.status)).length,
    approved: rows.filter((row) => row.status === 'APPROVED').length,
    holds: rows.filter((row) => ['HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'].includes(row.status)).length,
    total: rows.length,
  }), [rows]);

  const openInspector = (row) => {
    setSelected(row);
    setRemark(row.remarks || '');
    const currentBalance = row.ledger?.is_configured ? row.ledger.outstanding_balance : null;
    setBalanceInput(currentBalance == null ? '' : String(currentBalance));
    setReceiptNumber(row.official_receipt_number || row.ledger?.official_receipt_number || '');
  };
  const updateDecision = async (nextStatus, note, target = selected) => {
    if (!target?.id || String(target.id).startsWith('preview-')) { Alert.alert('Preview only', 'Connect to Supabase to update a real clearance item.'); return; }
    const hasClearancePaper = (target.proofs || []).some(isClearancePaperProof);
    if (nextStatus === 'APPROVED' && !hasClearancePaper) {
      Alert.alert('Clearance paper required', 'A student must upload a photo of the physical Accounting Clearance Paper before approval.');
      return;
    }
    if (nextStatus === 'APPROVED' && !target.ledger?.is_configured) {
      Alert.alert('Ledger setup required', 'Enter and save the student’s actual fee amounts before approving the Accounting clearance.');
      return;
    }
    if (nextStatus !== 'APPROVED' && !note.trim()) { Alert.alert('Remark required', 'Enter a reason before placing this student on hold.'); return; }
    const decisionStatus = nextStatus === 'REJECTED' ? 'REQUIREMENT_NEEDED' : nextStatus;
    setSaving(true);
    const updatedAt = new Date().toISOString();
    setRows((current) => current.map((row) => row.id === target.id ? {
      ...row,
      status: decisionStatus,
      remarks: note.trim() || null,
      balance_amount: decisionStatus === 'APPROVED' ? 0 : row.balance_amount,
      updated_at: updatedAt,
      verified_at: decisionStatus === 'APPROVED' ? updatedAt : null,
      verified_by: decisionStatus === 'APPROVED' ? staffUserId : null,
      proofs: (row.proofs || []).map((proof) => isClearancePaperProof(proof)
        ? { ...proof, status: decisionStatus, reviewed_at: updatedAt, rejection_reason: decisionStatus === 'APPROVED' ? null : note.trim() }
        : proof),
    } : row));
    try {
      // A single database RPC keeps the item, its proof review state, and the
      // student ledger in the same PostgreSQL transaction.
      const { error: decisionError } = await supabase.rpc('accounting_decide_clearance_item', {
        p_item_id: target.id,
        p_status: decisionStatus,
        p_remarks: note.trim() || null,
      });
      if (decisionError) throw decisionError;
      const { data: savedItem, error: verifyError } = await supabase
        .from('clearance_items')
        .select('id, status, office_id')
        .eq('id', target.id)
        .maybeSingle();
      if (verifyError) throw verifyError;
      if (!savedItem || String(savedItem.status || '').toUpperCase() !== decisionStatus
        || savedItem.office_id !== target.office_id) {
        throw new Error('The Accounting clearance status was not saved. Refresh the queue and verify this student item before approving again.');
      }
      if (target.id === selected?.id) setSelected(null);
      await loadQueue(true);
      Alert.alert(decisionStatus === 'APPROVED' ? 'Clearance paper approved' : 'Clearance paper rejected', decisionStatus === 'APPROVED' ? 'The Accounting item is approved, the ledger balance is cleared, and the student can access the other offices.' : 'The student will see the rejection reason in their Accounting status.');
    } catch (cause) {
      await loadQueue(true);
      Alert.alert('Could not update clearance', cause?.message || 'Please try again.');
    } finally { setSaving(false); }
  };
  const saveFinancials = async () => {
    if (!selected?.id) { Alert.alert('Clearance item unavailable', 'Reload the queue and select this student again.'); return; }
    if (!selected.ledger?.is_configured) { Alert.alert('Ledger setup required', 'Enter and save the student’s actual tuition, laboratory, and miscellaneous fees first.'); return; }
    if (!balanceInput.trim()) { Alert.alert('Check the balance', 'Enter a balance of zero or more.'); return; }
    const balance = Number(balanceInput);
    if (!Number.isFinite(balance) || balance < 0) { Alert.alert('Check the balance', 'Enter a valid amount of zero or more.'); return; }
    setSaving(true);
    try {
      const { error: financialError } = await supabase.rpc('accounting_adjust_clearance_balance', {
        p_item_id: selected.id,
        p_balance: balance,
        p_receipt_number: receiptNumber.trim() || null,
      });
      if (financialError) throw financialError;
      await loadQueue(true);
      Alert.alert('Financial details saved', 'The Accounting item and student ledger balance were updated together.');
    } catch (cause) { Alert.alert('Could not save financial details', cause?.message || 'Please try again.'); }
    finally { setSaving(false); }
  };
  const inspectProof = async (proof) => {
    if (proof.storage_path) {
      try {
        const url = await createProofPreviewUrl(proof.storage_path);
        if (!url) return;
        if (String(proof.mime_type || proof.file_type || '').includes('pdf')) { await Linking.openURL(url); return; }
        setSelectedProof(url);
      } catch (cause) { Alert.alert('Could not open clearance paper', cause?.message || 'Check storage access policies.'); }
      return;
    }
    if (proof.file_url) {
      if (String(proof.mime_type || proof.file_type || '').includes('pdf')) { await Linking.openURL(proof.file_url); return; }
      setSelectedProof(proof.file_url); return;
    }
    Alert.alert('Clearance paper unavailable', 'This proof record has no storage path or file URL.');
  };
  const periodTitle = period?.title || [period?.semester, period?.academic_year].filter(Boolean).join(' ') || 'No active clearance period';
  const staffName = staffProfile?.full_name || user?.email || 'Accounting Officer';
  const officeTitle = staffProfile?.office_name || (staffProfile?.office_code === 'ACCOUNTING'
    ? 'Accounting Office'
    : staffProfile?.office_code ? `${String(staffProfile.office_code).replaceAll('_', ' ')} Office` : 'Accounting Office');
  const employeeId = staffProfile?.employee_id_number || 'Not set';
  const departmentName = staffProfile?.academic_departments?.name || staffProfile?.department_name;
  const staffAffiliation = departmentName
    ? `Western Leyte College · ${departmentName}`
    : `Western Leyte College · ${officeTitle}`;
  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      setSignOutModalVisible(false);
      setMenuVisible(false);
      navigation.reset({ index: 0, routes: [{ name: 'Landing' }] });
    } catch (cause) {
      Alert.alert('Could not sign out', cause?.message || 'Please try again.');
    } finally {
      setSigningOut(false);
    }
  };

  return <SafeAreaView style={styles.safe}>
    <View style={styles.topbar}>
      <Pressable onPress={() => navigation.goBack()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back"><ArrowLeft size={20} color="#FFFFFF" /></Pressable>
      <View style={styles.headerCopy}><Text style={styles.title}>Accounting Office</Text><Text style={styles.subtitle}>Student Clearance Queue</Text></View>
      <Pressable onPress={() => setMenuVisible(true)} style={styles.menuButton} accessibilityRole="button" accessibilityLabel="Open staff menu"><Menu size={22} color="#FFFFFF" /></Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadQueue(true)} tintColor="#1B4332" />}>
      <View style={styles.periodBanner}><CircleDollarSign size={19} color="#E5D47C" /><Text style={styles.periodText}>{periodTitle}</Text><Text style={styles.periodTag}>{period?.is_active === false || String(period?.status || '').toUpperCase() === 'CLOSED' ? 'CLOSED' : period?.id ? 'ACTIVE' : 'PERIOD'}</Text></View>
      {fallback ? <View style={styles.warning}><Text style={styles.warningText}>{error ? `Live data unavailable: ${error}` : 'Connect Supabase to review student submissions.'}</Text></View> : null}
      <View style={[styles.staffProfileCard, width >= 600 && styles.staffProfileCardWide]}>
        <View style={styles.staffProfileTopRow}>
          <Text style={styles.staffOfficeTitle} numberOfLines={1}>{officeTitle}</Text>
          <View style={styles.staffRoleBadge}><Text style={styles.staffRoleText}>{staffRole}</Text></View>
        </View>
        <View style={styles.staffProfileMiddleRow}>
          <View style={styles.staffIdentity}>
            <Text style={styles.staffName} numberOfLines={2}>{staffName}</Text>
            <Text style={styles.staffAffiliation} numberOfLines={2}>{staffAffiliation}</Text>
            <Text style={styles.staffEmployeeId}>Employee ID: {employeeId}</Text>
          </View>
          <View style={styles.staffAvatar}><User size={29} color="#1B4332" strokeWidth={2.2} /></View>
        </View>
      </View>
      <View style={[styles.metrics, width >= 650 && styles.metricsWide]}>
        <Metric label="Pending Review" value={metrics.pending} color="#A66B10" />
        <Metric label="Accounting Approved" value={metrics.approved} color="#23834B" />
        <Metric label="Holds / Balance Due" value={metrics.holds} color="#B5473B" />
        <Metric label="Total Assigned Students" value={metrics.total} color="#1B4332" />
      </View>
      <View style={styles.filterPanel}>
        <View style={styles.searchBox}><Search size={18} color="#748076" /><TextInput value={search} onChangeText={setSearch} placeholder="Search student name or ID" placeholderTextColor="#8A958B" style={styles.searchInput} returnKeyType="search" /></View>
        <View style={[styles.filters, width >= 800 && styles.filtersWide]}>
          <Filter label={departmentFilter} options={['All departments', ...departmentOptions]} menuKey="department" current={filterMenu} setCurrent={setFilterMenu} onChange={(v) => { setDepartmentFilter(v); setFilterMenu(null); }} />
          <Filter label={levelFilter === 'All levels' ? 'All academic levels' : levelLabel(levelFilter)} options={['All levels', ...LEVELS]} menuKey="level" current={filterMenu} setCurrent={setFilterMenu} onChange={(v) => { setLevelFilter(v); setFilterMenu(null); }} format={levelLabel} />
          <Filter label={statusFilter === 'ALL' ? 'All statuses' : statusFilter} options={STATUSES} menuKey="status" current={filterMenu} setCurrent={setFilterMenu} onChange={(v) => { setStatusFilter(v); setFilterMenu(null); }} />
        </View>
      </View>
      <View style={styles.listHeading}><View><Text style={styles.sectionTitle}>Financial clearance queue</Text><Text style={styles.sectionSubtitle}>{visibleRows.length} student{visibleRows.length === 1 ? '' : 's'} match these filters</Text></View><View style={styles.listHeadingActions}>{loading ? <ActivityIndicator color="#1B4332" /> : null}<Pressable onPress={() => setLedgerEditorVisible(true)} style={styles.ledgerButton}><CircleDollarSign size={15} color="#FFFFFF" /><Text style={styles.ledgerButtonText}>Manage Ledgers</Text></Pressable></View></View>
      {visibleRows.map((row) => <StudentCard key={row.id} row={row} wide={width >= 760} onInspect={() => openInspector(row)} onApprove={() => Alert.alert('Approve Accounting clearance?', `Confirm payment clearance for ${row.request?.student?.full_name || 'this student'}? This unlocks the remaining clearance offices.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Approve', onPress: () => updateDecision('APPROVED', '', row) }])} onHold={() => openInspector(row)} />)}
      {!loading && visibleRows.length === 0 ? <View style={styles.empty}><FileText size={27} color="#819083" /><Text style={styles.emptyTitle}>No students in this queue</Text><Text style={styles.emptyText}>Try changing the search or filters.</Text></View> : null}
      {fallback ? <Pressable onPress={() => loadQueue(true)} style={styles.retry}><Text style={styles.retryText}>Retry live data</Text></Pressable> : null}
    </ScrollView>

    <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
      <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)}>
        <View style={styles.menuCard}>
          <Text style={styles.menuTitle}>Staff menu</Text>
          <Pressable style={styles.menuAction} onPress={() => { setMenuVisible(false); loadQueue(true); }}>
            <CircleDollarSign size={18} color="#1B4332" /><Text style={styles.menuActionText}>Refresh accounting queue</Text>
          </Pressable>
          <Pressable style={styles.menuAction} onPress={() => { setMenuVisible(false); setSignOutModalVisible(true); }}>
            <LogOut size={18} color="#B5473B" /><Text style={[styles.menuActionText, styles.menuSignOutText]}>Sign out</Text>
          </Pressable>
          <Pressable style={styles.menuClose} onPress={() => setMenuVisible(false)}><Text style={styles.menuCloseText}>Close</Text></Pressable>
        </View>
      </Pressable>
    </Modal>

    <AccountingLedgerEditorScreen visible={ledgerEditorVisible} onClose={() => setLedgerEditorVisible(false)} onSaved={() => loadQueue(true)} />
    <Modal visible={Boolean(selected)} transparent animationType="fade" onRequestClose={() => !saving && setSelected(null)}>
      <View style={styles.modalBackdrop}><View style={styles.inspector}>
        <View style={styles.modalHeader}><View style={{ flex: 1 }}><Text style={styles.modalTitle}>Financial inspector</Text><Text style={styles.modalSubtitle}>{selected?.request?.student?.full_name || 'Student'} · {selected?.request?.student?.student_id_number || 'No student ID'}</Text></View><Pressable onPress={() => setSelected(null)} disabled={saving} style={styles.closeButton}><X size={20} color="#4C5A4E" /></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
          <View style={styles.balanceCard}><Text style={styles.balanceLabel}>OUTSTANDING BALANCE</Text><Text style={styles.balance}>{selected?.ledger?.is_configured ? money(selected.ledger.outstanding_balance) : 'Not configured'}</Text><Text style={styles.balanceHelp}>{selected?.ledger?.is_configured ? selected.ledger.required_action : 'Actual fees must be entered by Accounting before approval'}</Text></View>
          <Text style={styles.groupTitle}>Fee breakdown</Text>
          <FeeRow label="Tuition fee" value={selected?.ledger?.is_configured ? money(selected.ledger.tuition_fee) : '—'} /><FeeRow label="Laboratory fee" value={selected?.ledger?.is_configured ? money(selected.ledger.lab_fee) : '—'} /><FeeRow label="Miscellaneous fee" value={selected?.ledger?.is_configured ? money(selected.ledger.misc_fee) : '—'} /><FeeRow label="Library fine" value={selected?.ledger?.is_configured ? money(selected.ledger.library_fine) : '—'} /><FeeRow label="Late dues" value={selected?.ledger?.is_configured ? money(selected.ledger.late_dues) : '—'} />
          {!selected?.ledger ? <Text style={styles.note}>No ledger record is linked. Fee lines are shown as zero until a ledger is configured.</Text> : null}
          <Text style={styles.groupTitle}>Payment history ({selected?.payments?.length || 0})</Text>
          {selected?.payments?.length ? selected.payments.map((payment) => <FeeRow key={payment.id} label={`${payment.payment_date ? new Date(payment.payment_date).toLocaleDateString() : 'Payment'} · ${payment.status || 'RECORDED'}`} value={money(payment.amount)} />) : <Text style={styles.note}>No payment history is recorded for this student.</Text>}
          <Text style={styles.groupTitle}>Physical clearance paper ({selected?.proofs?.filter(isClearancePaperProof).length || 0})</Text>
          {selected?.proofs?.length ? <View style={styles.proofList}>{selected.proofs.map((proof) => <Pressable key={proof.id} style={styles.proofCard} onPress={() => inspectProof(proof)}>{proof.preview_url && !String(proof.mime_type || proof.file_type || '').toLowerCase().includes('pdf') ? <Image source={{ uri: proof.preview_url }} resizeMode="cover" style={styles.proofIcon} /> : <View style={styles.proofIcon}><ImageIcon size={19} color="#1B4332" /></View>}<View style={{ flex: 1 }}><Text style={styles.proofName} numberOfLines={1}>{proof.file_name || proof.file_url?.split('/').pop() || 'Payment receipt'}</Text><Text style={styles.proofDate}>{proof.created_at || proof.uploaded_at ? new Date(proof.created_at || proof.uploaded_at).toLocaleString() : 'Uploaded proof'}</Text></View><Text style={styles.viewProof}>View</Text></Pressable>)}</View> : <Text style={styles.note}>No receipt has been uploaded for this clearance item.</Text>}
          <Text style={styles.groupTitle}>Manual balance override</Text>
          <LabeledInput label="Outstanding balance (PHP)" value={balanceInput} onChangeText={setBalanceInput} keyboardType="decimal-pad" placeholder="0.00" />
          <LabeledInput label="Official receipt number (optional)" value={receiptNumber} onChangeText={setReceiptNumber} placeholder="OR number" />
          <Pressable onPress={saveFinancials} disabled={saving || !selected?.id} style={[styles.secondaryAction, (saving || !selected?.id) && styles.disabled]}><Text style={styles.secondaryActionText}>Save financial details</Text></Pressable>
          <Text style={styles.groupTitle}>Decision</Text>
          <LabeledInput label="Remark (required for hold)" value={remark} onChangeText={setRemark} placeholder="Explain what the student needs to resolve" multiline />
          <Pressable onPress={() => updateDecision('APPROVED', '')} disabled={saving} style={[styles.approveAction, saving && styles.disabled]}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <><Check size={18} color="#FFFFFF" /><Text style={styles.actionText}>APPROVE CLEARANCE</Text></>}</Pressable>
          <View style={styles.decisionRow}><Pressable onPress={() => updateDecision('REQUIREMENT_NEEDED', remark)} disabled={saving} style={[styles.holdAction, saving && styles.disabled]}><ShieldAlert size={16} color="#8A5C0D" /><Text style={styles.holdText}>REQUIREMENT NEEDED</Text></Pressable><Pressable onPress={() => updateDecision('REJECTED', remark)} disabled={saving} style={[styles.rejectAction, saving && styles.disabled]}><Text style={styles.rejectText}>REJECT</Text></Pressable></View>
        </ScrollView>
      </View></View>
    </Modal>
    <Modal visible={Boolean(selectedProof)} transparent animationType="fade" onRequestClose={() => setSelectedProof(null)}>
      <View style={styles.previewBackdrop}><Pressable onPress={() => setSelectedProof(null)} style={styles.previewClose}><X size={23} color="#FFFFFF" /></Pressable>{selectedProof ? <Image source={{ uri: selectedProof }} resizeMode="contain" style={styles.previewImage} /> : null}</View>
    </Modal>
    <ConfirmSignOutModal
      visible={signOutModalVisible}
      title="Sign out of the staff portal?"
      message="You will return to the welcome screen and need to sign in again to review clearance requests."
      busy={signingOut}
      onCancel={() => setSignOutModalVisible(false)}
      onConfirm={handleSignOut}
    />
  </SafeAreaView>;
}

function Metric({ label, value, color }) { return <View style={[styles.metric, { borderTopColor: color }]}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function FeeRow({ label, value }) { return <View style={styles.feeRow}><Text style={styles.feeLabel}>{label}</Text><Text style={styles.feeValue}>{value}</Text></View>; }
function StudentCard({ row, wide, onInspect, onApprove, onHold }) {
  const student = row.request?.student || {};
  const department = student.academic_departments?.code || 'Department';
  const program = student.programs?.code || 'Program';
  const ledgerConfigured = row.ledger?.is_configured === true;
  const balance = ledgerConfigured ? Number(row.ledger?.outstanding_balance ?? 0) : null;
  const approved = row.status === 'APPROVED';
  return <View style={[styles.studentCard, wide && styles.studentCardWide]}>
    <View style={styles.studentTop}><View style={styles.initial}><Text style={styles.initialText}>{(student.full_name || 'S').slice(0, 1).toUpperCase()}</Text></View><View style={styles.studentCopy}><Text style={styles.studentName}>{student.full_name || 'Student profile unavailable'}</Text><Text style={styles.studentMeta}>{student.student_id_number || 'No ID'} · {department} / {program}</Text><View style={styles.badgeRow}><Text style={styles.levelBadge}>{levelLabel(row.request?.academic_level)}</Text><Text style={[styles.statusBadge, statusTone(row.status)]}>{String(row.status || 'PENDING').replaceAll('_', ' ')}</Text></View></View><View style={[styles.balanceBadge, { backgroundColor: !ledgerConfigured ? '#EDF0EC' : balance > 0 ? '#FCE9E6' : '#E8F3E9' }]}><Text style={[styles.balanceBadgeAmount, { color: !ledgerConfigured ? '#68766B' : balance > 0 ? '#B5473B' : '#23834B' }]}>{ledgerConfigured ? money(balance) : 'Not set'}</Text><Text style={[styles.balanceBadgeLabel, { color: !ledgerConfigured ? '#68766B' : balance > 0 ? '#B5473B' : '#23834B' }]}>{ledgerConfigured ? (balance > 0 ? 'DUE' : 'CLEARED') : 'LEDGER'}</Text></View></View>
    <View style={styles.receiptLine}><FileText size={15} color="#55705C" /><Text style={styles.receiptText}>{row.proofs?.length || 0} receipt{row.proofs?.length === 1 ? '' : 's'} attached</Text>{row.proofs?.length ? <View style={styles.receiptThumb}><FileText size={13} color="#1B4332" /></View> : null}</View>
    <View style={styles.cardActions}><Pressable onPress={onInspect} style={styles.inspectButton}><Text style={styles.inspectText}>Inspect Financials</Text></Pressable>{!approved ? <Pressable onPress={onApprove} style={styles.quickApprove}><Check size={15} color="#FFFFFF" /><Text style={styles.quickApproveText}>Quick Approve</Text></Pressable> : null}<Pressable onPress={onHold} style={styles.holdButton}><Text style={styles.holdButtonText}>{approved ? 'Review' : 'Put on Hold'}</Text></Pressable></View>
  </View>;
}
function Filter({ label, options, menuKey, current, setCurrent, onChange, format = (v) => v }) {
  const open = current === menuKey;
  return <View style={styles.filterWrap}><Pressable onPress={() => setCurrent(open ? null : menuKey)} style={styles.filterButton}><Text style={styles.filterLabel} numberOfLines={1}>{label}</Text><ChevronDown size={15} color="#5B685D" /></Pressable>{open ? <View style={styles.filterOptions}>{options.map((option) => <Pressable key={option} onPress={() => onChange(option)} style={styles.filterOption}><Text style={styles.filterOptionText}>{format(option)}</Text></Pressable>)}</View> : null}</View>;
}
function LabeledInput({ label, value, onChangeText, placeholder, keyboardType, multiline }) { return <View style={styles.inputGroup}><Text style={styles.inputLabel}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#929B92" keyboardType={keyboardType} multiline={multiline} style={[styles.input, multiline && styles.multiline]} /></View>; }

const styles = StyleSheet.create({
  listHeadingActions: { flexDirection: 'row', alignItems: 'center', gap: 9 }, ledgerButton: { minHeight: 39, paddingHorizontal: 11, borderRadius: 10, backgroundColor: '#1B4332', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, ledgerButtonText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  safe: { flex: 1, backgroundColor: '#F3F6F1' }, topbar: { minHeight: 79, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#1B4332' }, backButton: { width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.13)', alignItems: 'center', justifyContent: 'center' }, menuButton: { width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.13)', alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1, minWidth: 0 }, title: { color: '#FFFFFF', fontWeight: '900', fontSize: 18, flexShrink: 1 }, subtitle: { color: '#D5E0D7', fontSize: 12, marginTop: 4 }, content: { padding: 17, paddingBottom: 55, width: '100%', maxWidth: 1250, alignSelf: 'center', flexGrow: 1 }, periodBanner: { backgroundColor: '#244F39', minHeight: 48, borderRadius: 13, paddingHorizontal: 14, marginBottom: 13, flexDirection: 'row', alignItems: 'center', gap: 9 }, periodText: { flex: 1, color: '#FFFFFF', fontWeight: '800', fontSize: 13 }, periodTag: { color: '#E5D47C', fontWeight: '900', fontSize: 10, letterSpacing: 0.7 },
  staffProfileCard: { backgroundColor: '#218653', borderRadius: 18, padding: 16, marginBottom: 15, elevation: 4, shadowColor: '#143C25', shadowOpacity: 0.18, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } }, staffProfileCardWide: { padding: 21 }, staffProfileTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, staffOfficeTitle: { flex: 1, color: '#F4D35E', fontSize: 14, fontWeight: '900', letterSpacing: 0.4 }, staffRoleBadge: { paddingHorizontal: 11, paddingVertical: 5, backgroundColor: '#F4D35E', borderRadius: 20 }, staffRoleText: { color: '#25432D', fontSize: 9, fontWeight: '900', letterSpacing: 0.6 }, staffProfileMiddleRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 14 }, staffIdentity: { flex: 1, minWidth: 0 }, staffName: { color: '#FFFFFF', fontSize: 23, lineHeight: 29, fontWeight: '900', flexShrink: 1 }, staffAffiliation: { color: '#E4F2E7', fontSize: 12, lineHeight: 17, marginTop: 7 }, staffEmployeeId: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', marginTop: 5 }, staffAvatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#F4D35E', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  warning: { backgroundColor: '#FFF2D9', borderRadius: 11, padding: 12, marginBottom: 12 }, warningText: { color: '#77530F', fontSize: 12, lineHeight: 18 }, metrics: { gap: 10, marginBottom: 14 }, metricsWide: { flexDirection: 'row', flexWrap: 'wrap' }, metric: { backgroundColor: '#FFFFFF', borderRadius: 14, borderTopWidth: 4, padding: 14, minHeight: 84, flex: 1, minWidth: 145, elevation: 1, shadowColor: '#17251A', shadowOpacity: 0.05, shadowRadius: 5 }, metricValue: { color: '#1A2D20', fontSize: 23, fontWeight: '900' }, metricLabel: { color: '#6C796E', fontSize: 11, fontWeight: '700', marginTop: 3 }, filterPanel: { backgroundColor: '#FFFFFF', padding: 13, borderRadius: 15, borderWidth: 1, borderColor: '#E3E9E1', zIndex: 2 }, searchBox: { minHeight: 46, borderWidth: 1, borderColor: '#DCE5DB', borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 11 }, searchInput: { flex: 1, minWidth: 0, color: '#18221A', fontSize: 14, paddingVertical: 9, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) }, filters: { gap: 9, marginTop: 10, zIndex: 5 }, filtersWide: { flexDirection: 'row', flexWrap: 'wrap' }, filterWrap: { flex: 1, minWidth: 145, position: 'relative', zIndex: 6 }, filterButton: { minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: '#DFE6DD', paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 }, filterLabel: { color: '#435246', fontSize: 12, fontWeight: '700', flex: 1 }, filterOptions: { position: 'absolute', top: 45, left: 0, right: 0, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DFE6DD', borderRadius: 10, elevation: 7, shadowColor: '#000000', shadowOpacity: 0.1, shadowRadius: 7, zIndex: 99, maxHeight: 225 }, filterOption: { minHeight: 39, justifyContent: 'center', paddingHorizontal: 11, borderBottomWidth: 1, borderBottomColor: '#F0F3EF' }, filterOptionText: { color: '#28382C', fontSize: 12 }, listHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 9 }, sectionTitle: { color: '#18221A', fontSize: 17, fontWeight: '900' }, sectionSubtitle: { color: '#718075', fontSize: 11, marginTop: 3 }, studentCard: { width: '100%', backgroundColor: '#FFFFFF', padding: 14, borderRadius: 15, borderWidth: 1, borderColor: '#E3E9E1', marginBottom: 11, elevation: 1, shadowColor: '#122018', shadowOpacity: 0.04, shadowRadius: 4 }, studentCardWide: { padding: 17 }, studentTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, initial: { width: 43, height: 43, borderRadius: 14, backgroundColor: '#E7F0E7', alignItems: 'center', justifyContent: 'center' }, initialText: { color: '#1B4332', fontWeight: '900', fontSize: 18 }, studentCopy: { flex: 1, minWidth: 0 }, studentName: { color: '#1E2B21', fontWeight: '900', fontSize: 14 }, studentMeta: { color: '#718075', fontSize: 11, marginTop: 4 }, badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 }, levelBadge: { color: '#36543D', backgroundColor: '#EEF3E9', fontSize: 9, fontWeight: '900', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 }, statusBadge: { overflow: 'hidden', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, fontSize: 9, fontWeight: '900' }, green: { backgroundColor: '#E7F4E9', color: '#237A42' }, amber: { backgroundColor: '#FFF1D5', color: '#8A5C0D' }, red: { backgroundColor: '#FCE9E6', color: '#A93E35' }, balanceBadge: { minWidth: 89, borderRadius: 11, padding: 9, alignItems: 'center' }, balanceBadgeAmount: { fontWeight: '900', fontSize: 12 }, balanceBadgeLabel: { fontWeight: '900', fontSize: 9, marginTop: 3, letterSpacing: 0.6 }, receiptLine: { minHeight: 35, marginTop: 7, flexDirection: 'row', alignItems: 'center', gap: 7 }, receiptText: { color: '#506454', fontSize: 11, fontWeight: '700', flex: 1 }, receiptThumb: { width: 28, height: 28, backgroundColor: '#E7F0E7', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, borderTopWidth: 1, borderTopColor: '#EEF1EC', paddingTop: 10, marginTop: 4 }, inspectButton: { minHeight: 37, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 9, backgroundColor: '#EAF0E6' }, inspectText: { color: '#1B4332', fontWeight: '800', fontSize: 11 }, quickApprove: { minHeight: 37, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 11, borderRadius: 9, backgroundColor: '#23834B' }, quickApproveText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' }, holdButton: { minHeight: 37, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 9, backgroundColor: '#FFF1D5' }, holdButtonText: { color: '#8A5C0D', fontWeight: '900', fontSize: 11 }, empty: { minHeight: 185, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderRadius: 15, gap: 7 }, emptyTitle: { color: '#26352A', fontSize: 15, fontWeight: '900' }, emptyText: { color: '#718075', fontSize: 12 }, retry: { alignSelf: 'center', padding: 12 }, retryText: { color: '#1B4332', fontWeight: '800' }, menuBackdrop: { flex: 1, backgroundColor: 'rgba(10,26,15,0.45)', justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: 70, paddingHorizontal: 14 }, menuCard: { width: '100%', maxWidth: 300, backgroundColor: '#FFFFFF', borderRadius: 15, padding: 14, elevation: 8, shadowColor: '#102014', shadowOpacity: 0.18, shadowRadius: 12 }, menuTitle: { color: '#1B2A1E', fontSize: 15, fontWeight: '900', marginBottom: 6 }, menuAction: { minHeight: 47, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#EDF1EB' }, menuActionText: { color: '#26352A', fontSize: 13, fontWeight: '800' }, menuSignOutText: { color: '#B5473B' }, menuClose: { minHeight: 38, alignItems: 'center', justifyContent: 'center', marginTop: 5 }, menuCloseText: { color: '#657267', fontSize: 12, fontWeight: '700' }, modalBackdrop: { flex: 1, backgroundColor: 'rgba(10,26,15,0.57)', justifyContent: 'center', alignItems: 'center', padding: 14 }, inspector: { width: '100%', maxWidth: 650, maxHeight: '94%', borderRadius: 19, backgroundColor: '#F5F7F3', overflow: 'hidden' }, modalHeader: { minHeight: 70, backgroundColor: '#FFFFFF', paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E4EAE3' }, modalTitle: { color: '#1B2A1E', fontSize: 18, fontWeight: '900' }, modalSubtitle: { color: '#718075', fontSize: 11, marginTop: 4 }, closeButton: { width: 37, height: 37, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#EFF3ED' }, modalContent: { padding: 16, paddingBottom: 30 }, balanceCard: { backgroundColor: '#1B4332', borderRadius: 14, padding: 15 }, balanceLabel: { color: '#D2DFD3', fontSize: 10, fontWeight: '900', letterSpacing: 0.7 }, balance: { color: '#FFFFFF', fontSize: 25, fontWeight: '900', marginTop: 4 }, balanceHelp: { color: '#E5D47C', fontWeight: '800', fontSize: 11, marginTop: 4 }, groupTitle: { color: '#233328', fontWeight: '900', fontSize: 13, marginTop: 17, marginBottom: 7 }, feeRow: { minHeight: 34, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E7ECE5' }, feeLabel: { color: '#667469', fontSize: 12 }, feeValue: { color: '#2A382D', fontWeight: '800', fontSize: 12 }, note: { backgroundColor: '#FFF1D5', padding: 10, borderRadius: 9, color: '#77530F', lineHeight: 17, fontSize: 11, marginTop: 8 }, proofList: { gap: 7 }, proofCard: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#FFFFFF', borderRadius: 10, padding: 8, borderWidth: 1, borderColor: '#E5EBE4' }, proofIcon: { width: 35, height: 35, borderRadius: 10, backgroundColor: '#E8F0E6', justifyContent: 'center', alignItems: 'center' }, proofName: { color: '#28372C', fontWeight: '800', fontSize: 11 }, proofDate: { color: '#758176', fontSize: 10, marginTop: 3 }, viewProof: { color: '#1B4332', fontSize: 11, fontWeight: '900', paddingHorizontal: 5 }, inputGroup: { marginBottom: 10 }, inputLabel: { color: '#455247', fontSize: 11, fontWeight: '800', marginBottom: 5 }, input: { minHeight: 43, borderWidth: 1, borderColor: '#DCE5DB', borderRadius: 10, backgroundColor: '#FFFFFF', paddingHorizontal: 11, color: '#18221A', fontSize: 13 }, multiline: { minHeight: 77, paddingTop: 10, textAlignVertical: 'top' }, secondaryAction: { minHeight: 41, borderWidth: 1, borderColor: '#1B4332', borderRadius: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF' }, secondaryActionText: { color: '#1B4332', fontSize: 12, fontWeight: '900' }, approveAction: { minHeight: 47, borderRadius: 11, backgroundColor: '#1B4332', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 2 }, actionText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' }, decisionRow: { flexDirection: 'row', gap: 8, marginTop: 8 }, holdAction: { minHeight: 43, flex: 1, backgroundColor: '#FFF1D5', borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 5 }, holdText: { color: '#8A5C0D', fontSize: 10, fontWeight: '900' }, rejectAction: { minHeight: 43, paddingHorizontal: 13, backgroundColor: '#FCE9E6', borderRadius: 10, justifyContent: 'center', alignItems: 'center' }, rejectText: { color: '#A93E35', fontWeight: '900', fontSize: 11 }, disabled: { opacity: 0.5 }, previewBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.91)', justifyContent: 'center', alignItems: 'center' }, previewClose: { position: 'absolute', zIndex: 1, right: 20, top: 50, width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }, previewImage: { width: '94%', height: '82%' },
});
