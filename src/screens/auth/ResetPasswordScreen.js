import { useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { supabase } from '../../api/supabase.js';
import { AuthPage, PasswordField, PrimaryButton, ScreenHeader } from '../../components/auth/AuthUI.js';

export function ResetPasswordScreen({ navigation, route }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);

  const save = async () => {
    setError('');
    if (password.length < 8) { setError('Use a password with at least 8 characters.'); return; }
    if (password !== confirmation) { setError('The passwords do not match.'); return; }
    if (!supabase) { setError('Password reset is unavailable. Check the app Supabase configuration.'); return; }
    setSaving(true);
    let passwordUpdated = false;
    try {
      const { data, error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      if (!data?.user) throw new Error('The recovery session expired. Request a new reset code.');
      passwordUpdated = true;
      setComplete(true);
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
      setTimeout(() => navigation.reset({ index: 0, routes: [{ name: 'Login', params: { email: route.params?.email || '' } }] }), 900);
    } catch (cause) {
      const message = passwordUpdated
        ? 'Your password was changed, but this session could not be closed. Sign out and use your new password next time.'
        : cause?.message || 'Could not update your password.';
      if (passwordUpdated) {
        setTimeout(() => navigation.reset({ index: 0, routes: [{ name: 'Login', params: { email: route.params?.email || '' } }] }), 900);
        Alert.alert('Password changed', message);
      } else {
        setError(message);
        Alert.alert('Password not changed', message);
      }
    } finally {
      setSaving(false);
    }
  };

  return <AuthPage>
    <ScreenHeader title="Choose a new password" subtitle="Your email is verified. Set a new password to finish account recovery." eyebrow="ACCOUNT RECOVERY" back navigation={navigation} />
    <PasswordField label="New password" value={password} onChangeText={(value) => { setPassword(value); setError(''); }} placeholder="At least 8 characters" autoComplete="new-password" />
    <PasswordField label="Confirm new password" value={confirmation} onChangeText={(value) => { setConfirmation(value); setError(''); }} placeholder="Enter the new password again" autoComplete="new-password" />
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {complete ? <Text accessibilityRole="alert" style={styles.success}>Password changed. Returning to sign in…</Text> : null}
    <PrimaryButton title="Save new password" onPress={save} disabled={complete} loading={saving} />
  </AuthPage>;
}

const styles = StyleSheet.create({
  error: { color: '#A5352B', fontSize: 13, lineHeight: 19, marginTop: 8 },
  success: { color: '#276738', backgroundColor: '#EAF4E8', borderRadius: 10, padding: 12, fontSize: 14, lineHeight: 20, marginTop: 8, textAlign: 'center', fontWeight: '700' },
});
