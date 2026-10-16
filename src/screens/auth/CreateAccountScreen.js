import { useEffect, useMemo, useState } from 'react';
import { Check, IdCard, Mail, UserRound } from 'lucide-react-native';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { getAcademicDepartments, getAcademicPrograms, registerAccount } from '../../api/authApi.js';
import { ACADEMIC_LEVELS, YEAR_LEVELS } from '../../data/academic.js';
import { OFFICES } from '../../constants/offices.js';
import { AuthPage, CheckRow, FormField, InlineLink, PasswordField, PickerField, PrimaryButton, ScreenHeader, ToggleRow } from '../../components/auth/AuthUI.js';

const ROLES = [
  { value: 'STUDENT', label: 'Student' },
  { value: 'STAFF', label: 'Staff / Approver' },
];
const OFFICE_OPTIONS = OFFICES.map(({ code, name }) => ({ value: code, label: name }));
const DEPARTMENT_OFFICES = ['DEAN', 'ADVISER'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_PATTERN = /^\d{4}$/;
const EMPLOYEE_ID_PATTERN = /^[A-Za-z0-9-]{3,20}$/;
function passwordScore(value) {
  return [value.length >= 8, /[A-Z]/.test(value), /\d/.test(value), /[^A-Za-z0-9]/.test(value)].filter(Boolean).length;
}

function validateEmailDomain(emailStr, selectedRole) {
  const normalizedEmail = emailStr.trim().toLowerCase();
  const normalizedRole = String(selectedRole || '').toUpperCase();
  if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail)) return false;
  if (normalizedRole === 'STUDENT') return normalizedEmail.endsWith('@wlcormoc.edu.ph');
  if (normalizedRole === 'STAFF') {
    return normalizedEmail.endsWith('@wlcormoc.edu.ph') || normalizedEmail.endsWith('@gmail.com');
  }
  return false;
}

function emailDomainError(selectedRole) {
  return selectedRole === 'STUDENT'
    ? 'Student accounts must use an official school email address (@wlcormoc.edu.ph).'
    : 'Staff accounts must use a valid school email (@wlcormoc.edu.ph) or Gmail address (@gmail.com).';
}

export function CreateAccountScreen({ navigation, route, onRegister }) {
  const [role, setRole] = useState('STUDENT');
  const [fullName, setFullName] = useState('');
  const [personId, setPersonId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [academicLevel, setAcademicLevel] = useState('');
  const [department, setDepartment] = useState('');
  const [departmentName, setDepartmentName] = useState('');
  const [program, setProgram] = useState('');
  const [programName, setProgramName] = useState('');
  const [yearLevel, setYearLevel] = useState('');
  const [graduating, setGraduating] = useState(false);
  const [office, setOffice] = useState('');
  const [assignedDepartment, setAssignedDepartment] = useState('');
  const [departmentRows, setDepartmentRows] = useState([]);
  const [programRows, setProgramRows] = useState([]);
  const [catalogError, setCatalogError] = useState('');
  const [localTermsAccepted, setLocalTermsAccepted] = useState(false);
  const termsAccepted = localTermsAccepted || route.params?.termsAccepted === true;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    Promise.allSettled([getAcademicDepartments(), getAcademicPrograms()]).then(([departmentResult, programResult]) => {
      if (!active) return;
      const departments = departmentResult.status === 'fulfilled' ? departmentResult.value : [];
      const programs = programResult.status === 'fulfilled' ? programResult.value : [];
      setDepartmentRows(departments);
      setProgramRows(programs);
      if (departmentResult.status === 'rejected') {
        setCatalogError(departmentResult.reason?.message || 'The live department catalog could not be loaded. Try again later or contact an administrator.');
      } else if (!departments.length) {
        setCatalogError('No academic departments are configured yet. Contact an administrator to update the academic catalog.');
      } else if (programResult.status === 'rejected') {
        setCatalogError(programResult.reason?.message || 'The live program catalog could not be loaded. Try again later or contact an administrator.');
      } else {
        setCatalogError('');
      }
    });
    return () => { active = false; };
  }, []);
  const score = useMemo(() => passwordScore(password), [password]);
  const emailValid = validateEmailDomain(email, role);
  const emailError = email.length > 0 && !emailValid ? emailDomainError(role) : '';
  const emailPlaceholder = role === 'STUDENT'
    ? 'student.name@wlcormoc.edu.ph'
    : 'employee@wlcormoc.edu.ph or name@gmail.com';
  const confirmValid = password.length > 0 && password === confirmPassword;
  const needsOfficeDepartment = DEPARTMENT_OFFICES.includes(office);
  const departmentOptions = departmentRows.map(({ id, code, name }) => ({ id, value: code, label: code, description: name }));
  const levelOptions = ACADEMIC_LEVELS.map((value) => ({ value, label: value.replaceAll('_', ' ') }));
  const studentDepartments = departmentRows.filter(({ code }) => academicLevel === 'HIGH_SCHOOL' ? code === 'HS' : code !== 'HS');
  const yearOptions = (academicLevel === 'HIGH_SCHOOL' ? ['Grade 11', 'Grade 12'] : YEAR_LEVELS.filter((item) => item.endsWith('Year'))).map((value) => ({ value, label: value }));
  const selectedDepartment = departmentRows.find((row) => row.code === department);
  const programOptions = programRows
    .filter((row) => row.department_id === selectedDepartment?.id
      && (!row.academic_level || String(row.academic_level).toUpperCase() === academicLevel))
    .map((row) => ({ value: row.code, label: `${row.code} - ${row.name || row.code}` }));

  const commonValid = fullName.trim().length >= 3 && emailValid && score >= 3 && confirmValid && termsAccepted;
  const roleValid = role === 'STUDENT'
      ? ID_PATTERN.test(personId.trim()) && !!academicLevel && !!department && !!program && !!yearLevel
      : EMPLOYEE_ID_PATTERN.test(personId.trim()) && !!office && (!needsOfficeDepartment || !!assignedDepartment);
  const valid = commonValid && roleValid;

  const changeRole = (nextRole) => {
    setRole(nextRole);
    setPersonId('');
    setAcademicLevel('');
    setDepartment('');
    setDepartmentName('');
    setProgram('');
    setProgramName('');
    setYearLevel('');
    setOffice('');
    setAssignedDepartment('');
    setError('');
  };

  const changeLevel = (value) => {
    setAcademicLevel(value);
    setDepartment('');
    setDepartmentName('');
    setProgram('');
    setProgramName('');
    setYearLevel('');
  };

  const changeOffice = (value) => {
    setOffice(value);
    setAssignedDepartment('');
  };

  const submit = async () => {
    setError('');
    if (!validateEmailDomain(email, role)) {
      setError(emailDomainError(role));
      return;
    }
    if (!valid) {
      setError('Complete the required fields and accept the terms.');
      return;
    }
    const profile = role === 'STUDENT'
      ? { academicLevel, department, departmentName, program, programName, yearLevel, graduating }
      : { office, department: needsOfficeDepartment ? assignedDepartment : null };
    setLoading(true);
    try {
      const registrationData = role === 'STUDENT'
        ? {
          fullName: fullName.trim(),
          studentIdNumber: personId.trim(),
          email: email.trim(),
          password,
          department,
          departmentName,
          program,
          programName,
          academicLevel,
          yearLevel,
          graduating,
        }
        : { role, fullName: fullName.trim(), personId: personId.trim(), email: email.trim(), password, ...profile };
      const registrationHandler = onRegister || registerAccount;
      await registrationHandler(registrationData);
      navigation.navigate('Verification', { email: email.trim(), purpose: 'registration', role });
    } catch (cause) {
      setError(cause?.message || 'We could not create your account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return <AuthPage>
    <ScreenHeader title="Create your account" subtitle="Choose your account type and enter your institutional details." eyebrow="ACCOUNT REGISTRATION" back navigation={navigation} />
    <View style={styles.roleTabs} accessibilityRole="tablist">
      {ROLES.map((item) => <Pressable key={item.value} onPress={() => changeRole(item.value)} accessibilityRole="tab" accessibilityState={{ selected: role === item.value }} style={[styles.roleTab, role === item.value && styles.roleTabActive]}>
        <Text style={[styles.roleTabText, role === item.value && styles.roleTabTextActive]}>{item.label}</Text>
      </Pressable>)}
    </View>
    <Text style={styles.sectionHeading}>Personal details</Text>
    <FormField label="Full name" icon={UserRound} value={fullName} onChangeText={setFullName} placeholder="First and last name" autoCapitalize="words" autoComplete="name" textContentType="name" />
    <FormField label={role === 'STUDENT' ? 'Student ID number' : 'Employee ID number'} icon={IdCard} value={personId} onChangeText={(value) => setPersonId(role === 'STUDENT' ? value.replace(/\D/g, '').slice(0, 4) : value)} placeholder={role === 'STUDENT' ? '4-digit student ID' : 'Employee ID'} keyboardType={role === 'STUDENT' ? 'number-pad' : 'default'} autoCapitalize="characters" maxLength={role === 'STUDENT' ? 4 : 20} error={personId && role === 'STUDENT' && !ID_PATTERN.test(personId) ? 'Enter a 4-digit student ID number.' : ''} />
    <FormField label="Institutional email" icon={Mail} value={email} onChangeText={(value) => { setEmail(value); setError(''); }} placeholder={emailPlaceholder} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" error={emailError} />
    <Text style={styles.helper}>{role === 'STUDENT' ? 'Must end in @wlcormoc.edu.ph' : 'Allowed: @wlcormoc.edu.ph or @gmail.com'}</Text>

    {role === 'STUDENT' ? <>
      <Text style={styles.sectionHeading}>Academic details</Text>
      <PickerField label="Academic level" selectedValue={academicLevel} onValueChange={changeLevel} options={levelOptions} placeholder="Choose academic level" />
      <PickerField label="Academic department" selectedValue={department} onValueChange={(value) => { const selected = departmentRows.find((item) => item.code === value); setDepartment(value); setDepartmentName(selected?.name || ''); setProgram(''); setProgramName(''); }} options={studentDepartments.map(({ id, code, name }) => ({ id, value: code, label: code, description: name }))} placeholder={!academicLevel ? 'Choose academic level first' : studentDepartments.length ? 'Choose department' : 'No departments in the live catalog'} enabled={!!academicLevel && studentDepartments.length > 0} />
      <PickerField label="Degree program" selectedValue={program} onValueChange={(value) => { const selected = programRows.find((item) => item.code === value && item.department_id === selectedDepartment?.id); setProgram(value); setProgramName(selected?.name || value); }} options={programOptions} placeholder={department ? programOptions.length ? 'Choose program or course' : 'No programs in the live catalog' : 'Choose department first'} enabled={!!department && programOptions.length > 0} />
      {catalogError ? <Text style={styles.catalogError}>{catalogError}</Text> : department && !programOptions.length ? <Text style={styles.catalogError}>No programs are configured for this department and academic level. Contact an administrator to update the academic catalog.</Text> : null}
      <PickerField label="Year level" selectedValue={yearLevel} onValueChange={setYearLevel} options={yearOptions} placeholder={academicLevel ? 'Choose year level' : 'Choose academic level first'} enabled={!!academicLevel} />
      <ToggleRow label="Graduating student" description="Use the graduating clearance checklist." value={graduating} onValueChange={setGraduating} />
    </> : null}

    {role === 'STAFF' ? <>
      <Text style={styles.sectionHeading}>Requested office access</Text>
      <PickerField label="Office you are requesting" selectedValue={office} onValueChange={changeOffice} options={OFFICE_OPTIONS} placeholder="Choose requested office" />
      {needsOfficeDepartment ? <PickerField label="Requested academic department" selectedValue={assignedDepartment} onValueChange={setAssignedDepartment} options={departmentOptions} placeholder={departmentOptions.length ? 'Choose department' : 'No departments in the live catalog'} enabled={departmentOptions.length > 0} /> : null}
      <Text style={styles.helper}>An administrator will review your request. You cannot access an office until it is approved and assigned.</Text>
    </> : null}

    <Text style={styles.sectionHeading}>Secure your account</Text>
    <PasswordField label="Password" value={password} onChangeText={setPassword} placeholder="Create a strong password" autoComplete="new-password" />
    <PasswordStrength score={score} />
    <FormField label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Enter your password again" autoComplete="new-password" error={confirmPassword && !confirmValid ? 'Passwords do not match.' : ''} trailing={confirmValid ? <Check size={18} color="#32804A" strokeWidth={2.5} /> : null} />

    <CheckRow checked={termsAccepted} onPress={() => {
      setLocalTermsAccepted(!termsAccepted);
      if (route.params?.termsAccepted) navigation.setParams({ termsAccepted: false });
    }}>
      <Text style={styles.termsCopy}>I agree to the <InlineLink onPress={() => navigation.navigate('Terms')}>Terms &amp; Conditions</InlineLink> and <InlineLink onPress={() => navigation.navigate('PrivacyPolicy')}>Privacy Policy</InlineLink>.</Text>
    </CheckRow>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <PrimaryButton title="Register Account" onPress={submit} disabled={!valid} loading={loading} />
    <View style={styles.loginLink}><Text style={styles.loginText}>Already have an account? </Text><InlineLink onPress={() => navigation.navigate('Login')}>Log In</InlineLink></View>
  </AuthPage>;
}

function PasswordStrength({ score }) {
  const labels = ['Add length, a number, uppercase, and a symbol.', 'Weak', 'Fair', 'Good', 'Strong'];
  const fillColors = ['#E3E8E1', '#D07156', '#D6A23D', '#6C9C4A', '#32804A'];
  return <View style={styles.strengthWrap}>
    <View style={styles.strengthBars}>{[1, 2, 3, 4].map((bar) => <View key={bar} style={[styles.strengthBar, score >= bar && { backgroundColor: fillColors[score] }]} />)}</View>
    <Text style={styles.strengthLabel}>{labels[score]}</Text>
  </View>;
}

const styles = StyleSheet.create({
  roleTabs: { flexDirection: 'row', padding: 4, borderRadius: 13, backgroundColor: '#E9EEE6', marginBottom: 15, gap: 4 },
  roleTab: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 10, paddingHorizontal: 5 }, roleTabActive: { backgroundColor: '#FFFFFF', shadowColor: '#173A22', shadowOpacity: 0.08, shadowRadius: 5, elevation: 2 }, roleTabText: { color: '#718075', fontSize: 12, fontWeight: '700', textAlign: 'center' }, roleTabTextActive: { color: '#1F4B2C' },
  sectionHeading: { color: '#1F4B2C', fontSize: 15, fontWeight: '800', marginTop: 12, marginBottom: 11 },
  strengthWrap: { marginTop: -4, marginBottom: 12 }, strengthBars: { flexDirection: 'row', gap: 5 }, strengthBar: { height: 5, borderRadius: 3, flex: 1, backgroundColor: '#E3E8E1' }, strengthLabel: { color: '#59665B', fontSize: 12, lineHeight: 17, marginTop: 6 },
  helper: { color: '#59665B', fontSize: 13, lineHeight: 19, marginTop: -4, marginBottom: 10 }, catalogError: { color: '#8A5C0D', fontSize: 12, lineHeight: 18, marginTop: -3, marginBottom: 8 }, termsCopy: { color: '#465449', fontSize: 13, lineHeight: 19 }, error: { color: '#B5473B', fontSize: 13, lineHeight: 19, marginTop: 10 }, loginLink: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 19 }, loginText: { color: '#5D6B60', fontSize: 13 },
});
