import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  isConfigured: boolean;
  isPasswordRecovery: boolean;
  serverClockOffsetMs: number;
  getServerNowMs: () => number;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (params: {
    email: string;
    password: string;
    fullName: string;
  }) => Promise<{ error: string | null; needsEmailVerification: boolean }>;
  resendVerification: (email: string) => Promise<{ error: string | null }>;
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  clearPasswordRecovery: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState<boolean>(false);
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState<number>(0);

  const syncServerClock = useCallback(async () => {
    if (!supabase) return;
    try {
      const t0 = Date.now();
      const { data, error } = await supabase.rpc('get_server_now');
      const t1 = Date.now();
      if (!error && typeof data === 'string') {
        const serverMs = new Date(data).getTime();
        const clientMidMs = Math.round((t0 + t1) / 2);
        setServerClockOffsetMs(serverMs - clientMidMs);
      }
    } catch {
      // Fallback to 0 offset if RPC unavailable
    }
  }, []);

  const loadProfile = useCallback(async (userId: string) => {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.error('Failed to load user profile:', error.message);
      return null;
    }
    return (data as Profile | null) ?? null;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    const nextProfile = await loadProfile(user.id);
    setProfile(nextProfile);
  }, [loadProfile, user]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    let active = true;

    const init = async () => {
      try {
        const {
          data: { session: currentSession },
        } = await supabase!.auth.getSession();

        if (!active) return;
        setSession(currentSession);
        setUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          const [prof] = await Promise.all([
            loadProfile(currentSession.user.id),
            syncServerClock(),
          ]);
          if (active) setProfile(prof);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (nextSession?.user) {
        void (async () => {
          const [prof] = await Promise.all([
            loadProfile(nextSession.user.id),
            syncServerClock(),
          ]);
          if (active) setProfile(prof);
        })();
      } else {
        setProfile(null);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [loadProfile, syncServerClock]);

  const getServerNowMs = useCallback(
    () => Date.now() + serverClockOffsetMs,
    [serverClockOffsetMs],
  );

  const signIn = async (email: string, password: string) => {
    if (!supabase) return { error: 'Supabase is not configured.' };
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return { error: error ? error.message : null };
  };

  const signUp = async ({
    email,
    password,
    fullName,
  }: {
    email: string;
    password: string;
    fullName: string;
  }) => {
    if (!supabase) {
      return { error: 'Supabase is not configured.', needsEmailVerification: false };
    }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
        },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    if (error) {
      return { error: error.message, needsEmailVerification: false };
    }
    const needsEmailVerification = !data.session;
    return { error: null, needsEmailVerification };
  };

  const resendVerification = async (email: string) => {
    if (!supabase) return { error: 'Supabase is not configured.' };
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    return { error: error ? error.message : null };
  };

  const sendPasswordReset = async (email: string) => {
    if (!supabase) return { error: 'Supabase is not configured.' };
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error ? error.message : null };
  };

  const updatePassword = async (newPassword: string) => {
    if (!supabase) return { error: 'Supabase is not configured.' };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (!error) {
      setIsPasswordRecovery(false);
    }
    return { error: error ? error.message : null };
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
    setUser(null);
  };

  const clearPasswordRecovery = () => setIsPasswordRecovery(false);

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        profile,
        loading,
        isConfigured: isSupabaseConfigured,
        isPasswordRecovery,
        serverClockOffsetMs,
        getServerNowMs,
        signIn,
        signUp,
        resendVerification,
        sendPasswordReset,
        updatePassword,
        signOut,
        refreshProfile,
        clearPasswordRecovery,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
