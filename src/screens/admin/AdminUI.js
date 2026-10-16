import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { ArrowLeft, ArrowUp, ChevronRight, X } from 'lucide-react-native';

export const ADMIN_COLORS = { green: '#1F4B2C', dark: '#173A22', lime: '#C3E956', canvas: '#F5F7F2', ink: '#18221A', muted: '#718075', line: '#E3E9E1', white: '#FFFFFF', red: '#B5473B', amber: '#A66B10' };
export const DEPARTMENT_FALLBACKS = [
  { code: 'CICTE', name: 'College of Information, Computing and Technology Education' },
  { code: 'CONAHS', name: 'College of Nursing and Allied Health Sciences' },
  { code: 'COAB', name: 'College of Accountancy and Business' },
  { code: 'COED', name: 'College of Education' },
  { code: 'STAHM', name: 'School of Tourism and Hospitality Management' },
  { code: 'SOLG', name: 'School of Law and Governance' },
  { code: 'HS', name: 'High School Department' },
];
export const PROGRAM_FALLBACKS = [
  { code: 'BSIT', name: 'Bachelor of Science in Information Technology', departmentCode: 'CICTE', academic_level: 'UNDERGRADUATE' },
  { code: 'BSCS', name: 'Bachelor of Science in Computer Science', departmentCode: 'CICTE', academic_level: 'UNDERGRADUATE' },
  { code: 'BSN', name: 'Bachelor of Science in Nursing', departmentCode: 'CONAHS', academic_level: 'UNDERGRADUATE' },
  { code: 'BSA', name: 'Bachelor of Science in Accountancy', departmentCode: 'COAB', academic_level: 'UNDERGRADUATE' },
  { code: 'BSED', name: 'Bachelor of Secondary Education', departmentCode: 'COED', academic_level: 'UNDERGRADUATE' },
  { code: 'BSHM', name: 'Bachelor of Science in Hospitality Management', departmentCode: 'STAHM', academic_level: 'UNDERGRADUATE' },
  { code: 'JD', name: 'Juris Doctor', departmentCode: 'SOLG', academic_level: 'POSTGRADUATE' },
  { code: 'STEM', name: 'Science, Technology, Engineering and Mathematics', departmentCode: 'HS', academic_level: 'HIGH_SCHOOL' },
];

export function AdminPage({ title, subtitle, navigation, children, rightAction, onRefresh, refreshing: refreshingProp, embedded = false }) {
  const { width } = useWindowDimensions();
  const scrollRef = useRef(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [refreshingInternal, setRefreshingInternal] = useState(false);
  const refreshing = refreshingProp ?? refreshingInternal;
  const refresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshingInternal(true);
    try { await onRefresh(); }
    catch (error) { Alert.alert('Refresh failed', error?.message || 'Could not refresh admin data. Please try again.'); }
    finally { setRefreshingInternal(false); }
  };
  return <SafeAreaView style={[styles.safe, embedded && styles.embeddedSafe]}>
    <View style={styles.header}>
      <Pressable onPress={() => navigation?.goBack()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back"><ArrowLeft size={20} color={ADMIN_COLORS.green} /></Pressable>
      <View style={styles.headerCopy}><Text numberOfLines={1} style={styles.title}>{title}</Text>{subtitle ? <Text numberOfLines={1} style={styles.subtitle}>{subtitle}</Text> : null}</View>
      {rightAction || <View style={styles.headerSpacer} />}
    </View>
    {embedded ? <View style={[styles.content, styles.embeddedContent, width >= 1024 && styles.wideContent]}>{children}</View> : <ScrollView
      ref={scrollRef}
      keyboardShouldPersistTaps="always"
      nestedScrollEnabled
      showsVerticalScrollIndicator
      scrollEventThrottle={100}
      onScroll={(event) => setShowScrollTop(event.nativeEvent.contentOffset.y > 200)}
      refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={refresh} tintColor={ADMIN_COLORS.green} colors={[ADMIN_COLORS.green]} /> : undefined}
      contentContainerStyle={[styles.content, width >= 1024 && styles.wideContent]}
    >{children}</ScrollView>}
    {!embedded && showScrollTop ? <Pressable onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })} accessibilityRole="button" accessibilityLabel="Scroll to top" style={styles.scrollTopFab}><ArrowUp size={21} color="#FFFFFF" /></Pressable> : null}
  </SafeAreaView>;
}

export function SectionTitle({ children, action, onAction }) {
  return <View style={styles.sectionHead}><Text style={styles.sectionTitle}>{children}</Text>{action ? <Pressable onPress={onAction}><Text style={styles.link}>{action}</Text></Pressable> : null}</View>;
}

export function Panel({ children, style }) { return <View style={[styles.panel, style]}>{children}</View>; }

export function MetricCard({ label, value, icon: Icon, tint = '#EAF0E6' }) {
  const { width } = useWindowDimensions();
  const cardWidth = width < 600 ? '100%' : width < 1024 ? '47%' : '23%';
  return <View style={[styles.metricCard, { width: cardWidth, marginHorizontal: width < 600 ? 0 : 4 }]}><View style={[styles.metricIcon, { backgroundColor: tint }]}>{Icon ? <Icon size={18} color={ADMIN_COLORS.green} /> : null}</View><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

export function AdminButton({ title, onPress, secondary = false, disabled = false, loading = false, icon: Icon }) {
  return <Pressable onPress={onPress} disabled={disabled || loading} style={[styles.button, secondary && styles.buttonSecondary, (disabled || loading) && styles.disabled]}>
    {loading ? <ActivityIndicator color={secondary ? ADMIN_COLORS.green : '#FFFFFF'} /> : <View style={styles.buttonContent}>{Icon ? <Icon size={17} color={secondary ? ADMIN_COLORS.green : '#FFFFFF'} /> : null}<Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{title}</Text></View>}
  </Pressable>;
}

export function AdminField({ label, value, onChangeText, placeholder, keyboardType, multiline }) {
  return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#929B92" keyboardType={keyboardType || 'default'} multiline={multiline} autoCapitalize="sentences" style={[styles.input, multiline && styles.multiline]} /></View>;
}

export function AdminSelect({ label, value, options, onChange, placeholder = 'Choose an option' }) {
  const [open, setOpen] = useState(false);
  return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><Pressable onPress={() => setOpen(true)} style={styles.select}><Text style={[styles.selectText, !value && styles.placeholder]}>{value || placeholder}</Text><ChevronRight size={17} color={ADMIN_COLORS.muted} /></Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}><View style={styles.modalBackdrop}><Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} /><View style={styles.modalCard}><View style={styles.modalHead}><Text style={styles.modalTitle}>{label}</Text><Pressable onPress={() => setOpen(false)}><X size={20} color={ADMIN_COLORS.muted} /></Pressable></View><ScrollView keyboardShouldPersistTaps="always">{options.map((option) => <Pressable key={option} onPress={() => { onChange(option); setOpen(false); }} style={styles.option}><Text style={styles.optionText}>{option}</Text><ChevronRight size={16} color="#A7B0A8" /></Pressable>)}</ScrollView></View></View></Modal>
  </View>;
}

export function StatusPill({ children, tone = 'green' }) {
  const toneStyle = tone === 'amber' ? styles.pillAmber : tone === 'red' ? styles.pillRed : styles.pillGreen;
  return <View style={[styles.pill, toneStyle]}><Text style={[styles.pillText, tone === 'amber' && styles.pillTextAmber, tone === 'red' && styles.pillTextRed]}>{children}</Text></View>;
}

export function DataNote({ children, error }) {
  return <View style={[styles.note, error && styles.noteError]}><Text style={[styles.noteText, error && styles.noteErrorText]}>{children}</Text></View>;
}

export function AdminConfirmModal({ visible, title, message, confirmLabel = 'Confirm', destructive = false, busy = false, onCancel, onConfirm }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
    <View style={styles.modalBackdrop}><View style={styles.confirmCard}>
      <Text style={styles.modalTitle}>{title}</Text><Text style={styles.confirmMessage}>{message}</Text>
      <View style={styles.confirmActions}><Pressable onPress={onCancel} disabled={busy} style={styles.confirmCancel}><Text style={styles.confirmCancelText}>Cancel</Text></Pressable><Pressable onPress={onConfirm} disabled={busy} style={[styles.confirmButton, destructive && styles.confirmDestructive, busy && styles.disabled]}>{busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.confirmButtonText}>{confirmLabel}</Text>}</Pressable></View>
    </View></View>
  </Modal>;
}

export function AdminRow({ title, detail, right, onPress }) {
  const Content = <View style={styles.row}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text>{detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}</View>{right}</View>;
  return onPress ? <Pressable onPress={onPress} style={styles.rowPress}>{Content}</Pressable> : Content;
}

const styles = StyleSheet.create({
  safe: { flex: 1, width: '100%', minWidth: 0, backgroundColor: ADMIN_COLORS.canvas }, embeddedSafe: { flexGrow: 1, flexShrink: 0 }, header: { minHeight: 70, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: ADMIN_COLORS.line, paddingHorizontal: 17, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }, back: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#EDF2E9', alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1, minWidth: 0 }, title: { color: ADMIN_COLORS.ink, fontSize: 20, fontWeight: '900', flexShrink: 1 }, subtitle: { color: ADMIN_COLORS.muted, fontSize: 12, marginTop: 3, flexShrink: 1 }, headerSpacer: { width: 8 }, content: { width: '100%', maxWidth: 900, alignSelf: 'center', padding: 17, paddingBottom: 85, flexGrow: 1 }, embeddedContent: { maxWidth: '100%', alignSelf: 'stretch', minWidth: 0 }, wideContent: { maxWidth: 1320, padding: 25, paddingBottom: 85 }, scrollTopFab: { position: 'absolute', right: 25, bottom: 25, width: 54, height: 54, borderRadius: 27, backgroundColor: '#1b4332', alignItems: 'center', justifyContent: 'center', elevation: 7, shadowColor: '#000000', shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, sectionHead: { minHeight: 35, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 9 }, sectionTitle: { color: ADMIN_COLORS.ink, fontSize: 16, fontWeight: '900', flexShrink: 1 }, link: { color: ADMIN_COLORS.green, fontSize: 13, fontWeight: '800' }, panel: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 15, borderWidth: 1, borderColor: ADMIN_COLORS.line, marginBottom: 11 }, metricCard: { backgroundColor: '#FFFFFF', borderRadius: 15, borderWidth: 1, borderColor: ADMIN_COLORS.line, padding: 13, margin: 4 }, metricIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, metricValue: { color: ADMIN_COLORS.ink, fontSize: 24, fontWeight: '900', marginTop: 10 }, metricLabel: { color: ADMIN_COLORS.muted, fontSize: 12, lineHeight: 17, marginTop: 3, fontWeight: '700' }, button: { minHeight: 49, paddingHorizontal: 14, borderRadius: 12, backgroundColor: ADMIN_COLORS.green, alignItems: 'center', justifyContent: 'center', marginTop: 8 }, buttonSecondary: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: ADMIN_COLORS.green }, disabled: { opacity: 0.5 }, buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, buttonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 }, buttonTextSecondary: { color: ADMIN_COLORS.green }, fieldWrap: { marginBottom: 12 }, fieldLabel: { color: '#455247', fontSize: 13, fontWeight: '800', marginBottom: 6 }, input: { minHeight: 47, borderWidth: 1, borderColor: '#DCE5DB', borderRadius: 11, paddingHorizontal: 12, color: ADMIN_COLORS.ink, backgroundColor: '#FFFFFF', fontSize: 15 }, multiline: { minHeight: 88, paddingTop: 11, textAlignVertical: 'top' }, select: { minHeight: 47, borderWidth: 1, borderColor: '#DCE5DB', borderRadius: 11, backgroundColor: '#FFFFFF', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, selectText: { color: ADMIN_COLORS.ink, fontSize: 14, flex: 1 }, placeholder: { color: '#929B92' }, pill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' }, pillGreen: { backgroundColor: '#E8F3E9' }, pillAmber: { backgroundColor: '#FFF1D5' }, pillRed: { backgroundColor: '#FCE9E6' }, pillText: { color: ADMIN_COLORS.green, fontSize: 10, fontWeight: '900' }, pillTextAmber: { color: ADMIN_COLORS.amber }, pillTextRed: { color: ADMIN_COLORS.red }, note: { borderRadius: 11, backgroundColor: '#EDF3E9', padding: 11, marginBottom: 12 }, noteText: { color: '#425546', fontSize: 12, lineHeight: 18 }, noteError: { backgroundColor: '#FCE9E6' }, noteErrorText: { color: ADMIN_COLORS.red }, rowPress: { borderBottomWidth: 1, borderBottomColor: '#EEF1EC' }, row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 9 }, rowCopy: { flex: 1 }, rowTitle: { color: ADMIN_COLORS.ink, fontSize: 14, fontWeight: '800' }, rowDetail: { color: ADMIN_COLORS.muted, fontSize: 12, lineHeight: 17, marginTop: 3 }, modalBackdrop: { flex: 1, backgroundColor: 'rgba(14,32,18,0.45)', justifyContent: 'center', alignItems: 'center', padding: 19 }, modalCard: { width: '100%', maxWidth: 550, maxHeight: '82%', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, elevation: 10 }, confirmCard: { width: '100%', maxWidth: 500, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 19 }, confirmMessage: { color: ADMIN_COLORS.muted, fontSize: 13, lineHeight: 19, marginTop: 9 }, confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 19 }, confirmCancel: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 10, backgroundColor: '#EEF1EC' }, confirmCancelText: { color: ADMIN_COLORS.muted, fontWeight: '800' }, confirmButton: { minHeight: 42, minWidth: 105, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 13, borderRadius: 10, backgroundColor: ADMIN_COLORS.green }, confirmDestructive: { backgroundColor: ADMIN_COLORS.red }, confirmButtonText: { color: '#FFFFFF', fontWeight: '900' }, modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 9 }, modalTitle: { color: ADMIN_COLORS.ink, fontSize: 17, fontWeight: '900' }, option: { minHeight: 46, borderTopWidth: 1, borderTopColor: '#EEF1EC', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, optionText: { color: ADMIN_COLORS.ink, fontSize: 14 },
});

export const adminStyles = styles;
