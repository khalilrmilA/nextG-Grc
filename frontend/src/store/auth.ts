export type UserRole = "admin" | "ciso" | "auditor" | "viewer" | "super_admin";
export type PlanTier = "free_trial" | "starter" | "professional" | "enterprise";

export interface AuthUser {
  email: string;
  name: string;
  role: UserRole;
  plan: PlanTier;
  daysRemaining?: number;
  org: string;
  accessToken?: string;
  refreshToken?: string;
  // Framework fields (populated after login via GET /auth/me)
  tenant_id?: string;
  primary_framework_id?: string | null;
  selected_framework_ids?: string[];
  org_size?: string | null;
  primary_assessment_id?: string | null;
}

export const PLAN_FEATURES: Record<PlanTier, {
  label: string;
  maxFrameworks: number;
  maxAdmins: number;
  maxIntegrations: number;
  modules: string[];
  settingsTabs: string[];
}> = {
  free_trial: {
    label: "Free Trial",
    maxFrameworks: 1,
    maxAdmins: 1,
    maxIntegrations: 0,
    modules: ["dashboard", "risks", "compliance"],
    settingsTabs: ["profile", "security"],
  },
  starter: {
    label: "Starter",
    maxFrameworks: 3,
    maxAdmins: 10,
    maxIntegrations: 25,
    modules: ["dashboard", "risks", "compliance", "frameworks", "audits", "policies"],
    settingsTabs: ["profile", "organization", "notifications", "security"],
  },
  professional: {
    label: "Professional",
    maxFrameworks: 10,
    maxAdmins: 50,
    maxIntegrations: 75,
    modules: ["dashboard", "risks", "compliance", "frameworks", "audits", "policies", "vendors"],
    settingsTabs: ["profile", "organization", "notifications", "security", "api"],
  },
  enterprise: {
    label: "Enterprise",
    maxFrameworks: 999,
    maxAdmins: 999,
    maxIntegrations: 999,
    modules: ["dashboard", "risks", "compliance", "frameworks", "audits", "policies", "vendors"],
    settingsTabs: ["profile", "organization", "notifications", "security", "api", "appearance"],
  },
};

export const DEMO_USERS: Record<string, AuthUser> = {
  "admin@demo.com": {
    email: "admin@demo.com",
    name: "Admin",
    role: "admin",
    plan: "enterprise",
    org: "Acme Corp",
  },
  "ciso@demo.com": {
    email: "ciso@demo.com",
    name: "Sophie Martin",
    role: "ciso",
    plan: "professional",
    org: "Acme Corp",
  },
  "auditor@demo.com": {
    email: "auditor@demo.com",
    name: "Jean Dupont",
    role: "auditor",
    plan: "starter",
    org: "Acme Corp",
  },
  "viewer@demo.com": {
    email: "viewer@demo.com",
    name: "Trial User",
    role: "viewer",
    plan: "free_trial",
    daysRemaining: 11,
    org: "Acme Corp",
  },
  "superadmin@platform.com": {
    email: "superadmin@platform.com",
    name: "Super Admin",
    role: "super_admin",
    plan: "enterprise",
    org: "Platform Owner",
  },
};

// ── Simple in-memory + localStorage auth store ──────────────────────────────
// Uses localStorage (not sessionStorage) so it persists across page refreshes.
// Uses a plain in-memory variable so React renders are synchronous.

const LS_KEY = "grc_user_v2";

function readStorage(): AuthUser | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function writeStorage(user: AuthUser | null) {
  try {
    if (user) {
      localStorage.setItem(LS_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(LS_KEY);
    }
  } catch { /* ignore */ }
}

// In-memory mirror — always in sync with localStorage
let _currentUser: AuthUser | null = readStorage();

type Listener = () => void;
const _listeners = new Set<Listener>();

function _notify() {
  // Use a microtask so React batches the update with the navigation
  queueMicrotask(() => _listeners.forEach(fn => fn()));
}

export const authSession = {
  getUser(): AuthUser | null {
    return _currentUser;
  },
  isLoggedIn(): boolean {
    return _currentUser !== null;
  },
  login(user: AuthUser) {
    _currentUser = user;
    writeStorage(user);
    _notify();
  },
  logout() {
    _currentUser = null;
    writeStorage(null);
    _notify();
  },
  subscribe(fn: Listener): () => void {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },
};

// ── React hook ────────────────────────────────────────────────────────────────

import { useSyncExternalStore } from "react";

export function useAuthStore<T>(selector: (user: AuthUser | null) => T): T {
  return useSyncExternalStore(
    authSession.subscribe.bind(authSession),
    () => selector(_currentUser),   // always reads in-memory, never sessionStorage
    () => selector(_currentUser),   // server snapshot = same (no SSR)
  );
}
