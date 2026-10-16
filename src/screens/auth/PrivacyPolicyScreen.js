import { StyleSheet, Text, View } from 'react-native';
import { AuthPage, PrimaryButton, ScreenHeader, colors } from '../../components/auth/AuthUI.js';

const sections = [
  {
    title: 'Information this service may use',
    body: 'A clearance account may use your name, student number, institutional email, academic level, department, program, year level, clearance status, office remarks, the proof documents you choose to submit, and a Guidance exit survey response if you choose to provide one. A receipt can contain financial or account details, so submit only the portion required for verification.',
  },
  {
    title: 'Why information is used',
    body: 'The proposed purposes are to create and verify your account, prepare the correct clearance checklist, route submissions to authorized signatories, record their decisions and remarks, and issue a clearance credential when requirements are complete. The College must identify and document the lawful basis for each purpose before the service is used.',
  },
  {
    title: 'Who may receive it',
    body: 'Clearance information should be available only to staff who need it to review or administer your request, and to service providers acting under the College’s instructions and safeguards. Documents and student records should not be publicly visible or used for unrelated purposes.',
  },
  {
    title: 'Guidance exit survey',
    body: 'If you choose to submit a Guidance exit survey response, it is stored with your Guidance clearance record. You and active staff assigned to Guidance can read it. The College must confirm the retention period and support process before production release.',
  },
  {
    title: 'Clearance pass QR checks',
    body: 'Anyone who scans a valid pass QR code can check whether its clearance is approved, the clearance period, and the completion date. The verification service does not return your name or student ID. Keep the QR code private because it is the reference used to check the pass.',
  },
  {
    title: 'Storage, security, and retention',
    body: 'The College should publish the storage location, access controls, security measures, incident contact, and retention period for account data and uploaded proofs. Records should be kept only as long as needed for the declared purposes or another applicable legal or records-management requirement, then securely disposed of or de-identified.',
  },
  {
    title: 'Your privacy rights',
    body: 'Subject to the Data Privacy Act of 2012 and its applicable rules, you may ask how your information is processed and request access or correction. Other rights and remedies may apply depending on the circumstances. The College should provide a process and contact for privacy requests and complaints.',
  },
  {
    title: 'Privacy contact',
    body: 'Contact the Western Leyte College Data Protection Officer: [WLC DPO name and contact details to be supplied]. Do not send passwords, verification codes, or unnecessary identity documents in a privacy request.',
  },
];

export function PrivacyPolicyScreen({ navigation }) {
  return <AuthPage footer={<PrimaryButton title="I Understand" onPress={() => navigation.goBack()} />}>
    <ScreenHeader title="Privacy Policy" subtitle="How student account information and clearance proof are intended to be handled." eyebrow="STUDENT CLEARANCE PORTAL" back navigation={navigation} />
    <Text style={styles.updated}>Draft for institutional review · October 2026</Text>
    <View style={styles.draftNotice}><Text style={styles.draftTitle}>Complete the College details before release</Text><Text style={styles.draftText}>WLC must confirm its controller identity, lawful bases, service providers, safeguards, retention periods, and Data Protection Officer contact.</Text></View>
    {sections.map((section) => <View key={section.title} style={styles.section}><Text style={styles.sectionTitle}>{section.title}</Text><Text style={styles.body}>{section.body}</Text></View>)}
    <Text style={styles.legalNote}>This draft reflects the Data Privacy Act principles of transparency, legitimate purpose, proportionality, and retention limits. It is not a final compliance determination.</Text>
  </AuthPage>;
}

const styles = StyleSheet.create({
  updated: { color: '#5D6B60', fontSize: 13, fontWeight: '600', marginTop: -9, marginBottom: 16 },
  draftNotice: { backgroundColor: '#FFF4DD', borderColor: '#F0D9A7', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 19 }, draftTitle: { color: '#805C1E', fontSize: 14, fontWeight: '800' }, draftText: { color: '#6F5D3D', fontSize: 13, lineHeight: 19, marginTop: 5 },
  section: { marginBottom: 21 }, sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: '800', marginBottom: 7 }, body: { color: '#4F5D52', fontSize: 14, lineHeight: 22 }, legalNote: { color: '#5D6B60', fontSize: 13, lineHeight: 19, marginTop: 2, marginBottom: 10 },
});
