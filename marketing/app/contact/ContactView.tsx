"use client";
import PublicFooter from "@/components/landing/PublicFooter";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Send, Mail, MessageSquare, Building2, CheckCircle, AlertCircle } from "lucide-react";
import PublicNav from "@/components/landing/PublicNav";
import SupportChat from "@/components/landing/SupportChat";
import { useI18n } from "@/i18n";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export default function ContactView() {
  const { t } = useI18n();
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    subject: "",
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const resp = await fetch(`${API_BASE}/public/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          company: form.company.trim() || null,
          subject: form.subject.trim() || null,
          message: form.message.trim(),
        }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const detail = (data as { detail?: string })?.detail;
        throw new Error(typeof detail === "string" ? detail : t("public.contact.err_could_not_send"));
      }
      setSuccess(true);
      setForm({ name: "", email: "", company: "", subject: "", message: "" });
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? t("public.contact.err_could_not_send"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f0f9ff] text-gray-900">
      <PublicNav />

      <section className="max-w-4xl mx-auto px-6 pt-12 pb-8 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold mb-4">
          <MessageSquare className="w-3.5 h-3.5" />
          {t("public.contact.hero_badge")}
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900 mb-4">
          {t("public.contact.hero_title_alt")}
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          {t("public.contact.hero_subtitle_alt")}
        </p>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-20 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          {success ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-green-50 border border-green-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">{t("public.contact.message_sent")}</h2>
              <p className="text-gray-600 mb-6">{t("public.contact.thanks")}</p>
              <button
                type="button"
                onClick={() => setSuccess(false)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
              >
                {t("public.contact.send_another")}
                <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <h2 className="text-xl font-bold text-gray-900">{t("public.contact.send_us_msg")}</h2>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="contact-name" className="block text-xs font-semibold text-gray-700 mb-1.5">
                    {t("public.contact.your_name")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="contact-name"
                    type="text"
                    required
                    value={form.name}
                    onChange={e => update("name", e.target.value)}
                    placeholder={t("public.contact.name_placeholder")}
                    className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label htmlFor="contact-email" className="block text-xs font-semibold text-gray-700 mb-1.5">
                    {t("public.contact.work_email")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    required
                    value={form.email}
                    onChange={e => update("email", e.target.value)}
                    placeholder={t("public.contact.email_placeholder")}
                    className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="contact-company" className="block text-xs font-semibold text-gray-700 mb-1.5">{t("public.contact.company_label")}</label>
                  <input
                    id="contact-company"
                    type="text"
                    value={form.company}
                    onChange={e => update("company", e.target.value)}
                    placeholder={t("public.contact.company_placeholder")}
                    className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label htmlFor="contact-subject" className="block text-xs font-semibold text-gray-700 mb-1.5">{t("public.contact.subject_label")}</label>
                  <select
                    id="contact-subject"
                    value={form.subject}
                    onChange={e => update("subject", e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  >
                    <option value="">{t("public.contact.subject_choose")}</option>
                    <option>{t("public.contact.subject_demo")}</option>
                    <option>{t("public.contact.subject_pricing")}</option>
                    <option>{t("public.contact.subject_support")}</option>
                    <option>{t("public.contact.subject_partnerships")}</option>
                    <option>{t("public.contact.subject_press")}</option>
                    <option>{t("public.contact.subject_other")}</option>
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="contact-message" className="block text-xs font-semibold text-gray-700 mb-1.5">
                  {t("public.contact.message_label")} <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="contact-message"
                  required
                  minLength={10}
                  maxLength={5000}
                  rows={6}
                  value={form.message}
                  onChange={e => update("message", e.target.value)}
                  placeholder={t("public.contact.message_placeholder")}
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
                />
                <p className="text-xs text-gray-400 mt-1">{form.message.length}/5000</p>
              </div>

              {error && (
                <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? t("public.contact.sending") : (
                  <>
                    {t("public.contact.send_msg")}
                    <Send className="w-4 h-4 rtl:scale-x-[-1]" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        <aside className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-3">
              <Mail className="w-4 h-4 text-blue-600" />
              {t("public.contact.sidebar_email_directly")}
            </div>
            <ul className="space-y-2 text-sm">
              <li>
                <p className="text-xs text-gray-500">{t("public.contact.sidebar_sales")}</p>
                <a href="mailto:sales@grceye.com" className="text-blue-600 hover:underline font-medium">sales@grceye.com</a>
              </li>
              <li>
                <p className="text-xs text-gray-500">{t("public.contact.sidebar_support")}</p>
                <a href="mailto:support@grceye.com" className="text-blue-600 hover:underline font-medium">support@grceye.com</a>
              </li>
            </ul>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-3">
              <Building2 className="w-4 h-4 text-blue-600" />
              {t("public.contact.sidebar_try_title")}
            </div>
            <p className="text-sm text-gray-600 mb-3">{t("public.contact.sidebar_try_desc")}</p>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              {t("public.contact.sidebar_create")}
              <ArrowRight className="w-4 h-4 rtl:rotate-180" />
            </Link>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
            <p className="text-sm font-semibold text-blue-900 mb-1">{t("public.contact.sidebar_response_title")}</p>
            <p className="text-sm text-blue-800">{t("public.contact.sidebar_response_desc")}</p>
          </div>
        </aside>
      </section>

      <PublicFooter />
      <SupportChat />
    </div>
  );
}
