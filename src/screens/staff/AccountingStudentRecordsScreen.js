import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Search } from 'lucide-react-native';
import { supabase } from '../../api/supabase.js';

const TABS = [
  { key: 'students', label: 'Students', columns: [
    ['student_id', 'Account ID'], ['full_name', 'Student'], ['student_id_number', 'Student ID'], ['email', 'Email'], ['academic_level', 'Level'],
    ['department_code', 'Department code'], ['department_name', 'Department'], ['program_code', 'Program code'], ['program_name', 'Program'], ['year_level', 'Year'], ['is_graduating', 'Graduating'],
    ['account_status', 'Account status'], ['created_at', 'Created'],
  ] },
  { key: 'payments', label: 'Payments', columns: [
    ['payment_id', 'Payment ID'], ['student_id', 'Account ID'], ['student_name', 'Student'], ['student_id_number', 'Student ID'], ['email', 'Email'], ['department_code', 'Department'],
    ['program_code', 'Program'], ['payment_date', 'Payment date'], ['amount', 'Amount'], ['status', 'Status'], ['recorded_at', 'Recorded'],
  ] },
  { key: 'ledgers', label: 'Ledgers', columns: [
    ['ledger_id', 'Ledger ID'], ['student_id', 'Account ID'], ['student_name', 'Student'], ['student_id_number', 'Student ID'], ['tuition_fee', 'Tuition'], ['lab_fee', 'Laboratory'],
    ['misc_fee', 'Miscellaneous'], ['total_balance', 'Total fees'], ['outstanding_balance', 'Outstanding'],
    ['required_action', 'Required action'], ['official_receipt_number', 'Receipt number'], ['is_configured', 'Configured'], ['updated_at', 'Updated'],
  ] },
  { key: 'clearances', label: 'Clearance history', columns: [
    ['student_id', 'Account ID'], ['student_name', 'Student'], ['student_id_number', 'Student ID'], ['email', 'Email'], ['period_title', 'Period'],
    ['academic_year', 'Academic year'], ['semester', 'Semester'], ['request_status', 'Request status'], ['clearance_type', 'Type'],
    ['office_name', 'Office'], ['item_status', 'Item status'], ['balance_amount', 'Balance'],
    ['official_receipt_number', 'Receipt number'], ['remarks', 'Remarks'], ['updated_at', 'Updated'],
  ] },
];

const moneyFields = new Set(['amount', 'tuition_fee', 'lab_fee', 'misc_fee', 'total_balance', 'outstanding_balance', 'balance_amount']);
const dateFields = new Set(['payment_date', 'recorded_at', 'created_at', 'updated_at']);
const formatValue = (key, value) => {
  if (value === null || value === undefined || value === '') return '—';
  if (moneyFields.has(key)) return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (dateFields.has(key)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
};

export function AccountingStudentRecordsScreen({ visible, onClose }) {
  const [records, setRecords] = useState({ students: [], payments: [], ledgers: [], clearances: [] });
  const [tabKey, setTabKey] = useState('students');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const tab = TABS.find((entry) => entry.key === tabKey) || TABS[0];

  const loadRecords = useCallback(async () => {
    if (!supabase) { setError('Supabase is not configured.'); return; }
    setLoading(true);
    setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('accounting_export_student_records');
      if (rpcError) throw rpcError;
      setRecords({
        students: Array.isArray(data?.students) ? data.students : [],
        payments: Array.isArray(data?.payments) ? data.payments : [],
        ledgers: Array.isArray(data?.ledgers) ? data.ledgers : [],
        clearances: Array.isArray(data?.clearances) ? data.clearances : [],
      });
    } catch (loadError) {
      setError(loadError?.message || 'Could not load student records. Check that you are signed in as active Accounting staff.');
    } finally {
      setLoading(false);
    }
  }, []);

  const filteredRows = useMemo(() => {
    const rows = records[tab.key] || [];
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => Object.values(row).some((value) => String(value ?? '').toLowerCase().includes(query)));
  }, [records, search, tab.key]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={loadRecords}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to accounting" onPress={onClose} style={styles.back}><ArrowLeft size={21} color="#FFFFFF" /></Pressable>
          <View style={styles.headerCopy}><Text style={styles.title}>Student Records</Text><Text style={styles.subtitle}>Student profiles, payments, balances, and clearance history</Text></View>
        </View>
        <View style={styles.body}>
          <View style={styles.countCards}>
            <Count label="Students" value={records.students.length} />
            <Count label="Payments" value={records.payments.length} />
            <Count label="Ledgers" value={records.ledgers.length} />
            <Count label="Clearance items" value={records.clearances.length} />
          </View>
          <View style={styles.searchBox}><Search size={17} color="#708075" /><TextInput value={search} onChangeText={setSearch} placeholder="Search by name, student ID, email, or details" placeholderTextColor="#89948A" style={styles.searchInput} returnKeyType="search" /></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {TABS.map((entry) => <Pressable key={entry.key} onPress={() => setTabKey(entry.key)} style={[styles.tab, tabKey === entry.key && styles.tabActive]}><Text style={[styles.tabText, tabKey === entry.key && styles.tabTextActive]}>{entry.label} ({records[entry.key].length})</Text></Pressable>)}
          </ScrollView>
          <View style={styles.tableHeading}><Text style={styles.tableTitle}>{tab.label}</Text><Text style={styles.tableCount}>{filteredRows.length} record{filteredRows.length === 1 ? '' : 's'}</Text></View>
          {loading && records.students.length === 0 ? <View style={styles.state}><ActivityIndicator color="#1B4332" /><Text style={styles.stateText}>Loading student records…</Text></View> : error ? <View style={styles.error}><Text style={styles.errorText}>{error}</Text><Pressable style={styles.retry} onPress={loadRecords}><Text style={styles.retryText}>Retry</Text></Pressable></View> : filteredRows.length === 0 ? <View style={styles.state}><Text style={styles.stateTitle}>{search ? 'No matching records' : 'No records found'}</Text><Text style={styles.stateText}>{search ? 'Try another search.' : 'Records will appear here when available.'}</Text></View> : (
            <ScrollView style={styles.tableFrame} refreshControl={<RefreshControl refreshing={loading} onRefresh={loadRecords} tintColor="#1B4332" />}>
              <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
                <View>
                  <View style={styles.tableRow}>
                    {tab.columns.map(([key, label]) => <View key={key} style={[styles.cell, styles.headCell, styles[`col_${key}`]]}><Text style={styles.headText} numberOfLines={2}>{label}</Text></View>)}
                  </View>
                  {filteredRows.map((row, index) => <View key={row.student_id || row.payment_id || row.ledger_id || `${row.student_id_number}-${row.office_code}-${index}`} style={[styles.tableRow, index % 2 === 1 && styles.alternateRow]}>
                    {tab.columns.map(([key]) => <View key={key} style={[styles.cell, styles[`col_${key}`]]}><Text selectable style={styles.cellText} numberOfLines={3}>{formatValue(key, row[key])}</Text></View>)}
                  </View>)}
                </View>
              </ScrollView>
            </ScrollView>
          )}
          {loading && records.students.length > 0 ? <View style={styles.refreshing}><ActivityIndicator size="small" color="#1B4332" /><Text style={styles.refreshingText}>Refreshing records…</Text></View> : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Count({ label, value }) { return <View style={styles.countCard}><Text style={styles.countValue}>{value.toLocaleString()}</Text><Text style={styles.countLabel}>{label}</Text></View>; }

const widths = { student_id: 235, payment_id: 235, ledger_id: 235, full_name: 185, student_name: 185, student_id_number: 125, email: 205, academic_level: 135, department_name: 170, program_name: 180, department_code: 130, program_code: 125, year_level: 65, is_graduating: 90, account_status: 125, created_at: 120, payment_date: 120, amount: 115, status: 120, recorded_at: 120, tuition_fee: 115, lab_fee: 115, misc_fee: 125, total_balance: 120, outstanding_balance: 130, required_action: 170, official_receipt_number: 145, is_configured: 95, updated_at: 125, period_title: 170, academic_year: 115, semester: 95, request_status: 135, clearance_type: 130, office_name: 155, item_status: 120, balance_amount: 110, remarks: 220 };
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3F6F1' }, header: { minHeight: 76, paddingHorizontal: 17, paddingVertical: 11, backgroundColor: '#1B4332', flexDirection: 'row', alignItems: 'center', gap: 12 }, back: { width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.13)', alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1 }, title: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' }, subtitle: { color: '#D5E0D7', fontSize: 11, marginTop: 4 }, body: { flex: 1, padding: 14, gap: 11 }, countCards: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, countCard: { flex: 1, minWidth: 105, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 11, borderWidth: 1, borderColor: '#E3E9E1' }, countValue: { fontSize: 20, fontWeight: '900', color: '#1B4332' }, countLabel: { marginTop: 3, fontSize: 10, color: '#667469', fontWeight: '700' }, searchBox: { minHeight: 44, borderWidth: 1, borderColor: '#DCE5DB', borderRadius: 11, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11 }, searchInput: { flex: 1, minWidth: 0, color: '#18221A', paddingVertical: 8, fontSize: 13 }, tabs: { gap: 7, alignItems: 'center' }, tab: { minHeight: 36, borderRadius: 10, backgroundColor: '#E8EEE6', paddingHorizontal: 12, justifyContent: 'center' }, tabActive: { backgroundColor: '#1B4332' }, tabText: { color: '#455247', fontSize: 11, fontWeight: '800' }, tabTextActive: { color: '#FFFFFF' }, tableHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 }, tableTitle: { color: '#1D2D21', fontSize: 15, fontWeight: '900' }, tableCount: { color: '#718075', fontSize: 11, fontWeight: '700' }, tableFrame: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E1E8E0' }, tableRow: { flexDirection: 'row', minHeight: 48, borderBottomWidth: 1, borderBottomColor: '#E9EEE7' }, alternateRow: { backgroundColor: '#F7F9F6' }, cell: { width: 130, paddingHorizontal: 9, paddingVertical: 8, justifyContent: 'center', borderRightWidth: 1, borderRightColor: '#EFF2ED' }, headCell: { minHeight: 45, backgroundColor: '#EAF0E8' }, headText: { color: '#435246', fontSize: 10, fontWeight: '900' }, cellText: { color: '#26352A', fontSize: 11, lineHeight: 16 }, state: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FFFFFF', borderRadius: 12 }, stateTitle: { color: '#26352A', fontSize: 15, fontWeight: '900' }, stateText: { color: '#718075', fontSize: 12, textAlign: 'center' }, error: { padding: 14, backgroundColor: '#FCE9E6', borderRadius: 12 }, errorText: { color: '#A93E35', fontSize: 12, lineHeight: 18 }, retry: { alignSelf: 'flex-start', marginTop: 9, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#FFFFFF', borderRadius: 8 }, retryText: { color: '#1B4332', fontWeight: '900', fontSize: 11 }, refreshing: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, refreshingText: { color: '#718075', fontSize: 11 },
  ...Object.fromEntries(Object.entries(widths).map(([key, width]) => [`col_${key}`, { width }])),
});
