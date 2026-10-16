import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { LogOut, X } from 'lucide-react-native';

export function ConfirmSignOutModal({
  visible,
  title = 'Sign out?',
  message = 'You will need to sign in again to continue.',
  busy = false,
  onCancel,
  onConfirm,
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => { if (!busy) onCancel?.(); }}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close sign out confirmation"
          disabled={busy}
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.dialog} accessibilityRole="alert" accessibilityLabel={title}>
          <View style={styles.header}>
            <View style={styles.icon}><LogOut size={20} color="#B7443A" /></View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel sign out"
              disabled={busy}
              onPress={onCancel}
              hitSlop={8}
              style={styles.close}
            >
              <X size={19} color="#68756A" />
            </Pressable>
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onCancel}
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed, busy && styles.disabled]}
            >
              <Text style={styles.cancelText}>Stay signed in</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={onConfirm}
              style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed, busy && styles.disabled]}
            >
              {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <LogOut size={16} color="#FFFFFF" />}
              <Text style={styles.confirmText}>{busy ? 'Signing out…' : 'Sign out'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10, 25, 16, 0.58)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 420, borderRadius: 20, backgroundColor: '#FFFFFF', padding: 22, shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 },
  icon: { width: 43, height: 43, borderRadius: 14, backgroundColor: '#FCEBE8', alignItems: 'center', justifyContent: 'center' },
  close: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#193A2A', fontSize: 19, fontWeight: '800' },
  message: { color: '#68756A', fontSize: 14, lineHeight: 21, marginTop: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 24 },
  cancelButton: { minHeight: 44, paddingHorizontal: 14, borderRadius: 11, borderWidth: 1, borderColor: '#DDE5DC', alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: '#425447', fontSize: 13, fontWeight: '700' },
  confirmButton: { minHeight: 44, minWidth: 118, paddingHorizontal: 14, borderRadius: 11, backgroundColor: '#B7443A', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  confirmText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.55 },
});
