import { useEffect, useState } from 'react';
import { Mail, RefreshCw, ShieldCheck } from 'lucide-react-native';
import { Pressable, Text, View, StyleSheet, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthPage, FormField, PasswordField, PrimaryButton, InlineLink, ScreenHeader, colors } from '../../components/auth/AuthUI.js';
import { supabase } from '../../api/supabase.js';
import { fetchStaffAssignments } from '../../api/authApi.js';
import { useAuth } from '../../context/AuthContext.js';

const REMEMBERED_EMAIL_KEY = 'olclear.auth.rememberedEmail';

const validateLoginEmail = (emailStr, isStaffTab) => {
  const lowerEmail = emailStr.trim().toLowerCase();
  if (!lowerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lowerEmail)) return false;
  if (isStaffTab) {
    return lowerEmail.endsWith('@wlcormoc.edu.ph') || lowerEmail.endsWith('@gmail.com');
  }
  return lowerEmail.endsWith('@wlcormoc.edu.ph');
};

const loginEmailError = (isStaffTab) => isStaffTab
  ? 'Enter a valid school email ending in @wlcormoc.edu.ph or a Gmail address ending in @gmail.com.'
  : 'Enter your institutional email ending in @wlcormoc.edu.ph.';

function readableAuthError(error) {
  const message = `${error?.message || ''} ${error?.code || ''}`.toLowerCase();
  if (/email_not_confirmed|not confirmed|email not verified|unverified/.test(message)) {
    return 'Please verify your email address before signing in.';
  }
  if (/invalid login credentials|invalid_credentials|wrong password|user not found/.test(message)) {
    return 'Invalid email or password.';
  }
  if (/network|fetch failed|failed to fetch|timed out|timeout/.test(message)) {
    return 'Network error. Please check your internet connection.';
  }
  return error?.message || 'We could not sign you in. Please try again.';
}

export function LoginScreen({ navigation, route, onSignIn }) {
  const { setAuthenticatedProfile } = useAuth();
  const verifiedEmail = String(route?.params?.email || '').trim().toLowerCase();
  const [email, setEmail] = useState(verifiedEmail);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [loginContext, setLoginContext] = useState('student');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isStaffTab = loginContext === 'staff';
  const emailIsValid = validateLoginEmail(email, isStaffTab);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(REMEMBERED_EMAIL_KEY)
      .then((savedEmail) => {
        if (!active || verifiedEmail || !savedEmail) return;
        setEmail(savedEmail);
        setRemember(true);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [verifiedEmail]);

  const toggleRemember = async (value) => {
    setRemember(value);
    try {
      if (value && email.trim()) await AsyncStorage.setItem(REMEMBERED_EMAIL_KEY, email.trim());
      if (!value) await AsyncStorage.removeItem(REMEMBERED_EMAIL_KEY);
    } catch {
      // Remember Me is optional; a storage failure should not block sign-in.
    }
  };

  const submit = async () => {
    setError('');
    if (!email.trim()) return setError('Enter your institutional email.');
    if (!password) return setError('Enter your password.');
    if (!validateLoginEmail(email, isStaffTab)) return setError(loginEmailError(isStaffTab));
    if (!supabase) return setError('Sign-in is unavailable. Check the app’s Supabase configuration.');
    setLoading(true);
    let authenticated = false;
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) throw signInError;
      if (!data?.user?.id) throw new Error('Sign-in did not return an account. Please try again.');
      authenticated = true;

      const { data: profile, error: profileError } = await supabase
        .from('users')
        .select(`
          *,
          academic_departments (id, code, name),
          programs (id, code, name, academic_level)
        `)
        .eq('id', data.user.id)
        .single();
      if (profileError || !profile) {
        await supabase.auth.signOut();
        throw new Error('We could not load your account profile. Please contact your administrator.');
      }

      const profileRole = String(profile.role || '').toUpperCase();
      const roleMatchesContext = loginContext === 'student'
        ? profileRole === 'STUDENT'
        : ['STAFF', 'ADMIN'].includes(profileRole);
      if (!roleMatchesContext) {
        await supabase.auth.signOut();
        setError('Access denied. Please select the correct login tab for your account type.');
        return;
      }
      const accountStatus = String(profile.status || 'ACTIVE').toUpperCase();
      if (profileRole === 'ADMIN' && accountStatus !== 'ACTIVE') {
        await supabase.auth.signOut();
        authenticated = false;
        setError('Your administrator account is not active. Contact another administrator.');
        return;
      }

      let officeCodes = [];
      let authenticatedProfile = profile;
      if (profileRole === 'STAFF') {
        const assignments = await fetchStaffAssignments(data.user.id);
        officeCodes = assignments.map((assignment) => {
          const office = Array.isArray(assignment.offices) ? assignment.offices[0] : assignment.offices;
          return office?.code;
        }).filter(Boolean);
        const officeAssignment = assignments.find((assignment) => {
          const office = Array.isArray(assignment.offices) ? assignment.offices[0] : assignment.offices;
          return office?.code;
        }) || assignments[0];
        const office = Array.isArray(officeAssignment?.offices)
          ? officeAssignment.offices[0]
          : officeAssignment?.offices;
        const officeCode = office?.code || profile.office_code || '';
        const hasOfficeAssignment = Boolean(officeCode);
        const status = String(profile.status || '').toUpperCase();
        if (status === 'PENDING_APPROVAL' || !hasOfficeAssignment || status !== 'ACTIVE') {
          const message = status === 'PENDING_APPROVAL' || !hasOfficeAssignment
            ? 'Your staff account is pending administrator approval and office assignment.'
            : 'Your staff account is not active. Contact the system administrator.';
          const { error: signOutError } = await supabase.auth.signOut();
          authenticated = false;
          setError(signOutError ? `${message} We could not securely sign you out: ${signOutError.message}` : message);
          return;
        }
        authenticatedProfile = {
          ...profile,
          office_code: officeCode || null,
          assigned_office_id: profile.assigned_office_id || officeAssignment?.office_id || null,
          department_id: profile.department_id || officeAssignment?.department_id || null,
        };
        if (officeCodes.length === 0 && officeCode) officeCodes = [officeCode];
      }

      try {
        if (remember) await AsyncStorage.setItem(REMEMBERED_EMAIL_KEY, email.trim());
        else await AsyncStorage.removeItem(REMEMBERED_EMAIL_KEY);
      } catch {
        // A storage issue should not undo successful authentication.
      }
      setAuthenticatedProfile(authenticatedProfile);
      if (onSignIn) await onSignIn({ email: email.trim(), password, remember, loginContext, user: data.user, profile: authenticatedProfile });
      if (profileRole === 'STUDENT') {
        navigation.reset({ index: 0, routes: [{ name: 'Home', params: { profile } }] });
      } else if (profileRole === 'ADMIN') {
        navigation.reset({ index: 0, routes: [{ name: 'AdminDashboard', params: { profile } }] });
      } else {
        if (String(authenticatedProfile.office_code || '').toUpperCase() === 'ACCOUNTING') {
          navigation.reset({ index: 0, routes: [{ name: 'AccountingStaff', params: { profile } }] });
        } else {
          navigation.reset({ index: 0, routes: [{ name: 'StaffOfficeQueue', params: { profile } }] });
        }
      }
    } catch (cause) {
      const message = readableAuthError(cause);
      if (authenticated) {
        const { error: signOutError } = await supabase.auth.signOut();
        setError(signOutError ? `${message} Sign-out also failed: ${signOutError.message}` : message);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  return <AuthPage>
    <ScreenHeader title="Welcome back" subtitle="Sign in with your Western Leyte College account." />
    <View style={styles.segment} accessibilityRole="tablist">
      {[{ value: 'student', label: 'Student Login' }, { value: 'staff', label: 'Staff / Admin' }].map((option) => <Pressable key={option.value} onPress={() => { setLoginContext(option.value); setError(''); }} accessibilityRole="tab" accessibilityState={{ selected: loginContext === option.value }} style={[styles.segmentItem, loginContext === option.value && styles.segmentItemActive]}><Text style={[styles.segmentText, loginContext === option.value && styles.segmentTextActive]}>{option.label}</Text></Pressable>)}
    </View>
    <FormField label="Institutional email" icon={Mail} value={email} onChangeText={(value) => { setEmail(value); setError(''); }} placeholder={isStaffTab ? 'employee@wlcormoc.edu.ph or name@gmail.com' : 'student.name@wlcormoc.edu.ph'} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" error={email.length > 0 && !emailIsValid ? loginEmailError(isStaffTab) : ''} />
    <PasswordField label="Password" value={password} onChangeText={setPassword} />
    {error ? <View accessibilityRole="alert" style={styles.errorCard}>
      <Text style={styles.error}>{error}</Text>
      <Pressable
        onPress={submit}
        disabled={loading}
        accessibilityRole="button"
        style={styles.retryButton}
      >
        <RefreshCw size={15} color={colors.red} />
        <Text style={styles.retryText}>Refresh status and retry</Text>
      </Pressable>
    </View> : null}
    <View style={styles.optionsRow}>
      <View style={styles.rememberRow}><Switch value={remember} onValueChange={toggleRemember} trackColor={{ false: '#D6DED4', true: '#A8C85A' }} thumbColor={remember ? colors.forest : '#FFFFFF'} accessibilityLabel="Remember me" /><Text style={styles.rememberText}>Remember Me</Text></View>
      <InlineLink onPress={() => navigation.navigate('ForgotPassword', { email })}>Forgot Password?</InlineLink>
    </View>
    <PrimaryButton title="Sign In" onPress={submit} loading={loading} />
    <View style={styles.footerRow}><Text style={styles.footerText}>Don’t have an account? </Text><InlineLink onPress={() => navigation.navigate('Register')}>Sign Up</InlineLink></View>
    <View style={styles.secureNote}><ShieldCheck size={16} color={colors.forest} /><Text style={styles.secureText}>{loginContext === 'student' ? 'Sign in to view and manage your clearance.' : 'Staff and admin access is checked against your assigned role.'}</Text></View>
  </AuthPage>;
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 13, backgroundColor: '#E9EEE6', marginBottom: 17 },
  segmentItem: { flex: 1, minHeight: 45, justifyContent: 'center', alignItems: 'center', borderRadius: 10 }, segmentItemActive: { backgroundColor: '#FFFFFF', elevation: 2 }, segmentText: { color: '#5D6B60', fontSize: 13, fontWeight: '700' }, segmentTextActive: { color: colors.forest },
  optionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 1, marginBottom: 10 },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: -8 },
  rememberText: { color: '#4F5D52', fontSize: 13 },
  errorCard: { backgroundColor: '#FDEBE8', borderColor: '#E7B5AE', borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8, marginBottom: 12 },
  error: { color: '#9D382D', fontSize: 13, lineHeight: 19 },
  retryButton: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 9, paddingVertical: 5 },
  retryText: { color: '#9D382D', fontSize: 12, fontWeight: '800' },
  footerRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 20 },
  footerText: { color: '#5D6B60', fontSize: 13 },
  secureNote: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, marginTop: 24 },
  secureText: { color: '#5D6B60', fontSize: 12, lineHeight: 17 },
});
