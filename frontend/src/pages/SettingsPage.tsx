import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  Settings, User, Bell, Shield, Globe, Palette,
  Save, Eye, EyeOff, Check, AlertTriangle,
  Lock, Crown, Trash2, Plus, Loader2, Zap,
  Sun, Moon, Monitor, RotateCcw, KeyRound,
  ChevronLeft, ChevronRight, Network, PlugZap, X,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore, hasAnyRole, PLAN_FEATURES, type PlanTier } from "../store/auth";
import { notificationsApi, authApi, directoryApi, usersApi, subscriptionsApi, type PlanUsage } from "../api/endpoints";
import { planDisplayName } from "../lib/plans";
import type { NotificationPreference, NotificationType, NotificationChannel } from "../types";
import { useAppearance, appearanceStore, type ThemeMode, type Density, type AccentColor, type FontSize, type SidebarStyle } from "../store/appearance";
import { useFramework } from "../context/FrameworkContext";
import AiAccessRequestDialog from "../components/features/ai/AiAccessRequestDialog";
import LicenseKeyModal from "../components/license/LicenseKeyModal";
import MfaPanel from "../components/MfaPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "profile" | "organization" | "framework" | "notifications" | "security" | "directory" | "ai-access" | "appearance" | "admin";

// ── Reusable primitives ───────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, type = "text", placeholder, disabled }: {
  value: string; onChange?: (v: string) => void;
  type?: string; placeholder?: string; disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 bg-white
                 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                 disabled:bg-gray-50 disabled:text-gray-400"
    />
  );
}

function Toggle({ enabled, onChange, label, description }: {
  enabled: boolean; onChange: (v: boolean) => void; label: string; description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors ${enabled ? "bg-blue-600" : "bg-gray-200"}`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-0.5 ${enabled ? "translate-x-4" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

function SaveBar({ onSave, saved }: { onSave: () => void; saved: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-end gap-3 pt-6 mt-6 border-t border-gray-100">
      {saved && (
        <span className="flex items-center gap-1.5 text-sm text-green-600">
          <Check className="w-4 h-4" /> {t("settings.saved")}
        </span>
      )}
      <button
        type="button"
        onClick={onSave}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        <Save className="w-4 h-4" />
        {t("settings.save_changes")}
      </button>
    </div>
  );
}

// Lock overlay for plan-gated tabs
function LockedOverlay({ requiredPlan }: { requiredPlan: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        <Lock className="w-6 h-6 text-gray-400" />
      </div>
      <h3 className="text-base font-semibold text-gray-800">{t("settings.feature_locked")}</h3>
      <p className="text-sm text-gray-500 mt-1 max-w-xs">
        {t("settings.feature_locked_desc", { plan: requiredPlan })}
      </p>
      <button
        type="button"
        className="mt-5 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
      >
        {t("settings.upgrade_plan")}
      </button>
    </div>
  );
}

// ── Tab: Framework ────────────────────────────────────────────────────────────

// PATCH /auth/me/frameworks is require_roles(CISO, COMPLIANCE_MANAGER,
// POLICY_MANAGER) — plus the tenant_admin / super_admin auto-pass. Every other
// role (viewer, executive, auditor, risk_manager …) can OPEN this tab, because
// ROUTE_ROLES["/framework"] is wider than the write gate, and used to get a
// silent 403: handleSave had try/finally with no catch, so the button spun and
// nothing happened, twice, forever.
const FRAMEWORK_WRITE_ROLES = ["tenant_admin", "super_admin", "ciso", "compliance_manager", "policy_manager"];

function FrameworkTab() {
  const { t } = useTranslation();
  const { primaryFramework, selectedFrameworks, allFrameworks, loading, saveFrameworks } = useFramework();
  const user = useAuthStore(u => u);
  // The scalar `role` is checked as well as the roles array, because the server
  // does: require_roles auto-passes on User.role for super_admin/tenant_admin,
  // and get_effective_roles falls back to the scalar role when `roles` is empty.
  // The live database holds an account whose scalar role is super_admin while
  // its roles array says ["viewer"] — reading the array alone would hide this
  // button from the one person the backend never refuses.
  const canSave =
    FRAMEWORK_WRITE_ROLES.includes(user?.role ?? "") || hasAnyRole(user, FRAMEWORK_WRITE_ROLES);

  const [primaryId, setPrimaryId] = useState<string>(() => primaryFramework?.id ?? "");
  const [secondaryIds, setSecondaryIds] = useState<string[]>(
    () => selectedFrameworks.filter(f => f.id !== primaryFramework?.id).map(f => f.id)
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [search, setSearch] = useState("");

  // Sync when context loads
  useEffect(() => {
    if (primaryFramework && !primaryId) setPrimaryId(primaryFramework.id);
    setSecondaryIds(selectedFrameworks.filter(f => f.id !== primaryFramework?.id).map(f => f.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryFramework, selectedFrameworks]);

  function toggleSecondary(id: string) {
    if (id === primaryId) return;
    setSecondaryIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function handleSave() {
    if (!primaryId) return;
    setSaving(true);
    setSaveError("");
    try {
      await saveFrameworks(primaryId, [primaryId, ...secondaryIds.filter(x => x !== primaryId)]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: unknown) {
      // A 403 here is the role gate, not a bug — say so instead of spinning.
      const status = (err as { response?: { status?: number } })?.response?.status;
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setSaveError(
        status === 403
          ? t("common.access_restricted_hint")
          : (typeof detail === "string" && detail) || t("errors.save_failed")
      );
    } finally {
      setSaving(false);
    }
  }

  const filtered = allFrameworks.filter(fw =>
    !search || fw.name.toLowerCase().includes(search.toLowerCase()) || fw.short_name.toLowerCase().includes(search.toLowerCase())
  );

  const primaryFw = allFrameworks.find(f => f.id === primaryId);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">{t("settings.framework_title")}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{t("settings.framework_subtitle")}</p>
      </div>

      {/* Summary */}
      {primaryFw && (
        <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-800">
          <strong>{t("settings.primary_label")}:</strong> {primaryFw.name} ({t("compliance.controls_count", { count: primaryFw.control_count })})
          {secondaryIds.length > 0 && (
            <span className="ml-2 text-blue-600">
              {t("settings.secondary_count", { count: secondaryIds.length })}
            </span>
          )}
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={t("settings.search_frameworks")}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      {/* Framework list */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
          {filtered.map(fw => {
            const isPrimary = fw.id === primaryId;
            const isSecondary = secondaryIds.includes(fw.id);
            return (
              <div
                key={fw.id}
                className={`relative rounded-xl border-2 p-3 transition-all ${
                  isPrimary ? "border-blue-500 bg-blue-50 shadow-sm"
                  : isSecondary ? "border-slate-400 bg-slate-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  {/* Radio — set primary */}
                  <button
                    type="button"
                    onClick={() => {
                      setPrimaryId(fw.id);
                      setSecondaryIds(prev => prev.filter(x => x !== fw.id));
                    }}
                    className="flex items-center gap-2 flex-1 text-left"
                  >
                    <div className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                      isPrimary ? "border-blue-500 bg-blue-500" : "border-gray-300"
                    }`}>
                      {isPrimary && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <span className="text-sm font-semibold text-gray-900 leading-tight">{fw.short_name}</span>
                  </button>

                  {/* Checkbox — add as secondary */}
                  {!isPrimary && (
                    <button
                      type="button"
                      onClick={() => toggleSecondary(fw.id)}
                      className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                        isSecondary ? "bg-slate-600 border-slate-600" : "border-gray-300 hover:border-slate-400"
                      }`}
                    >
                      {isSecondary && <Check className="w-3 h-3 text-white" />}
                    </button>
                  )}
                </div>

                <p className="text-xs text-gray-400 mt-1 ml-6">{t("compliance.controls_count", { count: fw.control_count })}</p>

                {isPrimary && (
                  <span className="ml-6 mt-1 inline-block text-xs font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                    {t("settings.primary_label")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {saveError && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {saveError}
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <p className="text-xs text-gray-400">{t("settings.framework_note")}</p>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-green-600">
              <Check className="w-4 h-4" /> {t("settings.saved")}
            </span>
          )}
          {canSave ? (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !primaryId}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? t("settings.saving") : t("settings.save_frameworks")}
            </button>
          ) : (
            /* No write gate client-side would just produce a 403 on click. */
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <Lock className="w-3.5 h-3.5" /> {t("common.access_restricted")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab: Profile ──────────────────────────────────────────────────────────────

// This tab used to be a form that saved nothing. Its Save button called
// `setSaved(true)` and NOTHING else — no request, no mutation — so the green
// "Saved" tick appeared and the edit was gone on the next reload; the fields
// were seeded with "Admin" / "admin@demo.com" when the store was empty, and the
// phone, timezone and language rows were invented settings with no column, no
// endpoint and no effect (the real language switcher is in the top bar, and the
// value shown here said "English" whatever the interface language was).
// There is no route to write them: auth.py exposes only /me/framework(s),
// /change-password and /logout — no PATCH /auth/me. So the tab now shows the
// real account, read-only, and says who can change it. Wiring an editable
// profile needs a backend route first (see needs_integration).
function ProfileTab() {
  const { t } = useTranslation();
  const roleLabel = (role: string) => String(t(`company_admin.roles.${role}_label` as never, role));
  const planLabel = (plan: PlanTier) => String(t(`plan.${plan}` as never, PLAN_FEATURES[plan].label));
  const user = useAuthStore(u => u);
  const nameParts = (user?.name ?? "").trim().split(/\s+/).filter(Boolean);
  const form = {
    firstName: nameParts[0] ?? "",
    lastName:  nameParts.slice(1).join(" "),
    email:     user?.email ?? "",
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">{t("settings.profile_title")}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{t("settings.profile_subtitle")}</p>
      </div>

      {/* Role badge */}
      <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm">
          {form.firstName.charAt(0)}
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800">{form.firstName} {form.lastName}</p>
          <p className="text-xs text-gray-500">{roleLabel(user?.role ?? "viewer")} · {planLabel(user?.plan ?? "free_trial")} · {user?.org}</p>
        </div>
        <span className="ml-auto px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-700">
          {roleLabel(user?.role ?? "viewer")}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label={t("settings.first_name")}>
          <Input value={form.firstName} disabled />
        </Field>
        <Field label={t("settings.last_name")}>
          <Input value={form.lastName} disabled />
        </Field>
      </div>
      <Field label={t("settings.email_address")}>
        <Input value={form.email} type="email" disabled />
      </Field>

      <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
        {t(
          "settings.profile_readonly",
          "Your name and email address are managed by your administrator. To change your password, use the Security tab.",
        )}
      </p>
    </div>
  );
}

// ── Tab: Notifications ────────────────────────────────────────────────────────

// Rows we show in the UI (subset of all NotificationType values).
// The English text is the t() FALLBACK, not the rendered string: these labels
// were the last bare-English block on this page and stayed English in French
// and Arabic. Keys land in en/fr/ar under notif_pref.* (see needs_integration);
// until they do the fallback keeps today's wording exactly.
const EMAIL_ROWS: { type: NotificationType; label: string; description: string }[] = [
  { type: "risk_new",              label: "New risk created",       description: "When a new risk is added to the register" },
  { type: "risk_overdue",          label: "Risk treatment overdue", description: "When a risk treatment deadline passes" },
  { type: "audit_assigned",        label: "Audit assigned to me",   description: "When you are assigned as lead auditor" },
  { type: "audit_due",             label: "Audit due in 7 days",    description: "Reminder before audit deadline" },
  { type: "policy_review_due",     label: "Policy review due",      description: "When a policy is due for review" },
  { type: "vendor_alert",          label: "Vendor risk alert",      description: "When a vendor risk score increases significantly" },
  { type: "weekly_digest",         label: "Weekly GRC digest",      description: "Summary of open risks, upcoming audits, policy gaps" },
  { type: "compliance_score_drop", label: "Compliance score drop",  description: "When your compliance score drops by more than 5%" },
];

const INAPP_ROWS: { type: NotificationType; label: string }[] = [
  { type: "risk_new",          label: "New risk created" },
  { type: "audit_assigned",    label: "Audit assigned to me" },
  { type: "policy_review_due", label: "Policy review due" },
  { type: "vendor_alert",      label: "Vendor risk alert" },
  { type: "compliance_score_drop", label: "Compliance score drop" },
];

function prefKey(type: NotificationType, channel: NotificationChannel) {
  return `${type}::${channel}`;
}

function NotificationsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // Load preferences from backend; fall back to all-enabled defaults on error
  const { data: prefs, isLoading, isError } = useQuery({
    queryKey: ["notif-prefs"],
    queryFn: notificationsApi.getPreferences,
    retry: false,
  });

  // Build a lookup map: "type::channel" → enabled
  const prefMap: Record<string, boolean> = {};
  if (prefs) {
    for (const p of prefs) {
      prefMap[prefKey(p.notification_type, p.channel)] = p.enabled;
    }
  }

  // Local overrides (changes the user has made but not yet saved)
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);

  function isEnabled(type: NotificationType, channel: NotificationChannel): boolean {
    const k = prefKey(type, channel);
    if (k in overrides) return overrides[k];
    if (k in prefMap) return prefMap[k];
    return true; // default ON
  }

  function toggle(type: NotificationType, channel: NotificationChannel) {
    const k = prefKey(type, channel);
    setOverrides(prev => ({ ...prev, [k]: !isEnabled(type, channel) }));
  }

  const saveMutation = useMutation({
    mutationFn: (preferences: NotificationPreference[]) =>
      notificationsApi.updatePreferences(preferences),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notif-prefs"] });
      setOverrides({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  function save() {
    // Collect all changed preferences to send
    const toSave: NotificationPreference[] = Object.entries(overrides).map(([key, enabled]) => {
      const [notification_type, channel] = key.split("::") as [NotificationType, NotificationChannel];
      return { notification_type, channel, enabled };
    });
    if (toSave.length === 0) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      return;
    }
    saveMutation.mutate(toSave);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">{t("settings.notif_title")}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{t("settings.notif_subtitle")}</p>
        {isError && (
          <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> {t("settings.notif_backend_offline")}
          </p>
        )}
      </div>

      {/* Email notifications */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <p className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <Globe className="w-4 h-4 text-blue-500" /> {t("settings.email_notifications")}
        </p>
        {EMAIL_ROWS.map(({ type, label, description }) => (
          <Toggle
            key={type}
            enabled={isEnabled(type, "email")}
            onChange={() => toggle(type, "email")}
            label={String(t(`notif_pref.${type}` as never, label))}
            description={String(t(`notif_pref.${type}_desc` as never, description))}
          />
        ))}
      </div>

      {/* In-app notifications */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <p className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <Bell className="w-4 h-4 text-blue-500" /> {t("settings.inapp_notifications")}
        </p>
        {INAPP_ROWS.map(({ type, label }) => (
          <Toggle
            key={type}
            enabled={isEnabled(type, "in_app")}
            onChange={() => toggle(type, "in_app")}
            label={String(t(`notif_pref.${type}` as never, label))}
          />
        ))}
      </div>

      <SaveBar onSave={save} saved={saved} />
    </div>
  );
}

// ── Tab: Security ─────────────────────────────────────────────────────────────

const SESSIONS_PAGE_SIZE = 10;

function SecurityTab() {
  const { t } = useTranslation();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew]         = useState(false);
  const [pw, setPw]   = useState({ current: "", next: "", confirm: "" });
  const [sessions, setSessions] = useState<any[]>([]);
  const [sessLoading, setSessLoading] = useState(true);
  const [revoking, setRevoking] = useState("");
  const [sessPage, setSessPage] = useState(1);
  const [saved, setSaved] = useState(false);
  const [pwError, setPwError] = useState("");
  const [saving, setSaving] = useState(false);

  async function savePassword() {
    if (!pw.current || !pw.next || pw.next !== pw.confirm) return;
    setSaving(true);
    setPwError("");
    try {
      const { authApi } = await import("../api/endpoints");
      await authApi.changePassword(pw.current, pw.next);
      setSaved(true);
      setPw({ current: "", next: "", confirm: "" });
      setTimeout(() => setSaved(false), 2500);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setPwError(msg || t("settings.err_password_update"));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    let alive = true;
    authApi.listSessions()
      .then((s: any[]) => { if (alive) setSessions(Array.isArray(s) ? s : []); })
      .catch(() => { if (alive) setSessions([]); })
      .finally(() => { if (alive) setSessLoading(false); });
    return () => { alive = false; };
  }, []);

  async function revokeSession(id: string) {
    setRevoking(id);
    try {
      await authApi.revokeSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch { /* ignore */ } finally { setRevoking(""); }
  }

  function relTime(iso?: string | null) {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    // The active-sessions list is the one place on this page that still printed
    // bare English ("Just now", "3h ago") in the French and Arabic UI.
    if (diff < 60_000) return String(t("activity_log.time_just_now"));
    const m = Math.floor(diff / 60_000);
    if (m < 60) return String(t("settings.rel_minutes_ago", "{{count}}m ago", { count: m }));
    const h = Math.floor(m / 60);
    if (h < 24) return String(t("settings.rel_hours_ago", "{{count}}h ago", { count: h }));
    return String(t("settings.rel_days_ago", "{{count}}d ago", { count: Math.floor(h / 24) }));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">{t("settings.security_title")}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{t("settings.security_subtitle")}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <p className="text-sm font-semibold text-gray-800">{t("settings.change_password_title")}</p>
        <Field label={t("settings.current_password")}>
          <div className="relative">
            <Input value={pw.current} onChange={v => setPw(p => ({ ...p, current: v }))} type={showCurrent ? "text" : "password"} placeholder="••••••••" />
            <button type="button" onClick={() => setShowCurrent(s => !s)} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>
        <Field label={t("settings.new_password")} hint={t("settings.new_password_hint")}>
          <div className="relative">
            <Input value={pw.next} onChange={v => setPw(p => ({ ...p, next: v }))} type={showNew ? "text" : "password"} placeholder="••••••••" />
            <button type="button" onClick={() => setShowNew(s => !s)} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>
        <Field label={t("settings.confirm_password")}>
          <Input value={pw.confirm} onChange={v => setPw(p => ({ ...p, confirm: v }))} type="password" placeholder="••••••••" />
          {pw.confirm && pw.next !== pw.confirm && (
            <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {t("settings.passwords_no_match")}</p>
          )}
        </Field>
        {pwError && (
          <p className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {pwError}</p>
        )}
        <div className="flex items-center justify-end gap-3 pt-2">
          {saved && <span className="flex items-center gap-1.5 text-sm text-green-600"><Check className="w-4 h-4" /> {t("settings.password_updated")}</span>}
          <button type="button" onClick={savePassword} disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
            {saving ? "Saving…" : t("settings.update_password")}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-semibold text-gray-800">{t("settings.two_factor_title", "Two-Factor Authentication")}</p>
        <p className="text-xs text-gray-400">{t("settings.two_factor_desc", "Protect your account with a time-based one-time password (TOTP) from an authenticator app.")}</p>
        <MfaPanel />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <p className="text-sm font-semibold text-gray-800 mb-3">{t("settings.active_sessions")}</p>
        <div className="space-y-3">
          {sessLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-2"><Loader2 className="w-4 h-4 animate-spin" /> {t("common.loading", "Loading…")}</div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">{t("settings.no_sessions", "No active sessions.")}</p>
          ) : (() => {
            const totalPages = Math.max(1, Math.ceil(sessions.length / SESSIONS_PAGE_SIZE));
            const page = Math.min(sessPage, totalPages);
            const pageItems = sessions.slice((page - 1) * SESSIONS_PAGE_SIZE, page * SESSIONS_PAGE_SIZE);
            return (
              <>
                {pageItems.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">
                        {s.device || t("settings.session_fallback")}{" "}
                        {s.current && <span className="ml-2 px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">{t("settings.current_session")}</span>}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {[s.ip_address, relTime(s.last_seen || s.created_at)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {!s.current && (
                      <button type="button" onClick={() => revokeSession(s.id)} disabled={revoking === s.id}
                        className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50 shrink-0">
                        {revoking === s.id ? t("common.loading", "…") : t("settings.revoke")}
                      </button>
                    )}
                  </div>
                ))}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <p className="text-xs text-gray-400">
                      {t("settings.sessions_page_info", { page, total: totalPages })}
                    </p>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setSessPage(page - 1)} disabled={page <= 1}
                        className="p-1 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent">
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button type="button" onClick={() => setSessPage(page + 1)} disabled={page >= totalPages}
                        className="p-1 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ── Tab: AI Access ────────────────────────────────────────────────────────────

function AiAccessTab() {
  // Every string below went through t() with an English default rather than a
  // bare literal: the keys do not exist in en/fr/ar yet (locale files are not
  // this lane's), so the fallback keeps today's wording and the tab becomes
  // translatable the moment the keys land. See needs_integration.
  const { t, i18n } = useTranslation();
  const [showRequestDialog, setShowRequestDialog] = useState(false);

  const { data: usage, isLoading: usageLoading } = useQuery({
    queryKey: ["auth", "ai-usage"],
    queryFn: authApi.getAiUsage,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["auth", "ai-access-status"],
    queryFn: authApi.getAiAccessStatus,
  });

  const isLoading = usageLoading || statusLoading;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">{t("ai_access.title", "AI Access & Usage")}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{t("ai_access.subtitle", "Manage your AI feature access and monitor token usage")}</p>
      </div>

      {/* Current Usage */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : usage ? (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-4">{t("ai_access.usage_title", "Token Usage This Month")}</h3>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">{t("ai_access.tokens", "Tokens")}</span>
                  <span className="text-sm font-medium text-gray-900">
                    {usage.tokens_used} / {usage.tokens_limit}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      usage.percentage_used >= 100
                        ? "bg-red-500"
                        : usage.percentage_used >= 80
                        ? "bg-orange-500"
                        : "bg-blue-500"
                    }`}
                    style={{ width: `${Math.min(usage.percentage_used, 100)}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">{t("ai_access.requests", "Requests")}</span>
                  <span className="text-sm font-medium text-gray-900">
                    {usage.requests_made} / {usage.requests_limit}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      (usage.requests_made / usage.requests_limit * 100) >= 100
                        ? "bg-red-500"
                        : (usage.requests_made / usage.requests_limit * 100) >= 80
                        ? "bg-orange-500"
                        : "bg-purple-500"
                    }`}
                    style={{ width: `${Math.min((usage.requests_made / usage.requests_limit * 100), 100)}%` }}
                  />
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-4">
              {t("ai_access.resets_on", "Resets on {{date}}", { date: new Date(usage.reset_at).toLocaleDateString(i18n.language === "ar" ? "ar-u-nu-latn" : i18n.language === "fr" ? "fr-FR" : "en-US") })}
            </p>
          </div>
        </div>
      ) : null}

      {/* Access Requests */}
      {status && status.requests.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-800">{t("ai_access.requests_title", "Access Requests")}</h3>
          <div className="space-y-3">
            {status.requests.map((req) => (
              <div key={req.id} className="flex items-start justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900 capitalize">{req.feature.replace("-", " ")}</p>
                  <p className="text-xs text-gray-500 mt-1">{req.reason}</p>
                </div>
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    req.status === "approved"
                      ? "bg-green-100 text-green-700"
                      : req.status === "denied"
                      ? "bg-red-100 text-red-700"
                      : "bg-yellow-100 text-yellow-700"
                  }`}
                >
                  {req.status === "denied" ? t("ai_access.status_denied") : String(t(`vocab.${req.status}` as never, req.status))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Request Button */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900">{t("ai_access.need_more", "Need More AI Access?")}</h3>
            <p className="text-xs text-gray-600 mt-1">
              {t("ai_access.need_more_desc", "Request access to additional AI features like document generation and intelligent analysis.")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowRequestDialog(true)}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          {t("ai_access.request_cta", "Request AI Access")}
        </button>
      </div>

      <AiAccessRequestDialog
        isOpen={showRequestDialog}
        onClose={() => setShowRequestDialog(false)}
        feature="all"
      />
    </div>
  );
}

// ── Tab: Appearance ───────────────────────────────────────────────────────────

// `label` is the t() fallback, not the rendered string — the accent swatch's
// tooltip and the sidebar previews were bare English (a title="" attribute
// included). Keys go under settings.accent_* / settings.sidebar_*.
const ACCENT_OPTIONS: { value: AccentColor; label: string; bg: string; ring: string }[] = [
  { value: "blue",    label: "Ocean Blue",    bg: "bg-blue-500",    ring: "ring-blue-500"    },
  { value: "violet",  label: "Violet",        bg: "bg-violet-500",  ring: "ring-violet-500"  },
  { value: "emerald", label: "Emerald",       bg: "bg-emerald-500", ring: "ring-emerald-500" },
  { value: "rose",    label: "Rose",          bg: "bg-rose-500",    ring: "ring-rose-500"    },
  { value: "orange",  label: "Amber",         bg: "bg-orange-500",  ring: "ring-orange-500"  },
];

const SIDEBAR_OPTIONS: { value: SidebarStyle; label: string; preview: string }[] = [
  { value: "dark",    label: "Dark",    preview: "bg-slate-900" },
  { value: "light",   label: "Light",   preview: "bg-white border border-gray-200" },
  { value: "branded", label: "Branded", preview: "bg-gradient-to-b from-blue-700 to-blue-900" },
];

function OptionCard({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative p-3 rounded-xl border-2 text-sm font-medium transition-all text-left w-full ${
        selected
          ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
          : "border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400 dark:hover:border-gray-500"
      }`}
    >
      {selected && <Check className="absolute top-2 right-2 w-3.5 h-3.5 text-blue-500" />}
      {children}
    </button>
  );
}

// ── Directory (Active Directory / LDAP) ──────────────────────────────────────
// The backend has always read this from Tenant.settings["ldap"], but nothing
// could write it: the key was missing from the settings whitelist, so a
// directory could only be configured by editing .env on the server. This tab
// is the administrator-facing half of that integration.

const LDAP_TEXT_FIELDS: { key: string; label: string; hint?: string; placeholder?: string }[] = [
  { key: "server_uri", label: "dir.f_server_uri", placeholder: "ldap://ad.example.com:389", hint: "dir.h_server_uri" },
  { key: "bind_dn", label: "dir.f_bind_dn", placeholder: "CN=grc-svc,OU=Services,DC=example,DC=com", hint: "dir.h_bind_dn" },
  { key: "user_search_base", label: "dir.f_search_base", placeholder: "OU=Users,DC=example,DC=com" },
  { key: "user_filter", label: "dir.f_user_filter", placeholder: "(sAMAccountName={username})", hint: "dir.h_user_filter" },
  { key: "default_email_domain", label: "dir.f_email_domain", placeholder: "example.com", hint: "dir.h_email_domain" },
];

const LDAP_ATTR_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: "attr_email", label: "dir.f_attr_email", placeholder: "mail" },
  { key: "attr_firstname", label: "dir.f_attr_first", placeholder: "givenName" },
  { key: "attr_lastname", label: "dir.f_attr_last", placeholder: "sn" },
  { key: "attr_groups", label: "dir.f_attr_groups", placeholder: "memberOf" },
];

function DirectoryTab() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<any | null>(null);
  const [form, setForm] = useState<any>({});
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [groupRows, setGroupRows] = useState<{ group: string; role: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [probe, setProbe] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);

  function hydrate(d: any) {
    setCfg(d);
    setForm({
      enabled: d.enabled, server_uri: d.server_uri, use_ssl: d.use_ssl, bind_dn: d.bind_dn,
      user_search_base: d.user_search_base, user_filter: d.user_filter,
      attr_email: d.attr_email, attr_firstname: d.attr_firstname,
      attr_lastname: d.attr_lastname, attr_groups: d.attr_groups,
      default_email_domain: d.default_email_domain, default_role: d.default_role,
      auto_create: d.auto_create,
    });
    setGroupRows(Object.entries(d.group_role_map || {}).map(([group, role]) => ({ group, role: String(role) })));
    setPassword("");
  }

  useEffect(() => {
    directoryApi.get()
      .then(hydrate)
      .catch((e: any) => setError(e?.response?.data?.detail || t("dir.e_load", "Could not load the directory settings.")))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function draftPayload(includePassword: boolean) {
    const map: Record<string, string> = {};
    for (const row of groupRows) {
      if (row.group.trim() && row.role.trim()) map[row.group.trim()] = row.role.trim();
    }
    const payload: Record<string, unknown> = { ...form, group_role_map: map };
    // Omitted entirely -> the server keeps the stored password. Only send it
    // when the administrator actually typed a new one.
    if (includePassword && password) payload.bind_password = password;
    return payload;
  }

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    try {
      const updated = await directoryApi.update(draftPayload(true));
      hydrate(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : t("dir.e_save", "Could not save the directory settings."));
    } finally { setSaving(false); }
  }

  async function runTest() {
    setTesting(true); setTestResult(null); setError("");
    try {
      setTestResult(await directoryApi.test({ probe_username: probe.trim() || null, draft: draftPayload(true) }));
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : t("dir.e_test", "The connection test could not be run."));
    } finally { setTesting(false); }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>;
  }

  const set = (key: string) => (v: any) => setForm({ ...form, [key]: v });
  const inherited = (key: string) => cfg && !(cfg.overridden_keys || []).includes(key);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Network className="w-5 h-5 text-blue-600" /> {t("dir.title", "Active Directory / LDAP")}
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {t("dir.subtitle", "Let people sign in with their directory account. Settings here apply to your organisation and override the server defaults.")}
        </p>
      </div>

      {cfg && !cfg.ldap3_installed && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 text-amber-800 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t("dir.no_ldap3", "The ldap3 library is not installed on this server, so directory sign-in cannot run. Settings can still be saved.")}</span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 text-red-700 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      <SectionCard title={t("dir.s_connection", "Connection")}>
        <Toggle
          enabled={!!form.enabled}
          onChange={set("enabled")}
          label={t("dir.t_enable", "Enable directory sign-in")}
          description={t("dir.t_enable_d", "Adds a directory login option to the sign-in screen for your organisation.")}
        />
        <Toggle
          enabled={!!form.use_ssl}
          onChange={set("use_ssl")}
          label={t("dir.t_ssl", "Use SSL (LDAPS)")}
          description={t("dir.t_ssl_d", "Encrypt the connection to the directory server.")}
        />
        {LDAP_TEXT_FIELDS.slice(0, 2).map((f) => (
          <Field key={f.key} label={t(f.label) + (inherited(f.key) ? t("dir.inherited", "  ·  inherited from server") : "")} hint={f.hint ? t(f.hint) : undefined}>
            <Input value={form[f.key] ?? ""} onChange={set(f.key)} placeholder={f.placeholder} />
          </Field>
        ))}
        <Field
          label={t("dir.f_password", "Service account password")}
          hint={cfg?.bind_password_set
            ? t("dir.h_password_set", "A password is stored. Leave blank to keep it, or type a new one to replace it.")
            : t("dir.h_password_unset", "No password stored. Leave blank to bind anonymously.")}
        >
          <div className="relative">
            <Input
              value={password}
              onChange={setPassword}
              type={showPassword ? "text" : "password"}
              placeholder={cfg?.bind_password_set ? "••••••••  (unchanged)" : ""}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>
        {LDAP_TEXT_FIELDS.slice(2).map((f) => (
          <Field key={f.key} label={t(f.label) + (inherited(f.key) ? t("dir.inherited", "  ·  inherited from server") : "")} hint={f.hint ? t(f.hint) : undefined}>
            <Input value={form[f.key] ?? ""} onChange={set(f.key)} placeholder={f.placeholder} />
          </Field>
        ))}
      </SectionCard>

      <SectionCard title={t("dir.s_attributes", "Directory attributes")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {LDAP_ATTR_FIELDS.map((f) => (
            <Field key={f.key} label={t(f.label)}>
              <Input value={form[f.key] ?? ""} onChange={set(f.key)} placeholder={f.placeholder} />
            </Field>
          ))}
        </div>
      </SectionCard>

      <SectionCard title={t("dir.s_accounts", "Accounts and roles")}>
        <Toggle
          enabled={!!form.auto_create}
          onChange={set("auto_create")}
          label={t("dir.t_autocreate", "Create an account on first sign-in")}
          description={t("dir.t_autocreate_d", "Off means only people who already have an account here can use directory sign-in.")}
        />
        <Field label={t("dir.f_default_role", "Default role")} hint={t("dir.h_default_role", "Used when no directory group maps to a role.")}>
          <select
            value={form.default_role ?? ""}
            onChange={(e) => set("default_role")(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {(cfg?.assignable_roles || []).map((r: string) => (
              <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
            ))}
          </select>
        </Field>

        <div>
          <p className="text-sm font-medium text-gray-700 mb-1">{t("dir.s_group_map", "Group to role mapping")}</p>
          <p className="text-xs text-gray-400 mb-3">
            {t("dir.h_group_map", "A directory group grants a role here. Write the group name (GRC_RSSI) or its full DN. When someone belongs to several mapped groups, the most privileged role wins.")}
          </p>
          <div className="space-y-2">
            {groupRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={row.group}
                  onChange={(e) => setGroupRows(groupRows.map((r, j) => (j === i ? { ...r, group: e.target.value } : r)))}
                  placeholder={t("dir.ph_group", "Directory group")}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-gray-300">&rarr;</span>
                <select
                  value={row.role}
                  onChange={(e) => setGroupRows(groupRows.map((r, j) => (j === i ? { ...r, role: e.target.value } : r)))}
                  className="w-52 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">{t("dir.ph_role", "Select a role…")}</option>
                  {(cfg?.assignable_roles || []).map((r: string) => (
                    <option key={r} value={r}>{r.replace(/_/g, " ")}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setGroupRows(groupRows.filter((_, j) => j !== i))}
                  className="p-2 text-gray-400 hover:text-red-600"
                  aria-label={t("dir.a_remove", "Remove mapping")}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setGroupRows([...groupRows, { group: "", role: "" }])}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800"
            >
              <Plus className="w-4 h-4" /> {t("dir.a_add", "Add a mapping")}
            </button>
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t("dir.s_test", "Test the connection")}>
        <p className="text-xs text-gray-400 -mt-1">
          {t("dir.h_test", "Tries what is on screen against the directory. Nothing is saved and nobody is signed in.")}
        </p>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[14rem]">
            <Field label={t("dir.f_probe", "Directory username to look up (optional)")} hint={t("dir.h_probe", "Proves the filter and the group mapping, not just that the server answers.")}>
              <Input value={probe} onChange={setProbe} placeholder="jdupont" />
            </Field>
          </div>
          <button
            type="button"
            onClick={runTest}
            disabled={testing}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />} {t("dir.a_test", "Test connection")}
          </button>
        </div>

        {testResult && (
          <div className="mt-2 rounded-xl border border-gray-100 divide-y divide-gray-50">
            {(testResult.steps || []).map((st: any, i: number) => (
              <div key={i} className="flex items-start gap-2.5 px-3 py-2.5">
                {st.ok
                  ? <Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                  : <X className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 capitalize">{st.step}</p>
                  {st.detail && <p className="text-xs text-gray-500 break-words">{st.detail}</p>}
                </div>
              </div>
            ))}
            {testResult.user_found && (
              <div className="px-3 py-2.5 text-xs text-gray-600">
                <p className="font-medium text-gray-800 mb-1">{t("dir.r_entry", "Directory entry")}</p>
                <p className="break-all">{testResult.user_found.dn}</p>
                <p>{testResult.user_found.first_name} {testResult.user_found.last_name} · {testResult.user_found.email || t("dir.r_no_email", "no email attribute")}</p>
                {(testResult.groups || []).length > 0 && (
                  <p className="mt-1 break-all">{t("dir.r_groups", "Groups:")} {testResult.groups.slice(0, 8).join(", ")}{testResult.groups.length > 8 ? ` +${testResult.groups.length - 8} more` : ""}</p>
                )}
                <p className="mt-1">
                  {t("dir.r_role", "Role on sign-in:")} <span className="font-medium text-gray-800">{(testResult.mapped_role || form.default_role || "").replace(/_/g, " ")}</span>
                  {!testResult.mapped_role && t("dir.r_role_default", " (default — no group matched)")}
                </p>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <div className="flex items-center justify-end gap-3 pt-2">
        {saved && <span className="flex items-center gap-1.5 text-sm text-green-600"><Check className="w-4 h-4" /> {t("settings.saved", "Saved")}</span>}
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {t("settings.save_changes", "Save changes")}
        </button>
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
      <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{title}</p>
      {children}
    </div>
  );
}

function AppearanceTab() {
  const { t } = useTranslation();
  const [ap, set] = useAppearance();
  const [saved, setSaved] = useState(false);

  // Changes are applied live; "save" just shows confirmation (already persisted)
  function handleSet(patch: Parameters<typeof set>[0]) {
    set(patch);
  }

  function save() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function reset() {
    appearanceStore.reset();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t("settings.appearance_title")}</h2>
          <p className="text-sm text-gray-500 mt-0.5">{t("settings.appearance_subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          <RotateCcw className="w-3 h-3" /> {t("settings.reset_defaults")}
        </button>
      </div>

      {/* ── Color theme ── */}
      <SectionCard title={t("settings.color_theme")}>
        <div className="grid grid-cols-3 gap-3">
          {([
            { value: "light",  label: t("settings.themes.light"),  Icon: Sun     },
            { value: "dark",   label: t("settings.themes.dark"),   Icon: Moon    },
            { value: "system", label: t("settings.themes.system"), Icon: Monitor },
          ] as { value: ThemeMode; label: string; Icon: typeof Sun }[]).map(({ value, label, Icon }) => (
            <OptionCard key={value} selected={ap.theme === value} onClick={() => handleSet({ theme: value })}>
              <div className="flex flex-col items-center gap-2 py-1">
                {/* Mini preview */}
                <div className={`w-full h-10 rounded-lg overflow-hidden border ${
                  value === "dark"   ? "bg-slate-800 border-slate-600" :
                  value === "system" ? "bg-gradient-to-r from-white to-slate-800 border-gray-300" :
                                       "bg-white border-gray-200"
                }`}>
                  <div className={`h-3 w-full ${value === "dark" ? "bg-slate-900" : value === "system" ? "bg-gradient-to-r from-slate-900 to-slate-700" : "bg-slate-900"}`} />
                  <div className="flex gap-1 p-1">
                    <div className={`flex-1 h-2 rounded ${value === "dark" ? "bg-slate-600" : value === "system" ? "bg-gradient-to-r from-gray-200 to-slate-600" : "bg-gray-200"}`} />
                    <div className={`flex-1 h-2 rounded ${value === "dark" ? "bg-slate-700" : "bg-gray-100"}`} />
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </div>
              </div>
            </OptionCard>
          ))}
        </div>
      </SectionCard>

      {/* ── Accent colour ── */}
      <SectionCard title={t("settings.accent_color_title")}>
        <div className="flex flex-wrap gap-3">
          {ACCENT_OPTIONS.map(({ value, label, bg, ring }) => (
            <button
              key={value}
              type="button"
              title={String(t(`settings.accent_${value}` as never, label))}
              aria-label={String(t(`settings.accent_${value}` as never, label))}
              onClick={() => handleSet({ accent: value })}
              className={`w-9 h-9 rounded-full ${bg} transition-all ${
                ap.accent === value ? `ring-2 ring-offset-2 ${ring} scale-110` : "opacity-70 hover:opacity-100 hover:scale-105"
              }`}
            />
          ))}
        </div>
        <p className="text-xs text-gray-400">
          {t("settings.accent_current")} <span className="font-medium text-gray-600 dark:text-gray-300">{String(t(`settings.accent_${ap.accent}` as never, ap.accent))}</span>
        </p>
      </SectionCard>

      {/* ── Font size ── */}
      <SectionCard title={t("settings.font_size")}>
        <div className="grid grid-cols-3 gap-3">
          {([
            { value: "sm", label: t("settings.font_small"),   preview: "text-xs" },
            { value: "md", label: t("settings.font_default"),  preview: "text-sm" },
            { value: "lg", label: t("settings.font_large"),    preview: "text-base" },
          ] as { value: FontSize; label: string; preview: string }[]).map(({ value, label, preview }) => (
            <OptionCard key={value} selected={ap.fontSize === value} onClick={() => handleSet({ fontSize: value })}>
              <div className="flex flex-col items-center gap-1 py-1">
                <span className={`${preview} font-semibold text-gray-700 dark:text-gray-300`}>Aa</span>
                <span className="text-xs text-gray-500">{label}</span>
              </div>
            </OptionCard>
          ))}
        </div>
      </SectionCard>

      {/* ── Density ── */}
      <SectionCard title={t("settings.density_title")}>
        <div className="grid grid-cols-3 gap-3">
          {([
            { value: "compact",     label: t("settings.density_compact"),     rows: [2, 2, 2, 2] },
            { value: "default",     label: t("settings.density_default"),     rows: [3, 3, 3]    },
            { value: "comfortable", label: t("settings.density_comfortable"), rows: [4, 4]       },
          ] as { value: Density; label: string; rows: number[] }[]).map(({ value, label, rows }) => (
            <OptionCard key={value} selected={ap.density === value} onClick={() => handleSet({ density: value })}>
              <div className="flex flex-col items-center gap-1.5 py-1">
                <div className="flex flex-col gap-0.5 w-full px-1">
                  {rows.map((h, i) => (
                    <div key={i} className="flex gap-1">
                      <div className={`rounded bg-gray-200 dark:bg-gray-600`} style={{ height: h, width: "30%" }} />
                      <div className={`rounded bg-gray-100 dark:bg-gray-700 flex-1`} style={{ height: h }} />
                    </div>
                  ))}
                </div>
                <span className="text-xs text-gray-500">{label}</span>
              </div>
            </OptionCard>
          ))}
        </div>
      </SectionCard>

      {/* ── Sidebar style ── */}
      <SectionCard title={t("settings.sidebar_title")}>
        <div className="grid grid-cols-3 gap-3">
          {SIDEBAR_OPTIONS.map(({ value, label, preview }) => (
            <OptionCard key={value} selected={ap.sidebarStyle === value} onClick={() => handleSet({ sidebarStyle: value })}>
              <div className="flex flex-col items-center gap-1.5 py-1">
                <div className={`w-full h-12 rounded-lg overflow-hidden flex`}>
                  <div className={`w-1/3 h-full ${preview}`} />
                  <div className="flex-1 bg-gray-50 dark:bg-gray-800 p-1 flex flex-col gap-0.5">
                    <div className="h-1.5 rounded bg-blue-500 w-3/4" />
                    <div className="h-1.5 rounded bg-gray-200 dark:bg-gray-600" />
                    <div className="h-1.5 rounded bg-gray-200 dark:bg-gray-600 w-2/3" />
                  </div>
                </div>
                <span className="text-xs text-gray-500">{String(t(`settings.sidebar_styles.${value}` as never, label))}</span>
              </div>
            </OptionCard>
          ))}
        </div>
      </SectionCard>

      {/* ── Extra toggles ── */}
      <SectionCard title={t("settings.accessibility_title")}>
        <Toggle
          enabled={ap.reducedMotion}
          onChange={v => handleSet({ reducedMotion: v })}
          label={t("settings.reduce_motion")}
          description={t("settings.reduce_motion_desc")}
        />
        <Toggle
          enabled={ap.compactNumbers}
          onChange={v => handleSet({ compactNumbers: v })}
          label={t("settings.compact_numbers")}
          description={t("settings.compact_numbers_desc")}
        />
      </SectionCard>

      {/* Save bar — mostly cosmetic since changes are live */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-700">
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-green-600">
            <Check className="w-4 h-4" /> {t("settings.preferences_saved")}
          </span>
        )}
        {!saved && <span />}
        <button
          type="button"
          onClick={save}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Save className="w-4 h-4" /> {t("settings.save_preferences")}
        </button>
      </div>
    </div>
  );
}

// ── Tab: Admin (admin-only) ───────────────────────────────────────────────────
//
// This tab used to render a hard-coded roster of five invented people
// ("Sophie Martin", "Jean Dupont", admin@demo.com …) with working-looking
// Invite / Suspend / Delete / change-role controls that only mutated local
// component state. Nothing was ever sent to the server and nothing was ever
// read from it, so an evaluator opening Settings saw five accounts that do not
// exist in the tenant — and could "delete" a user with no effect. One invented
// figure on screen puts every other number in the product in doubt, so the
// fabricated roster is gone.
//
// What replaces it is the real thing, read-only: GET /users for this tenant.
// Management (invite, roles, activate/deactivate, reset password, delete) is
// NOT duplicated here — it already exists, wired to the API, on /company-admin,
// and two half-implementations of user management is how the fake one appeared
// in the first place. This tab links there.

interface AdminUserRow {
  id: string; first_name: string; last_name: string; email: string;
  roles: string[]; effective_roles: string[]; is_active: boolean;
  expires_at?: string | null;
}

function AdminTab() {
  const { t } = useTranslation();
  const user = useAuthStore(u => u);
  // GET /users is require_roles(TENANT_ADMIN) server-side. The tab is only in
  // the nav for super_admin, but ?tab=admin is reachable by hand from any
  // account, so the gate is enforced on the content too — otherwise every role
  // sees an admin console it cannot use and a 403 it cannot read.
  const canRead = user?.role === "tenant_admin" || user?.role === "super_admin";

  const { data: users = [], isLoading, isError } = useQuery({
    queryKey: ["settings", "users"],
    queryFn: usersApi.list,
    enabled: canRead,
    retry: false,
  });

  if (!canRead) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
        <Lock className="w-8 h-8 text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-semibold text-gray-800">{t("common.access_restricted")}</p>
        <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">{t("common.access_restricted_hint")}</p>
      </div>
    );
  }

  const rows = users as AdminUserRow[];
  const activeCount = rows.filter(u => u.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Crown className="w-4 h-4 text-yellow-500" /> {t("company_admin.title")}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">{t("company_admin.subtitle")}</p>
        </div>
        {/* Management lives on /company-admin — this tab deliberately does not
            duplicate it. A plain <a> keeps this file free of a router import. */}
        <a
          href="/company-admin"
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> {t("company_admin.invite_member")}
        </a>
      </div>

      {isError && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {t("company_admin.err_load")}
        </div>
      )}

      {/* Roster — read-only, straight from the API */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-400">
            {isError ? t("dashctl.not_available") : t("company_admin.no_members")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {[t("settings.col_user"), t("settings.col_role"), t("settings.col_status")].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(u => {
                const fullName = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email;
                const roleList = (u.effective_roles?.length ? u.effective_roles : u.roles) ?? [];
                return (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {fullName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-800">{fullName}</p>
                          <p className="text-xs text-gray-400">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {roleList.length === 0
                          ? <span className="text-xs text-gray-400">{t("company_admin.group_no_roles")}</span>
                          : roleList.map(r => (
                            <span key={r} className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">
                              {String(t(`company_admin.roles.${r}_label` as never, r))}
                            </span>
                          ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${u.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                        {u.is_active ? t("company_admin.active") : t("company_admin.inactive")}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Stats — counted from the rows actually returned, never invented */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t("company_admin.total_members"), value: rows.length,                 color: "text-gray-800" },
          { label: t("company_admin.active"),        value: activeCount,                 color: "text-green-600" },
          { label: t("company_admin.inactive"),      value: rows.length - activeCount,   color: "text-gray-500" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{isLoading || isError ? "—" : value}</p>
            <p className="text-xs text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

// Which plan tier is required to unlock each tab
const TAB_MIN_PLAN: Partial<Record<Tab, PlanTier>> = {
  organization:  "starter",
  notifications: "starter",
};

const PLAN_ORDER: PlanTier[] = ["free_trial", "starter", "professional", "enterprise", "elite"];

function planAllows(userPlan: PlanTier, required: PlanTier): boolean {
  return PLAN_ORDER.indexOf(userPlan) >= PLAN_ORDER.indexOf(required);
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const user    = useAuthStore(u => u);
  const isAdmin = user?.role === "ciso";
  const isSuperAdmin = user?.role === "super_admin";
  const canManageLicense = user?.role === "tenant_admin" || user?.role === "super_admin";
  const plan    = user?.plan ?? "free_trial";
  const [licenseOpen, setLicenseOpen] = useState(false);
  // Real package + quota usage (the stored `plan` is cosmetic). Silent on error.
  const [planUsage, setPlanUsage] = useState<PlanUsage | null>(null);
  useEffect(() => {
    if (!user?.role || user.role === "super_admin" || user.role === "auditor") return;
    let cancelled = false;
    subscriptionsApi.getUsage().then((u) => { if (!cancelled) setPlanUsage(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.role]);

  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const t = searchParams.get("tab");
    const valid: Tab[] = ["profile","framework","notifications","security","directory","ai-access","appearance","admin"];
    return valid.includes(t as Tab) ? (t as Tab) : "profile";
  });

  // Sync if URL changes
  useEffect(() => {
    const t = searchParams.get("tab");
    const valid: Tab[] = ["profile","framework","notifications","security","directory","ai-access","appearance","admin"];
    if (t && valid.includes(t as Tab)) setActiveTab(t as Tab);
  }, [searchParams]);

  const ALL_TABS: { id: Tab; icon: React.ElementType; label: string; adminOnly?: boolean; superAdminOnly?: boolean }[] = [
    { id: "profile",       icon: User,      label: t("settings.profile")            },
    { id: "framework",     icon: Shield,    label: t("settings.framework")          },
    { id: "notifications", icon: Bell,      label: t("settings.notifications")      },
    { id: "security",      icon: Shield,    label: t("settings.security")           },
    { id: "directory",     icon: Network,   label: t("settings.directory", "Directory (AD/LDAP)"), adminOnly: true },
    { id: "ai-access",     icon: Zap,       label: t("settings.ai_access", "AI Access") },
    { id: "appearance",    icon: Palette,   label: t("settings.appearance")         },
    { id: "admin",         icon: Crown,     label: t("settings.admin_panel"), superAdminOnly: true },
  ];

  // Admin Panel tab only visible to super_admin; regular admin uses /company-admin
  const visibleTabs = ALL_TABS.filter(t => {
    if ((t as { superAdminOnly?: boolean }).superAdminOnly) return isSuperAdmin;
    // Directory settings hold a service-account credential and the API gates
    // them to tenant_admin — showing the tab to anyone else only produces a 403.
    if (t.id === "directory") return canManageLicense;
    return true;
  });

  function tabContent(tab: Tab): React.ReactNode {
    // ?tab=<id> is honoured from the URL for ANY account, so the tab list is not
    // the gate — this is. Both tabs enforce their own role check inside as well;
    // this stops a non-admin even being offered a directory form that asks for a
    // service-account bind password before answering 403.
    if (!visibleTabs.some((v) => v.id === tab)) {
      return (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <Lock className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-gray-800">{t("common.access_restricted")}</p>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">{t("common.access_restricted_hint")}</p>
        </div>
      );
    }
    if (tab === "admin") return <AdminTab />;
    const required = TAB_MIN_PLAN[tab];
    if (required && !isAdmin && !planAllows(plan, required)) {
      return <LockedOverlay requiredPlan={String(t(`plan.${required}` as never, PLAN_FEATURES[required].label))} />;
    }
    if (tab === "profile")       return <ProfileTab />;
    if (tab === "framework")     return <FrameworkTab />;
    if (tab === "notifications") return <NotificationsTab />;
    if (tab === "security")      return <SecurityTab />;
    if (tab === "directory")     return <DirectoryTab />;
    if (tab === "ai-access")     return <AiAccessTab />;
    return <AppearanceTab />;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
          <Settings className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">{t("settings.title")}</h1>
          <p className="text-sm text-gray-500">{t("settings.subtitle")}</p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 md:gap-6">
        {/* Sidebar tabs — horizontal scroller on phones, side rail from md up */}
        <aside className="md:w-52 md:flex-shrink-0 min-w-0">
          <nav className="flex md:block gap-1 md:gap-0 md:space-y-0.5 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
            {visibleTabs.map(({ id, icon: Icon, label, superAdminOnly }) => {
              const required   = TAB_MIN_PLAN[id];
              const isLocked   = !isAdmin && !isSuperAdmin && required !== undefined && !planAllows(plan, required);
              const isActive   = activeTab === id;
              return (
                <button key={id} type="button" onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-2.5 md:w-full flex-shrink-0 whitespace-nowrap px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}>
                  <Icon className={`w-4 h-4 flex-shrink-0 ${superAdminOnly && !isActive ? "text-yellow-500" : ""}`} />
                  <span className="flex-1 text-left">{label}</span>
                  {isLocked && !isActive && <Lock className="w-3 h-3 text-gray-400" />}
                  {superAdminOnly && <Crown className={`w-3 h-3 ${isActive ? "text-yellow-300" : "text-yellow-500"}`} />}
                </button>
              );
            })}
          </nav>

          {/* Plan info chip at bottom of settings nav */}
          <div className="mt-6 p-3 bg-gray-50 border border-gray-200 rounded-xl">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t("settings.current_plan_label")}</p>
            <p className="text-sm font-bold text-gray-800 mt-1">{planUsage
              ? planDisplayName(planUsage.plan_tier || planUsage.tier, t)
              : isAdmin ? `${t("roles.admin")} (${t("plan.enterprise")})` : String(t(`plan.${plan}` as never, PLAN_FEATURES[plan].label))}</p>
            {planUsage && user?.role === "tenant_admin" && (
              <ul className="mt-2 space-y-0.5 text-xs text-gray-500">
                {(["contributors", "frameworks", "vendors"] as const).map((k) => {
                  const max = planUsage.limits[k === "contributors" ? "max_contributors" : k === "frameworks" ? "max_frameworks" : "max_vendors"];
                  const flagged = planUsage.over_limit.includes(k) ? "text-red-600 font-semibold" : planUsage.near_limit.includes(k) ? "text-amber-600 font-semibold" : "";
                  return (
                    <li key={k} className={flagged}>
                      {max < 0
                        ? `${t(`plan_limits.item_${k}` as never, { used: planUsage.usage[k], max: "∞" })}`
                        : `${t(`plan_limits.item_${k}` as never, { used: planUsage.usage[k], max })}`}
                    </li>
                  );
                })}
              </ul>
            )}
            {plan === "free_trial" && !isAdmin && (
              <p className="text-xs text-orange-500 mt-0.5">{t("settings.days_remaining", { days: user?.daysRemaining ?? 14 })}</p>
            )}
            {!planUsage && !isAdmin && plan !== "enterprise" && (
              <p className="mt-2 text-xs text-gray-400">{String(t(`plan.${plan}` as never, PLAN_FEATURES[plan].label))}</p>
            )}
            {canManageLicense && (
              <button type="button" onClick={() => setLicenseOpen(true)}
                className="mt-3 flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors">
                <KeyRound className="w-3.5 h-3.5" /> {t("license.title")}
              </button>
            )}
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {tabContent(activeTab)}
        </div>
      </div>

      {canManageLicense && (
        <LicenseKeyModal open={licenseOpen} onClose={() => setLicenseOpen(false)} />
      )}
    </div>
  );
}
