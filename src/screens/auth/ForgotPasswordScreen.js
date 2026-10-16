import { useState } from 'react';
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react-native';
import { Text, StyleSheet } from 'react-native';
import { AuthPage, FormField, OutlineButton, PrimaryButton, ScreenHeader } from '../../components/auth/AuthUI.js';
import { supabase } from '../../api/supabase.js';

const recoveryEmailPattern = /^[^\s@]+@(wlcormoc\.edu\.ph|gmail\.com)$/i;

export function ForgotPasswordScreen({ navigation, route, onSendResetCode }) {
  const [email, setEmail] = useState(route.params?.email || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError('');
    if (!recoveryEmailPattern.test(email.trim())) {
      setError('Enter the registered @wlcormoc.edu.ph address or staff Gmail account.');
      return;
    }
    setLoading(true);
    try {
      if (onSendResetCode) await onSendResetCode({ email: email.trim() });
      else {
        if (!supabase) throw new Error('Password reset is unavailable. Check the app Supabase configuration.');
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
        if (resetError) throw resetError;
      }
      navigation.navigate('Verification', { email: email.trim(), purpose: 'password-reset' });
    } catch (cause) {
      setError(cause?.message || 'We could not send a reset code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return <AuthPage>
    <ScreenHeader title="Forgot password?" subtitle="We’ll send a one-time verification code to your registered school email." eyebrow="ACCOUNT RECOVERY" back navigation={navigation} />
    <FormField label="Registered email" icon={Mail} value={email} onChangeText={setEmail} placeholder="name@wlcormoc.edu.ph" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
    <Text style={styles.helper}>Enter the email linked to your account. Use the 6-digit code to verify that you own the address before setting a new password.</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <PrimaryButton title="Send Reset Code" onPress={submit} loading={loading} icon={ShieldCheck} />
    <OutlineButton title="Back to Login" onPress={() => navigation.navigate('Login')} icon={ArrowLeft} />
    <Text style={styles.support}>If you no longer have access to your registered email, contact your campus administrator.</Text>
  </AuthPage>;
}

const styles = StyleSheet.create({
  helper: { color: '#59665B', fontSize: 14, lineHeight: 21, marginTop: -2, marginBottom: 15 },
  error: { color: '#B5473B', fontSize: 13, lineHeight: 19, marginBottom: 8 },
  support: { color: '#66746A', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 25 },
});
