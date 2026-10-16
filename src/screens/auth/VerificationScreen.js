import { useEffect, useRef, useState } from 'react';
import { MailCheck, ShieldCheck } from 'lucide-react-native';
import { Alert, Pressable, Text, TextInput, View, StyleSheet } from 'react-native';
import { AuthPage, PrimaryButton, ScreenHeader, colors } from '../../components/auth/AuthUI.js';
import { supabase } from '../../api/supabase.js';
import { verifyEmailOtp } from '../../api/authApi.js';

const CODE_LENGTH = 6;
const INITIAL_COOLDOWN = 180;

function formatCountdown(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function VerificationScreen({ navigation, route, onResendCode }) {
  const email = route.params?.email || 'your school email';
  const purpose = route.params?.purpose || 'registration';
  const [digits, setDigits] = useState(Array(CODE_LENGTH).fill(''));
  const [secondsLeft, setSecondsLeft] = useState(INITIAL_COOLDOWN);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const inputs = useRef([]);
  const code = digits.join('');
  const normalizedEmail = String(email).trim().toLowerCase();

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = setTimeout(() => setSecondsLeft((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  useEffect(() => {
    if (!success) return undefined;
    const nextRoute = purpose === 'password-reset' ? 'ResetPassword' : 'Login';
    const timer = setTimeout(() => {
      navigation.reset({
        index: 0,
        routes: [{ name: nextRoute, params: { email: normalizedEmail } }],
      });
    }, 900);
    return () => clearTimeout(timer);
  }, [navigation, normalizedEmail, purpose, success]);

  const setDigit = (index, value) => {
    const number = value.replace(/\D/g, '').slice(-1);
    setDigits((current) => current.map((digit, i) => i === index ? number : digit));
    setError('');
    if (number && index < CODE_LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  const onKeyPress = (index, key) => {
    if (key === 'Backspace' && !digits[index] && index > 0) inputs.current[index - 1]?.focus();
  };

  const submit = async () => {
    setError('');
    if (code.length !== CODE_LENGTH) {
      setError('Enter all 6 digits to continue.');
      return;
    }
    setLoading(true);
    try {
      await verifyEmailOtp(normalizedEmail, code, purpose === 'password-reset' ? 'recovery' : 'signup');
      setSuccess(purpose === 'password-reset' ? 'Email verified. Opening password reset…' : 'Email verified successfully! Redirecting to login...');
    } catch (cause) {
      const verificationMessage = String(cause?.message || '');
      const alreadyVerified = /already confirmed|already registered|already verified/i.test(verificationMessage);
      if (alreadyVerified) {
        try {
          await verifyEmailOtp(normalizedEmail, code, purpose === 'password-reset' ? 'recovery' : 'signup');
          setSuccess(purpose === 'password-reset' ? 'Email verified. Opening password reset…' : 'Email verified successfully! Redirecting to login...');
          return;
        } catch (signOutError) {
          setError(signOutError?.message || 'Could not clear the temporary session. Please try again.');
          return;
        }
      }
      const displayMessage = cause?.message || 'Invalid or expired verification code.';
      setError(displayMessage);
      Alert.alert('Verification Failed', displayMessage);
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (secondsLeft > 0 || resending) return;
    setError('');
    setResending(true);
    try {
      if (onResendCode) {
        await onResendCode({ email: normalizedEmail, purpose });
      } else if (purpose === 'password-reset') {
        if (!supabase) throw new Error('Code delivery is unavailable. Check the app Supabase configuration.');
        const { error: resendError } = await supabase.auth.resetPasswordForEmail(normalizedEmail);
        if (resendError) throw resendError;
      } else {
        if (!supabase) throw new Error('Code delivery is unavailable. Check the app’s Supabase configuration.');
        const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: normalizedEmail });
        if (resendError) throw resendError;
      }
      setDigits(Array(CODE_LENGTH).fill(''));
      setSecondsLeft(INITIAL_COOLDOWN);
      inputs.current[0]?.focus();
    } catch (cause) {
      setError(cause?.message || 'We could not resend a code. Please try again.');
    } finally {
      setResending(false);
    }
  };

  const timeLabel = formatCountdown(secondsLeft);

  return <AuthPage>
    <ScreenHeader title={purpose === 'password-reset' ? 'Reset code' : 'Check your email'} subtitle="Enter the six-digit code we sent to:" eyebrow={purpose === 'password-reset' ? 'ACCOUNT RECOVERY' : 'EMAIL VERIFICATION'} back navigation={navigation} />
    <View style={styles.emailCard}><View style={styles.emailIcon}><MailCheck size={19} color={colors.forest} /></View><Text style={styles.emailText} numberOfLines={1}>{email}</Text></View>
    <View style={styles.codeRow}>
      {digits.map((digit, index) => <TextInput
        key={index}
        ref={(ref) => { inputs.current[index] = ref; }}
        value={digit}
        onChangeText={(value) => setDigit(index, value)}
        onKeyPress={({ nativeEvent }) => onKeyPress(index, nativeEvent.key)}
        keyboardType="number-pad"
        maxLength={1}
        selectTextOnFocus
        autoFocus={index === 0}
        accessibilityLabel={`Verification digit ${index + 1}`}
        style={[styles.codeInput, digit && styles.codeInputFilled, error && styles.codeInputError]}
      />)}
    </View>
    {success ? <Text accessibilityRole="alert" style={styles.success}>{success}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <PrimaryButton title="Verify & Continue" onPress={submit} disabled={code.length !== CODE_LENGTH || !!success} loading={loading} icon={ShieldCheck} />
    <Text style={styles.resendLabel}>{secondsLeft > 0 ? `Resend code in ${timeLabel}` : 'Didn’t receive a code?'}</Text>
    <Pressable onPress={resend} disabled={secondsLeft > 0 || resending || loading || !!success} accessibilityRole="button" style={styles.resendButton}>
      <Text style={[styles.resendText, (secondsLeft > 0 || resending || loading) && styles.resendDisabled]}>{resending ? 'Sending code…' : 'Resend Code'}</Text>
    </Pressable>
    <Pressable onPress={() => navigation.goBack()} disabled={!!success} accessibilityRole="link" style={styles.changeEmail}>
      <Text style={styles.changeEmailText}>Change email address</Text>
    </Pressable>
  </AuthPage>;
}

const styles = StyleSheet.create({
  emailCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#EAF0E6', padding: 12, borderRadius: 13, marginBottom: 22 },
  emailIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: '#DCE8D6', alignItems: 'center', justifyContent: 'center' }, emailText: { flex: 1, color: '#27432C', fontWeight: '700', fontSize: 14 },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 7, marginBottom: 12 },
  codeInput: { width: 43, height: 52, borderRadius: 12, borderWidth: 1.4, borderColor: '#DCE4D9', backgroundColor: '#FFFFFF', textAlign: 'center', color: colors.ink, fontSize: 20, fontWeight: '800' },
  codeInputFilled: { borderColor: '#7A9D54', backgroundColor: '#F8FBF2' }, codeInputError: { borderColor: '#B5473B' }, error: { color: '#B5473B', fontSize: 13, lineHeight: 18, marginBottom: 8 }, success: { color: '#276738', backgroundColor: '#EAF4E8', borderRadius: 10, padding: 12, fontSize: 14, lineHeight: 20, marginBottom: 12, textAlign: 'center', fontWeight: '700' },
  resendLabel: { textAlign: 'center', color: '#5D6B60', fontSize: 14, marginTop: 21 }, resendButton: { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 10 }, resendText: { color: colors.forest, fontSize: 14, fontWeight: '800' }, resendDisabled: { color: '#77847A' },
  changeEmail: { alignSelf: 'center', padding: 9, marginTop: 4 }, changeEmailText: { color: colors.forest, fontSize: 14, fontWeight: '700' }, integrationNote: { textAlign: 'center', color: '#647168', fontSize: 12, lineHeight: 18, marginTop: 14 },
});
