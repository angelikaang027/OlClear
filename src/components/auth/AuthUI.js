import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Check, ChevronDown, Eye, EyeOff, LockKeyhole } from 'lucide-react-native';

export const colors = {
  forest: '#1F4B2C', forestDark: '#173A22', lime: '#C3E956', canvas: '#F5F7F2',
  ink: '#18221A', muted: '#718075', line: '#E3E9E1', white: '#FFFFFF', red: '#B5473B',
};

export function AuthPage({ children, contentContainerStyle, footer, scroll = true }) {
  const content = scroll
    ? <ScrollView keyboardShouldPersistTaps="always" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, contentContainerStyle]}>{children}</ScrollView>
    : <View style={[styles.scrollContent, styles.flexContent, contentContainerStyle]}>{children}</View>;
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.flex}>
        {content}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export function ScreenHeader({ title, subtitle, navigation, eyebrow = 'OLCLEAR · WESTERN LEYTE COLLEGE', back = false }) {
  return <View style={styles.header}>
    {back && <Pressable onPress={() => navigation.goBack()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back"><ArrowLeft size={19} color={colors.forest} strokeWidth={2.2} /></Pressable>}
    <Text style={styles.eyebrow}>{eyebrow}</Text>
    <Text style={styles.title}>{title}</Text>
    {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
  </View>;
}

export function FormField({ label, icon: Icon, value, onChangeText, placeholder, keyboardType = 'default', autoCapitalize = 'none', autoComplete, textContentType, secureTextEntry = false, error, trailing, editable = true, maxLength }) {
  return <View style={styles.fieldBlock}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <View style={[styles.inputShell, error && styles.inputError, !editable && styles.inputDisabled]}>
      {Icon ? <Icon size={17} color={colors.muted} strokeWidth={1.8} /> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#99A39B"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        textContentType={textContentType}
        secureTextEntry={secureTextEntry}
        editable={editable}
        maxLength={maxLength}
        style={styles.input}
      />
      {trailing}
    </View>
    {error ? <Text style={styles.errorText}>{error}</Text> : null}
  </View>;
}

export function PasswordField({ label = 'Password', value, onChangeText, placeholder = 'Enter your password', error, autoComplete = 'password' }) {
  const [secure, setSecure] = useState(true);
  return <FormField
    label={label}
    icon={LockKeyhole}
    value={value}
    onChangeText={onChangeText}
    placeholder={placeholder}
    autoComplete={autoComplete}
    textContentType="password"
    error={error}
    trailing={<Pressable onPress={() => setSecure((current) => !current)} hitSlop={10} accessibilityRole="button" accessibilityLabel={secure ? 'Show password' : 'Hide password'}>{secure ? <Eye size={18} color={colors.muted} /> : <EyeOff size={18} color={colors.forest} />}</Pressable>}
    {...{ secureTextEntry: secure }}
  />;
}

export function PickerField({ label, selectedValue, onValueChange, options, placeholder = 'Select an option', enabled = true }) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find((option) => option.value === selectedValue);
  return <View style={styles.fieldBlock}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <Pressable
      onPress={() => enabled && setOpen(true)}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled, expanded: open }}
      style={[styles.pickerShell, !enabled && styles.inputDisabled]}
    >
      <Text style={[styles.pickerValue, !selectedOption && styles.pickerPlaceholder]} numberOfLines={1}>
        {selectedOption ? (selectedOption.description ? `${selectedOption.label} · ${selectedOption.description}` : selectedOption.label) : placeholder}
      </Text>
      <ChevronDown size={17} color={enabled ? colors.forest : colors.muted} />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
      <View style={styles.dropdownOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close options" />
        <View style={styles.dropdownCard} accessibilityLabel={`${label} options`}>
          <Text style={styles.dropdownTitle}>{label}</Text>
          {options.map((option) => {
            const selected = option.value === selectedValue;
            return <Pressable
              key={option.value}
              onPress={() => { onValueChange(option.value); setOpen(false); }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={({ pressed }) => [styles.dropdownOption, selected && styles.dropdownOptionSelected, pressed && styles.dropdownOptionPressed]}
            >
              <View style={styles.dropdownOptionCopy}>
                <Text style={[styles.dropdownOptionText, selected && styles.dropdownOptionTextSelected]}>{option.label}</Text>
                {option.description ? <Text style={styles.dropdownOptionDescription} numberOfLines={1}>{option.description}</Text> : null}
              </View>
              {selected ? <Check size={17} color={colors.forest} strokeWidth={2.5} /> : null}
            </Pressable>;
          })}
        </View>
      </View>
    </Modal>
  </View>;
}

export function CheckRow({ checked, onPress, children, error }) {
  return <View>
    <View style={styles.checkRow}>
      <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked }} style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? <Text style={styles.checkmark}>✓</Text> : null}
      </Pressable>
      <View style={styles.checkLabel}>{children}</View>
    </View>
    {error ? <Text style={styles.errorText}>{error}</Text> : null}
  </View>;
}

export function ToggleRow({ label, description, value, onValueChange }) {
  return <View style={styles.toggleRow}>
    <View style={styles.toggleCopy}><Text style={styles.toggleLabel}>{label}</Text>{description ? <Text style={styles.toggleDescription}>{description}</Text> : null}</View>
    <Switch value={value} onValueChange={onValueChange} trackColor={{ false: '#D9E0D7', true: '#9FB943' }} thumbColor={value ? colors.forest : '#F7F8F6'} accessibilityLabel={label} />
  </View>;
}

export function PrimaryButton({ title, onPress, disabled = false, loading = false, icon: Icon }) {
  return <Pressable onPress={onPress} disabled={disabled || loading} accessibilityRole="button" style={({ pressed }) => [styles.primaryButton, (disabled || loading) && styles.buttonDisabled, pressed && !disabled && styles.buttonPressed]}>
    {loading ? <ActivityIndicator size="small" color={colors.white} /> : <View style={styles.buttonContent}>{Icon ? <Icon size={17} color={colors.white} /> : null}<Text style={styles.primaryText}>{title}</Text></View>}
  </Pressable>;
}

export function OutlineButton({ title, onPress, icon: Icon }) {
  return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.outlineButton, pressed && styles.outlinePressed]}>
    {Icon ? <Icon size={17} color={colors.forest} /> : null}<Text style={styles.outlineText}>{title}</Text>
  </Pressable>;
}

export function InlineLink({ children, onPress, style }) {
  return <Text accessibilityRole="link" onPress={onPress} style={[styles.inlineLink, style]}>{children}</Text>;
}

export function Notice({ children }) {
  return <View style={styles.notice}><Text style={styles.noticeMark}>i</Text><Text style={styles.noticeText}>{children}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas }, flex: { flex: 1 }, scrollContent: { flexGrow: 1, width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 24, paddingBottom: 28 }, flexContent: { justifyContent: 'center' }, footer: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 10, paddingBottom: 14, backgroundColor: colors.canvas },
  header: { marginBottom: 19 }, backButton: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#EAF0E6', alignItems: 'center', justifyContent: 'center', marginBottom: 15 }, eyebrow: { color: '#718075', fontSize: 12, fontWeight: '800', letterSpacing: 1 }, title: { color: colors.ink, fontSize: 28, lineHeight: 35, fontWeight: '800', letterSpacing: -0.8, marginTop: 6 }, subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 7 },
  fieldBlock: { marginBottom: 15 }, fieldLabel: { color: '#3D4A40', fontSize: 14, fontWeight: '700', marginBottom: 8 }, inputShell: { minHeight: 54, borderWidth: 1, borderColor: '#DEE5DC', backgroundColor: colors.white, borderRadius: 13, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 11 }, inputError: { borderColor: colors.red }, inputDisabled: { backgroundColor: '#F0F2EF', opacity: 0.75 }, input: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 16, paddingVertical: 12 }, errorText: { color: colors.red, fontSize: 13, lineHeight: 18, marginTop: 5 },
  pickerShell: { minHeight: 56, borderWidth: 1, borderColor: '#DEE5DC', backgroundColor: colors.white, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15 }, pickerValue: { color: colors.ink, fontSize: 15, flex: 1, marginRight: 12 }, pickerPlaceholder: { color: '#89948B' },
  dropdownOverlay: { flex: 1, backgroundColor: 'rgba(10,25,14,0.48)', justifyContent: 'center', alignItems: 'center', padding: 22 }, dropdownCard: { width: '100%', maxWidth: 420, backgroundColor: colors.white, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 13, shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 }, dropdownTitle: { color: colors.ink, fontSize: 17, fontWeight: '800', paddingHorizontal: 9, paddingTop: 5, paddingBottom: 11 }, dropdownOption: { minHeight: 46, borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, dropdownOptionSelected: { backgroundColor: '#EAF0E6' }, dropdownOptionPressed: { backgroundColor: '#F1F5EE' }, dropdownOptionCopy: { flex: 1, justifyContent: 'center', paddingVertical: 5 }, dropdownOptionText: { color: '#526155', fontSize: 15 }, dropdownOptionTextSelected: { color: colors.forest, fontWeight: '800' }, dropdownOptionDescription: { color: colors.muted, fontSize: 12, lineHeight: 16, marginTop: 2 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 7 }, checkbox: { width: 19, height: 19, borderWidth: 1.5, borderColor: '#A5B1A5', borderRadius: 5, alignItems: 'center', justifyContent: 'center', marginTop: 1 }, checkboxChecked: { borderColor: colors.forest, backgroundColor: colors.forest }, checkmark: { color: colors.white, fontSize: 13, fontWeight: '900', lineHeight: 15 }, checkLabel: { flex: 1 },
  toggleRow: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 15 }, toggleCopy: { flex: 1, paddingRight: 8 }, toggleLabel: { color: colors.ink, fontSize: 14, fontWeight: '700' }, toggleDescription: { color: colors.muted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  primaryButton: { minHeight: 56, borderRadius: 14, backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 9 }, buttonDisabled: { opacity: 0.45 }, buttonPressed: { backgroundColor: colors.forestDark }, buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 }, primaryText: { color: colors.white, fontSize: 16, fontWeight: '800' }, outlineButton: { minHeight: 56, borderRadius: 14, borderWidth: 1.4, borderColor: colors.forest, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 11 }, outlinePressed: { backgroundColor: '#EAF0E6' }, outlineText: { color: colors.forest, fontSize: 16, fontWeight: '800' },
  inlineLink: { color: colors.forest, fontSize: 14, fontWeight: '800' }, notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 12, padding: 13, marginTop: 15, backgroundColor: '#EAF0E6' }, noticeMark: { color: colors.forest, fontWeight: '900', fontSize: 14 }, noticeText: { flex: 1, color: '#5E6E61', fontSize: 13, lineHeight: 19 },
});
