import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CLEARANCE_OFFICES } from '../data/clearance';

const green = '#1F4B2C';

export function LandingScreen({ clearance, clearedCount, periodName, periodActive, onOpenChecklist, onOpenPass }) {
  const progress = clearedCount / CLEARANCE_OFFICES.length;
  const nextAction = clearance.find((item) => item.status === 'HOLD') || clearance.find((item) => item.status === 'PENDING');
  const inReview = clearance.find((item) => item.status === 'SUBMITTED');
  const actionCount = clearance.filter((item) => item.status === 'HOLD' || item.status === 'PENDING').length;
  const nextTitle = nextAction ? 'Submit your proof' : inReview ? 'Your proof is in review' : 'Clearance complete';
  const nextDescription = nextAction ? `${nextAction.office}${nextAction.departmentSpecific ? ' · CICTE' : ''}` : inReview ? `${inReview.office} is reviewing your proof` : 'Your digital clearance pass is ready';
  return (
    <View>
      <View style={styles.greetingRow}>
        <View>
          <Text style={styles.eyebrow}>STUDENT DASHBOARD</Text>
          <Text style={styles.greeting}>Good morning, Angelika</Text>
          <Text style={styles.subheading}>Your clearance, all in one place.</Text>
        </View>
        <View style={styles.avatar}><Text style={styles.avatarText}>AA</Text></View>
      </View>

      <View style={styles.semesterPill}><View style={[styles.liveDot, !periodActive && styles.pausedDot]} /><Text style={styles.semesterText}>{periodName} · {periodActive ? 'Open' : 'Paused'}</Text><Text style={styles.chevron}>⌄</Text></View>

      <View style={styles.progressCard}>
        <View style={styles.progressTop}>
          <View><Text style={styles.cardEyebrow}>CLEARANCE PROGRESS</Text><Text style={styles.progressTitle}>{clearedCount} <Text style={styles.progressOf}>of {CLEARANCE_OFFICES.length} offices</Text></Text></View>
          <View style={styles.percentBadge}><Text style={styles.percentText}>{Math.round(progress * 100)}%</Text></View>
        </View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress * 100}%` }]} /></View>
        <View style={styles.progressBottom}><Text style={styles.progressCaption}>Keep going — you’re making progress.</Text><Text style={styles.progressCaption}>{CLEARANCE_OFFICES.length - clearedCount} to go</Text></View>
        <View style={styles.divider} />
        <View style={styles.statsRow}>
          <Stat value={String(clearedCount).padStart(2, '0')} label="APPROVED" color="#2F7945" />
          <View style={styles.statDivider} />
          <Stat value={String(clearance.filter((item) => item.status === 'SUBMITTED').length).padStart(2, '0')} label="IN REVIEW" color="#B47B21" />
          <View style={styles.statDivider} />
          <Stat value={String(clearance.filter((item) => item.status === 'HOLD' || item.status === 'PENDING').length).padStart(2, '0')} label="TO DO" color="#68746A" />
        </View>
      </View>

      <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Your next step</Text><Text style={styles.sectionHint}>{actionCount ? `${actionCount} actions needed` : inReview ? 'Awaiting review' : 'All done'}</Text></View>
      <View style={styles.nextCard}>
        <View style={styles.nextIcon}><Text style={styles.nextIconText}>{nextAction ? '↗' : inReview ? '◷' : '✓'}</Text></View>
        <View style={styles.nextCopy}><Text style={styles.nextTitle}>{nextTitle}</Text><Text style={styles.nextDescription}>{nextDescription}</Text></View>
        <Pressable onPress={onOpenChecklist} style={styles.smallArrow} accessibilityRole="button" accessibilityLabel="Open clearance checklist"><Text style={styles.arrowText}>›</Text></Pressable>
      </View>

      <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Quick access</Text></View>
      <View style={styles.quickRow}>
        <QuickCard icon="☷" title="Office checklist" caption={`${CLEARANCE_OFFICES.length} signatories`} onPress={onOpenChecklist} />
        <QuickCard icon="▦" title="Digital pass" caption={clearedCount === CLEARANCE_OFFICES.length ? 'Ready to view' : 'Unlock at 100%'} onPress={onOpenPass} />
      </View>

      <View style={styles.tipCard}><View style={styles.tipIcon}><Text style={styles.tipIconText}>i</Text></View><Text style={styles.tipText}>Upload a receipt or document for each office. You can track remarks and status updates here.</Text></View>
    </View>
  );
}

function Stat({ value, label, color }) {
  return <View style={styles.stat}><Text style={[styles.statValue, { color }]}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function QuickCard({ icon, title, caption, onPress }) {
  return <Pressable onPress={onPress} style={styles.quickCard} accessibilityRole="button"><View style={styles.quickIcon}><Text style={styles.quickIconText}>{icon}</Text></View><Text style={styles.quickTitle}>{title}</Text><Text style={styles.quickCaption}>{caption}</Text><Text style={styles.quickArrow}>↗</Text></Pressable>;
}

const styles = StyleSheet.create({
  greetingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 17 },
  eyebrow: { color: '#68806D', fontSize: 9, fontWeight: '800', letterSpacing: 1.25 },
  greeting: { color: '#18221A', fontSize: 22, fontWeight: '800', letterSpacing: -0.7, marginTop: 6 },
  subheading: { color: '#758078', fontSize: 12, marginTop: 4 },
  avatar: { width: 43, height: 43, borderRadius: 15, backgroundColor: '#E8EEDC', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#DCE6D5' },
  avatarText: { color: green, fontSize: 12, fontWeight: '800' },
  semesterPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: '#EAF0E6', borderRadius: 20, marginBottom: 14 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#62A16C' }, pausedDot: { backgroundColor: '#C28A3A' }, semesterText: { color: green, fontSize: 10, fontWeight: '700' }, chevron: { color: green, fontSize: 14, marginTop: -3 },
  progressCard: { backgroundColor: green, borderRadius: 20, padding: 18, shadowColor: '#102A17', shadowOpacity: 0.13, shadowRadius: 15, shadowOffset: { width: 0, height: 7 }, elevation: 3 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, cardEyebrow: { color: '#BBD0BE', fontSize: 9, fontWeight: '800', letterSpacing: 1.15 },
  progressTitle: { color: '#FFFFFF', fontSize: 27, fontWeight: '800', marginTop: 5, letterSpacing: -0.5 }, progressOf: { color: '#D5E2D7', fontSize: 13, fontWeight: '500', letterSpacing: 0 },
  percentBadge: { width: 49, height: 49, borderRadius: 25, backgroundColor: '#315C3B', borderWidth: 3, borderColor: '#527359', alignItems: 'center', justifyContent: 'center' }, percentText: { color: '#DAF58A', fontSize: 11, fontWeight: '800' },
  progressTrack: { height: 7, borderRadius: 4, backgroundColor: '#46664D', marginTop: 15, overflow: 'hidden' }, progressFill: { height: 7, borderRadius: 4, backgroundColor: '#C3E956' },
  progressBottom: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }, progressCaption: { color: '#C6D7C9', fontSize: 9 }, divider: { height: 1, backgroundColor: '#42634A', marginTop: 16, marginBottom: 12 },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, stat: { flex: 1, alignItems: 'center' }, statValue: { fontSize: 16, fontWeight: '800' }, statLabel: { color: '#C0D1C2', fontSize: 8, letterSpacing: 0.8, fontWeight: '700', marginTop: 3 }, statDivider: { width: 1, height: 25, backgroundColor: '#42634A' },
  sectionHeading: { marginTop: 23, marginBottom: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { color: '#1C281F', fontSize: 15, fontWeight: '800' }, sectionHint: { color: '#778479', fontSize: 10 },
  nextCard: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 13, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E9EDE7' }, nextIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#FFF4DF', alignItems: 'center', justifyContent: 'center' }, nextIconText: { color: '#AD7624', fontSize: 19, fontWeight: '700' }, nextCopy: { flex: 1, marginLeft: 11 }, nextTitle: { color: '#202A22', fontSize: 12, fontWeight: '800' }, nextDescription: { color: '#77827A', fontSize: 10, marginTop: 4 }, smallArrow: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#F0F4ED', alignItems: 'center', justifyContent: 'center' }, arrowText: { color: green, fontSize: 20, lineHeight: 22 },
  quickRow: { flexDirection: 'row', gap: 10 }, quickCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 15, padding: 13, borderWidth: 1, borderColor: '#E9EDE7', minHeight: 117 }, quickIcon: { width: 31, height: 31, borderRadius: 10, backgroundColor: '#EAF0E6', alignItems: 'center', justifyContent: 'center', marginBottom: 9 }, quickIconText: { color: green, fontSize: 15, fontWeight: '700' }, quickTitle: { color: '#253029', fontSize: 11, fontWeight: '800' }, quickCaption: { color: '#818A83', fontSize: 9, marginTop: 4 }, quickArrow: { position: 'absolute', right: 12, top: 13, color: '#87978A', fontSize: 13 },
  tipCard: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 14, padding: 12, borderRadius: 13, backgroundColor: '#EDF2E9' }, tipIcon: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#DDE8D8', alignItems: 'center', justifyContent: 'center' }, tipIconText: { color: green, fontSize: 11, fontWeight: '800' }, tipText: { flex: 1, color: '#617064', fontSize: 9, lineHeight: 14 },
});
