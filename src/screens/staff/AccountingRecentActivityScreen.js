import { useMemo } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, CheckCircle2, CircleDollarSign, Clock3, FileText, RefreshCw } from 'lucide-react-native';

const relation = (value) => Array.isArray(value) ? value[0] || null : value || null;
const statusLabel = (value) => String(value || 'PENDING').replaceAll('_', ' ').toLowerCase();
const asDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

function collectActivities(rows) {
  const activities = [];
  (rows || []).forEach((row) => {
    const request = relation(row.request);
    const student = relation(request?.student) || {};
    const studentName = student.full_name || student.student_id_number || 'Student';
    const studentId = student.student_id_number ? ` · ${student.student_id_number}` : '';

    (row.proofs || []).forEach((proof) => {
      const uploadedAt = asDate(proof.created_at || proof.uploaded_at);
      if (uploadedAt) activities.push({
        id: `proof-${proof.id}-upload`, date: uploadedAt, icon: FileText, tone: 'green',
        title: 'Proof uploaded', studentName, studentId,
        detail: `${proof.file_name || 'Clearance document'} · ${statusLabel(proof.status)}`,
      });
      const reviewedAt = asDate(proof.reviewed_at);
      if (reviewedAt) activities.push({
        id: `proof-${proof.id}-review`, date: reviewedAt, icon: CheckCircle2,
        tone: ['REJECTED', 'HOLD', 'REQUIREMENT_NEEDED'].includes(String(proof.status).toUpperCase()) ? 'red' : 'green',
        title: `Proof ${statusLabel(proof.status)}`, studentName, studentId,
        detail: proof.rejection_reason || proof.file_name || 'Clearance document reviewed',
      });
    });

    const clearanceStatus = String(row.status || '').toUpperCase();
    if (['APPROVED', 'HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'].includes(clearanceStatus)) {
      const decisionAt = asDate(row.processed_at || row.updated_at);
      if (decisionAt) activities.push({
        id: `clearance-${row.id}`, date: decisionAt,
        icon: clearanceStatus === 'APPROVED' ? CheckCircle2 : Clock3,
        tone: clearanceStatus === 'APPROVED' ? 'green' : 'amber',
        title: clearanceStatus === 'APPROVED' ? 'Accounting clearance approved' : `Clearance ${statusLabel(clearanceStatus)}`,
        studentName, studentId, detail: row.remarks || 'Accounting clearance item updated',
      });
    }

    const ledger = relation(row.ledger);
    const ledgerUpdatedAt = asDate(ledger?.updated_at);
    if (ledgerUpdatedAt && ledger?.is_configured) activities.push({
      id: `ledger-${ledger.id}`, date: ledgerUpdatedAt, icon: CircleDollarSign, tone: 'green',
      title: 'Student ledger updated', studentName, studentId,
      detail: `Outstanding balance: ₱${Number(ledger.outstanding_balance || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    });
  });

  const unique = [...new Map(activities.map((item) => [item.id, item])).values()];
  return unique.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 75);
}

export function AccountingRecentActivityScreen({ visible, onClose, rows, loading, error, fallback, refreshing, onRefresh }) {
  const activities = useMemo(() => collectActivities(rows), [rows]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.back} accessibilityRole="button" accessibilityLabel="Back to Accounting"><ArrowLeft size={21} color="#FFFFFF" /></Pressable>
          <View style={styles.headerCopy}><Text style={styles.title}>Recent Activity</Text><Text style={styles.subtitle}>Latest uploads, Accounting decisions, and ledger updates</Text></View>
          <Pressable onPress={onRefresh} disabled={refreshing} style={styles.refresh} accessibilityRole="button" accessibilityLabel="Refresh activity"><RefreshCw size={18} color="#FFFFFF" /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1B4332" />}>
          <View style={styles.summary}><Text style={styles.summaryCount}>{activities.length}</Text><View style={styles.summaryCopy}><Text style={styles.summaryTitle}>Recent accounting events</Text><Text style={styles.summaryText}>Sorted newest first · up to 75 entries</Text></View>{refreshing ? <ActivityIndicator color="#1B4332" /> : null}</View>
          {loading && activities.length === 0 ? <View style={styles.empty}><ActivityIndicator color="#1B4332" /><Text style={styles.emptyText}>Loading recent activity…</Text></View> : fallback && activities.length === 0 ? (
            <View style={styles.empty}><Clock3 size={29} color="#A93E35" /><Text style={styles.emptyTitle}>Activity unavailable</Text><Text style={styles.emptyText}>{error || 'Could not load Accounting activity.'}</Text><Pressable onPress={onRefresh} style={styles.tryAgain}><Text style={styles.tryAgainText}>Try again</Text></Pressable></View>
          ) : activities.length ? activities.map((activity) => <ActivityRow key={activity.id} activity={activity} />) : (
            <View style={styles.empty}><Clock3 size={29} color="#829184" /><Text style={styles.emptyTitle}>No recent activity</Text><Text style={styles.emptyText}>Proof uploads, Accounting decisions, and ledger changes for this clearance period will appear here.</Text></View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function ActivityRow({ activity }) {
  const Icon = activity.icon;
  return (
    <View style={styles.card}>
      <View style={[styles.iconWrap, styles[activity.tone]]}><Icon size={18} color={activity.tone === 'red' ? '#A93E35' : '#1B4332'} /></View>
      <View style={styles.copy}>
        <Text style={styles.eventTitle}>{activity.title}</Text>
        <Text style={styles.student}>{activity.studentName}{activity.studentId}</Text>
        <Text style={styles.detail}>{activity.detail}</Text>
      </View>
      <Text style={styles.date}>{activity.date.toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3F6F1' },
  header: { minHeight: 76, paddingHorizontal: 17, paddingVertical: 11, backgroundColor: '#1B4332', flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 42, height: 42, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.13)', alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0 }, title: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' }, subtitle: { color: '#D5E0D7', fontSize: 11, marginTop: 4 },
  refresh: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.13)' },
  content: { width: '100%', maxWidth: 1000, alignSelf: 'center', padding: 15, paddingBottom: 35, flexGrow: 1 },
  summary: { minHeight: 68, backgroundColor: '#FFFFFF', borderRadius: 13, paddingHorizontal: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: '#E3E9E1' },
  summaryCount: { color: '#1B4332', fontSize: 24, fontWeight: '900' }, summaryCopy: { flex: 1 }, summaryTitle: { color: '#243329', fontSize: 13, fontWeight: '900' }, summaryText: { color: '#718075', fontSize: 10, marginTop: 3 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 13, borderWidth: 1, borderColor: '#E3E9E1', padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  iconWrap: { width: 37, height: 37, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E7F4E9' }, green: { backgroundColor: '#E7F4E9' }, amber: { backgroundColor: '#FFF1D5' }, red: { backgroundColor: '#FCE9E6' },
  copy: { flex: 1, minWidth: 0 }, eventTitle: { color: '#26352A', fontSize: 12, fontWeight: '900' }, student: { color: '#1B4332', fontSize: 11, fontWeight: '800', marginTop: 4 }, detail: { color: '#718075', fontSize: 10, lineHeight: 15, marginTop: 3 }, date: { color: '#7E8980', fontSize: 9, maxWidth: 125, textAlign: 'right' },
  empty: { flex: 1, minHeight: 240, alignItems: 'center', justifyContent: 'center', padding: 25, backgroundColor: '#FFFFFF', borderRadius: 13, gap: 8 }, emptyTitle: { color: '#26352A', fontSize: 15, fontWeight: '900' }, emptyText: { maxWidth: 340, color: '#718075', fontSize: 12, lineHeight: 18, textAlign: 'center' }, tryAgain: { marginTop: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: '#EAF0E8' }, tryAgainText: { color: '#1B4332', fontWeight: '900', fontSize: 11 },
});
