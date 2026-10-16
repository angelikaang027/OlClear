import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Award, ChevronRight, FileCheck2, FileText, LockKeyhole, Menu, User } from 'lucide-react-native';
import { fetchStudentDashboard } from '../../api/studentApi.js';
import { OFFICES, normalizeOfficeName } from '../../constants/offices.js';
import { OfficeCard } from '../../components/OfficeCard.js';
import { isAccountingApproved, isOfficeUnlocked } from '../../utils/clearanceRules.js';
import { useAuth } from '../../context/AuthContext.js';
import { supabase } from '../../api/supabase.js';

const GREEN = '#0D3B2E';

export function HomeScreen({ navigation, route }) {
  const { user, profile: contextProfile } = useAuth();
  const profile = contextProfile || route.params?.profile || {};
  const [dashboard, setDashboard] = useState({ request: null, items: [], activities: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const itemStatusRef = useRef({});

  const load = useCallback(async (isRefresh = false) => {
    if (!user?.id) {
      setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      setDashboard(await fetchStudentDashboard(user.id));
    } catch (cause) {
      setError(cause?.message || 'Could not load your clearance details.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  useEffect(() => {
    itemStatusRef.current = Object.fromEntries(dashboard.items.map((item) => [item.id, {
      status: item.status,
      office_code: item.office_code || item.offices?.code,
    }]));
  }, [dashboard.items]);

  useEffect(() => {
    const requestId = dashboard.request?.id;
    if (!supabase || !requestId) return undefined;
    const refresh = () => load(true);
    const onItemUpdate = (payload) => {
      const updatedItem = payload?.new;
      if (!updatedItem?.id) return;

      setDashboard((current) => ({
        ...current,
        items: current.items.map((item) => item.id === updatedItem.id ? { ...item, ...updatedItem } : item),
      }));

      const previousItem = itemStatusRef.current[updatedItem.id] || {};
      const oldStatus = previousItem.status;
      itemStatusRef.current[updatedItem.id] = { ...previousItem, ...updatedItem };
      if (String(updatedItem.office_code || previousItem.office_code || '').toUpperCase() === 'ACCOUNTING'
        && updatedItem.status === 'APPROVED' && oldStatus !== 'APPROVED') {
        Alert.alert('Accounting cleared!', 'Your Accounting clearance has been approved. The remaining signatory offices are now unlocked.');
      }
      load(true);
    };
    const channel = supabase.channel(`student-clearance-${requestId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clearance_items', filter: `clearance_request_id=eq.${requestId}` }, onItemUpdate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clearance_requests', filter: `id=eq.${requestId}` }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [dashboard.request?.id, load]);

  const itemForOffice = useCallback((office) => {
    const matching = dashboard.items.filter((item) => item.office_code === office.code
      || normalizeOfficeName(item.office_name) === normalizeOfficeName(office.name));
    return matching.find((item) => String(item.status || '').toUpperCase() === 'APPROVED') || matching[0] || null;
  }, [dashboard.items]);
  const approved = OFFICES.filter((office) => itemForOffice(office)?.status === 'APPROVED').length;
  const accountingApproved = isAccountingApproved(dashboard.items);
  const total = OFFICES.length;
  const progress = total > 0 ? Math.round((approved / total) * 100) : 0;
  const studentName = profile.full_name || user?.user_metadata?.full_name || 'Student';
  const program = profile.programs?.code || profile.program_code || 'Program';
  const year = profile.year_level || '';
  const academicLevel = String(profile.academic_level || user?.user_metadata?.academic_level || 'UNDERGRADUATE').replaceAll('_', ' ');
  const department = profile.academic_departments?.code || profile.department_code || '';
  const studentId = profile.student_id_number || 'Not provided';

  const openOffice = (office) => {
    const item = itemForOffice(office);
    navigation.navigate('OfficeDetail', {
      office: office.name,
      officeCode: office.code,
      clearanceItem: item || null,
      requestId: dashboard.request?.id,
    });
  };

  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <StatusBar barStyle="light-content" backgroundColor={GREEN} />
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={GREEN} />}
    >
      <View style={styles.topBar}>
        <Text style={styles.topTitle}>Student Dashboard</Text>
        <Pressable onPress={() => navigation.navigate('Profile', { profile })} accessibilityRole="button" accessibilityLabel="Open profile menu" style={styles.menuButton}><Menu size={23} color="#FFFFFF" /></Pressable>
      </View>

      <View style={styles.profileCard}>
        <View style={styles.profileInfo}>
          <View style={styles.badgeRow}>
            <Text style={styles.programBadge}>{[program, year].filter(Boolean).join(' ')}</Text>
            <Text style={styles.levelBadge}>{academicLevel}</Text>
          </View>
          <Text style={styles.studentName} numberOfLines={2}>{studentName}</Text>
          <Text style={styles.studentMeta}>Student ID: {studentId}</Text>
          {!!department && <Text style={styles.studentMeta}>{department}</Text>}
        </View>
        <View style={styles.avatar}><User size={30} color={GREEN} strokeWidth={2.2} /></View>
      </View>

      {error ? <Pressable onPress={() => Alert.alert('Could not load clearance', error)} style={styles.errorCard}><Text style={styles.errorText}>{error}</Text><Text style={styles.retryText} onPress={() => load()}>Tap to retry</Text></Pressable> : null}
      {loading ? <View style={styles.loadingRow}><ActivityIndicator color={GREEN} /><Text style={styles.loadingText}>Loading your clearance…</Text></View> : null}
      {!accountingApproved ? <Pressable
        accessibilityRole="button"
        onPress={() => openOffice(OFFICES.find((office) => office.code === 'ACCOUNTING'))}
        style={styles.accountingAlert}
      >
        <LockKeyhole size={19} color="#8C5B08" />
        <Text style={styles.accountingAlertText}>Action Required: Upload your physical Accounting Clearance Paper and await Accounting approval to unlock the remaining offices.</Text>
        <ChevronRight size={18} color="#8C5B08" />
      </Pressable> : null}

      <Pressable onPress={() => navigation.navigate('OfficesList')} style={styles.progressCard} accessibilityRole="button">
        <View style={styles.progressIcon}><FileCheck2 size={25} color="#DDF36B" /></View>
        <View style={styles.progressCopy}>
          <Text style={styles.progressTitle}>{progress === 100 ? 'CLEARED' : 'IN PROGRESS'}</Text>
          <Text style={styles.progressSubtitle}>{approved} out of {total} requirements cleared</Text>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View>
        </View>
        <ChevronRight size={22} color="#FFFFFF" />
      </Pressable>
      {progress === 100 ? <Pressable onPress={() => navigation.navigate('DigitalPass')} style={styles.passLink} accessibilityRole="button">
        <View style={styles.passLinkIcon}><Award size={20} color={GREEN} /></View>
        <View style={styles.passLinkCopy}><Text style={styles.passLinkTitle}>VIEW DIGITAL CLEARANCE CERTIFICATE</Text><Text style={styles.passLinkSubtitle}>All 10 offices have approved your clearance.</Text></View>
        <ChevronRight size={19} color="#52715C" />
      </Pressable> : <View style={[styles.passLink, styles.passLinkLocked]}>
        <View style={styles.passLinkIcon}><LockKeyhole size={19} color={GREEN} /></View>
        <View style={styles.passLinkCopy}><Text style={styles.passLinkTitle}>DIGITAL CLEARANCE CERTIFICATE</Text><Text style={styles.passLinkSubtitle}>{`Unlock after all ${total} offices approve.`}</Text></View>
      </View>}

      <Pressable onPress={() => navigation.navigate('StepByStep')} style={styles.guideCard} accessibilityRole="button">
        <View style={styles.guideIcon}><Award size={26} color={GREEN} /></View>
        <View style={styles.guideCopy}><Text style={styles.guideTitle}>STEP BY STEP</Text><Text style={styles.guideSubtitle}>Clearance Process</Text></View>
        <ChevronRight size={20} color="#52715C" />
      </Pressable>

      <View style={styles.sectionHeader}>
        <View><Text style={styles.sectionTitle}>SIGNATORY OFFICES</Text><Text style={styles.sectionSubtitle}>Tap an office to view its requirements</Text></View>
        <Pressable onPress={() => navigation.navigate('OfficesList')} accessibilityRole="button" accessibilityLabel="View all offices"><ChevronRight size={20} color={GREEN} /></Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.officeRow}>
        {OFFICES.map((office) => {
          const item = itemForOffice(office);
          return <OfficeCard
            key={office.code}
            office={office}
            status={item?.status || 'PENDING'}
            isLocked={!isOfficeUnlocked(office.code, dashboard.items)}
            onPress={() => openOffice(office)}
            compact
          />;
        })}
        <Pressable onPress={() => navigation.navigate('OfficesList')} style={styles.moreCard}><ChevronRight size={22} color={GREEN} /><Text style={styles.moreText}>All offices</Text></Pressable>
      </ScrollView>

      <Pressable onPress={() => navigation.navigate('RecentActivity', { activities: dashboard.activities })} style={styles.activityCard}>
        <View style={styles.activityHeader}><View><Text style={styles.sectionTitle}>RECENT ACTIVITY</Text><Text style={styles.sectionSubtitle}>Latest proof submissions and updates</Text></View><ChevronRight size={19} color={GREEN} /></View>
        {dashboard.activities.length === 0
          ? <Text style={styles.emptyActivity}>{dashboard.request ? 'Your uploads and clearance updates will appear here.' : 'No active clearance request was found for your account.'}</Text>
          : dashboard.activities.slice(0, 3).map((activity) => <View key={activity.id} style={styles.activityItem}>
            <View style={styles.activityMark}><FileText size={16} color={GREEN} /></View>
            <View style={styles.activityCopy}><Text style={styles.activityOffice}>{activity.office}</Text><Text style={styles.activityDescription} numberOfLines={1}>{activity.description}</Text></View>
            <Text style={styles.activityDate}>{activity.created_at ? new Date(activity.created_at).toLocaleDateString() : ''}</Text>
          </View>)}
      </Pressable>
      <View style={styles.bottomSpace} />
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F2F5F0' }, content: { paddingBottom: 20 },
  topBar: { minHeight: 58, backgroundColor: GREEN, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 }, topTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' }, menuButton: { width: 40, height: 40, alignItems: 'flex-end', justifyContent: 'center' },
  profileCard: { marginHorizontal: 17, marginTop: 17, backgroundColor: '#1B4332', borderRadius: 18, padding: 17, minHeight: 142, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowColor: '#09291D', shadowOpacity: 0.16, shadowRadius: 11, shadowOffset: { width: 0, height: 5 }, elevation: 5 }, profileInfo: { flex: 1, paddingRight: 12 }, badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 11 }, programBadge: { color: GREEN, backgroundColor: '#DDF36B', fontSize: 11, fontWeight: '900', paddingVertical: 5, paddingHorizontal: 9, borderRadius: 8 }, levelBadge: { color: '#E9F4EB', borderWidth: 1, borderColor: '#71907B', fontSize: 9, fontWeight: '800', paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8 }, studentName: { color: '#FFFFFF', fontSize: 19, lineHeight: 24, fontWeight: '800' }, studentMeta: { color: '#D4E2D8', fontSize: 12, marginTop: 5 }, avatar: { width: 57, height: 57, borderRadius: 29, backgroundColor: '#DDF36B', alignItems: 'center', justifyContent: 'center' },
  errorCard: { marginHorizontal: 17, marginTop: 12, padding: 13, backgroundColor: '#FDEBE8', borderRadius: 12 }, errorText: { color: '#9D382D', fontSize: 13 }, retryText: { color: '#7A2A23', fontWeight: '800', marginTop: 5 }, loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingVertical: 15 }, loadingText: { color: '#68766B', fontSize: 13 },
  accountingAlert: { marginHorizontal: 17, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#FFF3D9', borderColor: '#E6C77D', borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 9 }, accountingAlertText: { flex: 1, color: '#6D4B10', fontSize: 12, lineHeight: 17, fontWeight: '700' },
  progressCard: { marginHorizontal: 17, marginTop: 16, backgroundColor: '#14744B', borderRadius: 16, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12 }, progressIcon: { width: 45, height: 45, borderRadius: 14, backgroundColor: '#0D633F', alignItems: 'center', justifyContent: 'center' }, progressCopy: { flex: 1 }, progressTitle: { color: '#DDF36B', fontSize: 13, letterSpacing: 0.7, fontWeight: '900' }, progressSubtitle: { color: '#F0F8F1', fontSize: 12, marginTop: 4 }, progressTrack: { height: 5, overflow: 'hidden', borderRadius: 3, backgroundColor: '#78A98E', marginTop: 10 }, progressFill: { height: 5, backgroundColor: '#DDF36B', borderRadius: 3 },
  passLink: { marginHorizontal: 17, marginTop: 10, borderRadius: 14, padding: 12, backgroundColor: '#E4EEE0', flexDirection: 'row', alignItems: 'center', gap: 10 }, passLinkLocked: { opacity: 0.76 }, passLinkIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#D4E5CE', alignItems: 'center', justifyContent: 'center' }, passLinkCopy: { flex: 1 }, passLinkTitle: { color: GREEN, fontWeight: '900', fontSize: 11 }, passLinkSubtitle: { color: '#657369', fontSize: 10, marginTop: 4 },
  guideCard: { marginHorizontal: 17, marginTop: 12, backgroundColor: '#FFFFFF', borderRadius: 15, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#193522', shadowOpacity: 0.07, shadowRadius: 7, elevation: 2 }, guideIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: '#EAF2E4', alignItems: 'center', justifyContent: 'center' }, guideCopy: { flex: 1 }, guideTitle: { color: GREEN, fontSize: 13, fontWeight: '900', letterSpacing: 0.5 }, guideSubtitle: { color: '#718075', fontSize: 12, marginTop: 4 },
  sectionHeader: { marginHorizontal: 19, marginTop: 22, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { color: GREEN, fontWeight: '900', fontSize: 13, letterSpacing: 0.55 }, sectionSubtitle: { color: '#718075', fontSize: 11, marginTop: 4 }, officeRow: { paddingHorizontal: 17, paddingBottom: 2, gap: 9 }, moreCard: { width: 82, minHeight: 139, justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: '#E5EEE3', borderRadius: 14 }, moreText: { color: GREEN, fontSize: 10, fontWeight: '800' },
  activityCard: { marginHorizontal: 17, marginTop: 19, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 15, shadowColor: '#193522', shadowOpacity: 0.06, shadowRadius: 7, elevation: 2 }, activityHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }, emptyActivity: { color: '#748077', fontSize: 12, lineHeight: 18, paddingVertical: 10 }, activityItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#EFF2ED' }, activityMark: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#EAF2E4', alignItems: 'center', justifyContent: 'center' }, activityCopy: { flex: 1 }, activityOffice: { color: '#28372C', fontSize: 12, fontWeight: '800' }, activityDescription: { color: '#718075', fontSize: 11, marginTop: 3 }, activityDate: { color: '#8A958B', fontSize: 9 }, bottomSpace: { height: 12 },
});
