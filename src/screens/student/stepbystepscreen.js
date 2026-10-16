import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Check, ChevronRight, FileCheck2, FileText, UploadCloud } from 'lucide-react-native';
import { CLEARANCE_OFFICES } from '../../data/clearance.js';

const STEPS = [
  {
    title: 'Review your office checklist',
    description: 'Open the office checklist and check each signatory’s status, requirements, and any remarks.',
    icon: FileText,
  },
  {
    title: 'Prepare your documents',
    description: 'Keep a clear photo, scan, or PDF of each receipt or document requested by an office.',
    icon: FileCheck2,
  },
  {
    title: 'Submit proof to each office',
    description: 'Open an office, choose the matching proof file, and submit it for review.',
    icon: UploadCloud,
  },
  {
    title: 'Follow up on remarks',
    description: 'Check the office status and notes. If an item is on hold, follow the instructions and submit updated proof.',
    icon: Check,
  },
  {
    title: 'Open your digital pass',
    description: `After all ${CLEARANCE_OFFICES.length} signatories approve your clearance, your digital QR pass becomes available for verification.`,
    icon: Check,
  },
];

export function StepByStepScreen({ navigation }) {
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <View style={styles.header}>
      <Pressable onPress={() => navigation.goBack()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back"><ArrowLeft size={21} color="#FFFFFF" /></Pressable>
      <Text style={styles.headerTitle}>Clearance Process</Text>
      <View style={styles.headerSpacer} />
    </View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.introCard}>
        <Text style={styles.eyebrow}>YOUR GUIDE</Text>
        <Text style={styles.title}>Step by step</Text>
        <Text style={styles.intro}>Complete each part of your clearance and keep track of office responses from your student dashboard.</Text>
      </View>
      <View style={styles.steps}>
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          return <View key={step.title} style={styles.stepRow}>
            <View style={styles.timeline}>
              <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View>
              {index < STEPS.length - 1 ? <View style={styles.line} /> : null}
            </View>
            <View style={styles.stepCard}>
              <View style={styles.stepIcon}><Icon size={20} color="#0D3B2E" /></View>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepDescription}>{step.description}</Text>
            </View>
          </View>;
        })}
      </View>
      <View style={styles.tipCard}>
        <Text style={styles.tipTitle}>A few helpful tips</Text>
        <Text style={styles.tipText}>• Make sure uploaded files are readable and belong to the correct office.</Text>
        <Text style={styles.tipText}>• Check recent activity for new submissions and office decisions.</Text>
        <Text style={styles.tipText}>• Your QR pass is only ready after every signatory has approved.</Text>
      </View>
      <Pressable onPress={() => navigation.navigate('OfficesList')} style={styles.action} accessibilityRole="button">
        <Text style={styles.actionText}>View office checklist</Text><ChevronRight size={18} color="#FFFFFF" />
      </Pressable>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3F6F1' },
  header: { height: 58, backgroundColor: '#0D3B2E', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  back: { width: 40, justifyContent: 'center' }, headerTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', flex: 1 }, headerSpacer: { width: 25 },
  content: { padding: 17, paddingBottom: 32 }, introCard: { backgroundColor: '#E3EFE0', borderRadius: 17, padding: 17, marginBottom: 18 }, eyebrow: { color: '#55715B', fontSize: 10, fontWeight: '900', letterSpacing: 1 }, title: { color: '#0D3B2E', fontSize: 24, fontWeight: '900', marginTop: 5 }, intro: { color: '#5F7062', fontSize: 13, lineHeight: 19, marginTop: 6 },
  steps: { gap: 0 }, stepRow: { flexDirection: 'row', gap: 12 }, timeline: { width: 31, alignItems: 'center' }, stepNumber: { width: 29, height: 29, borderRadius: 15, backgroundColor: '#0D3B2E', alignItems: 'center', justifyContent: 'center' }, stepNumberText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' }, line: { flex: 1, width: 2, backgroundColor: '#CCD9CA', minHeight: 13 }, stepCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginBottom: 12 }, stepIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: '#E8F0E5', alignItems: 'center', justifyContent: 'center', marginBottom: 9 }, stepTitle: { color: '#23382A', fontSize: 14, fontWeight: '900' }, stepDescription: { color: '#6B786E', fontSize: 12, lineHeight: 18, marginTop: 5 },
  tipCard: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 15, marginTop: 3 }, tipTitle: { color: '#0D3B2E', fontSize: 13, fontWeight: '900', marginBottom: 7 }, tipText: { color: '#67746A', fontSize: 11, lineHeight: 18, marginTop: 4 }, action: { minHeight: 50, borderRadius: 13, backgroundColor: '#0D3B2E', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 14 }, actionText: { color: '#FFFFFF', fontWeight: '900', fontSize: 13 },
});
