import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, FileCheck2, FileText } from 'lucide-react-native';

export function RecentActivityScreen({ navigation, route }) {
  const activities = route.params?.activities || [];
  return <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
    <View style={styles.header}><Pressable onPress={() => navigation.goBack()} style={styles.back}><ArrowLeft size={21} color="#FFFFFF" /></Pressable><Text style={styles.headerTitle}>Recent Activity</Text></View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.intro}>Proof submissions and clearance updates for your account.</Text>
      {activities.length === 0 ? <View style={styles.empty}><FileCheck2 size={28} color="#809182" /><Text style={styles.emptyTitle}>Nothing to show yet</Text><Text style={styles.emptyText}>Activity appears here when you submit proof or an office updates your clearance.</Text></View> : activities.map((activity) => <View key={activity.id} style={styles.card}>
        <View style={styles.icon}><FileText size={18} color="#0D3B2E" /></View>
        <View style={styles.copy}><Text style={styles.office}>{activity.office}</Text><Text style={styles.description}>{activity.description}</Text><Text style={styles.date}>{activity.created_at ? new Date(activity.created_at).toLocaleString() : ''}</Text></View>
      </View>)}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F3F6F1' }, header: { height: 58, backgroundColor: '#0D3B2E', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }, back: { width: 40, justifyContent: 'center' }, headerTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' }, content: { padding: 17, paddingBottom: 30 }, intro: { color: '#718075', fontSize: 13, lineHeight: 19, marginBottom: 13 }, empty: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 23, alignItems: 'center', marginTop: 9 }, emptyTitle: { color: '#26372C', fontSize: 14, fontWeight: '900', marginTop: 12 }, emptyText: { color: '#718075', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 }, card: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 13, marginBottom: 9 }, icon: { width: 39, height: 39, borderRadius: 12, backgroundColor: '#E8F0E5', alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1 }, office: { color: '#26372C', fontSize: 13, fontWeight: '900' }, description: { color: '#56655A', fontSize: 12, marginTop: 4 }, date: { color: '#89938B', fontSize: 10, marginTop: 5 },
});
