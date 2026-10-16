import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import { ArrowLeft, Award, Download, LockKeyhole, Printer } from 'lucide-react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { fetchStudentRequest } from '../../api/studentApi.js';
import { OFFICES, normalizeOfficeName } from '../../constants/offices.js';
import { useAuth } from '../../context/AuthContext.js';
import { getCertificateConfig } from '../../constants/certificateConfig.js';
import { generateCertificateHtml } from '../../utils/generateCertificateHtml.js';

const A4_PRINT_SIZE = { width: 595, height: 842 };

export function DigitalPassScreen({ navigation }) {
  const { user, profile } = useAuth();
  const userId = user?.id;
  const qrRef = useRef(null);
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!userId) {
      setRequest(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setRequest(await fetchStudentRequest(userId));
    } catch (cause) {
      setError(cause?.message || 'Could not load your pass.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const items = useMemo(() => request?.clearance_items || [], [request?.clearance_items]);
  const itemForOffice = useCallback((office) => items.find((item) => item.office_code === office.code)
    || items.find((item) => normalizeOfficeName(item.office_name) === normalizeOfficeName(office.name)), [items]);
  const approved = OFFICES.filter((office) => itemForOffice(office)?.status === 'APPROVED').length;
  const ready = approved === OFFICES.length && Boolean(request?.qr_code_token);
  const academicLevel = profile?.academic_level || user?.user_metadata?.academic_level || 'UNDERGRADUATE';
  const certificate = useMemo(() => getCertificateConfig(academicLevel), [academicLevel]);
  const certificateProfile = useMemo(() => ({
    ...(user?.user_metadata || {}),
    ...(profile || {}),
    academic_level: academicLevel,
  }), [academicLevel, profile, user?.user_metadata]);

  const makeHtml = useCallback(async () => {
    if (!ready || !request?.qr_code_token) throw new Error('Your certificate unlocks after all signatories approve your clearance.');
    if (!qrRef.current?.toDataURL) throw new Error('The QR code is still preparing. Please try again.');
    const qrCodeBase64 = await new Promise((resolve, reject) => {
      try {
        qrRef.current.toDataURL((value) => value ? resolve(value) : reject(new Error('Could not prepare the QR code.')));
      } catch (cause) {
        reject(cause);
      }
    });
    return generateCertificateHtml({
      profile: certificateProfile,
      request,
      items,
      qrCodeBase64,
      config: certificate,
    });
  }, [certificate, certificateProfile, items, ready, request]);

  const savePdf = useCallback(async () => {
    setAction('save');
    setError('');
    try {
      const html = await makeHtml();
      const file = await Print.printToFileAsync({ html, ...A4_PRINT_SIZE });
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('PDF created', 'This device cannot open the share sheet. Try Print Official Certificate to save or print the PDF.');
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
        dialogTitle: 'Save your clearance certificate',
      });
    } catch (cause) {
      setError(cause?.message || 'Could not create or share the certificate PDF.');
    } finally {
      setAction('');
    }
  }, [makeHtml]);

  const printCertificate = useCallback(async () => {
    setAction('print');
    setError('');
    try {
      const html = await makeHtml();
      await Print.printAsync({ html, ...A4_PRINT_SIZE });
    } catch (cause) {
      setError(cause?.message || 'Could not open the print dialog.');
    } finally {
      setAction('');
    }
  }, [makeHtml]);

  const canCreateCertificate = ready && !loading && !action;

  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={styles.back}>
        <ArrowLeft size={21} color="#FFFFFF" />
      </Pressable>
      <Text style={styles.headerTitle}>Digital Clearance Pass</Text>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {loading ? <ActivityIndicator color="#0D3B2E" style={styles.loader} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      <View style={[styles.passCard, !ready && styles.locked]}>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>OLClear</Text>
          <Text style={styles.sealText}>{certificate.levelLabel} CERTIFICATE</Text>
        </View>
        <View style={styles.divider} />
        {ready ? <View style={styles.qrWrap}>
          <QRCode
            value={`olclear://verify/${request.qr_code_token}`}
            size={184}
            backgroundColor="#FFFFFF"
            color="#0D3B2E"
            getRef={(ref) => { qrRef.current = ref; }}
          />
        </View> : <View style={styles.lockWrap}><LockKeyhole size={38} color="#DDF36B" /></View>}
        <Text style={styles.passStatus}>{ready ? 'CLEARANCE COMPLETE' : 'PASS LOCKED'}</Text>
        <Text style={styles.passHint}>{ready
          ? 'Present this QR code for clearance verification.'
          : `${approved} of ${OFFICES.length} offices approved. Your certificate unlocks after every office clears your request.`}</Text>
        <View style={styles.passNameBlock}>
          <Text style={styles.studentName}>{certificateProfile.full_name || 'Student'}</Text>
          <Text style={styles.studentId}>ID {certificateProfile.student_id_number || '—'}</Text>
        </View>
      </View>

      <View style={styles.detailsCard}>
        <View style={styles.seal}><Award size={24} color="#0D3B2E" /></View>
        <Text style={styles.sectionTitle}>VERIFICATION DETAILS</Text>
        <Detail label="Certificate" value={certificate.headerTitle} />
        <Detail label="Academic level" value={certificate.levelLabel} />
        <Detail label="Program" value={certificateProfile.programs?.code || certificateProfile.program_code || '—'} />
        <Detail label="Department" value={certificateProfile.academic_departments?.code || certificateProfile.department_code || '—'} />
        <Detail label="Clearance period" value={request?.clearance_periods?.title || request?.clearance_periods?.semester || 'Current period'} />
        <Detail label="Completion date" value={request?.completion_date ? new Date(request.completion_date).toLocaleDateString() : ready ? 'Not recorded' : 'Pending'} />
        {request?.qr_code_token && !ready ? <Text style={styles.note}>The QR credential remains hidden until all signatories approve your request.</Text> : null}
      </View>

      <View style={styles.actions}>
        <ActionButton
          label="Download / Save PDF"
          icon={<Download size={18} color="#FFFFFF" />}
          onPress={savePdf}
          disabled={!canCreateCertificate}
          loading={action === 'save'}
          primary
        />
        <ActionButton
          label="Print Official Certificate"
          icon={<Printer size={18} color={canCreateCertificate ? '#0D3B2E' : '#8A978D'} />}
          onPress={printCertificate}
          disabled={!canCreateCertificate}
          loading={action === 'print'}
        />
        {!ready ? <Text style={styles.disabledHint}>PDF and printing become available when all {OFFICES.length} offices approve your clearance.</Text> : null}
      </View>
    </ScrollView>
  </SafeAreaView>;
}

function Detail({ label, value }) {
  return <View style={styles.detailRow}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={styles.detailValue}>{value}</Text>
  </View>;
}

function ActionButton({ label, icon, onPress, disabled, loading, primary = false }) {
  return <Pressable
    accessibilityRole="button"
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [styles.actionButton, primary && styles.primaryButton, disabled && styles.disabledButton, pressed && !disabled && styles.pressed]}
  >
    {loading ? <ActivityIndicator color={primary ? '#FFFFFF' : '#0D3B2E'} /> : icon}
    <Text style={[styles.actionLabel, primary && styles.primaryLabel, disabled && !primary && styles.disabledLabel]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3F6F1' },
  header: { height: 58, backgroundColor: '#0D3B2E', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  back: { width: 40, justifyContent: 'center' },
  headerTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  content: { padding: 17, paddingBottom: 34 },
  loader: { marginVertical: 20 },
  error: { color: '#A5352B', backgroundColor: '#FCEAE7', padding: 12, borderRadius: 10, fontSize: 13, lineHeight: 18, marginBottom: 12 },
  passCard: { backgroundColor: '#0D3B2E', borderRadius: 22, padding: 19, alignItems: 'center', shadowColor: '#123A2B', shadowOpacity: 0.16, shadowRadius: 12, elevation: 4 },
  locked: { backgroundColor: '#244A37' },
  brandRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: '#DDF36B', fontWeight: '900', fontSize: 18 },
  sealText: { color: '#DCE8DD', fontSize: 9, fontWeight: '900', letterSpacing: 0.6, maxWidth: '65%', textAlign: 'right' },
  divider: { width: '100%', height: 1, backgroundColor: '#426450', marginVertical: 18 },
  qrWrap: { padding: 10, borderRadius: 12, backgroundColor: '#FFFFFF' },
  lockWrap: { width: 184, height: 184, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#41634D' },
  passStatus: { color: '#DDF36B', fontSize: 13, fontWeight: '900', letterSpacing: 1, marginTop: 17 },
  passHint: { color: '#E1ECE2', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 7 },
  passNameBlock: { width: '100%', alignItems: 'center', borderTopWidth: 1, borderColor: '#426450', marginTop: 17, paddingTop: 14 },
  studentName: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  studentId: { color: '#D0DDD2', fontSize: 13, marginTop: 4 },
  detailsCard: { backgroundColor: '#FFFFFF', borderRadius: 17, marginTop: 13, padding: 16 },
  seal: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#E8F0E5', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  sectionTitle: { color: '#0D3B2E', fontWeight: '900', fontSize: 13, letterSpacing: 0.6, marginBottom: 8 },
  detailRow: { minHeight: 45, borderBottomWidth: 1, borderBottomColor: '#EDF1EC', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  detailLabel: { color: '#718075', fontSize: 13 },
  detailValue: { color: '#28372C', fontSize: 13, fontWeight: '800', textAlign: 'right', flex: 1 },
  note: { color: '#7A5C1C', fontSize: 12, lineHeight: 18, marginTop: 12 },
  actions: { marginTop: 15, gap: 10 },
  actionButton: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: '#0D3B2E', backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 14 },
  primaryButton: { backgroundColor: '#0D3B2E', borderColor: '#0D3B2E' },
  disabledButton: { borderColor: '#D9E0D9', backgroundColor: '#EEF1ED' },
  actionLabel: { color: '#0D3B2E', fontSize: 14, fontWeight: '800' },
  primaryLabel: { color: '#FFFFFF' },
  disabledLabel: { color: '#8A978D' },
  pressed: { opacity: 0.82 },
  disabledHint: { textAlign: 'center', color: '#718075', fontSize: 12, lineHeight: 17, paddingHorizontal: 10 },
});
