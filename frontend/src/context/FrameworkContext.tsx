/**
 * FrameworkContext — global workspace framework state.
 *
 * Provides the active framework (name, short_name, id) to all modules.
 * Loaded once after login from the user profile + frameworks list.
 * Updated immediately when the user switches frameworks in Settings.
 */
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { authSession } from "../store/auth";
import { frameworksApi, authApi } from "../api/endpoints";
import type { Framework } from "@/types";

interface FrameworkContextValue {
  /** The active primary framework, or null if none set */
  primaryFramework: Framework | null;
  /** All frameworks the user has selected (primary + secondary) */
  selectedFrameworks: Framework[];
  /** All available frameworks (for the switcher dropdown) */
  allFrameworks: Framework[];
  /** True while loading */
  loading: boolean;
  /** Switch the workspace primary framework */
  switchFramework: (frameworkId: string) => Promise<void>;
  /** Save primary + full set of selected frameworks */
  saveFrameworks: (primaryId: string, selectedIds: string[]) => Promise<void>;
  /** Reload context (e.g. after login) */
  reload: () => void;
}

const FrameworkContext = createContext<FrameworkContextValue>({
  primaryFramework: null,
  selectedFrameworks: [],
  allFrameworks: [],
  loading: false,
  switchFramework: async () => {},
  saveFrameworks: async () => {},
  reload: () => {},
});

export function FrameworkProvider({ children }: { children: React.ReactNode }) {
  const [primaryFramework, setPrimaryFramework] = useState<Framework | null>(null);
  const [selectedFrameworks, setSelectedFrameworks] = useState<Framework[]>([]);
  const [allFrameworks, setAllFrameworks] = useState<Framework[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    const user = authSession.getUser();
    if (!user?.accessToken) return;

    let cancelled = false;
    setLoading(true);

    Promise.all([
      frameworksApi.list(),
      authApi.getProfile().catch(() => null),
    ]).then(([frameworks, profile]) => {
      if (cancelled) return;
      setAllFrameworks(frameworks);

      const primaryId = profile?.primary_framework_id ?? user.primary_framework_id;
      const selectedIds = profile?.selected_framework_ids ?? user.selected_framework_ids ?? [];

      if (primaryId) {
        const fw = frameworks.find(f => f.id === primaryId) ?? null;
        setPrimaryFramework(fw);
      } else {
        setPrimaryFramework(null);
      }

      const sel = frameworks.filter(f => selectedIds.includes(f.id));
      setSelectedFrameworks(sel);
    }).catch(() => {
      // ignore — context will show null
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [tick]);

  // Re-load when user logs in/out
  useEffect(() => {
    return authSession.subscribe(reload);
  }, [reload]);

  function _syncAuthStore(profile: { primary_framework_id: string | null; selected_framework_ids: string[]; primary_assessment_id: string | null }) {
    const current = authSession.getUser();
    if (current) {
      authSession.login({
        ...current,
        primary_framework_id: profile.primary_framework_id,
        selected_framework_ids: profile.selected_framework_ids,
        primary_assessment_id: profile.primary_assessment_id,
      });
    }
  }

  const switchFramework = useCallback(async (frameworkId: string) => {
    const profile = await authApi.updatePrimaryFramework(frameworkId);
    _syncAuthStore(profile);
    reload();
  }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveFrameworks = useCallback(async (primaryId: string, selectedIds: string[]) => {
    const profile = await authApi.updateSelectedFrameworks(primaryId, selectedIds);
    _syncAuthStore(profile);
    reload();
  }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <FrameworkContext.Provider value={{ primaryFramework, selectedFrameworks, allFrameworks, loading, switchFramework, saveFrameworks, reload }}>
      {children}
    </FrameworkContext.Provider>
  );
}

export function useFramework() {
  return useContext(FrameworkContext);
}
