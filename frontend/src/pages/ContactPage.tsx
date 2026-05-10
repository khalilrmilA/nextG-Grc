import PublicFooter from "../components/landing/PublicFooter";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, Send, Mail, MessageSquare, Building2, CheckCircle, AlertCircle } from "lucide-react";
import PublicNav from "../components/landing/PublicNav";
import SupportChat from "../components/landing/SupportChat";
import SEO from "../components/seo/SEO";
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

export default function ContactPage() {
  const { t } = useTranslation();
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
      await axios.post(`${API_BASE}/public/contact`, {
        name: form.name.trim(),
        email: form.email.trim(),
        company: form.company.trim() || null,
        subject: form.subject.trim() || null,
        message: form.message.trim(),
      });
      setSuccess(true);
      setForm({ name: "", email: "", company: "", subject: "", message: "" });
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : t("public.contact.error"));
    } finally {
      setSubmitting(false);
    }
  }

  const contactJsonLd = {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    "url": "https://grceye.com/contact",
    "name": "Contact GRCEye",
    "description": "Get in touch with the GRCEye team — sales, support, partnerships.",
  };

  return (
    <div className="min-h-screen bg-[#f0f9ff] text-gray-900">
      <SEO
        title={t("public.contact.hero_title")}
        description="Talk to the GRCEye team. Sales, support, partnerships, demos. We typically reply within one business day."
        path="/contact"
        keywords="contact GRCEye, GRC demo, GRC sales contact, GRCEye support"
        jsonLd={contactJsonLd}
      />

      <PublicNav links={[
        { to: "/",                 label: t("public.nav.home") },
        { to: "/features-landing", label: t("public.nav.features") },
        { to: "/solutions",        label: t("public.nav.solutions") },
        { to: "/faq",              label: t("public.nav.faq") },
        { to: "/contact",          label: t("public.nav.contact"), activeOn: "/contact" },
      ]} />

      {/* Spacer for fixed nav */}
      <div className="h-20" />

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-12 pb-8 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold mb-4">
          <MessageSquare className="w-3.5 h-3.5" />
          {t("public.contact.hero_subtitle")}
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900 mb-4">
          {t("public.contact.hero_title")}
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          {t("public.contact.hero_subtitle")}
        </p>
      </section>

      {/* Form + sidebar */}
      <section className="max-w-5xl mx-auto px-6 pb-20 grid lg:grid-cols-3 gap-8">
        {/* Form */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          {success ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-green-50 border border-green-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">{t("public.contact.success")}</h2>
              <p className="text-gray-600 mb-6">{t("public.contact.success")}</p>
              <button
                type="button"
                onClick={() => setSuccess(false)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors"
              >
                Send another message
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <h2 className="text-xl font-bold text-gray-900">Send us a message</h2>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="contact-name" className="block text-xs font-semibold text-gray-700 mb-1.5">
                    {t("public.contact.name_label")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="contact-name"
                    type="text"
                    required
                    value={form.name}
                    onChange={e => update("name", e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label htmlFor="contact-email" className="block text-xs font-semibold text-gray-700 mb-1.5">
                    {t("public.contact.email_label")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    required
                    value={form.email}
                    onChange={e => update("email", e.target.value)}
                    placeholder="jane@company.com"
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
                    placeholder="Acme Corp"
                    className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
                <div>
                  <label htmlFor="contact-subject" className="block text-xs font-semibold text-gray-700 mb-1.5">Subject</label>
                  <select
                    id="contact-subject"
                    value={form.subject}
                    onChange={e => update("subject", e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  >
                    <option value="">Choose a topic…</option>
                    <option>Request a demo</option>
                    <option>Pricing / sales</option>
                    <option>Technical support</option>
                    <option>Partnerships</option>
                    <option>Press / media</option>
                    <option>Other</option>
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
                  placeholder="Tell us a bit about what you need…"
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
                    {t("public.contact.send")}
                    <Send className="w-4 h-4 rtl:scale-x-[-1]" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-3">
              <Mail className="w-4 h-4 text-blue-600" />
              Email us directly
            </div>
            <ul className="space-y-2 text-sm">
              <li>
                <p className="text-xs text-gray-500">Sales</p>
                <a href="mailto:sales@grceye.com" className="text-blue-600 hover:underline font-medium">sales@grceye.com</a>
              </li>
              <li>
                <p className="text-xs text-gray-500">Support</p>
                <a href="mailto:support@grceye.com" className="text-blue-600 hover:underline font-medium">support@grceye.com</a>
              </li>
            </ul>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-3">
              <Building2 className="w-4 h-4 text-blue-600" />
              Looking to try it?
            </div>
            <p className="text-sm text-gray-600 mb-3">Skip the wait — start a 14-day free trial. No credit card required.</p>
            <Link
              to="/register"
              className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              Create an account
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
            <p className="text-sm font-semibold text-blue-900 mb-1">Response time</p>
            <p className="text-sm text-blue-800">We typically reply within one business day.</p>
          </div>
        </aside>
      </section>

      {/* Footer */}
      <PublicFooter />

      <SupportChat />
    </div>
  );
}
