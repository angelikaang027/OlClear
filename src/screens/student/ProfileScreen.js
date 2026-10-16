import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, LogOut, UserRound } from 'lucide-react-native';
import { ConfirmSignOutModal } from '../../components/ConfirmSignOutModal.js';
import { useAuth } from '../../context/AuthContext.js';
import { fetchStudentProfile } from '../../api/studentApi.js';

export function ProfileScreen({ navigation, route }) {
  const { user, profile: authProfile, signOut } = useAuth();
  const [loadedProfile, setLoadedProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutModalVisible, setSignOutModalVisible] = useState(false);

  const profile = authProfile || loadedProfile || route.params?.profile;

  useEffect(() => {
    let active = true;
    if (profile || !user?.id) return () => { active = false; };
    fetchStudentProfile(user.id)
      .then((row) => { if (active) setLoadedProfile(row); })
      .catch((cause) => { if (active) Alert.alert('Profile unavailable', cause?.message || 'Could not load your profile.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [profile, user?.id]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      setSignOutModalVisible(false);
      navigation.reset({ index: 0, routes: [{ name: 'Landing' }] });
    } catch (cause) {
      Alert.alert('Could not sign out', cause?.message || 'Please try again.');
    } finally { setSigningOut(false); }
  };

  const department = profile?.academic_departments?.name || profile?.academic_departments?.code || profile?.department_code || '—';
  const program = profile?.programs?.code || profile?.program_code || '—';

  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <View style={styles.header}><Pressable onPress={() => navigation.goBack()} style={styles.back}><ArrowLeft size={21} color="#FFFFFF" /></Pressable><Text style={styles.headerTitle}>My Profile</Text><View style={styles.rightSpace} /></View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.hero}><View style={styles.avatar}><UserRound size={34} color="#0D3B2E" /></View><Text style={styles.name}>{profile?.full_name || user?.user_metadata?.full_name || 'Student'}</Text><Text style={styles.email}>{profile?.email || user?.email || ''}</Text></View>
      {loading ? <ActivityIndicator color="#0D3B2E" style={styles.loader} /> : null}
      <View style={styles.infoCard}>
        <Info label="Student ID" value={profile?.student_id_number || '—'} />
        <Info label="Academic level" value={String(profile?.academic_level || user?.user_metadata?.academic_level || '—').replaceAll('_', ' ')} />
        <Info label="Department" value={department} />
        <Info label="Program / course" value={program} />
        <Info label="Year level" value={profile?.year_level || '—'} />
        <Info label="Graduating student" value={profile?.is_graduating ? 'Yes' : 'No'} />
      </View>
      <Text style={styles.settingsTitle}>ACCOUNT SETTINGS</Text>
      <Pressable onPress={() => setSignOutModalVisible(true)} disabled={signingOut} style={[styles.signOutButton, signingOut && styles.disabled]}>
        {signingOut ? <ActivityIndicator color="#B7443A" /> : <><LogOut size={18} color="#B7443A" /><Text style={styles.signOutText}>Sign Out</Text></>}
      </Pressable>
    </ScrollView>
    <ConfirmSignOutModal
      visible={signOutModalVisible}
      title="Sign out of your student account?"
      message="You will return to the welcome screen and need to sign in again to view your clearance."
      busy={signingOut}
      onCancel={() => setSignOutModalVisible(false)}
      onConfirm={handleSignOut}
    />
  </SafeAreaView>;
}

function Info({ label, value }) {
  return <View style={styles.infoRow}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3F6F1' }, header: { height: 58, backgroundColor: '#0D3B2E', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }, back: { width: 40, justifyContent: 'center' }, headerTitle: { flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '800' }, rightSpace: { width: 30 }, content: { padding: 17, paddingBottom: 32 }, hero: { backgroundColor: '#0D3B2E', borderRadius: 18, padding: 20, alignItems: 'center' }, avatar: { width: 65, height: 65, borderRadius: 33, backgroundColor: '#DDF36B', alignItems: 'center', justifyContent: 'center' }, name: { color: '#FFFFFF', fontSize: 19, fontWeight: '900', marginTop: 12 }, email: { color: '#D4E2D8', fontSize: 12, marginTop: 5 }, loader: { marginVertical: 14 }, infoCard: { backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 15, marginTop: 14 }, infoRow: { minHeight: 48, borderBottomWidth: 1, borderBottomColor: '#EDF1EC', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }, infoLabel: { color: '#718075', fontSize: 12 }, infoValue: { color: '#2D3D31', fontSize: 12, fontWeight: '800', textAlign: 'right', flex: 1 }, settingsTitle: { color: '#718075', fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginHorizontal: 3, marginTop: 24, marginBottom: 9 }, signOutButton: { backgroundColor: '#FFFFFF', borderRadius: 13, minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 }, signOutText: { color: '#B7443A', fontSize: 13, fontWeight: '900' }, disabled: { opacity: 0.6 },
});
