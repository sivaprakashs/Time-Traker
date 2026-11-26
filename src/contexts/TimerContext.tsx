import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { computeEffectiveSeconds } from '@/lib/timezone';
import type { TimeEntryWithRelations } from '@/types/database';

interface TimerContextValue {
  activeTimer: TimeEntryWithRelations | null;
  elapsedSeconds: number;
  loading: boolean;
  mutating: boolean;
  refreshActiveTimer: () => Promise<void>;
  startTimer: (params: {
    projectId: string;
    taskId?: string | null;
    description?: string;
  }) => Promise<TimeEntryWithRelations>;
  pauseTimer: () => Promise<TimeEntryWithRelations>;
  resumeTimer: () => Promise<TimeEntryWithRelations>;
  stopTimer: (overrides?: {
    description?: string;
    projectId?: string;
    taskId?: string | null;
  }) => Promise<TimeEntryWithRelations>;
  updateActiveDetails: (patch: {
    description?: string;
    project_id?: string;
    task_id?: string | null;
  }) => Promise<void>;
}

const TimerContext = createContext<TimerContextValue | null>(null);

const TIMER_SELECT = `
  *,
  project:projects(id, name, code, color),
  task:tasks(id, title, status),
  profile:profiles(id, full_name, email, department, role)
`;

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, getServerNowMs } = useAuth();
  const [activeTimer, setActiveTimer] = useState<TimeEntryWithRelations | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [mutating, setMutating] = useState<boolean>(false);

  const fetchActiveTimer = useCallback(async () => {
    if (!supabase || !user || profile?.status !== 'active') {
      setActiveTimer(null);
      setElapsedSeconds(0);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('time_entries')
        .select(TIMER_SELECT)
        .eq('user_id', user.id)
        .in('status', ['running', 'paused'])
        .maybeSingle();

      if (error) {
        console.error('Failed to fetch active timer:', error.message);
        return;
      }

      const entry = (data as TimeEntryWithRelations | null) ?? null;
      setActiveTimer(entry);
      setElapsedSeconds(entry ? computeEffectiveSeconds(entry, getServerNowMs()) : 0);
    } finally {
      setLoading(false);
    }
  }, [getServerNowMs, profile?.status, user]);

  useEffect(() => {
    void fetchActiveTimer();
  }, [fetchActiveTimer]);

  // Realtime sync across tabs/sessions for this user's active timer
  useEffect(() => {
    if (!supabase || !user) return;
    const channel = supabase
      .channel(`timer-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'time_entries',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void fetchActiveTimer();
        },
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [fetchActiveTimer, user]);

  // Always recompute elapsed seconds from saved timestamps, never increment blindly
  useEffect(() => {
    if (!activeTimer) {
      setElapsedSeconds(0);
      return;
    }

    const syncTick = () => {
      setElapsedSeconds(computeEffectiveSeconds(activeTimer, getServerNowMs()));
    };

    syncTick();

    if (activeTimer.status !== 'running') {
      return;
    }

    const interval = window.setInterval(syncTick, 1000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncTick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', syncTick);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', syncTick);
    };
  }, [activeTimer, getServerNowMs]);

  const hydrateEntryById = async (id: string): Promise<TimeEntryWithRelations> => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase
      .from('time_entries')
      .select(TIMER_SELECT)
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as TimeEntryWithRelations;
  };

  const startTimer = async ({
    projectId,
    taskId = null,
    description = '',
  }: {
    projectId: string;
    taskId?: string | null;
    description?: string;
  }) => {
    if (!supabase) throw new Error('Supabase is not configured');
    setMutating(true);
    try {
      const { data, error } = await supabase.rpc('start_timer', {
        p_project_id: projectId,
        p_task_id: taskId || null,
        p_description: description,
      });
      if (error) throw new Error(error.message);
      const hydrated = await hydrateEntryById((data as { id: string }).id);
      setActiveTimer(hydrated);
      setElapsedSeconds(computeEffectiveSeconds(hydrated, getServerNowMs()));
      return hydrated;
    } finally {
      setMutating(false);
    }
  };

  const pauseTimer = async () => {
    if (!supabase || !activeTimer) throw new Error('No active timer');
    setMutating(true);
    try {
      const { data, error } = await supabase.rpc('pause_timer', {
        p_entry_id: activeTimer.id,
      });
      if (error) throw new Error(error.message);
      const hydrated = await hydrateEntryById((data as { id: string }).id);
      setActiveTimer(hydrated);
      setElapsedSeconds(computeEffectiveSeconds(hydrated, getServerNowMs()));
      return hydrated;
    } finally {
      setMutating(false);
    }
  };

  const resumeTimer = async () => {
    if (!supabase || !activeTimer) throw new Error('No active timer');
    setMutating(true);
    try {
      const { data, error } = await supabase.rpc('resume_timer', {
        p_entry_id: activeTimer.id,
      });
      if (error) throw new Error(error.message);
      const hydrated = await hydrateEntryById((data as { id: string }).id);
      setActiveTimer(hydrated);
      setElapsedSeconds(computeEffectiveSeconds(hydrated, getServerNowMs()));
      return hydrated;
    } finally {
      setMutating(false);
    }
  };

  const stopTimer = async (overrides?: {
    description?: string;
    projectId?: string;
    taskId?: string | null;
  }) => {
    if (!supabase || !activeTimer) throw new Error('No active timer');
    setMutating(true);
    try {
      const { data, error } = await supabase.rpc('stop_timer', {
        p_entry_id: activeTimer.id,
        p_description: overrides?.description ?? null,
        p_project_id: overrides?.projectId ?? null,
        p_task_id: overrides?.taskId ?? null,
      });
      if (error) throw new Error(error.message);
      const completed = await hydrateEntryById((data as { id: string }).id);
      setActiveTimer(null);
      setElapsedSeconds(0);
      return completed;
    } finally {
      setMutating(false);
    }
  };

  const updateActiveDetails = async (patch: {
    description?: string;
    project_id?: string;
    task_id?: string | null;
  }) => {
    if (!supabase || !activeTimer) return;
    const { data, error } = await supabase
      .from('time_entries')
      .update(patch)
      .eq('id', activeTimer.id)
      .select(TIMER_SELECT)
      .single();
    if (error) throw new Error(error.message);
    setActiveTimer(data as TimeEntryWithRelations);
  };

  return (
    <TimerContext.Provider
      value={{
        activeTimer,
        elapsedSeconds,
        loading,
        mutating,
        refreshActiveTimer: fetchActiveTimer,
        startTimer,
        pauseTimer,
        resumeTimer,
        stopTimer,
        updateActiveDetails,
      }}
    >
      {children}
    </TimerContext.Provider>
  );
}

export function useTimer() {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error('useTimer must be used within TimerProvider');
  return ctx;
}
