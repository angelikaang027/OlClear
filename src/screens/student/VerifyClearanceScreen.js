import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, BadgeCheck, BadgeX } from 'lucide-react-native';
import { supabase } from '../../api/supabase.js';

export function VerifyClearanceScreen({ navigation, route }) {
  const token = String(route.params?.token || '').trim();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const verify = useCallback(async () => {
    setLoading(true);
    setError('');
    setRecord(null);
    try {
      if (!token) throw new Error('This verification link does not contain a clearance reference.');
      if (!supabase) throw new Error('Clearance verification is unavailable. Check your connection and try again.');
      const { data, error: verifyError } = await supabase.functions.invoke('verify-clearance', { body: { token } });
      if (verifyError) throw verifyError;
      if (data?.error) throw new Error(data.error);
      setRecord(data?.record || null);
    } catch (cause) {
      setError(cause?.message || 'We could not verify this clearance pass.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => { verify(); }, [verify]));

  const valid = Boolean(record?.valid);
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={styles.back}><ArrowLeft size={21} color="#FFFFFF" /></Pressable><Text style={styles.headerTitle}>Clearance verification</Text></View>
    <View style={styles.content}>
      <View style={[styles.card, valid ? styles.validCard : styles.invalidCard]}>
        {loading ? <ActivityIndicator size="large" color="#1B6B3A" /> : valid ? <BadgeCheck size={48} color="#1B7B41" /> : <BadgeX size={48} color="#A5352B" />}
        <Text style={[styles.status, valid ? styles.validText : styles.invalidText]}>{loading ? 'VERIFYING' : valid ? 'VALID CLEARANCE' : 'NOT VERIFIED'}</Text>
        {loading ? <Text style={styles.message}>Checking the College clearance record…</Text> : valid ? <>
          <Text style={styles.detail}>Clearance period: {record.period || 'Not recorded'}</Text>
          <Text style={styles.detail}>Completed: {record.completedAt ? new Date(record.completedAt).toLocaleDateString() : 'Not recorded'}</Text>
          <Text style={styles.message}>This credential matches a completed clearance record. Match the person to the identity printed on their pass.</Text>
        </> : <Text style={styles.message}>{error || 'This credential is invalid, incomplete, or has been revoked.'}</Text>}
      </View>
      {!loading && !valid ? <Pressable onPress={verify} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable> : null}
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3F6F1' },
  header: { height: 58, backgroundColor: '#0D3B2E', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  back: { width: 40 },
  headerTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  content: { flex: 1, justifyContent: 'center', padding: 20 },
  card: { alignItems: 'center', borderWidth: 1, borderRadius: 20, padding: 24 },
  validCard: { backgroundColor: '#EFF8EF', borderColor: '#B6D9B8' },
  invalidCard: { backgroundColor: '#FFF5F3', borderColor: '#E8C4BE' },
  status: { fontSize: 15, fontWeight: '900', letterSpacing: 0.6, marginTop: 14 },
  validText: { color: '#1B6B3A' },
  invalidText: { color: '#A5352B' },
  detail: { color: '#526258', fontSize: 13, marginTop: 8, textAlign: 'center' },
  message: { color: '#68766B', fontSize: 13, lineHeight: 19, marginTop: 15, textAlign: 'center' },
  retry: { alignSelf: 'center', marginTop: 14, paddingHorizontal: 18, paddingVertical: 11, backgroundColor: '#0D3B2E', borderRadius: 10 },
  retryText: { color: '#FFFFFF', fontWeight: '800' },
});
