import { StatusBar } from 'expo-status-bar';
import { AuthNavigator } from './src/navigation/AuthNavigator.js';
import { AuthProvider } from './src/context/AuthContext.js';

/** Optional auth overrides for host integrations; production defaults use Supabase. */
export default function App({ authActions = {} }) {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <AuthNavigator authActions={authActions} />
    </AuthProvider>
  );
}
