import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { fetchStudentRequest } from '../../api/studentApi.js';
import { supabase } from '../../api/supabase.js';
import { OFFICES, normalizeOfficeName } from '../../constants/offices.js';
import { OfficeCard } from '../../components/OfficeCard.js';
import { isOfficeUnlocked } from '../../utils/clearanceRules.js';
import { useAuth } from '../../context/AuthContext.js';


export function OfficesListScreen({ navigation }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [request, setRequest] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const result = userId ? await fetchStudentRequest(userId) : null;
      setRequest(result);
      setItems(result?.clearance_items || []);
    } catch (cause) {
      setError(cause?.message || 'Could not load your office checklist.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    const requestId = request?.id;
    if (!supabase || !userId || !requestId) return undefined;

    const channel = supabase.channel(`student-office-checklist-${requestId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'clearance_items',
        filter: `clearance_request_id=eq.${requestId}`,
      }, () => load(true))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [request?.id, userId, load]);

  const itemForOffice = (office) => {
    const matching = items.filter((item) => item.office_code === office.code
      || normalizeOfficeName(item.office_name) === normalizeOfficeName(office.name));
    return matching.find((item) => String(item.status || '').toUpperCase() === 'APPROVED') || matching[0];
  };
  const approved = OFFICES.filter((office) => String(itemForOffice(office)?.status || '').toUpperCase() === 'APPROVED').length;
  const percentage = Math.round((approved / OFFICES.length) * 100);

  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <View style={styles.header}><Pressable onPress={() => navigation.goBack()} style={styles.back}><ArrowLeft size={21} color="#FFFFFF" /></Pressable><Text style={styles.headerTitle}>Office Checklist</Text><View style={styles.headerSpace} /></View>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#0D3B2E" />}>
      <View style={styles.progressCard}>
        <View style={styles.progressTop}><View><Text style={styles.eyebrow}>CLEARANCE PROGRESS</Text><Text style={styles.percent}>{percentage}% <Text style={styles.percentCaption}>completed</Text></Text></View><Text style={styles.count}>{approved}/{OFFICES.length}</Text></View>
        <View style={styles.track}><View style={[styles.fill, { width: `${percentage}%` }]} /></View>
        <Text style={styles.requirementCount}>{approved} out of {OFFICES.length} requirements cleared</Text>
        <Text style={styles.progressHint}>{request ? 'Your current clearance period' : 'No active clearance request found.'}</Text>
      </View>
      {loading ? <ActivityIndicator color="#0D3B2E" style={styles.loader} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {OFFICES.map((office, index) => {
        const item = itemForOffice(office);
        return <OfficeCard
          key={office.code}
          office={office}
          status={String(item?.status || 'PENDING').toUpperCase()}
          isLocked={!isOfficeUnlocked(office.code, items)}
          index={index}
          remark={item?.remarks || item?.remark}
          onPress={() => navigation.navigate('OfficeDetail', { office: office.name, officeCode: office.code, clearanceItem: item || null, requestId: request?.id })}
        />;
      })}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3F6F1' }, header: { height: 58, backgroundColor: '#0D3B2E', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }, back: { width: 40, height: 44, justifyContent: 'center' }, headerTitle: { flex: 1, color: '#FFFFFF', fontSize: 17, fontWeight: '800' }, headerSpace: { width: 30 }, content: { padding: 17, paddingBottom: 32 },
  progressCard: { backgroundColor: '#FFFFFF', borderRadius: 17, padding: 16, marginBottom: 14 }, progressTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, eyebrow: { color: '#728175', fontSize: 10, fontWeight: '900', letterSpacing: 0.8 }, percent: { color: '#0D3B2E', fontSize: 25, fontWeight: '900', marginTop: 4 }, percentCaption: { color: '#718075', fontSize: 13, fontWeight: '600' }, count: { color: '#0D3B2E', backgroundColor: '#E8F1E7', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, fontWeight: '900' }, track: { height: 8, backgroundColor: '#E6ECE5', borderRadius: 4, overflow: 'hidden', marginTop: 13 }, fill: { height: 8, backgroundColor: '#35A568', borderRadius: 4 }, requirementCount: { color: '#0D3B2E', fontSize: 12, fontWeight: '800', marginTop: 9 }, progressHint: { color: '#718075', fontSize: 11, marginTop: 5 }, loader: { marginVertical: 20 },
  error: { color: '#A5352B', backgroundColor: '#FCEAE7', borderRadius: 10, padding: 12, marginBottom: 10, fontSize: 12 },
});
