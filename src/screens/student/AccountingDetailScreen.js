import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { ArrowLeft, CheckCircle2, Clock3, FileText, UploadCloud, X, ZoomIn, ZoomOut } from 'lucide-react-native';
import { createProofPreviewUrl, fetchOfficeProofs, fetchStudentRequest, markClearanceItemSubmitted, uploadOfficeProof } from '../../api/studentApi.js';
import { supabase } from '../../api/supabase.js';
import { useAuth } from '../../context/AuthContext.js';

const statusColor = (status) => status === 'APPROVED' ? '#1F8A50' : ['HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'].includes(status) ? '#A93E35' : '#1B4332';
const statusLabel = (status) => String(status || 'PENDING').replaceAll('_', ' ');
const formatCurrency = (amount) => `PHP ${(Number(amount) || 0).toFixed(2)}`;
const isBucketNotFound = (error) => /bucket[^\n]*not found/i.test(String(error?.message || error || ''));
const isClearancePaperProof = (proof) => {
  const clearanceItemId = proof?.clearance_item_id || proof?.item_id;
  const storageParts = String(proof?.storage_path || '').split('/');
  return String(proof?.document_type || '').toUpperCase() === 'CLEARANCE_PAPER'
    && String(proof?.file_name || '').toLowerCase().startsWith('clearance-paper-')
    && String(storageParts[0] || '').toLowerCase() === String(proof?.student_id || '').toLowerCase()
    && String(storageParts[1] || '').toLowerCase() === String(clearanceItemId || '').toLowerCase()
    && String(storageParts[2] || '').toLowerCase().includes('clearance-paper-');
};
const isUuid = (value) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function formatPaymentDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
}

export function AccountingDetailScreen({ navigation, route }) {
  const { user } = useAuth();
  const userId = user?.id;
  const routeItem = route?.params?.clearanceItem || null;
  const [item, setItem] = useState(routeItem);
  const [ledger, setLedger] = useState(null);
  const [payments, setPayments] = useState([]);
  const [proofs, setProofs] = useState([]);
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [warning, setWarning] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [validationModalVisible, setValidationModalVisible] = useState(false);
  const [validationErrorMessage, setValidationErrorMessage] = useState('');
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [isValidating, setIsValidating] = useState(false);
  const [previewScale, setPreviewScale] = useState(1);
  const activeRequestId = route?.params?.requestId || item?.clearance_request_id || item?.request_id || null;

  const load = useCallback(async (refresh = false) => {
    if (!userId || !supabase) {
      setLoading(false);
      setWarning('Sign in and configure Supabase to view your accounting details.');
      return;
    }
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    const [requestResult, ledgerResult, paymentsResult] = await Promise.allSettled([
      fetchStudentRequest(userId),
      supabase.from('student_ledgers').select('*').eq('student_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('student_payments').select('*').eq('student_id', userId).order('payment_date', { ascending: false }),
    ]);

    const messages = [];
    let accountingItem = null;
    if (requestResult.status === 'fulfilled') {
      const accountingItems = (requestResult.value?.clearance_items || []).filter((row) => String(row.office_code || '').toUpperCase() === 'ACCOUNTING');
      accountingItem = accountingItems.find((row) => String(row.status || '').toUpperCase() === 'APPROVED')
        || accountingItems[0]
        || (routeItem?.office_code === 'ACCOUNTING' ? routeItem : null);
      setItem(accountingItem || null);
      if (!accountingItem) messages.push('No Accounting clearance item exists for the active clearance period. Refresh your dashboard or ask the Registrar to initialize your clearance.');
    } else {
      accountingItem = routeItem?.office_code === 'ACCOUNTING' ? routeItem : null;
      setItem(accountingItem);
      messages.push('Could not load the Accounting clearance status.');
    }

    if (accountingItem?.id) {
      try {
        const receiptRows = await fetchOfficeProofs(accountingItem.id);
        const receiptsWithPreview = await Promise.all(receiptRows.slice(0, 8).map(async (proof) => {
          let previewUrl = proof.file_url || null;
          if (proof.storage_path) {
            try { previewUrl = await createProofPreviewUrl(proof.storage_path); }
            catch (proofError) { if (!isBucketNotFound(proofError)) throw proofError; }
          }
          return { ...proof, preview_url: previewUrl };
        }));
        setProofs(receiptsWithPreview);
      } catch (proofError) {
        setProofs([]);
        if (!isBucketNotFound(proofError)) messages.push('Receipt history could not be loaded. Pull down to retry.');
      }
    } else setProofs([]);

    const rawLedger = ledgerResult.status === 'fulfilled' && !ledgerResult.value.error
      ? ledgerResult.value.data
      : null;
    const fallbackBalance = Number(accountingItem?.balance_amount) || 0;
    const fallbackLedger = {
      tuition_fee: 0,
      lab_fee: 0,
      misc_fee: 0,
      outstanding_balance: fallbackBalance,
      total_balance: fallbackBalance,
      required_action: fallbackBalance === 0 ? 'NO OUTSTANDING BALANCE' : 'SETTLE PAYMENT',
    };
    setLedger(rawLedger || fallbackLedger);
    if (ledgerResult.status === 'rejected' || (ledgerResult.status === 'fulfilled' && ledgerResult.value.error)) {
      const ledgerError = ledgerResult.status === 'rejected' ? ledgerResult.reason : ledgerResult.value.error;
      if (!isBucketNotFound(ledgerError)) messages.push('Student ledger data could not be loaded. Showing zero balance until Accounting provides a ledger.');
    }

    if (paymentsResult.status === 'fulfilled' && !paymentsResult.value.error) {
      setPayments(paymentsResult.value.data || []);
    } else {
      setPayments([]);
      const paymentError = paymentsResult.status === 'rejected' ? paymentsResult.reason : paymentsResult.value.error;
      if (!isBucketNotFound(paymentError)) messages.push('Payment history could not be loaded. Pull down to retry.');
    }

    setWarning(messages.join(' '));
    setLoading(false);
    setRefreshing(false);
  }, [routeItem, userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!supabase || !userId || !activeRequestId) return undefined;
    const channel = supabase.channel(`student-accounting-ledger-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'student_ledgers', filter: `student_id=eq.${userId}` }, () => load(true))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clearance_items', filter: `clearance_request_id=eq.${activeRequestId}` }, (payload) => {
        if (payload?.new?.id) {
          setItem((current) => current?.id === payload.new.id ? { ...current, ...payload.new } : current);
        }
        load(true);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeRequestId, load, userId]);

  const accountingItemId = item?.id;
  const ensureAccountingItemId = () => {
    if (isUuid(accountingItemId)) return true;
    const message = 'Clearance item record not found. Please refresh the page and try again.';
    setError(message);
    Alert.alert('Accounting clearance not ready', message);
    return false;
  };

  const handlePhotoCaptured = (asset) => {
    setError('');
    setSuccessMessage('');
    setValidationErrorMessage('');
    setPreviewScale(1);
    setSelectedAsset(asset);
    setFile(asset);
    setPreviewModalVisible(true);
  };

  const chooseReceipt = () => {
    if (!ensureAccountingItemId()) return;
    return pickClearancePaper(false);
  };

  const pickClearancePaper = async (useCamera) => {
    if (!ensureAccountingItemId()) return;
    try {
      // Browsers grant access through the file chooser itself. Avoid awaiting a
      // permission request before opening it, or the browser may block the click.
      const permission = Platform.OS === 'web'
        ? { granted: true }
        : useCamera
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError(useCamera ? 'Allow camera access to photograph your clearance paper.' : 'Allow photo library access to choose your clearance paper image.');
        return;
      }
      const launch = useCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
      const result = await launch({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.85,
        base64: false,
      });
      const asset = result.assets?.[0];
      if (!result.canceled && asset) {
        const selectedPhoto = {
          ...asset,
          name: asset.fileName || `accounting-clearance-paper-${Date.now()}.jpg`,
          mimeType: asset.mimeType || 'image/jpeg',
        };
        handlePhotoCaptured(selectedPhoto);
      }
    } catch (cause) {
      setError(cause?.message || 'Could not open the camera or photo library.');
    }
  };

  const uploadClearancePaper = async (selectedFile) => {
    if (!selectedFile?.uri) {
      setError('Choose a photo of your physical Accounting clearance paper first.');
      return;
    }
    if (!ensureAccountingItemId()) return;
    if (!user?.id) {
      setError('Sign in again before submitting your clearance paper.');
      return;
    }

    setUploading(true);
    setError('');
    try {
      await uploadOfficeProof({ file: selectedFile, item: { ...item, id: accountingItemId }, userId: user.id, documentType: 'CLEARANCE_PAPER' });
      await markClearanceItemSubmitted(accountingItemId);
      setFile(null);
      await load(true);
      setSuccessMessage('Clearance Paper Submitted — Awaiting Accounting Staff Approval.');
      return true;
    } catch (cause) {
      setError(cause?.message || 'Could not upload your clearance paper. Please try again.');
      return false;
    } finally {
      setUploading(false);
    }
  };

  const validateClearancePaper = async (asset) => {
    if (!asset?.uri) return { valid: false, reason: 'No image asset selected.' };

    let width = Number(asset.width) || 0;
    let height = Number(asset.height) || 0;
    if (!width || !height) {
      try {
        const dimensions = await new Promise((resolve, reject) => {
          Image.getSize(asset.uri, (imageWidth, imageHeight) => resolve({ width: imageWidth, height: imageHeight }), reject);
        });
        width = dimensions.width;
        height = dimensions.height;
      } catch (_dimensionError) {
        return { valid: false, reason: 'The image dimensions could not be verified. Please choose or retake the photo.' };
      }
    }
    if (width < 600 || height < 600) {
      return { valid: false, reason: 'Image resolution is too low. Take a clear, full-page photo of your clearance paper.' };
    }

    let fileSize = Number(asset.fileSize) || 0;
    if (!fileSize) {
      try {
        const response = await fetch(asset.uri);
        if (!response.ok) return { valid: false, reason: 'The selected image could not be read. Please choose or retake it.' };
        fileSize = (await response.blob()).size;
      } catch (_sizeError) {
        return { valid: false, reason: 'The selected image size could not be verified. Please choose or retake it.' };
      }
    }
    if (fileSize < 50 * 1024) {
      return { valid: false, reason: 'The image appears blank, dark, or too small. Retake it in good lighting.' };
    }

    // Optional OCR / Vision validation can be called here before returning valid.
    return { valid: true };
  };

  const handleConfirmUpload = async () => {
    if (!selectedAsset || !ensureAccountingItemId()) return;
    setIsValidating(true);
    setValidationErrorMessage('');
    try {
      const check = await validateClearancePaper(selectedAsset);
      if (!check.valid) {
        setValidationErrorMessage(`${check.reason}\n\nInvalid Clearance Document Detected. The uploaded photo does not appear to be a clear, legible Accounting Clearance Paper. Ensure the paper is fully visible and well lit.`);
        setValidationModalVisible(true);
        return;
      }

      const uploaded = await uploadClearancePaper(selectedAsset);
      if (uploaded) {
        setPreviewModalVisible(false);
        setValidationModalVisible(false);
        setSelectedAsset(null);
        setFile(null);
      }
    } finally {
      setIsValidating(false);
    }
  };

  const discardSelectedPhoto = () => {
    setPreviewModalVisible(false);
    setValidationModalVisible(false);
    setValidationErrorMessage('');
    setSelectedAsset(null);
    setFile(null);
    setPreviewScale(1);
  };

  const handleTakePhotoWithCamera = async () => {
    if (!ensureAccountingItemId()) return;
    if (!user?.id) {
      setError('Sign in again before submitting your clearance paper.');
      return;
    }
    setError('');
    setUploading(true);
    try {
      if (Platform.OS !== 'web') {
        const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
        if (!permissionResult.granted) {
          Alert.alert('Permission Denied', 'Camera access is required to take a photo of your clearance paper.');
          return;
        }
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
        base64: false,
      });
      const photoAsset = result.assets?.[0];
      if (result.canceled || !photoAsset) return;

      const photoFile = {
        ...photoAsset,
        name: `accounting-clearance-paper-${user.id}-${Date.now()}.jpg`,
        mimeType: photoAsset.mimeType || 'image/jpeg',
      };
      handlePhotoCaptured(photoFile);
    } catch (cause) {
      setError(cause?.message || 'Failed to capture or upload the clearance paper photo.');
    } finally {
      setUploading(false);
    }
  };

  const openReceipt = async (proof) => {
    if (!proof.preview_url) return;
    try { await Linking.openURL(proof.preview_url); }
    catch (cause) { setError(cause?.message || 'Could not open this receipt.'); }
  };

  const submitReceipt = () => uploadClearancePaper(file);

  const status = item?.status || 'PENDING';
  const currentItemBalance = Number(item?.balance_amount) || 0;
  const displayedLedger = ledger || {
    tuition_fee: 0,
    lab_fee: 0,
    misc_fee: 0,
    outstanding_balance: currentItemBalance,
    total_balance: currentItemBalance,
    required_action: currentItemBalance === 0 ? 'NO OUTSTANDING BALANCE' : 'SETTLE PAYMENT',
  };
  const displayedPayments = payments;
  const ledgerConfigured = displayedLedger.is_configured === true || (!ledger && status === 'APPROVED');
  const totalBalance = ledgerConfigured ? Number(displayedLedger.outstanding_balance ?? item?.balance_amount ?? displayedLedger.total_balance ?? 0) || 0 : null;
  const noBalanceDue = ledgerConfigured && totalBalance === 0;
  const action = status === 'APPROVED' ? 'NO ACTION REQUIRED' : !ledgerConfigured ? 'FEES NOT YET ENTERED' : noBalanceDue ? 'NO OUTSTANDING BALANCE' : displayedLedger.required_action || 'SETTLE PAYMENT';

  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <View style={styles.header}>
      <Pressable onPress={() => navigation.goBack()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back"><ArrowLeft size={21} color="#FFFFFF" /></Pressable>
      <Text style={styles.headerTitle}>Accounting Office</Text>
      <View style={styles.headerSpace} />
    </View>

    <View style={[styles.statusBanner, { backgroundColor: statusColor(status) }]}>
      <Text style={styles.statusBannerLabel}>CLEARANCE STATUS</Text>
      <View style={styles.statusBannerValueRow}>
        {status === 'APPROVED' ? <CheckCircle2 size={19} color="#FFFFFF" /> : <Clock3 size={19} color="#FFFFFF" />}
        <Text style={styles.statusBannerValue}>{statusLabel(status)}</Text>
      </View>
    </View>

    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#0D3B2E" />}
    >
      {loading ? <ActivityIndicator color="#0D3B2E" style={styles.loader} /> : null}
      {warning ? <Text accessibilityRole="alert" style={styles.warning}>{warning}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {successMessage ? <Text accessibilityRole="alert" style={styles.successBanner}>{successMessage}</Text> : null}

      {proofs.some(isClearancePaperProof) && status !== 'APPROVED' ? <View style={styles.submittedNotice}>
        <Clock3 size={18} color="#805A0A" />
        <Text style={styles.submittedNoticeText}>Clearance Paper Submitted — Awaiting Accounting Staff Approval</Text>
      </View> : null}

      <View style={styles.timelineCard}>
        <Text style={styles.timelineTitle}>PAYMENT REVIEW STATUS</Text>
        <StatusTimeline status={status} hasProof={proofs.length > 0} />
        {['HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'].includes(status) && item?.remarks
          ? <Text style={styles.timelineRemark}>Accounting remark: {item.remarks}</Text>
          : null}
      </View>

      <View style={styles.receiptsCard}>
        <Text style={styles.historyTitle}>UPLOADED CLEARANCE PAPERS ({proofs.length})</Text>
        {proofs.length ? <View style={styles.receiptGrid}>{proofs.map((proof) => {
          const isImage = String(proof.mime_type || proof.file_type || '').startsWith('image/');
          return <Pressable key={proof.id} onPress={() => openReceipt(proof)} style={styles.receiptTile} accessibilityRole="button" accessibilityLabel={`Open receipt ${proof.file_name || ''}`}>
            {isImage && proof.preview_url ? <Image source={{ uri: proof.preview_url }} style={styles.receiptThumbnail} resizeMode="cover" /> : <View style={styles.receiptDocument}><FileText size={22} color="#0D3B2E" /></View>}
            <Text style={styles.receiptName} numberOfLines={1}>{proof.file_name || 'Payment receipt'}</Text>
            <Text style={styles.receiptDate}>{proof.uploaded_at ? new Date(proof.uploaded_at).toLocaleDateString() : ''}</Text>
          </Pressable>;
        })}</View> : <Text style={styles.emptyHistory}>No receipt has been uploaded yet.</Text>}
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>CLEARANCE SUMMARY</Text>
        <View style={styles.summaryInner}>
          <Text style={styles.innerLabel}>OUTSTANDING BALANCE:</Text>
          <Text style={styles.balance}>{ledgerConfigured ? formatCurrency(totalBalance) : 'Not configured'}</Text>
        </View>
        <View style={styles.summaryInner}>
          <Text style={styles.innerLabel}>REQUIRED ACTION:</Text>
          <View style={styles.actionRow}>
            {noBalanceDue || status === 'APPROVED' ? <CheckCircle2 size={17} color="#27824D" /> : null}
            <Text style={[styles.actionValue, (noBalanceDue || status === 'APPROVED') && styles.actionComplete]}>{action}</Text>
          </View>
        </View>

        <Text style={styles.feeHeading}>FEE BREAKDOWN</Text>
        <FeeRow label="Tuition Fees" value={ledgerConfigured ? formatCurrency(displayedLedger.tuition_fee) : '—'} />
        <FeeRow label="Laboratory Fees" value={ledgerConfigured ? formatCurrency(displayedLedger.lab_fee) : '—'} />
        <FeeRow label="Miscellaneous Fees" value={ledgerConfigured ? formatCurrency(displayedLedger.misc_fee) : '—'} last />
      </View>

      <View style={styles.historyCard}>
        <View style={styles.historyHeading}><FileText size={19} color="#0D3B2E" /><Text style={styles.historyTitle}>PAYMENT HISTORY</Text></View>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeading, styles.dateColumn]}>DATE</Text>
          <Text style={[styles.tableHeading, styles.amountColumn]}>AMOUNT</Text>
          <Text style={[styles.tableHeading, styles.paymentStatusColumn]}>STATUS</Text>
        </View>
        {displayedPayments.length === 0
          ? <Text style={styles.emptyHistory}>No payment records found.</Text>
          : displayedPayments.map((payment) => <View key={payment.id} style={styles.paymentRow}>
            <Text style={[styles.paymentText, styles.dateColumn]}>{formatPaymentDate(payment.payment_date)}</Text>
            <Text style={[styles.paymentText, styles.amountColumn]}>{formatCurrency(payment.amount)}</Text>
            <Text style={[styles.paymentStatus, styles.paymentStatusColumn]}>{String(payment.status || 'PENDING').toUpperCase()}</Text>
          </View>)}
      </View>

      {file && !previewModalVisible ? <View style={styles.selectedFile}>
        <FileText size={19} color="#0D3B2E" />
          {file.uri ? <Image source={{ uri: file.uri }} style={styles.selectedThumbnail} resizeMode="cover" /> : null}
          <Text style={styles.selectedFileName} numberOfLines={2}>{file.name || 'Physical clearance paper'}</Text>
      </View> : null}
    </ScrollView>

    <View style={styles.footer}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          if (!ensureAccountingItemId()) return;
          if (file) submitReceipt();
          else chooseReceipt();
        }}
        disabled={loading || uploading || status === 'APPROVED'}
        style={[styles.uploadButton, (loading || uploading || status === 'APPROVED') && styles.disabledButton]}
      >
        {uploading ? <ActivityIndicator color="#FFFFFF" /> : <UploadCloud size={19} color="#FFFFFF" />}
        <Text style={styles.uploadButtonText}>{file ? 'SUBMIT CLEARANCE PAPER' : 'UPLOAD PHYSICAL CLEARANCE PAPER'}</Text>
      </Pressable>
      {!file && status !== 'APPROVED' ? <Pressable
        accessibilityRole="button"
        onPress={handleTakePhotoWithCamera}
        disabled={loading || uploading}
        style={styles.cameraButton}
      ><Text style={styles.cameraButtonText}>TAKE PHOTO WITH CAMERA</Text></Pressable> : null}
      {status === 'APPROVED' ? <Text style={styles.footerHint}>Accounting has approved your payment proof.</Text> : null}
    </View>
    <Modal visible={previewModalVisible} transparent animationType="fade" onRequestClose={discardSelectedPhoto}>
      <View style={styles.modalBackdrop}>
        <View style={styles.previewModal}>
          <View style={styles.previewHeader}>
            <View style={styles.previewHeaderCopy}><Text style={styles.previewTitle}>Review Clearance Paper</Text><Text style={styles.previewSubtitle}>Check that the entire paper is visible and readable.</Text></View>
            <Pressable onPress={discardSelectedPhoto} disabled={isValidating || uploading} style={styles.previewClose} accessibilityRole="button" accessibilityLabel="Close preview"><X size={20} color="#344238" /></Pressable>
          </View>
          <View style={styles.previewStage}>
            {selectedAsset?.uri ? <Image source={{ uri: selectedAsset.uri }} resizeMode="contain" style={[styles.previewImage, { transform: [{ scale: previewScale }] }]} /> : null}
            <View style={styles.zoomControls}>
              <Pressable onPress={() => setPreviewScale((scale) => Math.max(1, Number((scale - 0.25).toFixed(2))))} style={styles.zoomButton} accessibilityRole="button" accessibilityLabel="Zoom out"><ZoomOut size={20} color="#FFFFFF" /></Pressable>
              <Pressable onPress={() => setPreviewScale((scale) => Math.min(3, Number((scale + 0.25).toFixed(2))))} style={styles.zoomButton} accessibilityRole="button" accessibilityLabel="Zoom in"><ZoomIn size={20} color="#FFFFFF" /></Pressable>
            </View>
          </View>
          <View style={styles.irreversibleWarning}><Text style={styles.warningIcon}>⚠️</Text><Text style={styles.irreversibleWarningText}>Please review carefully: Once submitted, you cannot undo, unsubmit, or edit your clearance paper upload.</Text></View>
          <View style={styles.previewActions}>
            <Pressable onPress={discardSelectedPhoto} disabled={isValidating || uploading} style={styles.retakeButton}><Text style={styles.retakeButtonText}>Cancel / Retake</Text></Pressable>
            <Pressable onPress={handleConfirmUpload} disabled={isValidating || uploading} style={[styles.confirmButton, (isValidating || uploading) && styles.disabledButton]}>
              {isValidating || uploading ? <ActivityIndicator color="#FFFFFF" /> : <UploadCloud size={17} color="#FFFFFF" />}
              <Text style={styles.confirmButtonText}>Validate & Submit</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
    <Modal visible={validationModalVisible} transparent animationType="fade" onRequestClose={() => setValidationModalVisible(false)}>
      <View style={styles.validationBackdrop}>
        <View style={styles.validationModal}>
          <Text style={styles.validationTitle}>❌ Invalid Clearance Document Detected</Text>
          <Text style={styles.validationMessage}>{validationErrorMessage}</Text>
          <Pressable onPress={discardSelectedPhoto} style={[styles.confirmButton, styles.validationRetakeButton]}><Text style={styles.confirmButtonText}>Retake / Re-upload Photo</Text></Pressable>
          <Pressable onPress={() => setValidationModalVisible(false)} style={styles.keepPreviewButton}><Text style={styles.keepPreviewText}>Keep Preview</Text></Pressable>
        </View>
      </View>
    </Modal>
  </SafeAreaView>;
}

function FeeRow({ label, value, last = false }) {
  return <View style={[styles.feeRow, last && styles.feeRowLast]}>
    <Text style={styles.feeLabel}>{label}</Text>
    <Text style={styles.feeValue}>{value}</Text>
  </View>;
}

function StatusTimeline({ status, hasProof }) {
  const rejected = ['HOLD', 'REJECTED', 'REQUIREMENT_NEEDED'].includes(status);
  const submitted = hasProof || !['PENDING', ''].includes(status);
  const inReview = ['SUBMITTED', 'IN_REVIEW'].includes(status) || (hasProof && status === 'PENDING');
  const approved = status === 'APPROVED';
  const steps = [
    { label: 'Submitted', complete: submitted },
    { label: 'In Review', complete: inReview || approved || rejected, current: inReview },
    { label: rejected ? 'Rejected with Remarks' : 'Approved', complete: approved || rejected, current: rejected || approved, rejected },
  ];
  return <View style={styles.timelineSteps}>{steps.map((step, index) => <View key={step.label} style={styles.timelineStep}>
    <View style={[styles.timelineMark, step.complete && !step.rejected && styles.timelineMarkComplete, step.rejected && styles.timelineMarkRejected]}>
      {step.complete && !step.rejected ? <CheckCircle2 size={15} color="#FFFFFF" /> : <View style={styles.timelineMarkDot} />}
    </View>
    {index < steps.length - 1 ? <View style={[styles.timelineConnector, step.complete && styles.timelineConnectorComplete]} /> : null}
    <Text style={[styles.timelineLabel, step.complete && !step.rejected && styles.timelineLabelComplete, step.rejected && styles.timelineLabelRejected]}>{step.label}</Text>
  </View>)}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3F6F1' },
  header: { height: 58, backgroundColor: '#0D3B2E', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  back: { width: 40, justifyContent: 'center' }, headerTitle: { flex: 1, color: '#FFFFFF', fontSize: 17, fontWeight: '800' }, headerSpace: { width: 28 },
  statusBanner: { minHeight: 72, paddingHorizontal: 20, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  submittedNotice: { marginBottom: 12, padding: 13, borderRadius: 12, backgroundColor: '#FFF3D9', flexDirection: 'row', alignItems: 'center', gap: 9 }, submittedNoticeText: { color: '#6D4B10', flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  statusBannerLabel: { color: '#D8E7D8', fontSize: 11, fontWeight: '900', letterSpacing: 0.8 }, statusBannerValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, statusBannerValue: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  content: { padding: 16, paddingBottom: 24 }, loader: { marginVertical: 16 }, warning: { color: '#73510D', backgroundColor: '#FFF1D0', borderColor: '#E6C77D', borderWidth: 1, borderRadius: 11, padding: 11, fontSize: 12, lineHeight: 17, marginBottom: 12 }, error: { color: '#A5352B', backgroundColor: '#FCEAE7', borderRadius: 11, padding: 11, fontSize: 12, lineHeight: 17, marginBottom: 12 }, successBanner: { color: '#17623A', backgroundColor: '#E5F4E8', borderColor: '#ABD5B4', borderWidth: 1, borderRadius: 11, padding: 12, fontSize: 12, lineHeight: 17, fontWeight: '800', marginBottom: 12 },
  summaryCard: { backgroundColor: '#1B4332', borderRadius: 18, padding: 16, shadowColor: '#0D3B2E', shadowOpacity: 0.14, shadowRadius: 9, elevation: 3 }, summaryTitle: { color: '#E4D27A', fontSize: 14, fontWeight: '900', letterSpacing: 0.8, marginBottom: 12 },
  timelineCard: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 15, marginTop: 13 }, timelineTitle: { color: '#0D3B2E', fontSize: 12, fontWeight: '900', letterSpacing: 0.55 }, timelineSteps: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 17 }, timelineStep: { flex: 1, alignItems: 'center', position: 'relative' }, timelineMark: { width: 25, height: 25, borderRadius: 13, borderWidth: 2, borderColor: '#C8D2C9', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', zIndex: 1 }, timelineMarkComplete: { backgroundColor: '#27824D', borderColor: '#27824D' }, timelineMarkRejected: { backgroundColor: '#B7443A', borderColor: '#B7443A' }, timelineMarkDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#C8D2C9' }, timelineConnector: { height: 2, backgroundColor: '#DDE5DD', position: 'absolute', left: '61%', right: '-39%', top: 11 }, timelineConnectorComplete: { backgroundColor: '#61A976' }, timelineLabel: { color: '#7B887D', fontSize: 10, fontWeight: '700', textAlign: 'center', marginTop: 7 }, timelineLabelComplete: { color: '#27824D' }, timelineLabelRejected: { color: '#B7443A' }, timelineRemark: { color: '#9D382D', backgroundColor: '#FCEAE7', borderRadius: 9, padding: 10, fontSize: 11, lineHeight: 16, marginTop: 13 },
  receiptsCard: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 15, marginTop: 13 }, receiptGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 11 }, receiptTile: { width: 90, alignItems: 'center' }, receiptThumbnail: { width: 78, height: 68, borderRadius: 9, backgroundColor: '#EDF1EC' }, receiptDocument: { width: 78, height: 68, borderRadius: 9, backgroundColor: '#EAF2E4', alignItems: 'center', justifyContent: 'center' }, receiptName: { width: 84, color: '#344338', fontSize: 9, fontWeight: '800', marginTop: 5, textAlign: 'center' }, receiptDate: { color: '#819083', fontSize: 8, marginTop: 2 },
  summaryInner: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 13, marginBottom: 9 }, innerLabel: { color: '#718075', fontSize: 10, fontWeight: '900', letterSpacing: 0.5 }, balance: { color: '#183528', fontSize: 21, fontWeight: '900', marginTop: 5 }, actionRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 5 }, actionValue: { color: '#9B6C13', fontSize: 14, fontWeight: '900' }, actionComplete: { color: '#27824D' },
  feeHeading: { color: '#E4D27A', fontSize: 11, fontWeight: '900', letterSpacing: 0.7, marginTop: 8, marginBottom: 4 }, feeRow: { minHeight: 39, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.18)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, feeRowLast: { borderBottomWidth: 0 }, feeLabel: { color: '#E7EEE8', fontSize: 12 }, feeValue: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  historyCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 15, marginTop: 13 }, historyHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 13 }, historyTitle: { color: '#0D3B2E', fontSize: 13, fontWeight: '900', letterSpacing: 0.5 }, tableHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#DDE5DD', paddingBottom: 9 }, tableHeading: { color: '#718075', fontSize: 9, fontWeight: '900', letterSpacing: 0.5 }, dateColumn: { width: '28%' }, amountColumn: { width: '42%', textAlign: 'right' }, paymentStatusColumn: { width: '30%', textAlign: 'right' }, paymentRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#EDF1EC' }, paymentText: { color: '#344338', fontSize: 11 }, paymentStatus: { color: '#27824D', fontSize: 10, fontWeight: '900', textAlign: 'right' }, emptyHistory: { color: '#718075', fontSize: 12, paddingVertical: 14 },
  selectedFile: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#E8F0E6', borderRadius: 12, padding: 12, marginTop: 12 }, selectedFileName: { flex: 1, color: '#344338', fontSize: 12, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(6,20,12,0.78)', justifyContent: 'center', alignItems: 'center', padding: 14 }, previewModal: { width: '100%', maxWidth: 720, maxHeight: '94%', backgroundColor: '#FFFFFF', borderRadius: 18, overflow: 'hidden' }, previewHeader: { minHeight: 70, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }, previewHeaderCopy: { flex: 1 }, previewTitle: { color: '#183528', fontSize: 17, fontWeight: '900' }, previewSubtitle: { color: '#708074', fontSize: 11, marginTop: 4 }, previewClose: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#EDF2EC', alignItems: 'center', justifyContent: 'center' }, previewStage: { height: 390, minHeight: 220, maxHeight: '55%', marginHorizontal: 12, backgroundColor: '#17221B', borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, previewImage: { width: '100%', height: '100%' }, zoomControls: { position: 'absolute', right: 10, bottom: 10, flexDirection: 'row', gap: 8 }, zoomButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(13,59,46,0.92)', alignItems: 'center', justifyContent: 'center' }, irreversibleWarning: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: 12, marginTop: 12, padding: 12, borderRadius: 11, borderWidth: 1, borderColor: '#E5C56E', backgroundColor: '#FFF4D8' }, warningIcon: { fontSize: 16 }, irreversibleWarningText: { flex: 1, color: '#684C12', fontSize: 12, lineHeight: 18, fontWeight: '800' }, previewActions: { flexDirection: 'row', gap: 9, padding: 12 }, retakeButton: { flex: 1, minHeight: 47, borderRadius: 11, borderWidth: 1, borderColor: '#D5DED4', alignItems: 'center', justifyContent: 'center' }, retakeButtonText: { color: '#435247', fontSize: 12, fontWeight: '800' }, confirmButton: { flex: 1, minHeight: 47, borderRadius: 11, backgroundColor: '#0D3B2E', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, paddingHorizontal: 10 }, confirmButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', textAlign: 'center' }, validationBackdrop: { flex: 1, backgroundColor: 'rgba(6,20,12,0.83)', justifyContent: 'center', alignItems: 'center', padding: 18 }, validationModal: { width: '100%', maxWidth: 480, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18 }, validationTitle: { color: '#A5352B', fontSize: 17, lineHeight: 23, fontWeight: '900' }, validationMessage: { color: '#48554A', fontSize: 13, lineHeight: 20, marginVertical: 13 }, validationRetakeButton: { flex: 0, width: '100%' }, keepPreviewButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', marginTop: 4 }, keepPreviewText: { color: '#526255', fontSize: 12, fontWeight: '800' },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, backgroundColor: '#F3F6F1', borderTopWidth: 1, borderTopColor: '#E4EAE3' }, uploadButton: { minHeight: 54, borderRadius: 14, backgroundColor: '#0D3B2E', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 12 }, uploadButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', letterSpacing: 0.2 }, cameraButton: { minHeight: 38, justifyContent: 'center', alignItems: 'center', marginTop: 5 }, cameraButtonText: { color: '#0D3B2E', fontSize: 11, fontWeight: '800' }, disabledButton: { opacity: 0.5 }, footerHint: { textAlign: 'center', color: '#5D6B60', fontSize: 11, marginTop: 7 }, selectedThumbnail: { width: 42, height: 42, borderRadius: 8 },
});
