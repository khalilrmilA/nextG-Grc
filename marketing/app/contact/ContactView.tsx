"use client";
import PublicFooter from "@/components/landing/PublicFooter";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Send, Mail, MessageSquare, Building2, CheckCircle, AlertCircle } from "lucide-react";
import PublicNav from "@/components/landing/PublicNav";
import SupportChat from "@/components/landing/SupportChat";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export default function ContactView() {
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
        throw new Error(typeof detail === "string" ? detail : "Could not send your message. Please try again or email sales@grceye.io directly.");
      }
      setSuccess(true);
      setForm({ name: "", email: "", company: "", subject: "", message: "" });
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? "Could not send your message. Please try again or email sales@grceye.io directly.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f0f9ff] text-gray-900">
      <PublicNav links={[
        { to: "/", label: "Home" },
        { to: "/features-landing", label: "Features" },
        { to: "/solutions", label: "Solutions" },
        { to: "/faq", label: "FAQ" },
        { to: "/contact", label: "Contact", activeOn: "/contact" },
      ]} />

      <div className="h-20" />

      <section className="max-w-4xl mx-auto px-6 pt-12 pb-8 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold mb-4">
          <MessageSquare className="w-3.5 h-3.5" />
          We&apos;d love to hear from you
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900 mb-4">
          Get in touch
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Questions about GRCEye, a custom demo for your team, or a partnership idea? Tell us what you need — we typically reply within one business day.
        </p>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-20 grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
          {success ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-green-50 border border-green-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Message sent</h2>
              <p className="text-gray-600 mb-6">Thanks — we received your message and will get back to you shortly.</p>
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
                    Your name <span className="text-red-500">*</span>
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
                    Work email <span className="text-red-500">*</span>
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
                  <label htmlFor="contact-company" className="block text-xs font-semibold text-gray-700 mb-1.5">Company</label>
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
                  Message <span className="text-red-500">*</span>
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
                {submitting ? "Sending…" : (
                  <>
                    Send message
                    <Send className="w-4 h-4" />
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
              Email us directly
            </div>
            <ul className="space-y-2 text-sm">
              <li>
                <p className="text-xs text-gray-500">Sales</p>
                <a href="mailto:sales@grceye.io" className="text-blue-600 hover:underline font-medium">sales@grceye.io</a>
              </li>
              <li>
                <p className="text-xs text-gray-500">Support</p>
                <a href="mailto:support@grceye.io" className="text-blue-600 hover:underline font-medium">support@grceye.io</a>
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
              href="/register"
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

      <PublicFooter />
      <SupportChat />
    </div>
  );
}
