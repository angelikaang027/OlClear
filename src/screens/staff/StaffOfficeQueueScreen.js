import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Check, CheckSquare, ChevronDown, ExternalLink, FileText, LogOut, Menu, Search, Square, X } from 'lucide-react-native';
import { createProofPreviewUrl } from '../../api/studentApi.js';
import { fetchOfficePendingProofs, proofClearanceItemId } from '../../api/staffApi.js';
import { supabase } from '../../api/supabase.js';
import { useAuth } from '../../context/AuthContext.js';
import { ConfirmSignOutModal } from '../../components/ConfirmSignOutModal.js';

const REASONS = ['Missing Document', 'Unreturned Book', 'Unpaid Dues', 'Incomplete Requirement', 'Other'];
const asOne = (value) => Array.isArray(value) ? value[0] || null : value || null;

export function StaffOfficeQueueScreen({ navigation, route }) {
  const { user, profile: authProfile, signOut } = useAuth();
  const profile = useMemo(() => authProfile || route.params?.profile || {}, [authProfile, route.params?.profile]);
  const userId = user?.id;
  const { width } = useWindowDimensions();
  const [office, setOffice] = useState(null);
  const [period, setPeriod] = useState(null);
  const [rows, setRows] = useState([]);
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [selectedIds, setSelectedIds] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [surveyNotice, setSurveyNotice] = useState('');
  const [decisionModal, setDecisionModal] = useState(false);
  const [reason, setReason] = useState('Missing Document');
  const [reasonMenuOpen, setReasonMenuOpen] = useState(false);
  const [remark, setRemark] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);
  const [signOutVisible, setSignOutVisible] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      if (!userId || String(profile.role || '').toUpperCase() !== 'STAFF') throw new Error('Sign in with an active staff account to open this queue.');
      const { error: periodActivationError } = await supabase.rpc('activate_due_clearance_period');
      if (periodActivationError) throw periodActivationError;
      const officeId = profile.assigned_office_id;
      let officeQuery = supabase.from('offices').select('id, code, name');
      if (officeId) officeQuery = officeQuery.eq('id', officeId);
      else if (profile.office_code) officeQuery = officeQuery.eq('code', profile.office_code);
      else throw new Error('No signatory office is assigned to this staff account. Contact an administrator.');
      const [{ data: officeRow, error: officeError }, { data: activePeriod, error: periodError }] = await Promise.all([
        officeQuery.maybeSingle(),
        supabase.from('clearance_periods').select('id, title, academic_year, semester').eq('is_active', true).maybeSingle(),
      ]);
      if (officeError) throw officeError;
      if (periodError) throw periodError;
      if (!officeRow?.id) throw new Error('Your assigned signatory office could not be found.');
      setOffice(officeRow);
      setPeriod(activePeriod || null);
      if (!activePeriod?.id) { setRows([]); return; }

      const { data, error: queueError } = await supabase.from('clearance_items').select(`
        id, status, remarks, updated_at,
        clearance_requests!clearance_request_id!inner (
          id, student_id, academic_level, clearance_period_id,
          users!inner (id, full_name, student_id_number, email, department_id, program_id,
            academic_departments(code, name), programs(code, name))
        )
      `).eq('office_id', officeRow.id).eq('clearance_requests.clearance_period_id', activePeriod.id).order('updated_at', { ascending: false });
      if (queueError) throw queueError;
      const normalized = (data || []).map((item) => {
        const request = asOne(item.clearance_requests);
        const student = asOne(request?.users);
        return { ...item, request, student, department: asOne(student?.academic_departments), program: asOne(student?.programs) };
      });
      const departmentCode = profile.academic_departments?.code || profile.department_code;
      const scopedRows = ['DEAN', 'ADVISER'].includes(String(officeRow.code).toUpperCase()) && departmentCode
        ? normalized.filter((item) => item.department?.code === departmentCode)
        : normalized;
      let surveyByItem = new Map();
      setSurveyNotice('');
      if (String(officeRow.code).toUpperCase() === 'GUIDANCE' && scopedRows.length) {
        const { data: surveyRows, error: surveyError } = await supabase
          .from('guidance_exit_survey_responses')
          .select('clearance_item_id, response, created_at, updated_at')
          .in('clearance_item_id', scopedRows.map((item) => item.id));
        if (surveyError) setSurveyNotice('Guidance survey responses are unavailable until the survey database migration is applied.');
        else surveyByItem = new Map((surveyRows || []).map((response) => [response.clearance_item_id, response]));
      }
      const proofRows = await fetchOfficePendingProofs({
        ...profile,
        assigned_office_id: officeRow.id,
        office_code: officeRow.code,
      }, { clearanceItemIds: scopedRows.map((item) => item.id) });
      setRows(scopedRows.map((item) => ({
        ...item,
        guidanceSurvey: surveyByItem.get(item.id) || null,
        proofs: proofRows.filter((proof) => proofClearanceItemId(proof) === item.id),
      })));
      setSelectedIds([]);
    } catch (cause) {
      setError(cause?.message || 'Could not load your office queue.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile, userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!supabase || !office?.id) return undefined;
    let channel = supabase.channel(`staff-office-${office.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clearance_items' }, () => load(true))
    if (String(office.code || '').toUpperCase() === 'GUIDANCE') {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: 'guidance_exit_survey_responses' }, () => load(true));
    }
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [office?.code, office?.id, load]);

  const visibleRows = useMemo(() => rows.filter((row) => {
    const status = String(row.status || 'PENDING').toUpperCase();
    const isRejected = ['HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'].includes(status);
    if (statusFilter === 'APPROVED' && status !== 'APPROVED') return false;
    if (statusFilter === 'REJECTED' && !isRejected) return false;
    if (statusFilter === 'PENDING' && (status === 'APPROVED' || isRejected)) return false;
    const text = `${row.student?.full_name || ''} ${row.student?.student_id_number || ''} ${row.program?.code || ''}`.toLowerCase();
    return text.includes(search.trim().toLowerCase());
  }), [rows, search, statusFilter]);

  const canReview = (row) => ['SUBMITTED', 'IN_REVIEW', 'REQUIREMENT_NEEDED', 'PENDING'].includes(String(row.status || '').toUpperCase()) && (row.proofs || []).length > 0;
  const reviewableRows = visibleRows.filter(canReview);
  const toggleRow = (row) => {
    if (!canReview(row)) {
      Alert.alert('Proof required', 'This request can be reviewed after the student submits a proof document.');
      return;
    }
    setSelectedIds((current) => current.includes(row.id) ? current.filter((value) => value !== row.id) : [...current, row.id]);
  };
  const selectAll = () => setSelectedIds(selectedIds.length === reviewableRows.length ? [] : reviewableRows.map((row) => row.id));
  const openProof = async (proof) => {
    try {
      let url = proof.file_url || null;
      if (!url && proof.storage_path) url = await createProofPreviewUrl(proof.storage_path);
      if (!url) throw new Error('The file is unavailable. Check that it is stored in the clearance_proofs bucket.');
      await Linking.openURL(url);
    } catch (cause) {
      Alert.alert('Could not open proof', cause?.message || 'Check the file and storage permissions.');
    }
  };

  const applyBatchDecision = async (nextStatus, note = '') => {
    if (!selectedIds.length) return;
    if (nextStatus !== 'APPROVED' && !note.trim()) { Alert.alert('Reason required', 'Enter a remark before returning the selected items.'); return; }
    setBusy(true);
    const previous = rows;
    setRows((current) => current.map((row) => selectedIds.includes(row.id) ? { ...row, status: nextStatus, remarks: note.trim() || null } : row));
    try {
      const { error: updateError } = await supabase.rpc('staff_decide_clearance_items', {
        p_item_ids: selectedIds,
        p_status: nextStatus,
        p_remarks: note.trim() || null,
      });
      if (updateError) throw updateError;
      setSelectedIds([]);
      setDecisionModal(false);
      setRemark('');
      await load(true);
    } catch (cause) {
      setRows(previous);
      Alert.alert('Could not update clearance items', cause?.message || 'Your office assignment or Accounting approval may be required.');
    } finally { setBusy(false); }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      setSignOutVisible(false);
      navigation.reset({ index: 0, routes: [{ name: 'Landing' }] });
    } catch (cause) { Alert.alert('Could not sign out', cause?.message || 'Please try again.'); }
    finally { setSigningOut(false); }
  };

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}>
      <View style={styles.headerCopy}><Text style={styles.title}>{office?.name || 'Staff Office'} Queue</Text><Text style={styles.subtitle}>{period?.title || 'No active clearance period'}</Text></View>
      <Pressable onPress={() => setMenuVisible(true)} accessibilityRole="button" accessibilityLabel="Open staff menu" style={styles.menuButton}><Menu size={22} color="#FFFFFF" /></Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#1B4332" />}>
      <View style={styles.summary}><Text style={styles.summaryLabel}>ASSIGNED OFFICE</Text><Text style={styles.officeName}>{office?.name || profile.office_code || 'Loading office'}</Text><Text style={styles.summaryCaption}>{visibleRows.length} {statusFilter.toLowerCase()} requests</Text></View>
      <View style={styles.search}><Search size={17} color="#748076" /><TextInput value={search} onChangeText={setSearch} placeholder="Search name or student ID" placeholderTextColor="#89938B" style={styles.searchInput} /></View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {[
          { key: 'PENDING', label: 'Pending' },
          { key: 'APPROVED', label: 'Approved' },
          { key: 'REJECTED', label: 'Rejected' },
        ].map((tab) => {
          const count = rows.filter((row) => {
            const status = String(row.status || 'PENDING').toUpperCase();
            return tab.key === 'PENDING'
              ? status !== 'APPROVED' && !['HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'].includes(status)
              : tab.key === 'APPROVED' ? status === 'APPROVED' : ['HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'].includes(status);
          }).length;
          const active = statusFilter === tab.key;
          return <Pressable key={tab.key} onPress={() => { setStatusFilter(tab.key); setSelectedIds([]); }} accessibilityRole="tab" accessibilityState={{ selected: active }} style={[styles.tab, active && styles.tabActive]}>
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label} ({count})</Text>
          </Pressable>;
        })}
      </View>
      <View style={styles.batchBar}>
        {statusFilter === 'PENDING' ? <><Pressable onPress={selectAll} disabled={!reviewableRows.length} style={styles.selectAll}>{selectedIds.length === reviewableRows.length && reviewableRows.length ? <CheckSquare size={17} color="#1B4332" /> : <Square size={17} color="#1B4332" />}<Text style={styles.selectText}>{selectedIds.length ? `${selectedIds.length} selected` : `Select all (${reviewableRows.length})`}</Text></Pressable>
        <View style={styles.batchActions}><Pressable disabled={!selectedIds.length || busy} onPress={() => applyBatchDecision('APPROVED')} style={[styles.approveButton, (!selectedIds.length || busy) && styles.disabled]}><Check size={15} color="#FFFFFF" /><Text style={styles.approveText}>Approve</Text></Pressable><Pressable disabled={!selectedIds.length || busy} onPress={() => { setReason('Missing Document'); setDecisionModal(true); }} style={[styles.returnButton, (!selectedIds.length || busy) && styles.disabled]}><Text style={styles.returnText}>Return</Text></Pressable></View></> : <Text style={styles.historyHint}>Read only</Text>}
      </View>
      {loading ? <ActivityIndicator color="#1B4332" style={styles.loader} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {surveyNotice ? <Text accessibilityRole="alert" style={styles.error}>{surveyNotice}</Text> : null}
      {visibleRows.map((row) => {
        const selected = selectedIds.includes(row.id);
        const statusColor = ['HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'].includes(row.status) ? '#B7443A' : row.status === 'SUBMITTED' ? '#A87817' : '#68766B';
        return <View key={row.id} style={[styles.requestCard, width >= 700 && styles.requestCardWide, selected && styles.requestSelected]}>
          <Pressable onPress={() => toggleRow(row)} style={styles.requestSelect} accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: !canReview(row) }}>
          <View style={styles.requestTop}><View style={styles.studentCopy}><Text style={styles.studentName}>{row.student?.full_name || 'Student profile unavailable'}</Text><Text style={styles.studentMeta}>{row.student?.student_id_number || 'No student ID'} · {row.department?.code || 'Department'} · {row.program?.code || 'Program'}</Text><Text style={[styles.status, { color: statusColor }]}>{String(row.status || 'PENDING').replaceAll('_', ' ')}</Text></View>{selected ? <CheckSquare size={20} color="#1B4332" /> : <Square size={20} color="#849087" />}</View>
          </Pressable>
          {row.proofs?.length ? <View style={styles.proofList}><Text style={styles.proofHeading}>Submitted proof</Text>{row.proofs.map((proof) => <Pressable key={proof.id} onPress={() => openProof(proof)} style={styles.proofLink}><FileText size={15} color="#1B4332" /><Text numberOfLines={1} style={styles.proofLinkText}>{proof.file_name || proof.file_type || 'Open submitted document'}</Text><ExternalLink size={14} color="#1B4332" /></Pressable>)}</View> : <Text style={styles.noProof}>Waiting for student proof submission</Text>}
          {row.remarks ? <Text style={styles.remarks}>Previous remark: {row.remarks}</Text> : null}
          {String(office?.code || '').toUpperCase() === 'GUIDANCE' && row.guidanceSurvey ? <View style={styles.proofList}><Text style={styles.proofHeading}>Student exit survey</Text><Text style={styles.surveyResponse}>{row.guidanceSurvey.response}</Text><Text style={styles.noProof}>Saved {row.guidanceSurvey.updated_at ? new Date(row.guidanceSurvey.updated_at).toLocaleString() : 'date unavailable'}</Text></View> : null}
        </View>;
      })}
      {!loading && visibleRows.length === 0 ? <View style={styles.empty}><Text style={styles.emptyTitle}>No requests need review</Text><Text style={styles.emptyCopy}>Submitted clearance items for this office will appear here.</Text></View> : null}
    </ScrollView>

    <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}><View style={styles.modalBackdrop}><Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuVisible(false)} /><View style={styles.dialog}><Text style={styles.modalTitle}>Staff menu</Text><Pressable onPress={() => { setMenuVisible(false); load(true); }} style={styles.menuAction}><Text style={styles.menuActionText}>Refresh queue</Text></Pressable><Pressable onPress={() => { setMenuVisible(false); setSignOutVisible(true); }} style={styles.menuAction}><LogOut size={16} color="#B7443A" /><Text style={[styles.menuActionText, styles.logoutText]}>Sign out</Text></Pressable></View></View></Modal>
    <Modal visible={decisionModal} transparent animationType="fade" onRequestClose={() => !busy && setDecisionModal(false)}><View style={styles.modalBackdrop}><View style={styles.dialog}>
      <View style={styles.modalHeader}><Text style={styles.modalTitle}>Return selected items</Text><Pressable onPress={() => setDecisionModal(false)} disabled={busy}><X size={20} color="#718075" /></Pressable></View>
      <Text style={styles.modalCaption}>Choose a reason and add any details the student needs.</Text>
      <Pressable onPress={() => setReasonMenuOpen((open) => !open)} style={styles.reasonPicker}><Text style={styles.reasonText}>{reason}</Text><ChevronDown size={17} color="#1B4332" /></Pressable>
      {reasonMenuOpen ? <View style={styles.reasonOptions}>{REASONS.map((entry) => <Pressable key={entry} onPress={() => { setReason(entry); setReasonMenuOpen(false); }} style={styles.reasonOption}><Text style={styles.reasonText}>{entry}</Text></Pressable>)}</View> : null}
      <TextInput value={remark} onChangeText={setRemark} placeholder="Add instructions or deficiency details" placeholderTextColor="#89938B" multiline style={styles.remarkInput} />
      <View style={styles.modalActions}><Pressable onPress={() => setDecisionModal(false)} disabled={busy} style={styles.cancelButton}><Text style={styles.cancelText}>Cancel</Text></Pressable><Pressable onPress={() => applyBatchDecision('REQUIREMENT_NEEDED', `${reason}: ${remark.trim()}`)} disabled={busy} style={[styles.submitButton, busy && styles.disabled]}>{busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitText}>Return to students</Text>}</Pressable></View>
    </View></View></Modal>
    <ConfirmSignOutModal visible={signOutVisible} title="Sign out of the staff portal?" message="You will need to sign in again to review your assigned office queue." busy={signingOut} onCancel={() => setSignOutVisible(false)} onConfirm={handleSignOut} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F7F2' },
  header: { backgroundColor: '#1B4332', paddingHorizontal: 18, paddingTop: 15, paddingBottom: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerCopy: { flex: 1 },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '900' },
  subtitle: { color: '#D5E1D6', fontSize: 12, marginTop: 4 },
  menuButton: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  content: { width: '100%', maxWidth: 1050, alignSelf: 'center', padding: 16, paddingBottom: 36 },
  summary: { backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E3EAE0', padding: 14, marginBottom: 12 },
  summaryLabel: { color: '#748076', fontSize: 10, fontWeight: '900', letterSpacing: 0.7 },
  officeName: { color: '#1B4332', fontSize: 19, fontWeight: '900', marginTop: 4 },
  summaryCaption: { color: '#68766B', fontSize: 12, marginTop: 3 },
  search: { minHeight: 45, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E0E7DE', borderRadius: 11, paddingHorizontal: 11, marginBottom: 10 },
  searchInput: { flex: 1, color: '#26362B', fontSize: 14, paddingVertical: 9 },
  tabs: { flexDirection: 'row', gap: 7, marginBottom: 10 },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8EDE6', borderRadius: 10, paddingHorizontal: 5 },
  tabActive: { backgroundColor: '#1B4332' },
  tabText: { color: '#526156', fontSize: 12, fontWeight: '800' },
  tabTextActive: { color: '#FFFFFF' },
  batchBar: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  selectAll: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  selectText: { color: '#314637', fontSize: 12, fontWeight: '800' },
  batchActions: { flexDirection: 'row', gap: 7 },
  approveButton: { minHeight: 37, paddingHorizontal: 12, borderRadius: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#1B7A43' },
  approveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  returnButton: { minHeight: 37, paddingHorizontal: 13, borderRadius: 9, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FCE9E6' },
  returnText: { color: '#A93E35', fontSize: 12, fontWeight: '900' },
  historyHint: { color: '#718075', fontSize: 11, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  loader: { marginVertical: 20 },
  error: { color: '#A5352B', backgroundColor: '#FCEAE7', padding: 11, borderRadius: 10, fontSize: 12, marginBottom: 10 },
  requestCard: { width: '100%', backgroundColor: '#FFFFFF', borderRadius: 13, borderWidth: 1, borderColor: '#E3EAE0', padding: 12, marginBottom: 9 },
  requestCardWide: { width: '49.3%' },
  requestSelected: { borderColor: '#1B7A43', backgroundColor: '#F5FAF4' },
  requestSelect: { minHeight: 52 },
  requestTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  studentCopy: { flex: 1 },
  studentName: { color: '#26362B', fontSize: 14, fontWeight: '900' },
  studentMeta: { color: '#768177', fontSize: 10, marginTop: 3 },
  status: { fontSize: 10, fontWeight: '900', marginTop: 4 },
  proofList: { marginTop: 9, padding: 10, backgroundColor: '#F5F8F3', borderRadius: 10 },
  proofHeading: { color: '#536256', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  proofLink: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#E7EDE4', marginTop: 5, paddingTop: 5 },
  proofLinkText: { flex: 1, color: '#1B4332', fontSize: 12, fontWeight: '700' },
  noProof: { color: '#778178', fontSize: 11, marginTop: 8 },
  remarks: { color: '#A14337', fontSize: 11, lineHeight: 16, marginTop: 8 },
  surveyResponse: { color: '#344338', fontSize: 12, lineHeight: 18, marginTop: 4, backgroundColor: '#F7FAF5', padding: 10, borderRadius: 9 },
  empty: { paddingVertical: 30, alignItems: 'center' },
  emptyTitle: { color: '#334438', fontSize: 15, fontWeight: '900' },
  emptyCopy: { color: '#738076', fontSize: 12, textAlign: 'center', marginTop: 5 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(13,35,19,0.48)', justifyContent: 'center', alignItems: 'center', padding: 17 },
  dialog: { width: '100%', maxWidth: 510, backgroundColor: '#FFFFFF', borderRadius: 17, padding: 16, elevation: 8 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { color: '#25362A', fontSize: 17, fontWeight: '900' },
  modalCaption: { color: '#68766B', fontSize: 12, lineHeight: 17, marginTop: 8, marginBottom: 11 },
  reasonPicker: { minHeight: 43, borderColor: '#DCE5DB', borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reasonText: { color: '#35453A', fontSize: 13, fontWeight: '700' },
  reasonOptions: { borderWidth: 1, borderColor: '#E1E8DE', borderRadius: 9, paddingHorizontal: 10, marginTop: 4 },
  reasonOption: { minHeight: 37, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#EEF1EC' },
  remarkInput: { minHeight: 85, textAlignVertical: 'top', borderColor: '#DCE5DB', borderWidth: 1, borderRadius: 10, padding: 10, color: '#26362B', marginTop: 10 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 13 },
  cancelButton: { minHeight: 40, paddingHorizontal: 13, borderRadius: 9, backgroundColor: '#EEF1EC', alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: '#526156', fontSize: 12, fontWeight: '800' },
  submitButton: { minHeight: 40, paddingHorizontal: 14, borderRadius: 9, backgroundColor: '#1B4332', alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  menuAction: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: '#EEF1EC', marginTop: 6 },
  menuActionText: { color: '#344338', fontSize: 13, fontWeight: '700' },
  logoutText: { color: '#B7443A' },
});
