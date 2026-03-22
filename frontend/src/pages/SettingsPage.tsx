import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import {
  Settings, User, Bell, Shield, Key, Globe, Palette,
  Building2, Save, Eye, EyeOff, Check, AlertTriangle,
  Lock, Crown, Trash2, Plus, ChevronDown, Loader2,
  Sun, Moon, Monitor, AlignJustify, RotateCcw,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore, PLAN_FEATURES, type PlanTier } from "../store/auth";
import { notificationsApi } from "../api/endpoints";
import type { NotificationPreference, NotificationType, NotificationChannel } from "../types";
import { useAppearance, appearanceStore, type ThemeMode, type Density, type AccentColor, type FontSize, type SidebarStyle } from "../store/appearance";
import { useFramework } from "../context/FrameworkContext";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "profile" | "organization" | "framework" | "notifications" | "security" | "api" | "appearance" | "admin";

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

function FrameworkTab() {
  const { t } = useTranslation();
  const { primaryFramework, selectedFrameworks, allFrameworks, loading, saveFrameworks } = useFramework();

  const [primaryId, setPrimaryId] = useState<string>(() => primaryFramework?.id ?? "");
  const [secondaryIds, setSecondaryIds] = useState<string[]>(
    () => selectedFrameworks.filter(f => f.id !== primaryFramework?.id).map(f => f.id)
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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
    try {
      await saveFrameworks(primaryId, [primaryId, ...secondaryIds.filter(x => x !== primaryId)]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
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
          <strong>Primary:</strong> {primaryFw.name} ({primaryFw.control_count} controls)
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

                <p className="text-xs text-gray-400 mt-1 ml-6">{fw.control_count} controls</p>

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

      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <p className="text-xs text-gray-400">{t("settings.framework_note")}</p>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-green-600">
              <Check className="w-4 h-4" /> {t("settings.saved")}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !primaryId}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? t("settings.saving") : t("settings.save_frameworks")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Profile ──────────────────────────────────────────────────────────────

function ProfileTab() {
  const { t } = useTranslation();
  const user = useAuthStore(u => u);
  const [form, setForm] = useState({
    firstName: user?.name.split(" ")[0] ?? "Admin",
    lastName:  user?.name.split(" ")[1] ?? "",
    email:     user?.email ?? "admin@demo.com",
    phone: "", timezone: "UTC+1 (Paris)", language: "English",
  });
  const [saved, setSaved] = useState(false);
  function save() { setSaved(true); setTimeout(() => setSaved(false), 2500); }

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
          <p className="text-xs text-gray-500 capitalize">{user?.role ?? "viewer"} · {PLAN_FEATURES[user?.plan ?? "free_trial"].label} · {user?.org}</p>
        </div>
        <span className="ml-auto px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-700 capitalize">
          {user?.role ?? "viewer"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label={t("settings.first_name")}>
          <Input value={form.firstName} onChange={v => setForm(f => ({ ...f, firstName: v }))} />
        </Field>
        <Field label={t("settings.last_name")}>
          <Input value={form.lastName} onChange={v => setForm(f => ({ ...f, lastName: v }))} />
        </Field>
      </div>
      <Field label={t("settings.email_address")}>
        <Input value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} type="email" />
      </Field>
      <Field label={t("settings.phone_number")} hint={t("settings.phone_hint")}>
        <Input value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="+33 6 00 00 00 00" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t("settings.timezone")}>
          <select value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {["UTC-8 (Los Angeles)", "UTC-5 (New York)", "UTC+0 (London)", "UTC+1 (Paris)", "UTC+3 (Riyadh)", "UTC+8 (Singapore)"].map(tz => (
              <option key={tz}>{tz}</option>
            ))}
          </select>
        </Field>
        <Field label={t("settings.language")}>
          <select value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {["English", "Français", "العربية", "Español", "Deutsch"].map(l => <option key={l}>{l}</option>)}
          </select>
        </Field>
      </div>
      <SaveBar onSave={save} saved={saved} />
    </div>
  );
}

// ── Tab: Organization ─────────────────────────────────────────────────────────

const PLAN_CARDS: { tier: PlanTier; price: string; features: string[] }[] = [
  { tier: "free_trial",   price: "Free",       features: ["1 framework", "1 admin",   "Dashboard + Risks + Compliance", "14-day trial"] },
  { tier: "starter",      price: "$6,000/yr",  features: ["3 frameworks", "10 admins", "All core modules", "25 integrations", "Email support"] },
  { tier: "professional", price: "$20,000/yr", features: ["10 frameworks", "50 admins", "All modules incl. Vendors", "75 integrations", "Priority support"] },
  { tier: "enterprise",   price: "Custom",     features: ["Unlimited frameworks", "Unlimited admins", "White-label", "Custom integrations", "Dedicated CSM"] },
];

function OrganizationTab() {
  const { t } = useTranslation();
  const user = useAuthStore(u => u);
  const currentPlan = user?.plan ?? "free_trial";
  const [form, setForm] = useState({
    name: user?.org ?? "Acme Corp", domain: "acme.com", industry: "Technology",
    size: "100–499", country: "France", vatNumber: "FR12345678901",
  });
  const [saved, setSaved]   = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  function save() { setSaved(true); setTimeout(() => setSaved(false), 2500); }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">{t("settings.org_title")}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{t("settings.org_subtitle")}</p>
      </div>

      {/* Current plan */}
      <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-blue-800">{PLAN_FEATURES[currentPlan].label}</p>
            <p className="text-xs text-blue-600 mt-0.5">
              {PLAN_FEATURES[currentPlan].maxFrameworks === 999
                ? t("settings.unlimited_frameworks")
                : `${PLAN_FEATURES[currentPlan].maxFrameworks} ${t("settings.frameworks_label")}`} ·{" "}
              {PLAN_FEATURES[currentPlan].maxAdmins === 999
                ? t("settings.unlimited_admins")
                : `${PLAN_FEATURES[currentPlan].maxAdmins} ${t("settings.admins_label")}`}
            </p>
          </div>
          <button type="button" onClick={() => setShowPlans(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors">
            {showPlans ? t("settings.hide_plans") : t("settings.change_plan")}
            <ChevronDown className={`w-3 h-3 transition-transform ${showPlans ? "rotate-180" : ""}`} />
          </button>
        </div>

        {showPlans && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {PLAN_CARDS.map(({ tier, price, features }) => {
              const isCurrent = tier === currentPlan;
              return (
                <div key={tier}
                  className={`p-3 rounded-xl border-2 transition-all ${isCurrent ? "border-blue-500 bg-white" : "border-gray-200 bg-white hover:border-blue-300"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-gray-800 capitalize">{PLAN_FEATURES[tier].label}</p>
                    {isCurrent && <span className="text-xs font-bold text-blue-600">{t("settings.current_plan_label")}</span>}
                  </div>
                  <p className="text-base font-bold text-gray-900 mb-2">{price}</p>
                  <ul className="space-y-1">
                    {features.map(f => (
                      <li key={f} className="flex items-start gap-1.5 text-xs text-gray-600">
                        <Check className="w-3 h-3 text-green-500 mt-0.5 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  {!isCurrent && (
                    <button type="button"
                      className="mt-3 w-full py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
                      {tier === "enterprise" ? t("settings.contact_sales") : t("settings.upgrade")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Field label={t("settings.org_name_label")}>
        <Input value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={t("settings.primary_domain")} hint={t("settings.domain_hint")}>
          <Input value={form.domain} onChange={v => setForm(f => ({ ...f, domain: v }))} placeholder="company.com" />
        </Field>
        <Field label={t("settings.vat_number")}>
          <Input value={form.vatNumber} onChange={v => setForm(f => ({ ...f, vatNumber: v }))} placeholder="FR00000000000" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Field label={t("settings.industry")}>
          <select value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {["Technology", "Finance & Banking", "Healthcare", "Retail", "Manufacturing", "Government", "Education", "Other"].map(i => <option key={i}>{i}</option>)}
          </select>
        </Field>
        <Field label={t("settings.company_size")}>
          <select value={form.size} onChange={e => setForm(f => ({ ...f, size: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {["1–9", "10–49", "50–99", "100–499", "500–999", "1000+"].map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label={t("settings.country")}>
          <select value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {["France", "United States", "United Kingdom", "Germany", "Saudi Arabia", "UAE", "Canada", "Other"].map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <SaveBar onSave={save} saved={saved} />
    </div>
  );
}

// ── Tab: Notifications ────────────────────────────────────────────────────────

// Rows we show in the UI (subset of all NotificationType values)
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
            label={label}
            description={description}
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
            label={label}
          />
        ))}
      </div>

      <SaveBar onSave={save} saved={saved} />
    </div>
  );
}

// ── Tab: Security ─────────────────────────────────────────────────────────────

function SecurityTab() {
  const { t } = useTranslation();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew]         = useState(false);
  const [pw, setPw]   = useState({ current: "", next: "", confirm: "" });
  const [mfa, setMfa] = useState(false);
  const [sessions]    = useState([
    { id: "1", device: "Chrome / Windows 11", location: "Paris, FR",  ip: "192.168.1.64", current: true,  last: "Now"         },
    { id: "2", device: "Safari / macOS",       location: "Lyon, FR",   ip: "10.0.0.5",    current: false, last: "2 days ago"  },
  ]);
  const [saved, setSaved] = useState(false);
  function savePassword() {
    if (!pw.current || !pw.next || pw.next !== pw.confirm) return;
    setSaved(true);
    setPw({ current: "", next: "", confirm: "" });
    setTimeout(() => setSaved(false), 2500);
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
        <div className="flex items-center justify-end gap-3 pt-2">
          {saved && <span className="flex items-center gap-1.5 text-sm text-green-600"><Check className="w-4 h-4" /> {t("settings.password_updated")}</span>}
          <button type="button" onClick={savePassword}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
            {t("settings.update_password")}
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-800">{t("settings.two_factor_title")}</p>
            <p className="text-xs text-gray-400 mt-0.5">{t("settings.two_factor_desc")}</p>
          </div>
          <button type="button" onClick={() => setMfa(v => !v)}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors ${mfa ? "bg-blue-600" : "bg-gray-200"}`}>
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-0.5 ${mfa ? "translate-x-4" : "translate-x-0.5"}`} />
          </button>
        </div>
        {mfa && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
            {t("settings.two_factor_setup")}
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <p className="text-sm font-semibold text-gray-800 mb-3">{t("settings.active_sessions")}</p>
        <div className="space-y-3">
          {sessions.map(s => (
            <div key={s.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <div>
                <p className="text-sm font-medium text-gray-800">
                  {s.device}{" "}
                  {s.current && <span className="ml-2 px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">{t("settings.current_session")}</span>}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{s.location} · {s.ip} · {s.last}</p>
              </div>
              {!s.current && (
                <button type="button" className="text-xs text-red-500 hover:text-red-700 font-medium">{t("settings.revoke")}</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Tab: API & Integrations ───────────────────────────────────────────────────

function ApiTab() {
  const { t } = useTranslation();
  const [keys, setKeys] = useState([
    { id: "1", name: "Production API Key", prefix: "grc_prod_••••••••••••••••", created: "2025-01-10", last_used: "Today" },
    { id: "2", name: "CI/CD Pipeline Key", prefix: "grc_cicd_••••••••••••••••", created: "2025-02-01", last_used: "3 days ago" },
  ]);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [integrations, setIntegrations] = useState([
    { name: "Jira",             desc: "Sync findings & risks as Jira issues",      connected: true  },
    { name: "Slack",            desc: "Send alerts and reports to Slack channels",  connected: false },
    { name: "Microsoft Teams",  desc: "GRC notifications in Teams",                connected: false },
    { name: "GitHub Actions",   desc: "Trigger compliance checks in CI/CD",         connected: true  },
    { name: "AWS Security Hub", desc: "Import findings from AWS",                   connected: false },
    { name: "Splunk / SIEM",    desc: "Forward audit logs to SIEM",                 connected: false },
  ]);

  function createKey() {
    if (!newName.trim()) return;
    setKeys(prev => [...prev, {
      id: String(Date.now()), name: newName.trim(),
      prefix: `grc_${newName.toLowerCase().replace(/\s+/g, "_").slice(0, 8)}_••••••••••••••••`,
      created: new Date().toISOString().split("T")[0], last_used: "Never",
    }]);
    setNewName("");
    setShowNew(false);
  }

  function toggleIntegration(name: string) {
    setIntegrations(prev => prev.map(i => i.name === name ? { ...i, connected: !i.connected } : i));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900">{t("settings.api_integrations")}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{t("settings.api_keys_title")}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-gray-800">{t("settings.api_keys")}</p>
          <button type="button" onClick={() => setShowNew(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
            <Key className="w-3 h-3" /> {t("settings.generate_key_btn")}
          </button>
        </div>
        {showNew && (
          <div className="mb-4 flex gap-2">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Key name (e.g. My App)"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button type="button" onClick={createKey}
              className="px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">{t("common.create")}</button>
            <button type="button" onClick={() => setShowNew(false)}
              className="px-3 py-2 text-gray-500 text-sm rounded-lg hover:bg-gray-100">{t("common.cancel")}</button>
          </div>
        )}
        <div className="space-y-3">
          {keys.map(k => (
            <div key={k.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <div>
                <p className="text-sm font-medium text-gray-800">{k.name}</p>
                <p className="text-xs font-mono text-gray-400 mt-0.5">{k.prefix}</p>
                <p className="text-xs text-gray-400 mt-0.5">Created {k.created} · Last used {k.last_used}</p>
              </div>
              <button type="button" onClick={() => setKeys(prev => prev.filter(x => x.id !== k.id))}
                className="text-xs text-red-500 hover:text-red-700 font-medium">{t("settings.revoke")}</button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <p className="text-sm font-semibold text-gray-800 mb-4">{t("settings.integrations")}</p>
        <div className="grid grid-cols-2 gap-3">
          {integrations.map(intg => (
            <div key={intg.name} className="flex items-start justify-between p-3 border border-gray-200 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-800">{intg.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{intg.desc}</p>
              </div>
              <button type="button" onClick={() => toggleIntegration(intg.name)}
                className={`ml-3 flex-shrink-0 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${
                  intg.connected
                    ? "bg-green-50 text-green-700 border-green-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200"
                }`}>
                {intg.connected ? t("settings.connected") : t("settings.connect")}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Tab: Appearance ───────────────────────────────────────────────────────────

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
              title={label}
              onClick={() => handleSet({ accent: value })}
              className={`w-9 h-9 rounded-full ${bg} transition-all ${
                ap.accent === value ? `ring-2 ring-offset-2 ${ring} scale-110` : "opacity-70 hover:opacity-100 hover:scale-105"
              }`}
            />
          ))}
        </div>
        <p className="text-xs text-gray-400">
          {t("settings.accent_current")} <span className="font-medium text-gray-600 dark:text-gray-300 capitalize">{ap.accent}</span>
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
                <span className="text-xs text-gray-500">{label}</span>
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

type DemoRole = "admin" | "ciso" | "auditor" | "viewer";
type DemoPlan = PlanTier;

interface ManagedUser {
  id: string; name: string; email: string;
  role: DemoRole; plan: DemoPlan; status: "active" | "invited" | "suspended";
  lastLogin: string;
}

const ROLE_BADGE: Record<DemoRole, string> = {
  admin:   "bg-yellow-100 text-yellow-700",
  ciso:    "bg-blue-100 text-blue-700",
  auditor: "bg-purple-100 text-purple-700",
  viewer:  "bg-gray-100 text-gray-600",
};

const STATUS_BADGE: Record<ManagedUser["status"], string> = {
  active:    "bg-green-100 text-green-700",
  invited:   "bg-orange-100 text-orange-700",
  suspended: "bg-red-100 text-red-600",
};

function AdminTab() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<ManagedUser[]>([
    { id: "1", name: "Admin",        email: "admin@demo.com",   role: "admin",   plan: "enterprise",   status: "active",    lastLogin: "Now"          },
    { id: "2", name: "Sophie Martin", email: "ciso@demo.com",    role: "ciso",    plan: "professional", status: "active",    lastLogin: "2 hours ago"  },
    { id: "3", name: "Jean Dupont",   email: "auditor@demo.com", role: "auditor", plan: "starter",      status: "active",    lastLogin: "Yesterday"    },
    { id: "4", name: "Trial User",    email: "viewer@demo.com",  role: "viewer",  plan: "free_trial",   status: "active",    lastLogin: "3 days ago"   },
    { id: "5", name: "Pending User",  email: "pending@demo.com", role: "viewer",  plan: "free_trial",   status: "invited",   lastLogin: "Never"        },
  ]);
  const [showInvite, setShowInvite] = useState(false);
  const [invite, setInvite]         = useState({ email: "", role: "viewer" as DemoRole, plan: "free_trial" as DemoPlan });

  function sendInvite() {
    if (!invite.email.trim()) return;
    setUsers(prev => [...prev, {
      id: String(Date.now()), name: invite.email.split("@")[0],
      email: invite.email.trim(), role: invite.role, plan: invite.plan,
      status: "invited", lastLogin: "Never",
    }]);
    setInvite({ email: "", role: "viewer", plan: "free_trial" });
    setShowInvite(false);
  }

  function toggleSuspend(id: string) {
    setUsers(prev => prev.map(u => u.id === id
      ? { ...u, status: u.status === "suspended" ? "active" : "suspended" }
      : u,
    ));
  }

  function removeUser(id: string) {
    setUsers(prev => prev.filter(u => u.id !== id));
  }

  function changeRole(id: string, role: DemoRole) {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, role } : u));
  }

  function changePlan(id: string, plan: DemoPlan) {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, plan } : u));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Crown className="w-4 h-4 text-yellow-500" /> {t("settings.admin_title")}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">{t("settings.admin_subtitle")}</p>
        </div>
        <button type="button" onClick={() => setShowInvite(v => !v)}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" /> {t("settings.invite_user")}
        </button>
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-blue-800">{t("settings.invite_new_user")}</p>
          <div className="grid grid-cols-3 gap-3">
            <input value={invite.email} onChange={e => setInvite(i => ({ ...i, email: e.target.value }))}
              placeholder="user@company.com" type="email"
              className="col-span-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
            <select value={invite.role} onChange={e => setInvite(i => ({ ...i, role: e.target.value as DemoRole }))}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="admin">Admin</option>
              <option value="ciso">CISO</option>
              <option value="auditor">Auditor</option>
              <option value="viewer">Viewer</option>
            </select>
            <select value={invite.plan} onChange={e => setInvite(i => ({ ...i, plan: e.target.value as DemoPlan }))}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="free_trial">Free Trial</option>
              <option value="starter">Starter</option>
              <option value="professional">Professional</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={sendInvite}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">{t("settings.send_invite")}</button>
            <button type="button" onClick={() => setShowInvite(false)}
              className="px-4 py-2 text-gray-600 text-sm rounded-lg hover:bg-gray-100">{t("common.cancel")}</button>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {[t("settings.col_user"), t("settings.col_role"), t("settings.col_plan"), t("settings.col_status"), t("settings.col_last_login"), t("settings.col_actions")].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {u.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-gray-800">{u.name}</p>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <select value={u.role} onChange={e => changeRole(u.id, e.target.value as DemoRole)}
                    className={`px-2 py-1 rounded-full text-xs font-semibold border-0 cursor-pointer ${ROLE_BADGE[u.role]}`}>
                    <option value="admin">Admin</option>
                    <option value="ciso">CISO</option>
                    <option value="auditor">Auditor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select value={u.plan} onChange={e => changePlan(u.id, e.target.value as DemoPlan)}
                    className="px-2 py-1 bg-gray-100 rounded-lg text-xs font-medium text-gray-600 border-0 cursor-pointer">
                    <option value="free_trial">Free Trial</option>
                    <option value="starter">Starter</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[u.status]}`}>
                    {u.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">{u.lastLogin}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => toggleSuspend(u.id)}
                      className={`text-xs font-medium transition-colors ${u.status === "suspended" ? "text-green-600 hover:text-green-700" : "text-orange-500 hover:text-orange-700"}`}>
                      {u.status === "suspended" ? t("settings.activate") : t("settings.suspend")}
                    </button>
                    <button type="button" onClick={() => removeUser(u.id)}
                      className="text-red-400 hover:text-red-600 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: t("settings.stat_total_users"), value: users.length,                                     color: "text-gray-800" },
          { label: t("settings.stat_active"),      value: users.filter(u => u.status === "active").length,   color: "text-green-600" },
          { label: t("settings.stat_invited"),     value: users.filter(u => u.status === "invited").length,  color: "text-orange-500" },
          { label: t("settings.stat_suspended"),   value: users.filter(u => u.status === "suspended").length, color: "text-red-500" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white border border-gray-200 rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
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
  api:           "professional",
  appearance:    "enterprise",
};

const PLAN_ORDER: PlanTier[] = ["free_trial", "starter", "professional", "enterprise"];

function planAllows(userPlan: PlanTier, required: PlanTier): boolean {
  return PLAN_ORDER.indexOf(userPlan) >= PLAN_ORDER.indexOf(required);
}

export default function SettingsPage() {
  const { t } = useTranslation();
  const user    = useAuthStore(u => u);
  const isAdmin = user?.role === "admin";
  const isSuperAdmin = user?.role === "super_admin";
  const plan    = user?.plan ?? "free_trial";

  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const t = searchParams.get("tab");
    const valid: Tab[] = ["profile","organization","framework","notifications","security","api","appearance","admin"];
    return valid.includes(t as Tab) ? (t as Tab) : "profile";
  });

  // Sync if URL changes
  useEffect(() => {
    const t = searchParams.get("tab");
    const valid: Tab[] = ["profile","organization","framework","notifications","security","api","appearance","admin"];
    if (t && valid.includes(t as Tab)) setActiveTab(t as Tab);
  }, [searchParams]);

  const ALL_TABS: { id: Tab; icon: React.ElementType; label: string; adminOnly?: boolean; superAdminOnly?: boolean }[] = [
    { id: "profile",       icon: User,      label: t("settings.profile")            },
    { id: "organization",  icon: Building2, label: t("settings.organization")       },
    { id: "framework",     icon: Shield,    label: t("settings.framework")          },
    { id: "notifications", icon: Bell,      label: t("settings.notifications")      },
    { id: "security",      icon: Shield,    label: t("settings.security")           },
    { id: "api",           icon: Key,       label: t("settings.api_integrations")   },
    { id: "appearance",    icon: Palette,   label: t("settings.appearance")         },
    { id: "admin",         icon: Crown,     label: t("settings.admin_panel"), superAdminOnly: true },
  ];

  // Admin Panel tab only visible to super_admin; regular admin uses /company-admin
  const visibleTabs = ALL_TABS.filter(t => {
    if ((t as { superAdminOnly?: boolean }).superAdminOnly) return isSuperAdmin;
    return true;
  });

  function tabContent(tab: Tab): React.ReactNode {
    if (tab === "admin") return <AdminTab />;
    const required = TAB_MIN_PLAN[tab];
    if (required && !isAdmin && !planAllows(plan, required)) {
      return <LockedOverlay requiredPlan={PLAN_FEATURES[required].label} />;
    }
    if (tab === "profile")       return <ProfileTab />;
    if (tab === "organization")  return <OrganizationTab />;
    if (tab === "framework")     return <FrameworkTab />;
    if (tab === "notifications") return <NotificationsTab />;
    if (tab === "security")      return <SecurityTab />;
    if (tab === "api")           return <ApiTab />;
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

      <div className="flex gap-6">
        {/* Sidebar tabs */}
        <aside className="w-52 flex-shrink-0">
          <nav className="space-y-0.5">
            {visibleTabs.map(({ id, icon: Icon, label, superAdminOnly }) => {
              const required   = TAB_MIN_PLAN[id];
              const isLocked   = !isAdmin && !isSuperAdmin && required !== undefined && !planAllows(plan, required);
              const isActive   = activeTab === id;
              return (
                <button key={id} type="button" onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
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
            <p className="text-sm font-bold text-gray-800 mt-1">{isAdmin ? "Admin (Enterprise)" : PLAN_FEATURES[plan].label}</p>
            {plan === "free_trial" && !isAdmin && (
              <p className="text-xs text-orange-500 mt-0.5">{t("settings.days_remaining", { days: user?.daysRemaining ?? 14 })}</p>
            )}
            {!isAdmin && plan !== "enterprise" && (
              <button type="button" onClick={() => setActiveTab("organization")}
                className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700">
                {t("settings.upgrade_arrow")}
              </button>
            )}
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {tabContent(activeTab)}
        </div>
      </div>
    </div>
  );
}
