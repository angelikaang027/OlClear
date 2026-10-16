import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { CircleCheck, Clock3, Lock, OctagonAlert } from 'lucide-react-native';
import { ACCOUNTING_REQUIRED_MESSAGE } from '../utils/clearanceRules.js';

const GREEN = '#0D3B2E';
const colorForStatus = (status) => status === 'APPROVED' ? '#27824D' : status === 'HOLD' || status === 'REJECTED' ? '#B7443A' : '#A87817';
const labelForStatus = (status) => String(status || 'PENDING').replaceAll('_', ' ');

export function OfficeCard({ office, status = 'PENDING', isLocked = false, onPress, compact = false, index, remark }) {
  const OfficeIcon = office.icon;
  const StatusIcon = status === 'APPROVED' ? CircleCheck : status === 'HOLD' || status === 'REJECTED' ? OctagonAlert : Clock3;
  const color = colorForStatus(status);

  const handlePress = () => {
    if (isLocked) {
      Alert.alert('Accounting approval required', ACCOUNTING_REQUIRED_MESSAGE);
      return;
    }
    onPress?.();
  };

  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${office.name}, ${isLocked ? 'locked' : labelForStatus(status)}`}
    accessibilityHint={isLocked ? 'Requires Accounting approval first.' : 'Open office clearance details.'}
    disabled={isLocked}
    onPress={handlePress}
    style={({ pressed }) => [
      compact ? styles.compactCard : styles.listCard,
      isLocked && styles.lockedCard,
      pressed && styles.pressed,
    ]}
  >
    {compact ? <>
      <View style={styles.compactIconWrap}>
        <OfficeIcon size={19} color={GREEN} />
        {isLocked ? <View style={styles.lockOverlay}><Lock size={12} color="#FFFFFF" /></View> : null}
      </View>
      <Text style={styles.compactOfficeName} numberOfLines={2}>{office.label || office.name}</Text>
      {isLocked
        ? <Text style={styles.lockNoteCompact}>Requires Accounting approval first</Text>
        : <View style={[styles.statusPill, { backgroundColor: `${color}18` }]}>
          <View style={[styles.statusDot, { backgroundColor: color }]} />
          <Text style={[styles.compactStatus, { color }]} numberOfLines={1}>{labelForStatus(status)}</Text>
        </View>}
    </> : <>
      {Number.isInteger(index) ? <View style={[styles.number, { backgroundColor: `${color}14` }]}><Text style={[styles.numberText, { color }]}>{String(index + 1).padStart(2, '0')}</Text></View> : null}
      <View style={styles.listOfficeIcon}>
        <OfficeIcon size={18} color={GREEN} />
        {isLocked ? <View style={styles.listLock}><Lock size={11} color="#FFFFFF" /></View> : null}
      </View>
      <View style={styles.listCopy}>
        <Text style={styles.listOfficeName}>{office.name}</Text>
        {isLocked
          ? <Text style={styles.lockNote}>Requires Accounting approval first</Text>
          : <Text style={[styles.listStatus, { color }]}>{labelForStatus(status)}</Text>}
        {!isLocked && remark ? <Text style={styles.remark} numberOfLines={1}>{remark}</Text> : null}
      </View>
      {!isLocked ? <StatusIcon size={19} color={color} /> : null}
    </>}
  </Pressable>;
}

const styles = StyleSheet.create({
  compactCard: { width: 118, minHeight: 139, padding: 10, borderRadius: 14, backgroundColor: '#FFFFFF', justifyContent: 'space-between', shadowColor: '#193522', shadowOpacity: 0.06, shadowRadius: 6, elevation: 2 },
  compactIconWrap: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#EAF2E4', alignItems: 'center', justifyContent: 'center' },
  lockOverlay: { position: 'absolute', right: -5, top: -5, width: 19, height: 19, borderRadius: 10, backgroundColor: '#68766B', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF' },
  compactOfficeName: { color: '#28372C', fontSize: 11, lineHeight: 14, fontWeight: '800', minHeight: 28, marginTop: 8 },
  statusPill: { alignSelf: 'flex-start', maxWidth: '100%', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 7 },
  statusDot: { width: 6, height: 6, borderRadius: 3 }, compactStatus: { fontSize: 8, fontWeight: '900' },
  lockNoteCompact: { color: '#68766B', fontSize: 9, lineHeight: 12, fontWeight: '700', marginTop: 6 },
  listCard: { minHeight: 76, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 9 },
  number: { width: 37, height: 37, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, numberText: { fontSize: 11, fontWeight: '900' },
  listOfficeIcon: { width: 35, height: 35, borderRadius: 11, backgroundColor: '#EAF2E4', alignItems: 'center', justifyContent: 'center' },
  listLock: { position: 'absolute', right: -4, top: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: '#68766B', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF' },
  listCopy: { flex: 1 }, listOfficeName: { color: '#26372C', fontSize: 13, fontWeight: '800' }, listStatus: { fontSize: 10, fontWeight: '900', marginTop: 4 },
  lockNote: { color: '#68766B', fontSize: 10, lineHeight: 14, fontWeight: '700', marginTop: 4 }, remark: { color: '#777F79', fontSize: 10, marginTop: 3 },
  lockedCard: { opacity: 0.5 }, pressed: { transform: [{ scale: 0.99 }] },
});
