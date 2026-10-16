import { StyleSheet, Text, View } from 'react-native';

const statusStyles = {
  APPROVED: { label: 'Approved', bg: '#E7F3E8', fg: '#327442' },
  SUBMITTED: { label: 'In review', bg: '#FFF2DA', fg: '#A36B17' },
  HOLD: { label: 'On hold', bg: '#FCEAE6', fg: '#AE5542' },
  PENDING: { label: 'Pending', bg: '#EEF1ED', fg: '#667168' },
};

export function StatusBadge({ status }) {
  const config = statusStyles[status] || statusStyles.PENDING;
  return <View style={[styles.badge, { backgroundColor: config.bg }]}><Text style={[styles.label, { color: config.fg }]}>{config.label}</Text></View>;
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8 },
  label: { fontSize: 8, fontWeight: '800' },
});
