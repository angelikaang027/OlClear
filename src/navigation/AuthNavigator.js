import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuth } from '../context/AuthContext.js';
import { LandingScreen } from '../screens/auth/LandingScreen.js';
import { LoginScreen } from '../screens/auth/LoginScreen.js';
import { CreateAccountScreen } from '../screens/auth/CreateAccountScreen.js';
import { ForgotPasswordScreen } from '../screens/auth/ForgotPasswordScreen.js';
import { VerificationScreen } from '../screens/auth/VerificationScreen.js';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen.js';
import { TermsScreen } from '../screens/auth/TermsScreen.js';
import { PrivacyPolicyScreen } from '../screens/auth/PrivacyPolicyScreen.js';
import { StudentDashboardScreen } from '../screens/student/studentdashboardscreen.js';
import { VerifyClearanceScreen } from '../screens/student/VerifyClearanceScreen.js';
import { OfficesListScreen } from '../screens/student/OfficesListScreen.js';
import { OfficeDetailScreen } from '../screens/student/OfficeDetailScreen.js';
import { DigitalPassScreen } from '../screens/student/DigitalPassScreen.js';
import { ProfileScreen } from '../screens/student/ProfileScreen.js';
import { RecentActivityScreen } from '../screens/student/recentactivityscreen.js';
import { StepByStepScreen } from '../screens/student/stepbystepscreen.js';
import { AdminDashboardScreen } from '../screens/admin/AdminDashboardScreen.js';
import { ClearancePeriodsScreen } from '../screens/admin/ClearancePeriodsScreen.js';
import { UserManagementScreen } from '../screens/admin/UserManagementScreen.js';
import { DepartmentProgramScreen } from '../screens/admin/DepartmentProgramScreen.js';
import { SystemAnalyticsScreen } from '../screens/admin/SystemAnalyticsScreen.js';
import { ClearanceOverrideScreen } from '../screens/admin/ClearanceOverrideScreen.js';
import { AccountingStaffScreen } from '../screens/staff/AccountingStaffScreen.js';
import { StaffOfficeQueueScreen } from '../screens/staff/StaffOfficeQueueScreen.js';

const Stack = createNativeStackNavigator();
function GuardedScreen({ component: Screen, roles, navigation, ...props }) {
  const { user, profile, loading } = useAuth();
  const role = String(profile?.role || '').toUpperCase();
  const allowed = Boolean(user && profile && roles.includes(role));

  useEffect(() => {
    if (loading || allowed) return;
    const destination = !user || !profile
      ? 'Landing'
      : role === 'ADMIN'
        ? 'AdminDashboard'
        : role === 'STAFF'
          ? String(profile.office_code || '').toUpperCase() === 'ACCOUNTING' ? 'AccountingStaff' : 'StaffOfficeQueue'
          : role === 'STUDENT' ? 'Home' : 'Landing';
    navigation.reset({ index: 0, routes: [{ name: destination }] });
  }, [loading, allowed, user, profile, role, navigation]);

  if (loading || !allowed) {
    return <View style={guardStyles.loading}><ActivityIndicator color="#1F4B2C" /></View>;
  }
  return <Screen navigation={navigation} {...props} />;
}

const guardStyles = StyleSheet.create({ loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F7F2' } });

const guard = (component, roles) => {
  function RoleGuard(props) {
    return <GuardedScreen {...props} component={component} roles={roles} />;
  }
  RoleGuard.displayName = `${component.displayName || component.name}RoleGuard`;
  return RoleGuard;
};
const HomeRoute = guard(StudentDashboardScreen, ['STUDENT']);
const OfficesListRoute = guard(OfficesListScreen, ['STUDENT']);
const OfficeDetailRoute = guard(OfficeDetailScreen, ['STUDENT']);
const DigitalPassRoute = guard(DigitalPassScreen, ['STUDENT']);
const ProfileRoute = guard(ProfileScreen, ['STUDENT']);
const RecentActivityRoute = guard(RecentActivityScreen, ['STUDENT']);
const StepByStepRoute = guard(StepByStepScreen, ['STUDENT']);
const AdminDashboardRoute = guard(AdminDashboardScreen, ['ADMIN']);
const ClearancePeriodsRoute = guard(ClearancePeriodsScreen, ['ADMIN']);
const UserManagementRoute = guard(UserManagementScreen, ['ADMIN']);
const DepartmentProgramRoute = guard(DepartmentProgramScreen, ['ADMIN']);
const SystemAnalyticsRoute = guard(SystemAnalyticsScreen, ['ADMIN']);
const AdminClearanceRoute = guard(ClearanceOverrideScreen, ['ADMIN']);
const AccountingStaffRoute = guard(AccountingStaffScreen, ['STAFF']);
const StaffOfficeQueueRoute = guard(StaffOfficeQueueScreen, ['STAFF']);
const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#F5F7F2',
    card: '#F5F7F2',
    primary: '#1F4B2C',
    text: '#18221A',
    border: '#E6EBE3',
  },
};

export function AuthNavigator({ authActions = {} }) {
  return (
    <NavigationContainer theme={theme} linking={{ prefixes: ['olclear://'], config: { screens: { VerifyClearance: 'verify/:token' } } }}>
      <Stack.Navigator
        initialRouteName="Landing"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="Landing" component={LandingScreen} />
        <Stack.Screen name="Login">
          {(props) => <LoginScreen {...props} onSignIn={authActions.signIn} />}
        </Stack.Screen>
        <Stack.Screen name="Register">
          {(props) => <CreateAccountScreen {...props} onRegister={authActions.register} />}
        </Stack.Screen>
        <Stack.Screen name="ForgotPassword">
          {(props) => <ForgotPasswordScreen {...props} onSendResetCode={authActions.sendResetCode} />}
        </Stack.Screen>
        <Stack.Screen name="Verification">
          {(props) => (
            <VerificationScreen
              {...props}
              onVerifyCode={authActions.verifyCode}
              onResendCode={authActions.resendCode}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
        <Stack.Screen name="Terms" component={TermsScreen} />
        <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />
        <Stack.Screen name="VerifyClearance" component={VerifyClearanceScreen} />
        <Stack.Screen name="Home" component={HomeRoute} />
        <Stack.Screen name="OfficesList" component={OfficesListRoute} />
        <Stack.Screen name="OfficeDetail" component={OfficeDetailRoute} />
        <Stack.Screen name="DigitalPass" component={DigitalPassRoute} />
        <Stack.Screen name="Profile" component={ProfileRoute} />
        <Stack.Screen name="RecentActivity" component={RecentActivityRoute} />
        <Stack.Screen name="StepByStep" component={StepByStepRoute} />
        <Stack.Screen name="AdminDashboard" component={AdminDashboardRoute} />
        <Stack.Screen name="ClearancePeriods" component={ClearancePeriodsRoute} />
        <Stack.Screen name="UserManagement" component={UserManagementRoute} />
        <Stack.Screen name="DepartmentProgram" component={DepartmentProgramRoute} />
        <Stack.Screen name="SystemAnalytics" component={SystemAnalyticsRoute} />
        <Stack.Screen name="AdminClearance" component={AdminClearanceRoute} />
        <Stack.Screen name="AccountingStaff" component={AccountingStaffRoute} />
        <Stack.Screen name="StaffOfficeQueue" component={StaffOfficeQueueRoute} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
