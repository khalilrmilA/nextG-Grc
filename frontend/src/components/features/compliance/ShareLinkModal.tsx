import { useState, useEffect } from "react";
import { X, Link2, Copy, Check, Trash2, Loader2, Plus, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { shareLinksApi, type ShareLink } from "@/api/endpoints";

interface Props {
  caId: string;
  controlTitle: string;
  controlId: string;
  onClose: () => void;
}

export default function ShareLinkModal({ caId, controlTitle, controlId, onClose }: Props) {
  const { t } = useTranslation();
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ label: "", instructions: "", expires_at: "", max_uses: "" });

  useEffect(() => {
    shareLinksApi.list(caId)
      .then(setLinks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [caId]);

  async function handleCreate() {
    setCreating(true);
    try {
      const link = await shareLinksApi.create(caId, {
        label: form.label || undefined,
        instructions: form.instructions || undefined,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        max_uses: form.max_uses ? parseInt(form.max_uses) : null,
      });
      setLinks(prev => [link, ...prev]);
      setForm({ label: "", instructions: "", expires_at: "", max_uses: "" });
      setShowForm(false);
    } catch {/* silent */} finally { setCreating(false); }
  }

  async function handleRevoke(linkId: string) {
    try {
      await shareLinksApi.revoke(linkId);
      setLinks(prev => prev.filter(l => l.id !== linkId));
    } catch {/* silent */}
  }

  function copyLink(link: ShareLink) {
    navigator.clipboard.writeText(link.upload_url);
    setCopiedId(link.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
              <Link2 className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">{t("share_link.modal_title")}</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                <span className="font-mono text-gray-500">{controlId}</span> — {controlTitle}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-300" />
            </div>
          ) : (
            <>
              {links.length === 0 && !showForm && (
                <div className="text-center py-10">
                  <div className="w-14 h-14 bg-orange-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                    <Link2 className="w-7 h-7 text-orange-300" />
                  </div>
                  <p className="text-sm font-medium text-gray-600">{t("share_link.no_links")}</p>
                  <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
                    {t("share_link.no_links_desc")}
                  </p>
                </div>
              )}

              {links.map(link => (
                <div key={link.id} className="flex items-start gap-3 p-4 bg-gray-50 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors">
                  <div className="w-8 h-8 bg-white rounded-lg border border-gray-200 flex items-center justify-center flex-shrink-0">
                    <Link2 className="w-3.5 h-3.5 text-orange-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-gray-800">{link.label || t("share_link.untitled_link")}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${link.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {link.is_active ? t("share_link.active") : t("share_link.revoked")}
                      </span>
                    </div>
                    <p className="text-xs text-blue-600 truncate font-mono mb-2">{link.upload_url}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      {link.expires_at && (
                        <span>{t("share_link.expires")} {new Date(link.expires_at).toLocaleDateString()}</span>
                      )}
                      <span>
                        {t(link.use_count === 1 ? "share_link.uploads_count" : "share_link.uploads_count_plural", { count: link.use_count })}
                        {link.max_uses != null && ` / ${link.max_uses} ${t("share_link.max_suffix")}`}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => window.open(link.upload_url, "_blank")}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-white transition-colors"
                      title={t("share_link.open_link")}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => copyLink(link)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-white transition-colors"
                      title={t("share_link.copy_link")}
                    >
                      {copiedId === link.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => handleRevoke(link.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-white transition-colors"
                      title={t("share_link.revoke_link")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              {showForm && (
                <div className="border-2 border-orange-200 rounded-xl p-4 space-y-3 bg-orange-50/40">
                  <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{t("share_link.new_link_title")}</h3>
                  <input
                    type="text"
                    placeholder={t("share_link.label_placeholder")}
                    value={form.label}
                    onChange={e => setForm(p => ({ ...p, label: e.target.value }))}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                  />
                  <textarea
                    placeholder={t("share_link.instructions_placeholder")}
                    value={form.instructions}
                    onChange={e => setForm(p => ({ ...p, instructions: e.target.value }))}
                    rows={3}
                    className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white resize-none"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1.5">{t("share_link.expiry_date")}</label>
                      <input
                        type="date"
                        value={form.expires_at}
                        onChange={e => setForm(p => ({ ...p, expires_at: e.target.value }))}
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 block mb-1.5">{t("share_link.max_uploads")}</label>
                      <input
                        type="number"
                        min="1"
                        placeholder={t("share_link.unlimited")}
                        value={form.max_uses}
                        onChange={e => setForm(p => ({ ...p, max_uses: e.target.value }))}
                        className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setShowForm(false)}
                      className="flex-1 text-sm text-gray-600 border border-gray-200 px-4 py-2.5 rounded-xl hover:bg-white transition-colors"
                    >
                      {t("share_link.cancel")}
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={creating}
                      className="flex-1 flex items-center justify-center gap-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white px-4 py-2.5 rounded-xl disabled:opacity-50 transition-colors"
                    >
                      {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                      {t("share_link.generate_link")}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!showForm && (
          <div className="px-6 py-4 border-t border-gray-100 flex-shrink-0">
            <button
              onClick={() => setShowForm(true)}
              className="w-full flex items-center justify-center gap-2 text-sm font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-200 px-4 py-2.5 rounded-xl transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t("share_link.create_new")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
