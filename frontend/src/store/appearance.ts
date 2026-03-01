/**
 * Global appearance store — theme + density + accent colour.
 * Persists to localStorage. Applies class changes directly to <html>.
 * Uses the same useSyncExternalStore pattern as auth.ts — fully synchronous.
 */
import { useSyncExternalStore } from "react";

export type ThemeMode   = "light" | "dark" | "system";
export type Density     = "compact" | "default" | "comfortable";
export type AccentColor = "blue" | "violet" | "emerald" | "rose" | "orange";
export type FontSize    = "sm" | "md" | "lg";
export type SidebarStyle = "dark" | "light" | "branded";

export interface AppearanceSettings {
  theme: ThemeMode;
  density: Density;
  accent: AccentColor;
  fontSize: FontSize;
  sidebarStyle: SidebarStyle;
  reducedMotion: boolean;
  compactNumbers: boolean;
}

const LS_KEY = "grc_appearance_v1";

const DEFAULTS: AppearanceSettings = {
  theme: "light",
  density: "default",
  accent: "blue",
  fontSize: "md",
  sidebarStyle: "dark",
  reducedMotion: false,
  compactNumbers: false,
};

function readStorage(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeStorage(s: AppearanceSettings) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// ── DOM application ───────────────────────────────────────────────────────────

const ACCENT_CLASSES: Record<AccentColor, string> = {
  blue:    "accent-blue",
  violet:  "accent-violet",
  emerald: "accent-emerald",
  rose:    "accent-rose",
  orange:  "accent-orange",
};

function getSystemDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyToDOM(s: AppearanceSettings) {
  const html = document.documentElement;

  // Theme
  const isDark = s.theme === "dark" || (s.theme === "system" && getSystemDark());
  html.classList.toggle("dark", isDark);

  // Density
  html.classList.remove("density-compact", "density-default", "density-comfortable");
  html.classList.add(`density-${s.density}`);

  // Accent colour
  html.classList.remove(...Object.values(ACCENT_CLASSES));
  html.classList.add(ACCENT_CLASSES[s.accent]);

  // Font size
  const fontSizeMap: Record<FontSize, string> = { sm: "13px", md: "14px", lg: "15px" };
  html.style.fontSize = fontSizeMap[s.fontSize];

  // Reduced motion
  if (s.reducedMotion) {
    html.style.setProperty("--tw-transition-duration", "0ms");
  } else {
    html.style.removeProperty("--tw-transition-duration");
  }
}

// ── In-memory state + pub/sub ─────────────────────────────────────────────────

let _state: AppearanceSettings = readStorage();
applyToDOM(_state); // apply immediately on module load

type Listener = () => void;
const _listeners = new Set<Listener>();

function _notify() {
  queueMicrotask(() => _listeners.forEach(fn => fn()));
}

export const appearanceStore = {
  get(): AppearanceSettings {
    return _state;
  },
  set(patch: Partial<AppearanceSettings>) {
    _state = { ..._state, ...patch };
    writeStorage(_state);
    applyToDOM(_state);
    _notify();
  },
  reset() {
    _state = { ...DEFAULTS };
    writeStorage(_state);
    applyToDOM(_state);
    _notify();
  },
  subscribe(fn: Listener): () => void {
    _listeners.add(fn);
    // Also re-apply when system colour scheme changes
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSysChange = () => { applyToDOM(_state); _notify(); };
    mq.addEventListener("change", onSysChange);
    return () => {
      _listeners.delete(fn);
      mq.removeEventListener("change", onSysChange);
    };
  },
};

// ── React hook ────────────────────────────────────────────────────────────────

export function useAppearance(): [AppearanceSettings, (patch: Partial<AppearanceSettings>) => void] {
  const state = useSyncExternalStore(
    appearanceStore.subscribe.bind(appearanceStore),
    () => appearanceStore.get(),
    () => appearanceStore.get(),
  );
  return [state, appearanceStore.set.bind(appearanceStore)];
}
