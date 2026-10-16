import { useEffect } from 'react';
import { Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { ArrowRight } from 'lucide-react-native';
import { useAuth } from '../../context/AuthContext.js';

export function LandingScreen({ navigation }) {
  const { user, profile, loading } = useAuth();

  useEffect(() => {
    if (loading || !user || !profile) return;
    const role = String(profile.role || '').toUpperCase();
    const route = role === 'ADMIN'
      ? 'AdminDashboard'
      : role === 'STAFF'
        ? String(profile.office_code || '').toUpperCase() === 'ACCOUNTING' ? 'AccountingStaff' : 'StaffOfficeQueue'
        : role === 'STUDENT' ? 'Home' : null;
    if (route) navigation.reset({ index: 0, routes: [{ name: route, params: { profile } }] });
  }, [loading, user, profile, navigation]);

  return <SafeAreaView style={styles.safe}>
    <StatusBar style="light" />
    <Svg style={StyleSheet.absoluteFill} viewBox="0 0 400 900" preserveAspectRatio="xMidYMid slice">
      <Defs>
        <LinearGradient id="backdrop" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#092D1B" />
          <Stop offset="0.43" stopColor="#45A96B" />
          <Stop offset="1" stopColor="#062A1B" />
        </LinearGradient>
        <LinearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#002916" stopOpacity="0.5" />
          <Stop offset="0.5" stopColor="#002916" stopOpacity="0.03" />
          <Stop offset="1" stopColor="#002916" stopOpacity="0.4" />
        </LinearGradient>
      </Defs>
      <Rect width="400" height="900" fill="url(#backdrop)" />
      {/* Simplified campus facade, tinted to match the reference photo treatment. */}
      <Path d="M0 52 400 4v264L0 222Z" fill="#B5D4B6" opacity="0.2" />
      <Path d="m0 54 400-48M0 92l400-46M0 214l400-44M0 230l400-43" stroke="#D5E4D0" strokeWidth="7" opacity="0.3" />
      <Path d="m22 103 46-5v87l-46 5zm67-7 47-6v88l-47 6zm69-8 48-6v88l-48 6zm70-8 49-6v88l-49 6zm72-9 47-5v87l-47 5" fill="#183C2A" opacity="0.5" />
      <Path d="M0 201 400 159M0 218 400 176" stroke="#D6E3D0" strokeWidth="5" opacity="0.25" />
      <Path d="m0 252 400-42v288L0 620Z" fill="#21834D" opacity="0.28" />
      <Path d="M0 0h400v900H0z" fill="url(#shade)" />
      {/* Angular lower panels echo the folded green shapes in the supplied reference. */}
      <Path d="M0 640 138 694q20 8 5 30L0 900Z" fill="#C3D6C1" opacity="0.19" />
      <Path d="m400 516-245 206q-20 17-1 34l246 144Z" fill="#A8C7A8" opacity="0.21" />
      <Path d="m400 516-245 206q-20 17-1 34" fill="none" stroke="#DCEBDD" strokeWidth="1.5" opacity="0.65" />
      <Path d="m0 900 142-176q15-19-5-29L0 660" fill="none" stroke="#DCEBDD" strokeWidth="1.5" opacity="0.55" />
    </Svg>

    <View style={styles.content}>
      <View style={styles.brandRow}>
        <View style={styles.logoFrame}><Image source={require('../../../assets/olclear-logo.png')} style={styles.logo} resizeMode="contain" /></View>
        <Text style={styles.brand}>OLClear</Text>
      </View>

      <View style={styles.intro}>
        <Text style={styles.headline}><Text style={styles.headlineAccent}>OLClear:</Text> WLC</Text>
        <Text style={styles.title}>ONLINE CLEARANCE</Text>
        <Text style={styles.tagline}>Fast, Paperless, and Accessible</Text>
        <View style={styles.divider} />
        <Text style={styles.description}>Complete your student clearance anytime, anywhere.</Text>
      </View>

      <View style={styles.actions}>
        <Pressable onPress={() => navigation.navigate('Login')} accessibilityRole="button" style={({ pressed }) => [styles.loginButton, pressed && styles.pressed]}>
          <Text style={styles.loginText}>Log In</Text><ArrowRight size={18} color="#153D25" strokeWidth={2.4} />
        </Pressable>
        <Pressable onPress={() => navigation.navigate('Register')} accessibilityRole="button" style={({ pressed }) => [styles.createButton, pressed && styles.createPressed]}>
          <Text style={styles.createText}>Create Account</Text>
        </Pressable>
    
      </View>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0A321F' },
  content: { flex: 1, justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 23, paddingBottom: 13 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logoFrame: { width: 38, height: 38, borderRadius: 11, backgroundColor: 'rgba(195,233,86,0.14)', borderWidth: 1, borderColor: 'rgba(195,233,86,0.45)', alignItems: 'center', justifyContent: 'center' },
  logo: { width: 33, height: 33 },
  brand: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', letterSpacing: 0.2, textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 7, textShadowOffset: { width: 0, height: 2 } },
  intro: { marginTop: 'auto', marginBottom: 'auto', paddingTop: 34, paddingBottom: 35 },
  headline: { color: '#FFFFFF', fontSize: 30, lineHeight: 36, fontWeight: '900', letterSpacing: -0.7, textShadowColor: 'rgba(0,0,0,0.27)', textShadowRadius: 8, textShadowOffset: { width: 0, height: 2 } },
  headlineAccent: { color: '#D4EB26' },
  title: { color: '#FFFFFF', fontSize: 18, lineHeight: 23, fontWeight: '800', letterSpacing: 0.8, marginTop: 1, textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 6 },
  tagline: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', marginTop: 12, textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 5 },
  divider: { height: 1, backgroundColor: 'rgba(216,233,75,0.7)', marginTop: 11, marginBottom: 8, width: '100%' },
  description: { color: '#F4FFF5', fontSize: 14, lineHeight: 21, maxWidth: 300, textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 5 },
  actions: { gap: 10 },
  loginButton: { minHeight: 51, borderRadius: 13, backgroundColor: '#D4EB26', paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  loginText: { color: '#153D25', fontSize: 16, fontWeight: '900' },
  createButton: { minHeight: 50, borderRadius: 13, borderWidth: 1.3, borderColor: 'rgba(255,255,255,0.88)', backgroundColor: 'rgba(5,45,25,0.22)', alignItems: 'center', justifyContent: 'center' },
  createText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.84, transform: [{ scale: 0.99 }] }, createPressed: { backgroundColor: 'rgba(255,255,255,0.12)' },
  version: { color: 'rgba(255,255,255,0.84)', fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 3 },
});
