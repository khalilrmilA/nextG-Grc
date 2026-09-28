import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Shield,
  Eye,
  Save,
  Loader2,
  CheckCircle2,
  Globe,
  FileText,
  Award,
  Users,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { trustCenterApi } from "@/api/endpoints";

export default function TrustCenterConfigPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [config, setConfig] = useState({
    enabled: false,
    show_frameworks: true,
    show_policies: true,
    show_certifications: true,
    show_subprocessors: true,
    custom_message: "",
    contact_email: "",
  });

  // Preview state
  const [previewSlug, setPreviewSlug] = useState("");
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const data = await trustCenterApi.getConfig();
      setConfig({
        enabled: data.enabled ?? false,
        show_frameworks: data.show_frameworks ?? true,
        show_policies: data.show_policies ?? true,
        show_certifications: data.show_certifications ?? true,
        show_subprocessors: data.show_subprocessors ?? true,
        custom_message: data.custom_message ?? "",
        contact_email: data.contact_email ?? "",
      });
    } catch {
      // defaults are fine
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await trustCenterApi.updateConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err?.response?.data?.detail || t("trust_center_cfg.save_failed"));
    } finally {
      setSaving(false);
    }
  }

  async function loadPreview() {
    if (!previewSlug.trim()) return;
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewData(null);
    try {
      const data = await trustCenterApi.getPublic(previewSlug.trim());
      setPreviewData(data);
    } catch (err: any) {
      setPreviewError(err?.response?.data?.detail || t("trust_center_cfg.preview_failed"));
    } finally {
      setPreviewLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t("nav.trust_center")}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {t("trust_center_cfg.subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Configuration Section */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-50 text-blue-600">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t("trust_center_cfg.config_title")}</h2>
              <p className="text-xs text-gray-500">{t("trust_center_cfg.config_desc")}</p>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm">{error}</div>
          )}

          <div className="space-y-5">
            {/* Toggles */}
            <div className="space-y-3">
              {[
                { key: "enabled", label: t("trust_center_cfg.toggle.enabled"), desc: t("trust_center_cfg.toggle.enabled_desc") },
                { key: "show_frameworks", label: t("trust_center_cfg.toggle.frameworks"), desc: t("trust_center_cfg.toggle.frameworks_desc") },
                { key: "show_policies", label: t("trust_center_cfg.toggle.policies"), desc: t("trust_center_cfg.toggle.policies_desc") },
                { key: "show_certifications", label: t("trust_center_cfg.toggle.certifications"), desc: t("trust_center_cfg.toggle.certifications_desc") },
                { key: "show_subprocessors", label: t("trust_center_cfg.toggle.subprocessors"), desc: t("trust_center_cfg.toggle.subprocessors_desc") },
              ].map((toggle) => (
                <div
                  key={toggle.key}
                  className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:bg-gray-50/50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{toggle.label}</p>
                    <p className="text-xs text-gray-500">{toggle.desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setConfig({ ...config, [toggle.key]: !config[toggle.key as keyof typeof config] })
                    }
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 ease-in-out ${
                      config[toggle.key as keyof typeof config] ? "bg-blue-600" : "bg-gray-200"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out mt-0.5 ${
                        config[toggle.key as keyof typeof config] ? "translate-x-5 rtl:-translate-x-5 ms-0.5" : "translate-x-0 ms-0.5"
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>

            {/* Custom Message */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("trust_center_cfg.custom_message")}
              </label>
              <textarea
                value={config.custom_message}
                onChange={(e) => setConfig({ ...config, custom_message: e.target.value })}
                rows={4}
                placeholder={t("trust_center_cfg.custom_message_placeholder")}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Contact Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("trust_center_cfg.contact_email")}
              </label>
              <input
                type="email"
                value={config.contact_email}
                onChange={(e) => setConfig({ ...config, contact_email: e.target.value })}
                placeholder="security@company.com"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Save Button */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : saved ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {saved ? t("trust_center_cfg.saved") : t("trust_center_cfg.save")}
            </button>
          </div>
        </div>

        {/* Preview Section */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-purple-50 text-purple-600">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{t("trust_center_cfg.preview_title")}</h2>
              <p className="text-xs text-gray-500">{t("trust_center_cfg.preview_desc")}</p>
            </div>
          </div>

          {/* Slug Input */}
          <div className="flex items-center gap-2 mb-6">
            <input
              value={previewSlug}
              onChange={(e) => setPreviewSlug(e.target.value)}
              placeholder={t("trust_center_cfg.slug_placeholder")}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={loadPreview}
              disabled={previewLoading || !previewSlug.trim()}
              className="inline-flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {t("trust_center_cfg.load")}
            </button>
          </div>

          {previewError && (
            <div className="p-3 bg-red-50 text-red-700 rounded-xl text-sm mb-4">{previewError}</div>
          )}

          {/* Preview Content */}
          {previewData ? (
            <div className="border border-gray-200 rounded-2xl overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-8 text-white">
                <div className="flex items-center gap-3 mb-2">
                  <Globe className="w-6 h-6" />
                  <h3 className="text-xl font-bold">{previewData.org_name || t("trust_center_cfg.organization")}</h3>
                </div>
                <p className="text-blue-100 text-sm">
                  {previewData.custom_message || t("trust_center_cfg.default_message")}
                </p>
              </div>

              <div className="p-5 space-y-5">
                {/* Frameworks */}
                {previewData.frameworks && previewData.frameworks.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <Shield className="w-4 h-4 text-blue-600" /> {t("trust_center_cfg.frameworks")}
                    </h4>
                    <div className="space-y-2">
                      {previewData.frameworks.map((fw: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                            <span className="text-sm font-medium text-gray-900">{fw.name}</span>
                          </div>
                          {fw.score != null && (
                            <span className="text-sm font-semibold text-green-600">{fw.score}%</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Policies */}
                {previewData.policies && previewData.policies.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-600" /> {t("trust_center_cfg.policies")}
                    </h4>
                    <div className="space-y-2">
                      {previewData.policies.map((p: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl">
                          <FileText className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-700">{p.title || p.name}</span>
                          {p.url && (
                            <a href={p.url} target="_blank" rel="noreferrer">
                              <ExternalLink className="w-3 h-3 text-blue-500" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Certifications */}
                {previewData.certifications && previewData.certifications.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <Award className="w-4 h-4 text-blue-600" /> {t("trust_center_cfg.certifications")}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {previewData.certifications.map((c: any, i: number) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-200 rounded-full px-3 py-1 text-xs font-semibold"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          {c.name || c}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Subprocessors */}
                {previewData.subprocessors && previewData.subprocessors.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                      <Users className="w-4 h-4 text-blue-600" /> {t("trust_center_cfg.subprocessors")}
                    </h4>
                    <div className="space-y-2">
                      {previewData.subprocessors.map((sp: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                          <span className="text-sm font-medium text-gray-900">{sp.name}</span>
                          <span className="text-xs text-gray-500">{sp.purpose || sp.service}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Contact */}
                {previewData.contact_email && (
                  <div className="pt-3 border-t border-gray-100 text-center">
                    <p className="text-xs text-gray-500">
                      {t("trust_center_cfg.contact_us")}{" "}
                      <a
                        href={`mailto:${previewData.contact_email}`}
                        className="text-blue-600 hover:underline"
                      >
                        {previewData.contact_email}
                      </a>
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-16 text-gray-400">
              <Globe className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm">{t("trust_center_cfg.preview_empty")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
