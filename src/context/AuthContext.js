import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../api/supabase.js';
import { fetchStudentProfile } from '../api/studentApi.js';
import { fetchStaffAssignments } from '../api/authApi.js';

const AuthContext = createContext(null);

async function loadProfile(userId) {
  if (!supabase || !userId) return null;
  return fetchStudentProfile(userId);
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let profileRequest = 0;
    const updateFromSession = async (nextSession) => {
      const requestId = ++profileRequest;
      if (!active) return;
      setSession(nextSession || null);
      setUser(nextSession?.user || null);
      if (!nextSession?.user?.id) {
        setProfile(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const nextProfile = await loadProfile(nextSession.user.id);
        let authenticatedProfile = nextProfile;
        const accountStatus = String(nextProfile?.status || 'ACTIVE').toUpperCase();
        if (accountStatus !== 'ACTIVE') {
          if (active && requestId === profileRequest) await supabase.auth.signOut();
          return;
        }
        if (String(nextProfile?.role || '').toUpperCase() === 'STAFF') {
          const assignments = await fetchStaffAssignments(nextSession.user.id);
          const officeAssignment = assignments.find((assignment) => {
            const office = Array.isArray(assignment.offices) ? assignment.offices[0] : assignment.offices;
            return office?.code;
          }) || assignments[0];
          const office = Array.isArray(officeAssignment?.offices)
            ? officeAssignment.offices[0]
            : officeAssignment?.offices;
          const status = String(nextProfile.status || '').toUpperCase();
          const officeCode = office?.code || nextProfile.office_code || '';
          const hasOfficeAssignment = Boolean(officeCode);
          if (status !== 'ACTIVE' || !hasOfficeAssignment) {
            if (active && requestId === profileRequest) await supabase.auth.signOut();
            return;
          }
          authenticatedProfile = {
            ...nextProfile,
            office_code: officeCode,
            assigned_office_id: nextProfile.assigned_office_id || officeAssignment?.office_id || null,
            department_id: nextProfile.department_id || officeAssignment?.department_id || null,
          };
        } else if (String(nextSession.user?.user_metadata?.role || '').toUpperCase() === 'STAFF') {
          if (active && requestId === profileRequest) await supabase.auth.signOut();
          return;
        }
        if (active && requestId === profileRequest) setProfile(authenticatedProfile);
      } catch {
        if (active && requestId === profileRequest) {
          setProfile(null);
          if (String(nextSession.user?.user_metadata?.role || '').toUpperCase() === 'STAFF') {
            await supabase.auth.signOut();
          }
        }
      } finally {
        if (active && requestId === profileRequest) setLoading(false);
      }
    };

    if (!supabase) {
      Promise.resolve().then(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }

    supabase.auth.getSession().then(({ data, error }) => {
      if (!error) updateFromSession(data?.session || null);
      else if (active) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Defer profile queries until Supabase finishes notifying auth listeners.
      setTimeout(() => updateFromSession(nextSession), 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({
    session,
    user,
    profile,
    loading,
    setAuthenticatedProfile: setProfile,
    refreshProfile: async () => {
      const nextProfile = await loadProfile(user?.id);
      setProfile(nextProfile);
      return nextProfile;
    },
    signOut: async () => {
      if (!supabase) return;
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
  }), [session, user, profile, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
