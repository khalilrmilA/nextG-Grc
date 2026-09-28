import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronRight, ChevronLeft, Check, Eye, EyeOff } from "lucide-react";
import { authApi } from "../api/endpoints";
import { frameworksApi } from "../api/endpoints";
import { authSession } from "../store/auth";
import FrameworkSelectionCard from "../components/features/compliance/FrameworkSelectionCard";
import AuthLayout from "../components/auth/AuthLayout";
import SEO from "../components/seo/SEO";
import type { Framework } from "@/types";

// Country display names are resolved at render time via Intl.DisplayNames in the UI language.
const COUNTRIES = ["US", "GB", "FR", "DE", "CA", "AU", "SA", "MA", "DZ", "TN", "AE", "SG"];

function countryName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

// Labels are i18n keys, resolved with t() where rendered.
const INDUSTRIES = [
  { value: "technology", label: "public.register.ind_technology" },
  { value: "financial", label: "public.register.ind_financial" },
  { value: "healthcare", label: "public.register.ind_healthcare" },
  { value: "government", label: "public.register.ind_government" },
  { value: "retail", label: "public.register.ind_retail" },
  { value: "manufacturing", label: "public.register.ind_manufacturing" },
  { value: "telecom", label: "public.register.ind_telecom" },
  { value: "energy", label: "public.register.ind_energy" },
  { value: "education", label: "public.register.ind_education" },
  { value: "legal", label: "public.register.ind_legal" },
];

const ORG_SIZES = [
  { value: "1-50", label: "1–50", sub: "public.register.size_startup" },
  { value: "51-200", label: "51–200", sub: "public.register.size_small" },
  { value: "201-1000", label: "201–1,000", sub: "public.register.size_mid" },
  { value: "1000+", label: "1,000+", sub: "public.register.size_enterprise" },
];

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  // i18n keys, resolved with t() where rendered
  const labels = ["", "public.register.pw_weak", "public.register.pw_fair", "public.register.pw_good", "public.register.pw_strong", "public.register.pw_very_strong"];
  const colors = ["", "bg-red-400", "bg-orange-400", "bg-yellow-400", "bg-green-400", "bg-emerald-500"];
  return { score, label: labels[score] || "", color: colors[score] || "" };
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(1);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [fwLoading, setFwLoading] = useState(false);

  // Track which fields the user has interacted with (to show inline errors only after touching)
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Step 1 fields
  const [form, setForm] = useState({
    first_name: "", last_name: "", email: "", password: "",
    organization_name: "", organization_slug: "",
    country: "", industry: "", org_size: "",
  });

  // Step 2 fields
  const [primaryFwId, setPrimaryFwId] = useState("");
  const [secondaryFwIds, setSecondaryFwIds] = useState<string[]>([]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setTouched((prev) => ({ ...prev, [k]: true }));
    setForm((f) => ({
      ...f,
      [k]: e.target.value,
      ...(k === "organization_name"
        ? { organization_slug: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") }
        : {}),
    }));
  };

  // Per-field inline validation — only shown after the field is touched
  const fieldErrors = {
    first_name: touched.first_name && !form.first_name ? t("public.register.err_first_name") : "",
    last_name: touched.last_name && !form.last_name ? t("public.register.err_last_name") : "",
    email: touched.email && !form.email ? t("public.register.err_email_required")
         : touched.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email) ? t("public.register.err_email_invalid") : "",
    password: touched.password && form.password.length === 0 ? t("public.register.err_password_required")
            : touched.password && form.password.length < 12 ? t("public.register.err_password_short", { count: form.password.length }) : "",
    organization_name: touched.organization_name && !form.organization_name ? t("public.register.err_org_required") : "",
  };

  // Load frameworks (public endpoint) when entering step 2
  useEffect(() => {
    if (step !== 2 || frameworks.length > 0) return;
    setFwLoading(true);
    frameworksApi.list()
      .then(setFrameworks)
      .catch(() => {/* ignore — show empty state */})
      .finally(() => setFwLoading(false));
  }, [step]);

  const pw = passwordStrength(form.password);
  const step1Valid = form.first_name && form.last_name && form.email && form.password.length >= 12 && form.organization_name;
  const step2Valid = !!primaryFwId;

  function toggleSecondary(id: string) {
    setSecondaryFwIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSubmit() {
    setLoading(true);
    setError("");
    try {
      // If slug is already taken the backend returns 400. Auto-suffix to make it unique.
      let slug = form.organization_slug;
      let tokens;
      try {
        tokens = await authApi.register({
          ...form,
          organization_slug: slug,
          primary_framework_id: primaryFwId || undefined,
          selected_framework_ids: primaryFwId
            ? [primaryFwId, ...secondaryFwIds.filter((x) => x !== primaryFwId)]
            : secondaryFwIds,
        });
      } catch (firstErr: any) {
        const detail: string = firstErr?.response?.data?.detail ?? "";
        if (detail.toLowerCase().includes("slug")) {
          // Append a 4-char random suffix and retry once
          slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
          tokens = await authApi.register({
            ...form,
            organization_slug: slug,
            primary_framework_id: primaryFwId || undefined,
            selected_framework_ids: primaryFwId
              ? [primaryFwId, ...secondaryFwIds.filter((x) => x !== primaryFwId)]
              : secondaryFwIds,
          });
        } else {
          throw firstErr;
        }
      }

      // Store tokens
      authSession.login({
        email: form.email,
        name: `${form.first_name} ${form.last_name}`.trim(),
        role: "ciso",
        plan: "free_trial",
        daysRemaining: 14,
        org: form.organization_name,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
      });

      // Enrich with profile (framework fields)
      try {
        const profile = await authApi.getProfile();
        const current = authSession.getUser();
        if (current) {
          authSession.login({
            ...current,
            tenant_id: profile.tenant_id,
            primary_framework_id: profile.primary_framework_id,
            selected_framework_ids: profile.selected_framework_ids,
            org_size: profile.org_size,
            primary_assessment_id: profile.primary_assessment_id,
            accessible_modules: profile.accessible_modules,
          });
        }
      } catch {/* profile enrichment is best-effort */}

      navigate("/dashboard");
    } catch (err: any) {
      // Log the full error to the browser console for debugging
      console.error("[Register] error", {
        status: err?.response?.status,
        data: err?.response?.data,
        message: err?.message,
      });
      const raw = err?.response?.data?.detail;
      // Pydantic 422 returns detail as an array of {loc, msg, type} objects
      const detail: string = Array.isArray(raw)
        ? raw.map((e: any) => `[${(e.loc ?? []).slice(1).join(".")}] ${e.msg}`).join(" · ")
        : (typeof raw === "string" ? raw : "");
      if (detail.toLowerCase().includes("email")) {
        setError(t("public.register.err_email_exists"));
      } else if (detail.toLowerCase().includes("password") || detail.toLowerCase().includes("min_length")) {
        setError(t("public.register.err_password_min"));
      } else if (err?.response?.status === 429) {
        setError(t("public.register.err_rate_limited"));
      } else if (err?.response?.status >= 500) {
        setError(t("public.register.err_server", { status: err.response.status }));
      } else if (detail) {
        setError(detail);
      } else {
        setError(t("public.register.err_generic"));
      }
    } finally {
      setLoading(false);
    }
  }

  const primaryFw = frameworks.find((f) => f.id === primaryFwId);

  return (
    <>
      <SEO title={t("public.register.seo_get_started")} description={t("public.register.seo_description")} path="/register" noIndex />
      <AuthLayout maxWidth="max-w-2xl">
        {/* Header */}
        <div className="mb-7">
          <h1 className="text-2xl font-bold text-gray-900">{t("public.register.seo_title")}</h1>
          <p className="text-gray-500 mt-1 text-sm">{t("public.register.tagline")}</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                step > s ? "bg-blue-600 text-white" :
                step === s ? "bg-blue-600 text-white ring-4 ring-blue-100" :
                "bg-gray-100 text-gray-400"
              }`}>
                {step > s ? <Check className="w-4 h-4" /> : s}
              </div>
              {s < 3 && (
                <div className={`w-16 h-0.5 ${step > s ? "bg-blue-500" : "bg-gray-200"}`} />
              )}
            </div>
          ))}
        </div>

        <div>
          {error && (
            <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
          )}

          {/* ── Step 1: Account Info ─────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{t("public.register.step1_title")}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{t("public.register.step1_subtitle")}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label={t("public.register.first_name")} error={fieldErrors.first_name}>
                  <input type="text" value={form.first_name} onChange={set("first_name")} required autoFocus
                    className={inputCls(!!fieldErrors.first_name)} placeholder={t("public.register.first_name_placeholder")} />
                </Field>
                <Field label={t("public.register.last_name")} error={fieldErrors.last_name}>
                  <input type="text" value={form.last_name} onChange={set("last_name")} required
                    className={inputCls(!!fieldErrors.last_name)} placeholder={t("public.register.last_name_placeholder")} />
                </Field>
              </div>

              <Field label={t("public.register.work_email")} error={fieldErrors.email}>
                <input type="email" value={form.email} onChange={set("email")} required
                  className={inputCls(!!fieldErrors.email)} placeholder={t("public.register.work_email_placeholder")} />
              </Field>

              <Field label={t("public.register.password")} error={fieldErrors.password}>
                <div className="relative">
                  <input type={showPw ? "text" : "password"} value={form.password} onChange={set("password")}
                    required minLength={12} className={inputCls(!!fieldErrors.password) + " pr-10"} placeholder={t("public.register.password_placeholder_min12")} />
                  <button type="button" onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {form.password && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex gap-0.5 flex-1">
                      {[1,2,3,4,5].map((i) => (
                        <div key={i} className={`h-1 flex-1 rounded-full ${i <= pw.score ? pw.color : "bg-gray-200"}`} />
                      ))}
                    </div>
                    <span className="text-xs text-gray-500">{pw.label ? t(pw.label) : ""}</span>
                  </div>
                )}
              </Field>

              <Field label={t("public.register.org_name")} error={fieldErrors.organization_name}>
                <input type="text" value={form.organization_name} onChange={set("organization_name")} required
                  className={inputCls(!!fieldErrors.organization_name)} placeholder={t("public.register.org_name_placeholder")} />
                {form.organization_slug && (
                  <p className="text-xs text-gray-400 mt-1">
                    URL: <span className="font-mono text-blue-600">grcplatform.com/{form.organization_slug}</span>
                  </p>
                )}
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label={t("public.register.country")}>
                  <select value={form.country} onChange={set("country")} className={SELECT}>
                    <option value="">{t("public.register.country_placeholder")}</option>
                    {COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c, i18n.language)}</option>)}
                  </select>
                </Field>
                <Field label={t("public.register.industry")}>
                  <select value={form.industry} onChange={set("industry")} className={SELECT}>
                    <option value="">{t("public.register.industry_placeholder")}</option>
                    {INDUSTRIES.map((i) => <option key={i.value} value={i.value}>{t(i.label)}</option>)}
                  </select>
                </Field>
              </div>

              <Field label={t("public.register.org_size")}>
                <div className="grid grid-cols-4 gap-2">
                  {ORG_SIZES.map((s) => (
                    <button key={s.value} type="button" onClick={() => setForm((f) => ({ ...f, org_size: s.value }))}
                      className={`rounded-lg border-2 p-2.5 text-center transition-all ${
                        form.org_size === s.value
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 hover:border-gray-300 text-gray-700"
                      }`}>
                      <div className="font-semibold text-sm">{s.label}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{t(s.sub)}</div>
                    </button>
                  ))}
                </div>
              </Field>

              <button type="button" disabled={!step1Valid}
                onClick={() => setStep(2)}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors">
                {t("public.register.continue")} <ChevronRight className="w-4 h-4 rtl:rotate-180" />
              </button>
            </div>
          )}

          {/* ── Step 2: Framework Selection ──────────────────────── */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{t("public.register.step2_title")}</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {t("public.register.step2_subtitle_pre")} <strong>{t("public.register.step2_subtitle_primary")}</strong> {t("public.register.step2_subtitle_mid")} <strong>{t("public.register.step2_subtitle_secondary")}</strong> {t("public.register.step2_subtitle_post")}
                </p>
              </div>

              {fwLoading ? (
                <div className="grid grid-cols-2 gap-3">
                  {[1,2,3,4,5,6].map((i) => (
                    <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : frameworks.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <p>{t("public.register.load_failed")}</p>
                  <button type="button" onClick={() => {
                    setFwLoading(true);
                    frameworksApi.list().then(setFrameworks).finally(() => setFwLoading(false));
                  }} className="text-blue-600 text-sm mt-2 hover:underline">{t("public.register.retry")}</button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
                  {frameworks.map((fw) => (
                    <FrameworkSelectionCard
                      key={fw.id}
                      framework={fw}
                      isPrimary={primaryFwId === fw.id}
                      selected={secondaryFwIds.includes(fw.id)}
                      onSelectPrimary={() => {
                        setPrimaryFwId(fw.id);
                        setSecondaryFwIds((prev) => prev.filter((x) => x !== fw.id));
                      }}
                      onToggleSecondary={() => {
                        if (fw.id === primaryFwId) return; // cannot add primary as secondary
                        toggleSecondary(fw.id);
                      }}
                      userIndustry={form.industry}
                      userCountry={form.country}
                    />
                  ))}
                </div>
              )}

              {primaryFw && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                  <strong>{t("public.register.primary")}</strong> {primaryFw.name} ({primaryFw.control_count} {t("public.register.controls")})
                  {secondaryFwIds.length > 0 && (
                    <span className="ml-2 text-blue-600">
                      +{secondaryFwIds.length} {t("public.register.secondary")}{secondaryFwIds.length > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)}
                  className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-3 rounded-lg flex items-center justify-center gap-2">
                  <ChevronLeft className="w-4 h-4 rtl:rotate-180" /> {t("public.register.back")}
                </button>
                <button type="button" disabled={!step2Valid}
                  onClick={() => setStep(3)}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2">
                  {t("public.register.continue")} <ChevronRight className="w-4 h-4 rtl:rotate-180" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Review & Submit ───────────────────────────── */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{t("public.register.step3_title")}</h2>
                <p className="text-sm text-gray-500 mt-0.5">{t("public.register.step3_subtitle")}</p>
              </div>

              <div className="bg-gray-50 rounded-xl p-5 space-y-3 text-sm">
                <ReviewRow label={t("public.register.review_name")} value={`${form.first_name} ${form.last_name}`} />
                <ReviewRow label={t("public.register.review_email")} value={form.email} />
                <ReviewRow label={t("public.register.review_org")} value={form.organization_name} />
                {form.industry && (
                  <ReviewRow label={t("public.register.review_industry")} value={(() => { const ind = INDUSTRIES.find((i) => i.value === form.industry); return ind ? t(ind.label) : form.industry; })()} />
                )}
                {form.org_size && (
                  <ReviewRow label={t("public.register.review_size")} value={`${form.org_size} ${t("public.register.review_size_suffix")}`} />
                )}
                {primaryFw && (
                  <ReviewRow label={t("public.register.review_primary")} value={`${primaryFw.name} (${primaryFw.control_count} ${t("public.register.controls")})`} />
                )}
                {secondaryFwIds.length > 0 && (
                  <ReviewRow
                    label={t("public.register.review_secondary")}
                    value={secondaryFwIds
                      .map((id) => frameworks.find((f) => f.id === id)?.short_name ?? id)
                      .join(", ")}
                  />
                )}
                {!primaryFwId && (
                  <div className="text-amber-600 text-xs mt-1">
                    {t("public.register.no_framework")}
                  </div>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 space-y-1">
                <div className="font-semibold">{t("public.register.next_steps")}</div>
                <ul className="space-y-0.5 text-blue-700">
                  <li>✓ {t("public.register.ns1")}</li>
                  {primaryFwId && <li>✓ {t("public.register.ns2")} {primaryFw?.short_name}</li>}
                  <li>✓ {t("public.register.ns3")}</li>
                  <li>✓ {t("public.register.ns4")}</li>
                </ul>
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(2)}
                  className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-3 rounded-lg flex items-center justify-center gap-2">
                  <ChevronLeft className="w-4 h-4 rtl:rotate-180" /> {t("public.register.back")}
                </button>
                <button type="button" onClick={handleSubmit} disabled={loading}
                  className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 disabled:opacity-60 text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2 shadow-lg">
                  {loading ? (
                    <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {t("public.register.creating")}</>
                  ) : (
                    <><Check className="w-4 h-4" /> {t("public.register.finish")}</>
                  )}
                </button>
              </div>
            </div>
          )}

          <p className="text-center text-sm text-gray-500 mt-4">
            {t("auth.have_account")}{" "}
            <Link to="/login" className="text-blue-600 font-medium hover:underline">{t("auth.sign_in")}</Link>
          </p>
        </div>
      </AuthLayout>
    </>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const INPUT = "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
const SELECT = INPUT;

/** Returns input class with red border when there is an error. */
function inputCls(hasError: boolean) {
  return hasError
    ? "w-full px-3 py-2.5 border border-red-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-red-400"
    : INPUT;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 text-right max-w-xs truncate">{value}</span>
    </div>
  );
}
