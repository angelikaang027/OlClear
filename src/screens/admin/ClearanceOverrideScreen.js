import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Check, Search, ShieldAlert, Trash2 } from 'lucide-react-native';
import { OFFICES } from '../../constants/offices.js';
import { supabase } from '../../api/supabase.js';
import { AdminButton, AdminField, AdminPage, AdminSelect, DataNote, Panel, SectionTitle, StatusPill, ADMIN_COLORS } from './AdminUI.js';

const STATUS_OPTIONS = ['PENDING', 'SUBMITTED', 'IN_PROGRESS', 'APPROVED', 'HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'];

export function ClearanceOverrideScreen({ navigation, route, searchQuery, onSearchChange, selectedOfficeCode, selectedRequestStatus, onOfficeFilterChange, embedded = false }) {
  const { width } = useWindowDimensions();
  const [requests, setRequests] = useState([]);
  const [localSearch, setLocalSearch] = useState('');
  const search = searchQuery ?? localSearch;
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [localOfficeFilter, setLocalOfficeFilter] = useState('All offices');
  const officeFilter = selectedOfficeCode || route?.params?.officeCode || localOfficeFilter;
  const [fallback, setFallback] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [nextStatus, setNextStatus] = useState('PENDING');
  const [adminNote, setAdminNote] = useState('');
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(async () => {
    if (!supabase) { setFallback(true); return; }
    try {
      const { error: activationError } = await supabase.rpc('activate_due_clearance_period');
      if (activationError) throw activationError;
      const { data: activePeriod, error: periodError } = await supabase.from('clearance_periods').select('id').eq('is_active', true).maybeSingle();
      if (periodError) throw periodError;
      let requestQuery = supabase.from('clearance_requests').select('*, clearance_periods(title, academic_year, semester), clearance_items(*, offices(id, code, name))').order('created_at', { ascending: false }).limit(200);
      if (activePeriod?.id) requestQuery = requestQuery.or(`clearance_period_id.eq.${activePeriod.id},overall_status.eq.VOIDED`);
      else requestQuery = requestQuery.eq('overall_status', 'VOIDED');
      const { data: rows, error } = await requestQuery;
      if (error) throw error;
      const userIds = [...new Set((rows || []).map((row) => row.student_id).filter(Boolean))];
      const { data: students, error: studentError } = userIds.length ? await supabase.from('users').select('id, full_name, student_id_number, department_id, program_id, academic_departments(code), programs(code)').in('id', userIds) : { data: [], error: null };
      if (studentError) throw studentError;
      const byId = Object.fromEntries((students || []).map((student) => [student.id, student]));
      setRequests((rows || []).map((row) => {
        const student = byId[row.student_id];
        const department = Array.isArray(student?.academic_departments) ? student.academic_departments[0] : student?.academic_departments;
        const program = Array.isArray(student?.programs) ? student.programs[0] : student?.programs;
        return { ...row, student: { ...student, department_code: department?.code, program_code: program?.code } };
      }));
      setFallback(false);
    } catch {
      setFallback(true);
      setRequests([]);
    }
  }, []);
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);
  const changeOfficeFilter = (value) => {
    setLocalOfficeFilter(value);
    onOfficeFilterChange?.(value);
    if (route?.params?.officeCode) navigation.setParams({ officeCode: null });
  };

  const visibleRequests = useMemo(() => requests.filter((request) => {
    const student = request.student || {};
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || `${student.full_name || ''} ${student.student_id_number || ''} ${student.department_code || ''} ${request.clearance_periods?.title || ''}`.toLowerCase().includes(query);
    const matchesSelectedItem = String(request.overall_status || '').toUpperCase() === 'VOIDED' || (request.clearance_items || []).some((item) => {
      const office = Array.isArray(item.offices) ? item.offices[0] : item.offices;
      const officeMatches = officeFilter === 'All offices' || (office?.code || item.office_code) === officeFilter;
      const statusMatches = statusFilter === 'All statuses' || item.status === statusFilter;
      const requestItems = request.clearance_items || [];
      const requestMatches = !selectedRequestStatus || selectedRequestStatus === 'ALL'
        || (selectedRequestStatus === 'CLEARED' && requestItems.length === OFFICES.length && requestItems.every((clearanceItem) => clearanceItem.status === 'APPROVED'))
        || (selectedRequestStatus === 'PENDING_ACTIONS' && requestItems.some((clearanceItem) => clearanceItem.status === 'PENDING'))
        || (selectedRequestStatus === 'ON_HOLD' && requestItems.some((clearanceItem) => ['HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'].includes(clearanceItem.status)));
      return officeMatches && statusMatches && requestMatches;
    });
    return matchesSearch && matchesSelectedItem;
  }), [requests, search, statusFilter, officeFilter, selectedRequestStatus]);

  const startOverride = (request, item) => { setEditing({ request, item }); setNextStatus(item.status || 'PENDING'); setAdminNote(''); setConfirmVisible(true); };
  const applyOverride = async () => {
    if (!adminNote.trim()) { Alert.alert('Admin note required', 'Add a reason for this manual status change.'); return; }
    if (!supabase || !editing?.item?.id) { Alert.alert('Supabase unavailable', 'Live clearance rows are required to make an override.'); return; }
    setBusy(true);
    const oldStatus = editing.item.status;
    setRequests((current) => current.map((request) => request.id === editing.request.id ? { ...request, clearance_items: request.clearance_items.map((item) => item.id === editing.item.id ? { ...item, status: nextStatus, remarks: `[ADMIN OVERRIDE] ${adminNote.trim()}` } : item) } : request));
    try {
      const { error } = await supabase.rpc('admin_override_clearance_item', {
        p_item_id: editing.item.id,
        p_status: nextStatus,
        p_reason: adminNote.trim(),
      });
      if (error) throw error;
      setConfirmVisible(false); setEditing(null);
    } catch (cause) {
      setRequests((current) => current.map((request) => request.id === editing.request.id ? { ...request, clearance_items: request.clearance_items.map((item) => item.id === editing.item.id ? { ...item, status: oldStatus } : item) } : request));
      Alert.alert('Override failed', cause.message);
    } finally { setBusy(false); }
  };

  const toggleRequestVoided = async () => {
    if (!voidTarget || !supabase) { Alert.alert('Unavailable', 'Live clearance requests are required to update a request.'); setVoidTarget(null); return; }
    const shouldVoid = String(voidTarget.overall_status || '').toUpperCase() !== 'VOIDED';
    if (shouldVoid && !voidReason.trim()) { Alert.alert('Reason required', 'Explain why this clearance request is being voided.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.rpc('admin_set_clearance_request_voided', {
        p_request_id: voidTarget.id,
        p_voided: shouldVoid,
        p_reason: voidReason.trim() || null,
      });
      if (error) throw error;
      setVoidTarget(null);
      setVoidReason('');
      await load();
    } catch (cause) { Alert.alert(shouldVoid ? 'Could not void request' : 'Could not restore request', cause.message); await load(); }
    finally { setBusy(false); }
  };

  return <AdminPage navigation={navigation} embedded={embedded} onRefresh={load} title="Clearance overrides" subtitle="Student queues and manual decisions">
    {fallback ? <DataNote>Live clearance data is unavailable or inaccessible. No student records are shown.</DataNote> : null}
    <View style={[styles.filters, width >= 720 && styles.filtersWide]}><View style={styles.search}><Search size={17} color={ADMIN_COLORS.muted} /><AdminField label="" value={search} onChangeText={searchQuery === undefined ? setLocalSearch : onSearchChange} placeholder="Search student, ID, or period" /></View><AdminSelect label="Office" value={officeFilter} options={['All offices', ...OFFICES.map((office) => office.code)]} onChange={changeOfficeFilter} /><AdminSelect label="Office item status" value={statusFilter} options={['All statuses', ...STATUS_OPTIONS]} onChange={setStatusFilter} /></View>
    <SectionTitle>Student requests ({visibleRequests.length})</SectionTitle>
    {visibleRequests.map((request) => <Panel key={request.id} style={styles.requestCard}><View style={styles.studentHead}><View style={styles.studentMark}><Text style={styles.studentMarkText}>{(request.student?.full_name || 'S').slice(0, 1).toUpperCase()}</Text></View><View style={styles.studentCopy}><Text style={styles.studentName}>{request.student?.full_name || 'Student profile unavailable'}</Text><Text style={styles.studentDetail}>{request.student?.student_id_number || 'No ID'} · {request.student?.department_code || 'Department'} · {request.student?.program_code || 'Program'}</Text><Text style={styles.period}>{request.clearance_periods?.title || 'Clearance period'}</Text>{String(request.overall_status || '').toUpperCase() === 'VOIDED' ? <StatusPill tone="red">VOIDED</StatusPill> : null}</View><Pressable onPress={() => { setVoidTarget(request); setVoidReason(''); }} style={String(request.overall_status || '').toUpperCase() === 'VOIDED' ? styles.restoreButton : styles.voidButton}>{String(request.overall_status || '').toUpperCase() === 'VOIDED' ? <Check size={15} color={ADMIN_COLORS.green} /> : <Trash2 size={15} color={ADMIN_COLORS.red} />}<Text style={String(request.overall_status || '').toUpperCase() === 'VOIDED' ? styles.restoreText : styles.voidText}>{String(request.overall_status || '').toUpperCase() === 'VOIDED' ? 'Restore' : 'Void'}</Text></Pressable></View>
      {String(request.overall_status || '').toUpperCase() === 'VOIDED' && request.void_reason ? <Text style={styles.remarks}>Void reason: {request.void_reason}</Text> : null}
      <View style={[styles.items, width >= 600 && styles.itemsWide]}>{(request.clearance_items || []).filter((item) => { const office = Array.isArray(item.offices) ? item.offices[0] : item.offices; return officeFilter === 'All offices' || (office?.code || item.office_code) === officeFilter; }).map((item) => { const office = Array.isArray(item.offices) ? item.offices[0] : item.offices; const officeLabel = office?.name || OFFICES.find((entry) => entry.code === item.office_code)?.name || 'Office'; return <View key={item.id || officeLabel} style={[styles.item, width >= 600 && styles.itemWide]}><View style={styles.itemCopy}><Text style={styles.office}>{officeLabel}</Text><Text style={styles.remarks} numberOfLines={2}>{item.remarks || 'No office remarks'}</Text></View><StatusPill tone={item.status === 'APPROVED' ? 'green' : ['HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'].includes(item.status) ? 'red' : 'amber'}>{item.status || 'PENDING'}</StatusPill>{String(request.overall_status || '').toUpperCase() !== 'VOIDED' ? <Pressable onPress={() => startOverride(request, item)} style={styles.overrideButton}><ShieldAlert size={14} color={ADMIN_COLORS.green} /><Text style={styles.overrideText}>Override</Text></Pressable> : null}</View>; })}</View>
    </Panel>)}
    {!visibleRequests.length ? <Panel><Text style={styles.empty}>No clearance requests match these filters.</Text></Panel> : null}
    <Modal visible={confirmVisible} transparent animationType="fade" onRequestClose={() => setConfirmVisible(false)}><View style={styles.modalBackdrop}><ScrollView style={styles.modalCard} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="always"><View style={styles.modalMark}><ShieldAlert size={21} color={ADMIN_COLORS.amber} /></View><Text style={styles.modalTitle}>Confirm status override</Text><Text style={styles.modalCopy}>Change {editing?.item?.offices?.name || 'office item'} from {editing?.item?.status || 'PENDING'} to {nextStatus}? The student and office approver will see the admin note.</Text><AdminSelect label="New status" value={nextStatus} options={STATUS_OPTIONS} onChange={setNextStatus} /><AdminField label="Admin note (required)" value={adminNote} onChangeText={setAdminNote} placeholder="Explain why this override is required" multiline /><AdminButton title="Confirm override" onPress={applyOverride} loading={busy} icon={Check} /><AdminButton title="Cancel" secondary onPress={() => setConfirmVisible(false)} /></ScrollView></View></Modal>
    <Modal visible={Boolean(voidTarget)} transparent animationType="fade" onRequestClose={() => setVoidTarget(null)}><View style={styles.modalBackdrop}><ScrollView style={styles.modalCard} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="always"><Text style={styles.modalTitle}>{String(voidTarget?.overall_status || '').toUpperCase() === 'VOIDED' ? 'Restore clearance request?' : 'Void clearance request?'}</Text><Text style={styles.modalCopy}>{String(voidTarget?.overall_status || '').toUpperCase() === 'VOIDED' ? 'This returns the saved request and office decisions to the student and assigned staff.' : 'This hides the request from the student and office queues while preserving its records.'} Student: {voidTarget?.student?.full_name || 'Unknown student'}.</Text><AdminField label={String(voidTarget?.overall_status || '').toUpperCase() === 'VOIDED' ? 'Restore note (optional)' : 'Reason (required)'} value={voidReason} onChangeText={setVoidReason} placeholder="Explain the administrative action" multiline /><AdminButton title={String(voidTarget?.overall_status || '').toUpperCase() === 'VOIDED' ? 'Restore request' : 'Void request'} onPress={toggleRequestVoided} loading={busy} /><AdminButton title="Cancel" secondary onPress={() => setVoidTarget(null)} /></ScrollView></View></Modal>
  </AdminPage>;
}

const styles = StyleSheet.create({ filters: { marginBottom: 7 }, filtersWide: { flexDirection: 'row', alignItems: 'flex-end', gap: 13 }, search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: ADMIN_COLORS.line, borderRadius: 12, paddingHorizontal: 11, paddingTop: 11 }, requestCard: { width: '100%' }, studentHead: { flexDirection: 'row', gap: 10, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: ADMIN_COLORS.line, paddingBottom: 12 }, studentMark: { width: 41, height: 41, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAF0E6' }, studentMarkText: { color: ADMIN_COLORS.green, fontSize: 17, fontWeight: '900' }, studentCopy: { flex: 1 }, studentName: { color: ADMIN_COLORS.ink, fontSize: 14, fontWeight: '900' }, studentDetail: { color: ADMIN_COLORS.muted, fontSize: 11, marginTop: 3 }, period: { color: ADMIN_COLORS.green, fontSize: 11, fontWeight: '800', marginTop: 3 }, voidButton: { flexDirection: 'row', gap: 4, alignItems: 'center', padding: 8, borderRadius: 9, backgroundColor: '#FCE9E6' }, voidText: { color: ADMIN_COLORS.red, fontSize: 11, fontWeight: '900' }, restoreButton: { flexDirection: 'row', gap: 4, alignItems: 'center', padding: 8, borderRadius: 9, backgroundColor: '#EAF0E6' }, restoreText: { color: ADMIN_COLORS.green, fontSize: 11, fontWeight: '900' }, items: { marginTop: 3 }, itemsWide: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }, item: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: '#EEF1EC' }, itemWide: { width: '49%' }, itemCopy: { flex: 1 }, office: { color: ADMIN_COLORS.ink, fontSize: 12, fontWeight: '800' }, remarks: { color: ADMIN_COLORS.muted, fontSize: 10, marginTop: 3 }, overrideButton: { flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: '#EAF0E6', padding: 7, borderRadius: 8 }, overrideText: { color: ADMIN_COLORS.green, fontSize: 10, fontWeight: '900' }, empty: { color: ADMIN_COLORS.muted, paddingVertical: 12 }, modalBackdrop: { flex: 1, backgroundColor: 'rgba(13,35,19,0.5)', justifyContent: 'center', alignItems: 'center', padding: 17 }, modalCard: { width: '100%', maxWidth: 550, maxHeight: '92%', backgroundColor: '#FFFFFF', borderRadius: 19, padding: 17 }, modalContent: { paddingBottom: 5 }, modalMark: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#FFF1D5', alignItems: 'center', justifyContent: 'center', marginBottom: 11 }, modalTitle: { color: ADMIN_COLORS.ink, fontSize: 19, fontWeight: '900' }, modalCopy: { color: ADMIN_COLORS.muted, fontSize: 13, lineHeight: 19, marginTop: 8, marginBottom: 12 },
});
