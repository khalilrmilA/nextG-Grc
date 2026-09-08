/**
 * CreateAuditorModal — « Affectation des auditeurs internes ou externes ».
 *
 * Two things this modal now carries that the tender asks for and the old one
 * could not express:
 *   1. every string goes through t() AND resolves to a key that really exists
 *      in en/fr/ar, so the form a francophone/arabophone administrator reaches
 *      is not English-only (an inline English default is still English);
 *   2. an Interne / Externe choice, with the firm name when the auditor comes
 *      from a cabinet — so an engagement led by an external auditor is
 *      distinguishable from one led by an employee.
 *
 * The firm name travels in a second call: usersApi.createAuditor() is typed to
 * the four legacy fields and drops anything else, while PATCH /users/{id}
 * (usersApi.update) does accept is_external / external_org. See
 * needs_integration — once createAuditor carries them, the follow-up PATCH
 * here becomes redundant and can be deleted.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, UserPlus, Loader2, Eye, EyeOff, CheckCircle, Building2 } from "lucide-react";
import { usersApi } from "@/api/endpoints";

interface Props {
  readonly onClose: () => void;
  readonly onCreated: (name: string, email: string) => void;
}

/** usersApi.update is typed to the entitlement fields; the backend payload also
 *  accepts the auditor's internal/external qualification. */
type AuditorQualificationPatch = Parameters<typeof usersApi.update>[1] & {
  is_external?: boolean;
  external_org?: string | null;
};

export default function CreateAuditorModal({ onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    expires_at: "",
    is_external: false,
    external_org: "",
  });
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [done, setDone] = useState(false);

  function setField(field: keyof typeof form, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      setError(`${t("common.required")}: ${t("auth.name")}, ${t("auth.email")}, ${t("auth.password")}`);
      return;
    }
    if (form.password.length < 8) {
      setError(`${t("auth.password")} — ${t("public.register.password_placeholder")}`);
      return;
    }
    if (form.is_external && !form.external_org.trim()) {
      setError(`${t("common.required")}: ${t("auth.org_name")}`);
      return;
    }
    setSubmitting(true);
    setError("");
    setWarning("");
    try {
      const created = await usersApi.createAuditor({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      });
      if (form.is_external) {
        // Non-fatal: the account exists either way, so a refusal here is a
        // warning on a created auditor, never a lost account.
        try {
          const patch: AuditorQualificationPatch = {
            is_external: true,
            external_org: form.external_org.trim(),
          };
          await usersApi.update(created.id, patch);
        } catch {
          setWarning(`${t("auth.org_name")} — ${t("common.error_generic")}`);
        }
      }
      setDone(true);
      setTimeout(() => {
        onCreated(form.name, form.email);
        onClose();
      }, 1500);
    } catch {
      setError(t("common.error_generic"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-purple-600" />
            <h2 className="text-base font-semibold text-gray-900">{t("audits.create_auditor_account")}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" title={t("common.close")}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {done ? (
            <div className="py-8 text-center">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <p className="text-base font-semibold text-gray-800">{t("common.success")}</p>
              <p className="text-sm text-gray-500 mt-1">
                {form.name} ({form.email})
              </p>
              {warning && (
                <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  {warning}
                </p>
              )}
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="auditor-name" className="block text-xs font-medium text-gray-600 mb-1">
                  {t("auth.name")}
                </label>
                <input
                  id="auditor-name"
                  type="text"
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label htmlFor="auditor-email" className="block text-xs font-medium text-gray-600 mb-1">
                  {t("auth.email")}
                </label>
                <input
                  id="auditor-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setField("email", e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              {/* Interne / Externe — objectif 4, « auditeurs internes ou externes » */}
              <div>
                <span className="block text-xs font-medium text-gray-600 mb-1">
                  {t("common.type")}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: false, label: t("audits.type_internal") },
                    { value: true, label: t("audits.type_external") },
                  ].map((opt) => (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => setField("is_external", opt.value)}
                      className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                        form.is_external === opt.value
                          ? "border-purple-500 bg-purple-50 text-purple-700"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {form.is_external && (
                <div>
                  <label htmlFor="auditor-firm" className="block text-xs font-medium text-gray-600 mb-1">
                    {t("auth.org_name")}
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-gray-300 absolute start-3 top-1/2 -translate-y-1/2" />
                    <input
                      id="auditor-firm"
                      type="text"
                      value={form.external_org}
                      onChange={(e) => setField("external_org", e.target.value)}
                      className="w-full ps-9 pe-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="auditor-password" className="block text-xs font-medium text-gray-600 mb-1">
                  {t("company_admin.pwd_label")}
                </label>
                <div className="relative">
                  <input
                    id="auditor-password"
                    type={showPwd ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => setField("password", e.target.value)}
                    placeholder={t("public.register.password_placeholder")}
                    className="w-full px-3 py-2.5 pe-10 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    title={showPwd ? t("dashboard.hide_widget") : t("dashboard.show_widget")}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="auditor-expires-at" className="block text-xs font-medium text-gray-600 mb-1">
                  {t("share_link.expiry_date")}{" "}
                  <span className="text-gray-400 font-normal">({t("common.optional")})</span>
                </label>
                <input
                  id="auditor-expires-at"
                  type="date"
                  value={form.expires_at}
                  onChange={(e) => setField("expires_at", e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="bg-purple-50 border border-purple-100 rounded-xl p-3">
                <p className="text-xs text-purple-700">{t("audits.auditor_access_info")}</p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
                >
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  {submitting ? t("auth.creating_account") : t("audits.create_auditor")}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
