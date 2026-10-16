import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View } from 'react-native';
import { Archive, CalendarDays, Pencil, Plus } from 'lucide-react-native';
import { supabase } from '../../api/supabase.js';
import { AdminButton, AdminConfirmModal, AdminField, AdminPage, AdminRow, AdminSelect, DataNote, Panel, SectionTitle, StatusPill, ADMIN_COLORS } from './AdminUI.js';

const formatISODate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function normalizeISODate(value, fallbackDate) {
  const dateValue = String(value || '').trim() || fallbackDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null;
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return dateValue;
}

function addDaysToISODate(value, days) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function isMissingDateColumnError(error) {
  const message = String(error?.message || '').toLowerCase();
  const mentionsDateColumn = message.includes('start_date') || message.includes('end_date');
  const indicatesMissingColumn = ['42703', 'PGRST204', 'PGRST202'].includes(error?.code)
    || message.includes('schema cache') || message.includes('does not exist')
    || message.includes('could not find') || message.includes('missing column');
  return mentionsDateColumn && indicatesMissingColumn;
}

export function ClearancePeriodsScreen({ navigation, embedded = false }) {
  const { width } = useWindowDimensions();
  const [periods, setPeriods] = useState([]);
  const [studentCount, setStudentCount] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [pendingPeriodAction, setPendingPeriodAction] = useState(null);
  const [periodActionBusy, setPeriodActionBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('2026-2027');
  const [semester, setSemester] = useState('REGULAR_SEMESTER');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState('');

  const fetchClearancePeriods = useCallback(async () => {
    if (!supabase) { setFallback(true); return; }
    const { error: activationError } = await supabase.rpc('activate_due_clearance_period');
    if (activationError) {
      setFallback(true);
      setError(`Could not update scheduled periods: ${activationError.message}`);
      return;
    }
    const [periodResult, studentResult, requestResult] = await Promise.all([
      supabase.from('clearance_periods').select('*').order('created_at', { ascending: false }),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'STUDENT'),
      supabase.from('clearance_requests').select('clearance_period_id, clearance_items(status)'),
    ]);
    if (periodResult.error) { setFallback(true); return; }
    setError('');
    const requestStats = {};
    (requestResult.data || []).forEach((request) => {
      const stat = requestStats[request.clearance_period_id] || { request_count: 0, completed_count: 0 };
      stat.request_count += 1;
      const items = request.clearance_items || [];
      if (items.length >= 10 && items.every((item) => item.status === 'APPROVED')) stat.completed_count += 1;
      requestStats[request.clearance_period_id] = stat;
    });
    setPeriods((periodResult.data || []).map((period) => ({ ...period, ...(requestStats[period.id] || { request_count: 0, completed_count: 0 }) })));
    setStudentCount(studentResult.error ? 0 : studentResult.count || 0);
    setFallback(Boolean(studentResult.error || requestResult.error));
  }, []);
  const load = fetchClearancePeriods;
  useEffect(() => { const timer = setTimeout(fetchClearancePeriods, 0); return () => clearTimeout(timer); }, [fetchClearancePeriods]);
  const active = periods.find((period) => period.is_active);

  const toggleActive = async (period, enabled) => {
    if (!supabase) { Alert.alert('Supabase unavailable', 'Connect Supabase to change a clearance period.'); return; }
    if (!enabled) { setPendingPeriodAction({ period, action: 'close' }); return; }
    try {
      const { error } = await supabase.rpc('admin_set_clearance_period_state', { p_period_id: period.id, p_action: 'reopen' });
      if (error) throw error;
      await load();
    } catch (cause) { Alert.alert('Could not update period', cause.message); await load(); }
  };

  const openCreate = () => { setEditing(null); setTitle(''); setYear('2026-2027'); setSemester('REGULAR_SEMESTER'); setStartDate(''); setEndDate(''); setError(''); setModalOpen(true); };
  const openEdit = (period) => { setEditing(period); setTitle(period.title || ''); setYear(period.academic_year || ''); setSemester(period.semester || 'REGULAR_SEMESTER'); setStartDate(period.start_date || ''); setEndDate(period.end_date || ''); setError(''); setModalOpen(true); };

  const archivePeriod = (period) => setPendingPeriodAction({ period, action: 'archive' });

  const confirmPeriodAction = async () => {
    const { period, action } = pendingPeriodAction || {};
    if (!period || !supabase) { setPendingPeriodAction(null); return; }
    setPeriodActionBusy(true);
    setPeriods((current) => current.map((item) => ({ ...item, is_active: action === 'reopen' ? item.id === period.id : item.id === period.id ? false : item.is_active })));
    try {
      const { error } = await supabase.rpc('admin_set_clearance_period_state', { p_period_id: period.id, p_action: action });
      if (error) throw error;
      setPendingPeriodAction(null); await load();
    } catch (error) { Alert.alert('Period update failed', error.message); await load(); }
    finally { setPeriodActionBusy(false); }
  };

  const savePeriod = async () => {
    setError('');
    if (!title.trim() || !year.trim()) { setError('Enter a period title and academic year.'); return; }
    if (!supabase) { setError('Supabase is not configured.'); return; }
    const today = formatISODate(new Date());
    const safeStartDate = normalizeISODate(startDate, today);
    const defaultEndDate = safeStartDate ? addDaysToISODate(safeStartDate, 30) : null;
    const safeEndDate = normalizeISODate(endDate, defaultEndDate);
    if (!safeStartDate || !safeEndDate) {
      setError('Enter valid dates in YYYY-MM-DD format (for example, 2026-10-15).');
      return;
    }
    if (safeEndDate < safeStartDate) {
      setError('The end date must be on or after the start date.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const { error: updateError } = await supabase.rpc('admin_update_clearance_period', {
          p_period_id: editing.id,
          p_title: title.trim(),
          p_academic_year: year.trim(),
          p_semester: semester,
          p_start_date: safeStartDate,
          p_end_date: safeEndDate,
        });
        if (updateError) throw updateError;
        setModalOpen(false); setError(''); await fetchClearancePeriods();
        return;
      }
      const { data, error: createError } = await supabase.rpc('admin_open_clearance_period', {
        p_title: title.trim(),
        p_academic_year: year.trim(),
        p_semester: semester,
        p_start_date: safeStartDate,
        p_end_date: safeEndDate,
      });
      if (createError) throw createError;
      const created = data?.period || data;
      const requestCount = Number(data?.request_count || 0);
      if (!created?.id) throw new Error('The database did not return the created clearance period.');
      setPeriods((current) => [{ ...created, request_count: requestCount }, ...current.map((period) => ({
        ...period,
        is_active: created.is_active ? false : period.is_active,
      }))]);
      setModalOpen(false);
      setTitle(''); setStartDate(''); setEndDate('');
      setError('');
      await fetchClearancePeriods();
      Alert.alert(created.is_active ? 'Period opened' : 'Period scheduled', `Created ${created.title} and initialized ${requestCount} student clearance requests.${created.is_active ? '' : ` It will open on ${created.start_date}.`}`);
    } catch (cause) {
      const message = cause.message || 'Could not save this period.';
      setError(isMissingDateColumnError(cause)
        ? 'The period was not saved. The database is missing start_date/end_date or the API schema cache is stale. Apply the clearance period date migration and reload the Supabase API schema cache, then retry.'
        : message);
      if (editing) await fetchClearancePeriods();
    }
    finally { setSaving(false); }
  };

  return <AdminPage navigation={navigation} embedded={embedded} onRefresh={load} title="Clearance periods" subtitle="Manage semester access and history" rightAction={<Pressable onPress={openCreate} style={styles.add}><Plus size={18} color="#FFFFFF" /><Text style={styles.addText}>New</Text></Pressable>}>
    {fallback ? <DataNote>{error || 'Live period data is unavailable. Only periods returned by Supabase are shown.'}</DataNote> : null}
    <SectionTitle>Active period</SectionTitle>
    <Panel style={styles.activePanel}>
      <View style={styles.topRow}><View style={styles.calendarIcon}><CalendarDays size={20} color={ADMIN_COLORS.green} /></View><StatusPill tone={active ? 'green' : 'amber'}>{active ? 'ACTIVE' : 'CLOSED'}</StatusPill></View>
      <Text style={styles.activeTitle}>{active?.title || 'No active clearance period'}</Text>
      <Text style={styles.activeDetail}>{active ? `${active.academic_year || ''} · ${active.semester || 'Semester'}` : 'Open a period to accept student clearance submissions.'}</Text>
      <Text style={styles.dates}>Start: {active?.start_date || '—'}     End: {active?.end_date || '—'}</Text>
      {active ? <View style={styles.lockRow}><View style={styles.lockCopy}><Text style={styles.lockTitle}>Period submissions</Text><Text style={styles.lockSub}>Close this period to stop new student actions.</Text></View><Switch value={Boolean(active.is_active)} onValueChange={(value) => toggleActive(active, value)} trackColor={{ false: '#D9E0D7', true: '#8CAF76' }} thumbColor={active.is_active ? ADMIN_COLORS.green : '#F7F8F6'} /></View> : null}
      {active ? <AdminButton title="LOCK & CLOSE CLEARANCE PERIOD" secondary onPress={() => toggleActive(active, false)} /> : null}
    </Panel>
    <SectionTitle action="Open period" onAction={openCreate}>Period history</SectionTitle>
    <View style={[styles.periodGrid, width >= 600 && styles.periodGridWide]}>{periods.map((period) => { const isUpcoming = period.status === 'SCHEDULED' || (!period.is_active && !period.archived_at && period.start_date && new Date(`${period.start_date}T00:00:00`) > new Date()); const state = period.is_active ? 'ACTIVE' : period.archived_at || period.status === 'ARCHIVED' ? 'ARCHIVED' : isUpcoming ? 'UPCOMING' : 'CLOSED'; return <Panel key={period.id} style={[styles.historyCard, width >= 600 && styles.historyCardDesktop]}><View style={styles.historyTop}><StatusPill tone={state === 'ACTIVE' ? 'green' : state === 'UPCOMING' ? 'amber' : 'red'}>{state}</StatusPill><Text style={styles.historyDate}>{period.created_at ? new Date(period.created_at).toLocaleDateString() : '—'}</Text></View><AdminRow title={period.title} detail={`${period.academic_year || ''} · ${period.semester || ''} · ${period.start_date || 'No start date'} – ${period.end_date || 'No end date'} · ${period.completed_count ?? 0}/${period.request_count ?? 0} cleared`} /><View style={styles.periodActions}><Pressable onPress={() => openEdit(period)} style={styles.iconAction}><Pencil size={15} color={ADMIN_COLORS.green} /><Text style={styles.actionText}>Edit</Text></Pressable>{!period.archived_at ? <Pressable onPress={() => archivePeriod(period)} style={styles.iconAction}><Archive size={15} color={ADMIN_COLORS.amber} /><Text style={[styles.actionText, styles.archiveText]}>Archive</Text></Pressable> : null}{!period.is_active ? <Pressable onPress={() => toggleActive(period, true)} style={styles.iconAction}><Text style={styles.actionText}>Reopen</Text></Pressable> : null}</View></Panel>; })}</View>
    <Text style={styles.helper}>Current students available for new requests: {studentCount}</Text>
    <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}><View style={styles.modalBackdrop}><ScrollView style={styles.modalCard} contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="always"><Text style={styles.modalTitle}>{editing ? 'Edit clearance period' : 'Open new clearance period'}</Text><AdminField label="Period title" value={title} onChangeText={setTitle} placeholder="2nd Semester 2026-2027" /><AdminField label="Academic year" value={year} onChangeText={setYear} placeholder="2026-2027" /><AdminSelect label="Period type" value={semester} onChange={setSemester} options={['REGULAR_SEMESTER', 'SUMMER', 'GRADUATING']} /><AdminField label="Start date (YYYY-MM-DD)" value={startDate} onChangeText={setStartDate} placeholder="2026-10-15" /><AdminField label="End date (YYYY-MM-DD)" value={endDate} onChangeText={setEndDate} placeholder="2026-12-15" />{error ? <Text style={styles.error}>{error}</Text> : null}<Text style={styles.modalNote}>{editing ? 'Date changes update the period state and must not overlap another active or scheduled period.' : 'A period starting today opens immediately. A future start date schedules it; the app activates it on the first period request on or after that date. Requests are prepared for every active student.'}</Text><AdminButton title={editing ? 'Save changes' : 'Create period & requests'} onPress={savePeriod} loading={saving} /><AdminButton title="Cancel" secondary onPress={() => setModalOpen(false)} /></ScrollView></View></Modal>
    <AdminConfirmModal visible={Boolean(pendingPeriodAction)} title={pendingPeriodAction?.action === 'archive' ? 'Archive clearance period?' : 'Close clearance period?'} message={pendingPeriodAction?.action === 'archive' ? `${pendingPeriodAction?.period?.title || 'This period'} has associated student records. Archiving closes it and keeps its history.` : 'Students will no longer be able to submit clearance proofs for this period.'} confirmLabel={pendingPeriodAction?.action === 'archive' ? 'Archive period' : 'Close period'} destructive onCancel={() => setPendingPeriodAction(null)} onConfirm={confirmPeriodAction} busy={periodActionBusy} />
  </AdminPage>;
}

const styles = StyleSheet.create({ add: { backgroundColor: ADMIN_COLORS.green, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 11, flexDirection: 'row', gap: 5, alignItems: 'center' }, addText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12 }, activePanel: { padding: 17 }, topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, calendarIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#EAF0E6', justifyContent: 'center', alignItems: 'center' }, activeTitle: { color: ADMIN_COLORS.ink, fontSize: 20, fontWeight: '900', marginTop: 13 }, activeDetail: { color: ADMIN_COLORS.muted, fontSize: 13, marginTop: 5 }, dates: { color: '#56645A', fontSize: 12, marginTop: 13 }, lockRow: { borderTopWidth: 1, borderTopColor: ADMIN_COLORS.line, marginTop: 16, paddingTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, lockCopy: { flex: 1, paddingRight: 10 }, lockTitle: { color: ADMIN_COLORS.ink, fontSize: 14, fontWeight: '800' }, lockSub: { color: ADMIN_COLORS.muted, fontSize: 12, lineHeight: 17, marginTop: 3 }, periodGrid: { gap: 5 }, periodGridWide: { flexDirection: 'row', flexWrap: 'wrap' }, historyCard: { width: '100%', marginBottom: 8 }, historyCardDesktop: { width: '48%', flexGrow: 1 }, historyTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, historyDate: { color: ADMIN_COLORS.muted, fontSize: 11 }, periodActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 5 }, iconAction: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 9, backgroundColor: '#EEF3EB', paddingHorizontal: 9, paddingVertical: 7 }, actionText: { color: ADMIN_COLORS.green, fontSize: 11, fontWeight: '900' }, archiveText: { color: ADMIN_COLORS.amber }, helper: { color: ADMIN_COLORS.muted, fontSize: 12, marginTop: 3 }, modalBackdrop: { flex: 1, backgroundColor: 'rgba(13,35,19,0.5)', justifyContent: 'center', alignItems: 'center', padding: 17 }, modalCard: { width: '100%', maxWidth: 550, maxHeight: '94%', backgroundColor: '#FFFFFF', borderRadius: 19, padding: 17 }, modalContent: { paddingBottom: 5 }, modalTitle: { color: ADMIN_COLORS.ink, fontWeight: '900', fontSize: 20, marginBottom: 14 }, modalNote: { color: ADMIN_COLORS.muted, fontSize: 12, lineHeight: 18, marginTop: 2 }, error: { color: ADMIN_COLORS.red, fontSize: 13, marginBottom: 5 },
});
