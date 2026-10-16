import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchStudentRequest } from '../../api/studentApi.js';
import { supabase } from '../../api/supabase.js';
import { getOffice } from '../../constants/offices.js';
import { isOfficeUnlocked } from '../../utils/clearanceRules.js';
import { useAuth } from '../../context/AuthContext.js';
import { AccountingDetailScreen } from './offices/AccountingDetailScreen.js';
import { RegistrarDetailScreen } from './offices/RegistrarDetailScreen.js';
import { DeanDetailScreen } from './offices/DeanDetailScreen.js';
import { DirectorSASDetailScreen } from './offices/DirectorSASDetailScreen.js';
import { GuidanceDetailScreen } from './offices/GuidanceDetailScreen.js';
import { AdviserDetailScreen } from './offices/AdviserDetailScreen.js';
import { PropertyDetailScreen } from './offices/PropertyDetailScreen.js';
import { LibrarianDetailScreen } from './offices/LibrarianDetailScreen.js';
import { CouncilDetailScreen } from './offices/CouncilDetailScreen.js';
import { ClinicDetailScreen } from './offices/ClinicDetailScreen.js';

const OFFICE_SCREEN_BY_CODE = {
  ACCOUNTING: AccountingDetailScreen,
  REGISTRAR: RegistrarDetailScreen,
  DEAN: DeanDetailScreen,
  DIRECTOR_SAS: DirectorSASDetailScreen,
  GUIDANCE: GuidanceDetailScreen,
  ADVISER: AdviserDetailScreen,
  PROPERTY: PropertyDetailScreen,
  LIBRARIAN: LibrarianDetailScreen,
  COUNCIL: CouncilDetailScreen,
  CLINIC: ClinicDetailScreen,
};

export function OfficeDetailScreen({ navigation, route }) {
  const { user } = useAuth();
  const office = getOffice(route.params?.officeCode || route.params?.office);
  const OfficeScreen = office ? OFFICE_SCREEN_BY_CODE[office.code] : null;
  const [access, setAccess] = useState(office?.code === 'ACCOUNTING');
  const [checkingAccess, setCheckingAccess] = useState(office?.code !== 'ACCOUNTING');
  const requestId = route.params?.requestId || route.params?.clearanceItem?.clearance_request_id || route.params?.clearanceItem?.request_id;

  useFocusEffect(useCallback(() => {
    if (!office || office.code === 'ACCOUNTING') {
      setAccess(true);
      setCheckingAccess(false);
      return undefined;
    }
    let mounted = true;
    setCheckingAccess(true);
    fetchStudentRequest(user?.id)
      .then((request) => {
        if (mounted) setAccess(isOfficeUnlocked(office.code, request?.clearance_items || []));
      })
      .catch(() => { if (mounted) setAccess(false); })
      .finally(() => { if (mounted) setCheckingAccess(false); });
    return () => { mounted = false; };
  }, [office, user?.id]));

  useEffect(() => {
    if (!supabase || !user?.id || !requestId || !office || office.code === 'ACCOUNTING') return undefined;
    let mounted = true;
    const refreshOfficeAccess = async () => {
      try {
        const request = await fetchStudentRequest(user.id);
        if (mounted) setAccess(isOfficeUnlocked(office.code, request?.clearance_items || []));
      } catch (_error) {
        if (mounted) setAccess(false);
      } finally {
        if (mounted) setCheckingAccess(false);
      }
    };
    const channel = supabase.channel(`student-office-access-${requestId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'clearance_items',
        filter: `clearance_request_id=eq.${requestId}`,
      }, (payload) => {
        if (String(payload?.new?.office_code || '').toUpperCase() === 'ACCOUNTING'
          && payload?.new?.status === 'APPROVED') {
          setAccess(true);
          setCheckingAccess(false);
        }
        refreshOfficeAccess();
      })
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [office, requestId, user?.id]);

  if (checkingAccess) return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <View style={styles.header}><Pressable onPress={() => navigation.goBack()} style={styles.back}><ArrowLeft size={21} color="#FFFFFF" /></Pressable><Text style={styles.title}>Checking clearance access</Text></View>
    <View style={styles.messageCard}><ActivityIndicator color="#0D3B2E" /></View>
  </SafeAreaView>;

  if (office?.code !== 'ACCOUNTING' && !access) return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <View style={styles.header}><Pressable onPress={() => navigation.goBack()} style={styles.back}><ArrowLeft size={21} color="#FFFFFF" /></Pressable><Text style={styles.title}>{office?.name || 'Clearance Office'}</Text></View>
    <View style={styles.messageCard}><Text style={styles.messageTitle}>Accounting approval required</Text><Text style={styles.message}>Upload a photo of your physical Accounting Clearance Paper and wait for Accounting Staff approval before opening this office.</Text></View>
  </SafeAreaView>;

  if (OfficeScreen) return <OfficeScreen navigation={navigation} route={route} />;

  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <View style={styles.header}>
      <Pressable onPress={() => navigation.goBack()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back"><ArrowLeft size={21} color="#FFFFFF" /></Pressable>
      <Text style={styles.title}>Clearance Office</Text>
    </View>
    <View style={styles.messageCard}><Text style={styles.messageTitle}>Office not found</Text><Text style={styles.message}>Return to the checklist and select one of the configured signatory offices.</Text></View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3F6F1' },
  header: { height: 58, backgroundColor: '#0D3B2E', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  back: { width: 40, justifyContent: 'center' },
  title: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  messageCard: { margin: 17, padding: 17, borderRadius: 15, backgroundColor: '#FFFFFF' },
  messageTitle: { color: '#0D3B2E', fontSize: 16, fontWeight: '900' },
  message: { color: '#68766B', fontSize: 13, lineHeight: 19, marginTop: 6 },
});
