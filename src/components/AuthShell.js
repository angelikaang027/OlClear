import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

export function AuthShell({ eyebrow = 'WESTERN LEYTE COLLEGE', title, subtitle, children }) {
  return <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.card}>
      <View style={styles.mark}><Text style={styles.markText}>O</Text></View>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      {children}
    </View>
  </ScrollView>;
}

export function AuthField({ label, placeholder, value, onChangeText, secureTextEntry, keyboardType, autoCapitalize = 'none' }) {
  return <View style={styles.fieldWrap}>
    <Text style={styles.label}>{label}</Text>
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#99A39B" secureTextEntry={secureTextEntry} keyboardType={keyboardType} autoCapitalize={autoCapitalize} style={styles.input} />
  </View>;
}

export function AuthButton({ title, onPress }) {
  return <Pressable onPress={onPress} style={styles.button} accessibilityRole="button"><Text style={styles.buttonText}>{title}</Text></Pressable>;
}

export function AuthLink({ title, onPress }) {
  return <Pressable onPress={onPress} style={styles.linkButton} accessibilityRole="button"><Text style={styles.linkText}>{title}</Text></Pressable>;
}

export function DemoNote({ children }) {
  return <View style={styles.note}><Text style={styles.noteMark}>i</Text><Text style={styles.noteText}>{children}</Text></View>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 }, content: { flexGrow: 1, width: '100%', maxWidth: 520, alignSelf: 'center', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: '#FFFFFF', borderColor: '#E6EBE3', borderWidth: 1, borderRadius: 20, padding: 20 },
  mark: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#C3E956', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }, markText: { color: '#1F4B2C', fontSize: 22, fontWeight: '900' },
  eyebrow: { color: '#718075', fontSize: 8, fontWeight: '800', letterSpacing: 1.1 }, title: { color: '#1B261E', fontSize: 22, fontWeight: '800', letterSpacing: -0.6, marginTop: 5 }, subtitle: { color: '#748077', fontSize: 11, lineHeight: 17, marginTop: 6, marginBottom: 14 },
  fieldWrap: { marginTop: 10 }, label: { color: '#4E5B51', fontSize: 9, fontWeight: '800', marginBottom: 6 }, input: { minHeight: 43, borderRadius: 10, borderWidth: 1, borderColor: '#E0E6DE', backgroundColor: '#FBFCFA', paddingHorizontal: 11, color: '#263129', fontSize: 11 },
  button: { minHeight: 43, borderRadius: 11, backgroundColor: '#1F4B2C', alignItems: 'center', justifyContent: 'center', marginTop: 14 }, buttonText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' }, linkButton: { minHeight: 34, justifyContent: 'center', alignItems: 'center', marginTop: 4 }, linkText: { color: '#1F4B2C', fontSize: 10, fontWeight: '800' },
  note: { flexDirection: 'row', gap: 8, backgroundColor: '#EDF2E9', borderRadius: 10, padding: 10, marginTop: 13 }, noteMark: { color: '#1F4B2C', fontSize: 11, fontWeight: '800' }, noteText: { flex: 1, color: '#68766B', fontSize: 9, lineHeight: 13 },
});
