import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { CheckCircle2, Search, UserRound, X } from 'lucide-react-native';
import { supabase } from '../../api/supabase.js';
import { useAuth } from '../../context/AuthContext.js';

const money = (amount) => `PHP ${Number(amount || 0).toFixed(2)}`;
const first = (value) => Array.isArray(value) ? value[0] || null : value || null;
const EMPTY_FEES = { tuition_fee: '', lab_fee: '', misc_fee: '' };
const ledgerFees = (ledger) => ledger?.is_configured
  ? { tuition_fee: String(ledger.tuition_fee ?? ''), lab_fee: String(ledger.lab_fee ?? ''), misc_fee: String(ledger.misc_fee ?? '') }
  : { ...EMPTY_FEES };

export function AccountingLedgerEditorScreen({ visible, onClose, onSaved }) {
  const { profile } = useAuth();
  const { width } = useWindowDimensions();
  const [students, setStudents] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [fees, setFees] = useState(EMPTY_FEES);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadStudents = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    setError('');
    try {
      if (String(profile?.role || '').toUpperCase() !== 'STAFF' || String(profile?.office_code || '').toUpperCase() !== 'ACCOUNTING') {
        throw new Error('This editor is only available to active Accounting staff.');
      }
      const { error: activationError } = await supabase.rpc('activate_due_clearance_period');
      if (activationError) throw activationError;
      const [{ data: office, error: officeError }, { data: period, error: periodError }] = await Promise.all([
        supabase.from('offices').select('id').eq('code', 'ACCOUNTING').maybeSingle(),
        supabase.from('clearance_periods').select('id').eq('is_active', true).maybeSingle(),
      ]);
      if (officeError) throw officeError;
      if (periodError) throw periodError;
      if (!office?.id || !period?.id) { setStudents([]); return; }

      const { data, error: queueError } = await supabase.from('clearance_items').select(`
        id, balance_amount, status,
        clearance_requests!clearance_request_id!inner (
          id, student_id, clearance_period_id,
          users!inner (id, full_name, student_id_number, email, academic_departments(code), programs(code))
        )
      `).eq('office_id', office.id).eq('clearance_requests.clearance_period_id', period.id).order('updated_at', { ascending: false });
      if (queueError) throw queueError;

      const normalized = (data || []).map((item) => {
        const request = first(item.clearance_requests);
        const student = first(request?.users);
        return { itemId: item.id, status: item.status, balance_amount: Number(item.balance_amount || 0), studentId: student?.id, student: { ...student, academic_departments: first(student?.academic_departments), programs: first(student?.programs) } };
      }).filter((row) => row.studentId);
      const ids = [...new Set(normalized.map((row) => row.studentId))];
      const ledgerResult = ids.length
        ? await supabase.from('student_ledgers').select('id, student_id, tuition_fee, lab_fee, misc_fee, total_balance, outstanding_balance, is_configured').in('student_id', ids).order('created_at', { ascending: false })
        : { data: [], error: null };
      if (ledgerResult.error) throw ledgerResult.error;
      const ledgerByStudent = {};
      (ledgerResult.data || []).forEach((ledger) => { if (!ledgerByStudent[ledger.student_id]) ledgerByStudent[ledger.student_id] = ledger; });
      const hydrated = normalized.map((row) => ({
        ...row,
        ledger: ledgerByStudent[row.studentId] || null,
      }));
      setStudents(hydrated);
      const selectedRow = hydrated.find((row) => row.studentId === selectedId) || hydrated[0] || null;
      setSelectedId(selectedRow?.studentId || '');
      if (selectedRow) setFees(ledgerFees(selectedRow.ledger));
    } catch (cause) {
      setError(cause?.message || 'Could not load student ledgers.');
    } finally { setLoading(false); }
  }, [profile, selectedId, visible]);

  useEffect(() => {
    const timer = setTimeout(() => { loadStudents(); }, 0);
    return () => clearTimeout(timer);
  }, [loadStudents]);

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return students.filter((row) => !query || `${row.student?.full_name || ''} ${row.student?.student_id_number || ''}`.toLowerCase().includes(query));
  }, [students, search]);
  const selected = students.find((row) => row.studentId === selectedId) || null;
  const total = Number(fees.tuition_fee || 0) + Number(fees.lab_fee || 0) + Number(fees.misc_fee || 0);

  const setFee = (key, value) => setFees((current) => ({ ...current, [key]: value.replace(/[^\d.]/g, '') }));
  const saveLedger = async (markPaid = false) => {
    if (!selected?.studentId) { Alert.alert('Select a student', 'Choose a student before saving ledger details.'); return; }
    const rawAmounts = ['tuition_fee', 'lab_fee', 'misc_fee'].map((key) => fees[key].trim());
    if (rawAmounts.some((value) => !value || !Number.isFinite(Number(value)) || Number(value) < 0)) { Alert.alert('Fee amounts required', 'Enter each actual fee amount. Enter 0 when that fee does not apply.'); return; }
    const amounts = rawAmounts.map(Number);
    if (markPaid && amounts.some((amount) => amount !== 0)) { Alert.alert('Zero balance required', 'Set all three fee fields to zero before marking the student fully paid.'); return; }
    setSaving(true);
    setError('');
    try {
      const { data, error: saveError } = await supabase.rpc('accounting_save_student_ledger', {
        p_student_id: selected.studentId,
        p_tuition_fee: amounts[0],
        p_lab_fee: amounts[1],
        p_misc_fee: amounts[2],
        p_mark_paid: markPaid,
      });
      if (saveError) throw saveError;
      setStudents((current) => current.map((row) => row.studentId === selected.studentId
        ? { ...row, balance_amount: markPaid ? 0 : total, status: markPaid ? 'APPROVED' : total > 0 && row.status === 'APPROVED' ? 'PENDING' : row.status, ledger: data || { ...row.ledger, tuition_fee: amounts[0], lab_fee: amounts[1], misc_fee: amounts[2], total_balance: total, outstanding_balance: total } }
        : row));
      Alert.alert(markPaid ? 'Student marked fully paid' : 'Ledger saved', markPaid ? 'Fees are zero and the Accounting clearance item is approved.' : `Total ledger balance: ${money(total)}.`);
      await loadStudents();
      onSaved?.();
    } catch (cause) {
      setError(cause?.message || 'Could not save the student ledger.');
    } finally { setSaving(false); }
  };

  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.backdrop}>
      <View style={styles.dialog}>
        <View style={styles.header}><View style={styles.headerIcon}><UserRound size={20} color="#1B4332" /></View><View style={styles.headerCopy}><Text style={styles.title}>Student Ledger Management</Text><Text style={styles.subtitle}>Edit fees for students in the active Accounting queue</Text></View><Pressable onPress={onClose} disabled={saving} style={styles.close}><X size={21} color="#526156" /></Pressable></View>
        <View style={styles.body}>
          <View style={styles.search}><Search size={17} color="#748076" /><TextInput value={search} onChangeText={setSearch} placeholder="Search name or student ID" placeholderTextColor="#89938B" style={styles.searchInput} /></View>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <View style={[styles.columns, width < 650 && styles.columnsMobile]}>
            <ScrollView style={[styles.studentList, width < 650 && styles.studentListMobile]} keyboardShouldPersistTaps="handled">
              {loading ? <ActivityIndicator color="#1B4332" style={styles.loading} /> : null}
              {!loading && filteredStudents.length === 0 ? <Text style={styles.empty}>No students found in the active Accounting queue.</Text> : null}
              {filteredStudents.map((row) => <Pressable key={row.studentId} onPress={() => { setSelectedId(row.studentId); setFees(ledgerFees(row.ledger)); }} style={[styles.studentRow, row.studentId === selectedId && styles.studentRowActive]}>
                <Text numberOfLines={1} style={styles.studentName}>{row.student?.full_name || 'Student'}</Text>
                <Text style={styles.studentId}>{row.student?.student_id_number || 'ID unavailable'} · {row.student?.academic_departments?.code || 'Department'}</Text>
                <Text style={[styles.studentBalance, row.ledger?.is_configured && Number(row.ledger?.total_balance) > 0 ? styles.balanceDue : styles.balanceClear]}>{row.ledger?.is_configured ? money(row.ledger.total_balance) : 'Ledger not configured'}</Text>
              </Pressable>)}
            </ScrollView>
            <ScrollView style={[styles.editor, width < 650 && styles.editorMobile]} keyboardShouldPersistTaps="handled">
              {selected ? <>
                <Text style={styles.selectedName}>{selected.student?.full_name || 'Student'}</Text>
                <Text style={styles.selectedMeta}>{selected.student?.student_id_number || 'ID unavailable'} · {selected.student?.programs?.code || 'Program'}</Text>
                {!selected.ledger?.is_configured ? <Text style={styles.empty}>No verified fee ledger is configured. Enter the actual fee amounts below; use 0 for fees that do not apply.</Text> : null}
                <FeeInput label="Tuition fee" value={String(fees.tuition_fee)} onChangeText={(value) => setFee('tuition_fee', value)} />
                <FeeInput label="Laboratory fee" value={String(fees.lab_fee)} onChangeText={(value) => setFee('lab_fee', value)} />
                <FeeInput label="Miscellaneous fee" value={String(fees.misc_fee)} onChangeText={(value) => setFee('misc_fee', value)} />
                <View style={styles.totalBox}><Text style={styles.totalLabel}>TOTAL BALANCE</Text><Text style={styles.totalValue}>{money(total)}</Text></View>
                <Pressable onPress={() => saveLedger(false)} disabled={saving} style={[styles.saveButton, saving && styles.disabled]}>{saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>Save Ledger</Text>}</Pressable>
                <Pressable onPress={() => saveLedger(true)} disabled={saving} style={[styles.paidButton, saving && styles.disabled]}><CheckCircle2 size={17} color="#FFFFFF" /><Text style={styles.paidText}>Mark as Fully Paid (Zero Balance)</Text></Pressable>
              </> : <Text style={styles.empty}>Select a student to edit their fee ledger.</Text>}
            </ScrollView>
          </View>
        </View>
      </View>
    </View>
  </Modal>;
}

function FeeInput({ label, value, onChangeText }) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><View style={styles.amountInput}><Text style={styles.currency}>PHP</Text><TextInput value={value} onChangeText={onChangeText} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#89938B" style={styles.input} /></View></View>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10,30,18,0.58)', justifyContent: 'center', alignItems: 'center', padding: 14 },
  dialog: { width: '100%', maxWidth: 920, maxHeight: '94%', backgroundColor: '#F5F7F3', borderRadius: 20, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 16, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E5EBE4' },
  headerIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E8F0E6' }, headerCopy: { flex: 1, minWidth: 0 }, title: { color: '#1B4332', fontSize: 18, fontWeight: '900' }, subtitle: { color: '#748076', fontSize: 11, marginTop: 3 }, close: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 14, flex: 1 }, search: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1E8DF', borderRadius: 11 }, searchInput: { flex: 1, color: '#26372C', fontSize: 13, outlineStyle: 'none' }, error: { color: '#A5352B', backgroundColor: '#FCEAE7', padding: 10, borderRadius: 9, marginTop: 9, fontSize: 11 },
  columns: { flex: 1, flexDirection: 'row', gap: 12, marginTop: 12, minHeight: 280 }, columnsMobile: { flexDirection: 'column' }, studentList: { width: '40%', maxWidth: 330, backgroundColor: '#FFFFFF', borderRadius: 13, padding: 8 }, studentListMobile: { width: '100%', maxWidth: '100%', maxHeight: 150, flexGrow: 0 }, editor: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 13, padding: 15 }, editorMobile: { minHeight: 280 }, loading: { marginVertical: 18 }, empty: { color: '#748076', fontSize: 12, lineHeight: 18, padding: 15, textAlign: 'center' },
  studentRow: { padding: 11, borderRadius: 10, marginBottom: 5, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EDF1EC' }, studentRowActive: { backgroundColor: '#EDF5EC', borderColor: '#85AE8C' }, studentName: { color: '#26372C', fontSize: 12, fontWeight: '900' }, studentId: { color: '#748076', fontSize: 10, marginTop: 4 }, studentBalance: { fontSize: 10, fontWeight: '900', marginTop: 6 }, balanceDue: { color: '#AA4539' }, balanceClear: { color: '#27824D' },
  selectedName: { color: '#1B4332', fontWeight: '900', fontSize: 17 }, selectedMeta: { color: '#748076', fontSize: 11, marginTop: 4, marginBottom: 14 }, field: { marginBottom: 10 }, fieldLabel: { color: '#435247', fontSize: 11, fontWeight: '800', marginBottom: 5 }, amountInput: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: '#DDE5DD', borderRadius: 10, paddingHorizontal: 11 }, currency: { color: '#748076', fontSize: 11, fontWeight: '800' }, input: { flex: 1, paddingVertical: 8, color: '#26372C', fontSize: 13, outlineStyle: 'none' }, totalBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1B4332', padding: 13, borderRadius: 11, marginTop: 4 }, totalLabel: { color: '#D5E0D7', fontSize: 10, fontWeight: '900' }, totalValue: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' }, saveButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1B4332', borderRadius: 10, marginTop: 12 }, saveText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12 }, paidButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, backgroundColor: '#27824D', borderRadius: 10, marginTop: 8, paddingHorizontal: 8 }, paidText: { color: '#FFFFFF', fontWeight: '900', fontSize: 11 }, disabled: { opacity: 0.55 },
});
