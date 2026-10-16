import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Activity, Download, Filter, TrendingUp } from 'lucide-react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '../../api/supabase.js';
import { OFFICES } from '../../constants/offices.js';
import { AdminPage, AdminSelect, DataNote, Panel, SectionTitle, ADMIN_COLORS, DEPARTMENT_FALLBACKS } from './AdminUI.js';

export function SystemAnalyticsScreen({ navigation, embedded = false }) {
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState(DEPARTMENT_FALLBACKS);
  const [academicLevel, setAcademicLevel] = useState('All levels');
  const [departmentFilter, setDepartmentFilter] = useState('All departments');
  const [clearanceType, setClearanceType] = useState('All clearance types');
  const [fallback, setFallback] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) { setFallback(true); return; }
    const [requestResult, userResult, departmentResult] = await Promise.all([
      supabase.from('clearance_requests').select('id, student_id, clearance_type, clearance_items(status, offices(code, name))').neq('overall_status', 'VOIDED'),
      supabase.from('users').select('id, role, academic_level, department_id'),
      supabase.from('academic_departments').select('id, code, name').order('code'),
    ]);
    if (requestResult.error || userResult.error) { setFallback(true); return; }
    setRequests(requestResult.data || []); setUsers(userResult.data || []);
    if (!departmentResult.error && departmentResult.data?.length) setDepartments(departmentResult.data);
    setFallback(Boolean(departmentResult.error));
  }, []);
  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);

  const report = useMemo(() => {
    const studentById = Object.fromEntries(users.filter((item) => item.role === 'STUDENT').map((item) => [item.id, item]));
    const filteredRequests = requests.filter((request) => {
      const student = studentById[request.student_id];
      if (academicLevel !== 'All levels' && student?.academic_level !== academicLevel) return false;
      if (departmentFilter !== 'All departments' && departments.find((item) => item.id === student?.department_id)?.code !== departmentFilter) return false;
      if (clearanceType !== 'All clearance types' && request.clearance_type !== clearanceType) return false;
      return true;
    });
    const departmentRows = departments.map((department) => {
      const departmentRequests = filteredRequests.filter((request) => studentById[request.student_id]?.department_id === department.id);
      const cleared = departmentRequests.filter((request) => (request.clearance_items || []).length >= OFFICES.length && request.clearance_items.every((item) => item.status === 'APPROVED')).length;
      return { ...department, total: departmentRequests.length, cleared, percent: departmentRequests.length ? Math.round(cleared / departmentRequests.length * 100) : 0 };
    });
    const officeRows = OFFICES.map((office) => ({ ...office, pending: filteredRequests.reduce((count, request) => count + (request.clearance_items || []).filter((item) => {
      const relation = Array.isArray(item.offices) ? item.offices[0] : item.offices;
      return relation?.code === office.code && item.status !== 'APPROVED';
    }).length, 0) })).sort((a, b) => b.pending - a.pending);
    return { departments: departmentRows, offices: officeRows };
  }, [requests, users, departments, academicLevel, departmentFilter, clearanceType]);

  const maxPending = Math.max(1, ...report.offices.map((office) => office.pending));
  const exportReport = async () => {
    setExporting(true);
    try {
      const html = createAnalyticsReportHtml({ report, totalRequests: requests.length, academicLevel, departmentFilter, clearanceType });
      const file = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Share clearance analytics report' });
      } else {
        await Print.printAsync({ html });
      }
    } catch (cause) {
      Alert.alert('Could not export report', cause?.message || 'Try again after the analytics data has loaded.');
    } finally {
      setExporting(false);
    }
  };

  return <AdminPage navigation={navigation} embedded={embedded} onRefresh={load} title="System analytics" subtitle="Clearance progress and bottlenecks">
    {fallback ? <DataNote>Some live analytics data could not be loaded. Metrics include only records returned by Supabase.</DataNote> : null}
    <Panel style={styles.filterPanel}><View style={styles.filterTitle}><Filter size={17} color={ADMIN_COLORS.green} /><Text style={styles.filterHeading}>Report filters</Text></View><AdminSelect label="Academic level" value={academicLevel} options={['All levels', 'HIGH_SCHOOL', 'UNDERGRADUATE', 'POSTGRADUATE']} onChange={setAcademicLevel} /><AdminSelect label="Department" value={departmentFilter} options={['All departments', ...departments.map((item) => item.code)]} onChange={setDepartmentFilter} /><AdminSelect label="Clearance type" value={clearanceType} options={['All clearance types', 'REGULAR_SEMESTER', 'GRADUATING', 'TRANSFER_EXIT']} onChange={setClearanceType} /></Panel>
    <SectionTitle>Departmental completion</SectionTitle>
    <Panel>{report.departments.map((department) => <View key={department.code} style={styles.departmentRow}><View style={styles.deptTitleRow}><View><Text style={styles.deptCode}>{department.code}</Text><Text style={styles.deptDetail}>{department.cleared} of {department.total} students cleared</Text></View><Text style={styles.percent}>{department.percent}%</Text></View><View style={styles.track}><View style={[styles.fill, { width: `${Math.max(0, Math.min(100, department.percent))}%` }]} /></View></View>)}</Panel>
    <SectionTitle>Office bottlenecks</SectionTitle>
    <Panel><View style={styles.heatIntro}><Activity size={17} color={ADMIN_COLORS.amber} /><Text style={styles.heatCopy}>Offices ranked by items that are not yet approved</Text></View>{report.offices.map((office, index) => <View key={office.code} style={styles.officeRow}><View style={styles.rank}><Text style={styles.rankText}>{index + 1}</Text></View><View style={styles.officeCopy}><Text style={styles.officeName}>{office.name}</Text><View style={styles.trackSmall}><View style={[styles.heatFill, { width: `${Math.max(5, office.pending / maxPending * 100)}%` }]} /></View></View><Text style={styles.pending}>{office.pending} pending</Text></View>)}</Panel>
    <Panel style={styles.summary}><TrendingUp size={19} color={ADMIN_COLORS.green} /><Text style={styles.summaryText}>{requests.length} clearance requests in the current report scope</Text></Panel>
    <Pressable disabled={exporting} onPress={exportReport} style={[styles.exportButton, exporting && styles.exportDisabled]}>{exporting ? <ActivityIndicator color="#FFFFFF" /> : <Download size={17} color="#FFFFFF" />}<Text style={styles.exportText}>{exporting ? 'Preparing PDF…' : 'Export Analytics Report (PDF)'}</Text></Pressable>
  </AdminPage>;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function createAnalyticsReportHtml({ report, totalRequests, academicLevel, departmentFilter, clearanceType }) {
  const departments = report.departments.map((item) => `<tr><td>${escapeHtml(item.code)}</td><td>${item.cleared}</td><td>${item.total}</td><td>${item.percent}%</td></tr>`).join('');
  const offices = report.offices.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${item.pending}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    body{font-family:Arial,sans-serif;color:#1c2921;margin:32px}h1{color:#1b4332;margin-bottom:4px}.muted{color:#647168;font-size:12px}.filters{padding:12px;background:#f1f5ef;border-radius:8px;margin:18px 0}h2{color:#1b4332;font-size:16px;margin-top:22px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #e5ebe6;font-size:12px}th{background:#edf3eb}.footer{margin-top:24px;color:#647168;font-size:11px}
  </style></head><body><h1>OLClear Clearance Analytics</h1><div class="muted">Generated ${escapeHtml(new Date().toLocaleString())} · ${totalRequests} requests in report scope</div>
    <div class="filters"><strong>Filters</strong><br>Academic level: ${escapeHtml(academicLevel)}<br>Department: ${escapeHtml(departmentFilter)}<br>Clearance type: ${escapeHtml(clearanceType)}</div>
    <h2>Departmental completion</h2><table><thead><tr><th>Department</th><th>Cleared</th><th>Total</th><th>Completion</th></tr></thead><tbody>${departments || '<tr><td colspan="4">No department records available.</td></tr>'}</tbody></table>
    <h2>Office bottlenecks</h2><table><thead><tr><th>Office</th><th>Items not approved</th></tr></thead><tbody>${offices || '<tr><td colspan="2">No office records available.</td></tr>'}</tbody></table>
    <div class="footer">This report contains the live records available to the administrator who generated it.</div></body></html>`;
}

const styles = StyleSheet.create({ filterPanel: { padding: 14 }, filterTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 13 }, filterHeading: { color: ADMIN_COLORS.ink, fontSize: 15, fontWeight: '900' }, departmentRow: { marginBottom: 16 }, deptTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }, deptCode: { color: ADMIN_COLORS.ink, fontSize: 13, fontWeight: '900' }, deptDetail: { color: ADMIN_COLORS.muted, fontSize: 11, marginTop: 3 }, percent: { color: ADMIN_COLORS.green, fontSize: 14, fontWeight: '900' }, track: { height: 8, borderRadius: 8, backgroundColor: '#EDF1EA', overflow: 'hidden' }, fill: { height: '100%', borderRadius: 8, backgroundColor: '#62A16A' }, heatIntro: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 6 }, heatCopy: { color: ADMIN_COLORS.muted, fontSize: 12, flex: 1 }, officeRow: { minHeight: 57, borderTopWidth: 1, borderTopColor: '#EEF1EC', flexDirection: 'row', gap: 9, alignItems: 'center' }, rank: { width: 25, height: 25, borderRadius: 8, backgroundColor: '#F0F3EE', alignItems: 'center', justifyContent: 'center' }, rankText: { color: ADMIN_COLORS.muted, fontSize: 11, fontWeight: '900' }, officeCopy: { flex: 1 }, officeName: { color: ADMIN_COLORS.ink, fontSize: 12, fontWeight: '800', marginBottom: 6 }, trackSmall: { height: 5, backgroundColor: '#F0F2EF', borderRadius: 5, overflow: 'hidden' }, heatFill: { height: '100%', backgroundColor: '#E8A541', borderRadius: 5 }, pending: { color: ADMIN_COLORS.amber, fontSize: 11, fontWeight: '900', minWidth: 62, textAlign: 'right' }, summary: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 2 }, summaryText: { color: ADMIN_COLORS.ink, fontSize: 13, fontWeight: '800', flex: 1 }, exportButton: { minHeight: 52, borderRadius: 13, backgroundColor: ADMIN_COLORS.green, marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, exportDisabled: { opacity: 0.65 }, exportText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
});
