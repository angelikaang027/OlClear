import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { ArrowLeft, CheckCircle2, Clock3, FileText, LockKeyhole, UploadCloud } from 'lucide-react-native';
import { createProofPreviewUrl, fetchGuidanceExitSurvey, fetchOfficeProofs, fetchStudentRequest, markClearanceItemSubmitted, submitGuidanceExitSurvey, uploadOfficeProof } from '../../../api/studentApi.js';
import { supabase } from '../../../api/supabase.js';
import { useAuth } from '../../../context/AuthContext.js';
import { isOfficeUnlocked } from '../../../utils/clearanceRules.js';

const statusColor = (status) => status === 'APPROVED' ? '#27824D' : ['HOLD', 'REJECTED'].includes(status) ? '#B7443A' : '#A87817';
const statusLabel = (status) => String(status || 'PENDING').replaceAll('_', ' ');

export function OfficeWorkspaceScreen({ navigation, route, config }) {
  const { user, profile } = useAuth();
  const [item, setItem] = useState(route.params?.clearanceItem || null);
  const [requestId, setRequestId] = useState(route.params?.requestId || route.params?.clearanceItem?.clearance_request_id || route.params?.clearanceItem?.request_id || null);
  const [items, setItems] = useState([]);
  const [proofs, setProofs] = useState([]);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dataNotice, setDataNotice] = useState('');
  const [surveyVisible, setSurveyVisible] = useState(false);
  const [surveyResponse, setSurveyResponse] = useState('');
  const [surveyComplete, setSurveyComplete] = useState(false);
  const [surveySubmitting, setSurveySubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      setDataNotice('Sign in to load your office clearance status and proof history.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const request = await fetchStudentRequest(user.id);
      const requestItems = request?.clearance_items || [];
      setRequestId(request?.id || requestId || null);
      const found = requestItems.find((row) => row.office_code === config.code)
        || route.params?.clearanceItem
        || null;
      setItems(requestItems);
      setItem(found);
      setProofs(found?.id ? await fetchOfficeProofs(found.id) : []);
      let savedSurvey = null;
      if (config.code === 'GUIDANCE' && found?.id) {
        try {
          savedSurvey = await fetchGuidanceExitSurvey(found.id);
        } catch (surveyError) {
          setError(surveyError?.message || 'Could not load your saved Guidance survey.');
        }
      }
      setSurveyResponse(savedSurvey?.response || '');
      setSurveyComplete(Boolean(savedSurvey));
      setDataNotice(found
        ? 'Your clearance status, staff notes, and proof history are live.'
        : 'There is no active clearance item for this office. Contact your administrator if you believe one should be available.');
    } catch (cause) {
      setDataNotice('Live office data could not be loaded. Pull to refresh or try again later.');
      setError(cause?.message || 'Could not load this office’s clearance details.');
    } finally {
      setLoading(false);
    }
  }, [user, config, route, requestId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!supabase || !requestId || !user?.id) return undefined;
    const channel = supabase.channel(`student-office-status-${requestId}-${config.code}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'clearance_items',
        filter: `clearance_request_id=eq.${requestId}`,
      }, (payload) => {
        const updatedItem = payload?.new;
        if (!updatedItem?.id) return;
        setItems((current) => current.map((row) => row.id === updatedItem.id ? { ...row, ...updatedItem } : row));
        setItem((current) => current?.id === updatedItem.id ? { ...current, ...updatedItem } : current);
        load();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [config.code, load, requestId, user?.id]);

  const isLocked = !isOfficeUnlocked(config.code, items);
  const status = item?.status || 'PENDING';
  const isApproved = status === 'APPROVED';
  const surveyReadOnly = isApproved || isLocked;
  const OfficeIcon = config.icon;
  const department = profile?.academic_departments?.code || profile?.department_code;

  const chooseFile = async () => {
    if (isApproved) {
      Alert.alert('Already cleared', 'This office has approved your clearance. No additional proof is needed.');
      return;
    }
    if (isLocked) {
      Alert.alert('Accounting approval required', 'You must submit proof of payment and receive Accounting approval before accessing this office.');
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true, multiple: false });
      if (!result.canceled && result.assets?.[0]) {
        setFile(result.assets[0]);
        setError('');
      }
    } catch (cause) {
      setError(cause?.message || 'Could not open the document picker.');
    }
  };

  const submitProof = async () => {
    if (isApproved) {
      Alert.alert('Already cleared', 'This office has approved your clearance. No additional proof is needed.');
      return;
    }
    if (isLocked) {
      Alert.alert('Accounting approval required', 'You must submit proof of payment and receive Accounting approval before accessing this office.');
      return;
    }
    if (!file) return setError('Choose an image or PDF before submitting proof.');
    if (Number(file.size || 0) > 10 * 1024 * 1024) return setError('Choose a file smaller than 10 MB.');
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (file.mimeType && !allowedTypes.includes(file.mimeType.toLowerCase())) return setError('Choose a PDF, JPEG, PNG, or WebP file.');
    if (!item?.id) return setError('This office is not included in an active clearance request yet.');
    if (!user?.id) return setError('Sign in again before submitting proof.');

    setUploading(true);
    setError('');
    try {
      const latest = await fetchStudentRequest(user.id);
      const latestItems = latest?.clearance_items || [];
      setItems(latestItems);
      if (!isOfficeUnlocked(config.code, latestItems)) {
        setFile(null);
        Alert.alert('Accounting approval required', 'You must submit proof of payment and receive Accounting approval before accessing this office.');
        return;
      }
      await uploadOfficeProof({ file, item, userId: user.id });
      await markClearanceItemSubmitted(item.id);
      setFile(null);
      await load();
      Alert.alert('Proof submitted', `Your document was sent to ${config.title} for review.`);
    } catch (cause) {
      setError(cause?.message || 'Could not submit this proof. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const openProof = async (proof) => {
    try {
      const url = await createProofPreviewUrl(proof.storage_path);
      if (!url) return;
      await Linking.openURL(url);
    } catch (cause) {
      setError(cause?.message || 'Could not open this document.');
    }
  };

  const saveSurvey = async () => {
    const response = surveyResponse.trim();
    if (!response) {
      Alert.alert('Response required', 'Write a short response before saving.');
      return;
    }
    if (response.length > 2000) {
      Alert.alert('Response too long', 'Keep your response within 2000 characters.');
      return;
    }
    if (!item?.id || config.code !== 'GUIDANCE') {
      Alert.alert('Guidance clearance unavailable', 'Open this survey from an active Guidance clearance item.');
      return;
    }
    if (surveyReadOnly) {
      setSurveyVisible(false);
      return;
    }
    setSurveySubmitting(true);
    try {
      const saved = await submitGuidanceExitSurvey(item.id, response);
      setSurveyResponse(saved?.response || response);
      setSurveyComplete(true);
      setSurveyVisible(false);
      Alert.alert('Survey saved', 'Your response is saved and visible to you and active staff assigned to Guidance.');
    } catch (cause) {
      Alert.alert('Could not save survey', cause?.message || 'Please try again.');
    } finally {
      setSurveySubmitting(false);
    }
  };

  const sections = config.sections || [];

  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <View style={styles.header}>
      <Pressable onPress={() => navigation.goBack()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back"><ArrowLeft size={21} color="#FFFFFF" /></Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>{config.title}</Text>
      <View style={styles.headerSpace} />
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.statusBanner, { backgroundColor: status === 'APPROVED' ? '#1F8A50' : status === 'HOLD' || status === 'REJECTED' ? '#A93E35' : '#1B4332' }]}>
        <View style={styles.statusCopy}><Text style={styles.statusLabel}>CLEARANCE STATUS</Text><Text style={styles.statusValue}>{statusLabel(status)}</Text></View>
        {status === 'APPROVED' ? <CheckCircle2 size={25} color="#FFFFFF" /> : <Clock3 size={25} color="#FFFFFF" />}
      </View>

      <View style={styles.introCard}>
        <View style={styles.officeIcon}><OfficeIcon size={24} color="#0D3B2E" /></View>
        <Text style={styles.introTitle}>{config.title} Clearance</Text>
        <Text style={styles.introText}>{config.subtitle}</Text>
        {config.code === 'DEAN' || config.code === 'ADVISER' ? <Text style={styles.departmentChip}>Department: {department || 'Assigned department'}</Text> : null}
      </View>

      {dataNotice ? <View style={styles.previewBanner}><Text style={styles.previewTitle}>CLEARANCE INFORMATION</Text><Text style={styles.previewText}>{dataNotice}</Text></View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator color="#0D3B2E" style={styles.loader} /> : null}

      {item?.remarks || item?.remark ? <View style={styles.staffNote}><Text style={styles.staffNoteTitle}>NOTE FROM THE OFFICE</Text><Text style={styles.staffNoteText}>{item.remarks || item.remark}</Text></View> : null}

      {isLocked ? <View style={styles.lockBanner}><LockKeyhole size={19} color="#8C5B08" /><Text style={styles.lockText}>Locked: Accounting approval is required before uploading documents for this office.</Text></View> : null}

      {sections.map((section) => <SectionCard
        key={section.title}
        section={section}
        actionLabel={surveyComplete && section.type === 'action' ? 'SURVEY COMPLETED' : undefined}
        surveyComplete={surveyComplete}
        onAction={section.type === 'action' && config.code === 'GUIDANCE' ? () => setSurveyVisible(true) : undefined}
        actionDisabled={loading || !item?.id || isLocked || surveySubmitting}
      />)}

      <View style={styles.uploadCard}>
        <Text style={styles.cardTitle}>{config.uploadTitle}</Text>
        <Text style={styles.uploadHint}>{isApproved ? 'This office has approved your clearance. No additional proof is needed.' : 'Accepted file types: PDF, JPEG, PNG, or WebP (up to 10 MB). The office will review your submitted proof.'}</Text>
        {file ? <View style={styles.fileRow}><FileText size={19} color="#0D3B2E" /><Text style={styles.fileName} numberOfLines={2}>{file.name || 'Selected document'}</Text></View> : null}
        <Pressable onPress={file ? submitProof : chooseFile} disabled={loading || uploading || isLocked || isApproved || !item?.id} style={[styles.uploadButton, (loading || uploading || isLocked || isApproved || !item?.id) && styles.disabled]} accessibilityRole="button">
          {uploading ? <ActivityIndicator color="#FFFFFF" /> : <UploadCloud size={19} color="#FFFFFF" />}
          <Text style={styles.uploadButtonText}>{uploading ? 'UPLOADING…' : file ? 'SUBMIT PROOF' : config.uploadLabel}</Text>
        </Pressable>
        {!item?.id && !loading ? <Text style={styles.noItemHint}>Uploads need an active clearance item for this office.</Text> : null}
      </View>

      <View style={styles.historyCard}>
        <Text style={styles.cardTitle}>SUBMISSION HISTORY</Text>
        {proofs.length === 0 ? <Text style={styles.emptyText}>No submitted proof is on record.</Text> : proofs.map((proof) => <Pressable key={proof.id} onPress={() => openProof(proof)} style={styles.proofRow}>
          <View style={styles.proofIcon}><FileText size={17} color="#0D3B2E" /></View>
          <View style={styles.proofCopy}><Text style={styles.proofName} numberOfLines={1}>{proof.file_name || 'Submitted document'}</Text><Text style={styles.proofDate}>{proof.created_at ? new Date(proof.created_at).toLocaleString() : 'Date unavailable'}</Text></View>
          <Text style={styles.proofAction}>OPEN</Text>
        </Pressable>)}
      </View>
    </ScrollView>
    <Modal visible={surveyVisible} transparent animationType="fade" onRequestClose={() => setSurveyVisible(false)}>
      <View style={styles.modalBackdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalKeyboard}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Guidance Exit Survey</Text>
            <Text style={styles.modalCopy}>What is one goal you want to focus on after completing this school year?</Text>
            <Text style={styles.modalPrivacy}>Your response is stored with this clearance and can be read by active staff assigned to Guidance.</Text>
            <TextInput
              value={surveyResponse}
              onChangeText={setSurveyResponse}
              multiline
              textAlignVertical="top"
              maxLength={2000}
              editable={!surveyReadOnly && !surveySubmitting}
              placeholder="Write a short response"
              style={styles.surveyInput}
              accessibilityLabel="Exit survey response"
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setSurveyVisible(false)} disabled={surveySubmitting} style={styles.modalCancel}><Text style={styles.modalCancelText}>{surveyReadOnly ? 'Close' : 'Cancel'}</Text></Pressable>
              {!surveyReadOnly ? <Pressable onPress={saveSurvey} disabled={surveySubmitting} style={[styles.modalSubmit, surveySubmitting && styles.disabled]}>{surveySubmitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.modalSubmitText}>Save response</Text>}</Pressable> : null}
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  </SafeAreaView>;
}

function SectionCard({ section, onAction, actionLabel, actionDisabled, surveyComplete }) {
  return <View style={styles.sectionCard}>
    <Text style={styles.cardTitle}>{section.title}</Text>
    {section.type === 'checklist' ? section.rows.map((row) => {
      const isSurveyRow = row.label === 'Exit interview questionnaire';
      const rowStatus = isSurveyRow ? surveyComplete ? 'APPROVED' : 'PENDING' : row.status;
      const color = statusColor(rowStatus);
      const detail = isSurveyRow ? surveyComplete ? 'Your response has been saved.' : 'Complete the exit survey before submission.' : row.detail;
      return <Pressable key={row.label} onPress={() => Alert.alert(row.label, detail || 'Check with the assigned office for details.')} style={styles.checkRow}>
        <View style={styles.checkCopy}><Text style={styles.checkTitle}>{row.label}</Text>{detail ? <Text style={styles.checkDetail}>{detail}</Text> : null}</View>
        <View style={[styles.badge, { backgroundColor: `${color}18` }]}><Text style={[styles.badgeText, { color }]}>{statusLabel(rowStatus)}</Text></View>
      </Pressable>;
    }) : null}
    {section.type === 'notice' ? <Text style={styles.noticeText}>{section.text}</Text> : null}
    {section.type === 'metrics' ? section.rows.map((row) => <View key={row.label} style={styles.detailMetric}><Text style={styles.checkTitle}>{row.label}</Text><Text style={styles.detailMetricValue}>{row.value}</Text></View>) : null}
    {section.type === 'action' ? <>
      <Text style={styles.noticeText}>{section.text}</Text>
      <Pressable onPress={onAction} disabled={!onAction || actionDisabled} style={[styles.secondaryAction, (!onAction || actionDisabled) && styles.disabled]}><Text style={styles.secondaryActionText}>{actionLabel || section.actionLabel}</Text></Pressable>
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  modalPrivacy: { color: '#66746A', fontSize: 11, lineHeight: 16, marginTop: 8, backgroundColor: '#F4F7F2', padding: 9, borderRadius: 9 },
  safe: { flex: 1, backgroundColor: '#F3F6F1' }, header: { height: 58, backgroundColor: '#0D3B2E', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }, back: { width: 40, justifyContent: 'center' }, headerTitle: { flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '800' }, headerSpace: { width: 25 }, content: { padding: 16, paddingBottom: 30 },
  statusBanner: { minHeight: 69, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }, statusCopy: { gap: 4 }, statusLabel: { color: '#DCE8DD', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 }, statusValue: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  introCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 12 }, officeIcon: { width: 43, height: 43, borderRadius: 13, backgroundColor: '#E8F0E5', alignItems: 'center', justifyContent: 'center', marginBottom: 9 }, introTitle: { color: '#163D2A', fontSize: 18, fontWeight: '900' }, introText: { color: '#6D7A70', fontSize: 13, lineHeight: 19, marginTop: 5 }, departmentChip: { color: '#0D3B2E', backgroundColor: '#E7EFE1', alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6, marginTop: 10, fontSize: 11, fontWeight: '800' },
  previewBanner: { backgroundColor: '#EDF3EC', borderColor: '#D8E5D5', borderWidth: 1, borderRadius: 12, padding: 11, marginBottom: 12 }, previewTitle: { color: '#1E5632', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 }, previewText: { color: '#526557', fontSize: 11, lineHeight: 16, marginTop: 3 }, error: { color: '#A5352B', backgroundColor: '#FCEAE7', padding: 11, borderRadius: 10, fontSize: 12, marginBottom: 10 }, loader: { marginVertical: 10 },
  staffNote: { backgroundColor: '#FFF4DC', borderColor: '#E8CE92', borderWidth: 1, borderRadius: 12, padding: 11, marginBottom: 12 }, staffNoteTitle: { color: '#805C10', fontSize: 10, fontWeight: '900', letterSpacing: 0.6 }, staffNoteText: { color: '#725A28', fontSize: 11, lineHeight: 16, marginTop: 3 },
  lockBanner: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#FFF2D6', borderColor: '#E4C16B', borderWidth: 1, padding: 12, borderRadius: 12, marginBottom: 12 }, lockText: { flex: 1, color: '#73510D', fontSize: 12, lineHeight: 17, fontWeight: '700' },
  sectionCard: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 15, marginBottom: 12 }, cardTitle: { color: '#0D3B2E', fontSize: 13, fontWeight: '900', letterSpacing: 0.4, marginBottom: 9 }, checkRow: { minHeight: 59, borderTopWidth: 1, borderTopColor: '#EDF1EC', paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 9 }, checkCopy: { flex: 1 }, checkTitle: { color: '#2D3D31', fontSize: 12, fontWeight: '800' }, checkDetail: { color: '#77837A', fontSize: 11, lineHeight: 15, marginTop: 3 }, badge: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7, maxWidth: 120 }, badgeText: { fontSize: 8, fontWeight: '900', textAlign: 'center' }, noticeText: { color: '#657369', fontSize: 12, lineHeight: 18 }, detailMetric: { minHeight: 39, borderTopWidth: 1, borderTopColor: '#EDF1EC', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, detailMetricValue: { color: '#0D3B2E', fontSize: 12, fontWeight: '800' }, secondaryAction: { minHeight: 42, borderWidth: 1, borderColor: '#0D3B2E', borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 11 }, secondaryActionText: { color: '#0D3B2E', fontSize: 11, fontWeight: '900' },
  uploadCard: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 15, marginBottom: 12 }, uploadHint: { color: '#718075', fontSize: 11, lineHeight: 16, marginBottom: 10 }, fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EAF0E7', borderRadius: 10, padding: 10, marginBottom: 10 }, fileName: { flex: 1, color: '#344338', fontSize: 11, fontWeight: '700' }, uploadButton: { minHeight: 50, backgroundColor: '#0D3B2E', borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 10 }, uploadButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900', textAlign: 'center' }, disabled: { opacity: 0.45 }, noItemHint: { color: '#78847A', fontSize: 10, lineHeight: 15, marginTop: 8, textAlign: 'center' },
  historyCard: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 15 }, emptyText: { color: '#718075', fontSize: 12, marginTop: 2 }, proofRow: { minHeight: 55, borderTopWidth: 1, borderTopColor: '#EDF1EC', flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 8, paddingTop: 8 }, proofIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#EAF0E7', alignItems: 'center', justifyContent: 'center' }, proofCopy: { flex: 1 }, proofName: { color: '#344338', fontSize: 11, fontWeight: '800' }, proofDate: { color: '#829087', fontSize: 9, marginTop: 3 }, proofAction: { color: '#0D3B2E', fontSize: 9, fontWeight: '900' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(12, 31, 19, 0.5)', justifyContent: 'center', padding: 20 }, modalKeyboard: { width: '100%' }, modalCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 18 }, modalTitle: { color: '#0D3B2E', fontSize: 18, fontWeight: '900' }, modalCopy: { color: '#66746A', fontSize: 13, lineHeight: 19, marginTop: 8 }, surveyInput: { minHeight: 110, borderWidth: 1, borderColor: '#DCE5DB', borderRadius: 11, padding: 11, color: '#26372C', fontSize: 13, marginTop: 13 }, modalActions: { flexDirection: 'row', gap: 9, marginTop: 14 }, modalCancel: { flex: 1, minHeight: 45, borderWidth: 1, borderColor: '#DCE5DB', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, modalCancelText: { color: '#536257', fontWeight: '800' }, modalSubmit: { flex: 1.4, minHeight: 45, backgroundColor: '#0D3B2E', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, modalSubmitText: { color: '#FFFFFF', fontWeight: '900' },
});
