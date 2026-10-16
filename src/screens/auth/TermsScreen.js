import { StyleSheet, Text, View } from 'react-native';
import { AuthPage, PrimaryButton, ScreenHeader, colors } from '../../components/auth/AuthUI.js';

const sections = [
  {
    title: '1. Account rules',
    body: 'Use your own Western Leyte College account and keep your password and one-time verification codes private. The details in your student profile must be accurate. Tell the College through its approved support channel if you believe someone has accessed your account.',
  },
  {
    title: '2. Clearance obligations',
    body: 'OLClear helps you track the requirements assigned to your academic level, department, and clearance purpose. You are responsible for submitting authentic, readable proof and following the instructions and deadlines set by each signatory office. A submission remains pending until the responsible office reviews it.',
  },
  {
    title: '3. Staff sign-off integrity',
    body: 'Staff and office approvers must review only records assigned to them, verify submitted proof against office requirements, record decisions accurately, and keep student information confidential. Do not approve a clearance item without completing the required review or use access for personal purposes.',
  },
  {
    title: '4. Admin period management',
    body: 'Administrators are responsible for accurate clearance period settings, office assignments, and access grants. Admin credentials and access codes must remain private. Changes that affect student or staff access should be authorized and recorded through the College process.',
  },
  {
    title: '5. Document upload policy',
    body: 'Upload only documents needed to verify the specific clearance item. Do not upload passwords, one-time codes, payment-card security codes, or unrelated personal information. Before submitting a receipt, cover account numbers or other details that the office does not need. Do not alter a document or submit another person’s proof.',
  },
  {
    title: '6. Responsible use',
    body: 'Do not impersonate another student or staff member, interfere with another person’s account, or attempt to access office records without authorization. Clearance status and digital passes are personal and must not be shared or represented as official before they are issued by the College.',
  },
  {
    title: '7. Service availability and support',
    body: 'OLClear is a support tool for the College’s clearance process. If a status appears incorrect or a document cannot be submitted, contact the responsible office through its official channel. The College should publish its support contacts, service limitations, and applicable records-retention schedule before production use.',
  },
];

export function TermsScreen({ navigation }) {
  const accept = () => navigation.navigate('Register', { termsAccepted: true });
  return <AuthPage footer={<PrimaryButton title="Accept Terms" onPress={accept} />}>
    <ScreenHeader title="Terms of Service" subtitle="Read these terms before creating an OLClear account." eyebrow="STUDENT CLEARANCE PORTAL" back navigation={navigation} />
    <Text style={styles.updated}>Last Updated: October 2026</Text>
    <View style={styles.draftNotice}><Text style={styles.draftTitle}>Institutional review required</Text><Text style={styles.draftText}>This is draft application copy. WLC should review and approve the final terms before release.</Text></View>
    {sections.map((section) => <View key={section.title} style={styles.section}><Text style={styles.sectionTitle}>{section.title}</Text><Text style={styles.body}>{section.body}</Text></View>)}
    <Text style={styles.contact}>For questions about these terms, contact the office responsible for student clearance.</Text>
  </AuthPage>;
}

const styles = StyleSheet.create({
  updated: { color: '#5D6B60', fontSize: 13, fontWeight: '600', marginTop: -9, marginBottom: 16 },
  draftNotice: { backgroundColor: '#FFF4DD', borderColor: '#F0D9A7', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 19 }, draftTitle: { color: '#805C1E', fontSize: 14, fontWeight: '800' }, draftText: { color: '#6F5D3D', fontSize: 13, lineHeight: 19, marginTop: 5 },
  section: { marginBottom: 21 }, sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: '800', marginBottom: 7 }, body: { color: '#4F5D52', fontSize: 14, lineHeight: 22 }, contact: { color: '#5D6B60', fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 10 },
});
