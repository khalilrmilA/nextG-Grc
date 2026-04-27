import { useState } from "react";
import { X, UserCheck, Printer, Loader2, Calendar, Mail, User, CheckCircle } from "lucide-react";
import { complianceApi } from "@/api/endpoints";
import type { ControlAssessmentDetail, GapDetail } from "@/types";

interface Props {
  ca: ControlAssessmentDetail;
  gap?: GapDetail;
  assessmentName: string;
  frameworkName: string;
  onClose: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  implemented: "Compliant",
  partially_implemented: "Partial",
  not_implemented: "Gap",
  not_applicable: "N/A",
  not_started: "Not Started",
  in_progress: "In Progress",
};

const STATUS_COLORS: Record<string, string> = {
  implemented: "#15803d",
  partially_implemented: "#92400e",
  not_implemented: "#991b1b",
  not_applicable: "#6b7280",
  not_started: "#6b7280",
  in_progress: "#1d4ed8",
};

const STATUS_BG: Record<string, string> = {
  implemented: "#dcfce7",
  partially_implemented: "#fef9c3",
  not_implemented: "#fee2e2",
  not_applicable: "#f3f4f6",
  not_started: "#f3f4f6",
  in_progress: "#dbeafe",
};

export default function AssignControlModal({ ca, gap, assessmentName, frameworkName, onClose }: Props) {
  const [form, setForm] = useState({ name: "", email: "", due: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSaveAndPrint() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const assignNote = [
        ca.notes ?? "",
        `\n\n[Assignment] Assigned to: ${form.name}${form.email ? ` <${form.email}>` : ""}`,
        form.due ? `Due: ${new Date(form.due).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}` : null,
        form.notes ? `Notes: ${form.notes}` : null,
        `Assigned on: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`,
      ].filter(Boolean).join("\n");

      await complianceApi.updateControlAssessment(ca.id, { notes: assignNote });
      setSaved(true);
      printPDF();
    } catch {/* silent */} finally { setSaving(false); }
  }

  function printPDF() {
    const status = ca.status;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Control Assignment — ${ca.control_identifier}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,Arial,sans-serif;color:#111827;padding:48px;font-size:13px;line-height:1.65}
    .logo-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;padding-bottom:16px;border-bottom:3px solid #2563eb}
    .logo-title{font-size:22px;font-weight:800;color:#1e40af;letter-spacing:-0.5px}
    .logo-sub{font-size:11px;color:#6b7280;margin-top:2px}
    .doc-type{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af}
    .control-header{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:24px}
    .control-id{font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px}
    .control-title{font-size:18px;font-weight:700;color:#111827;margin-bottom:8px;line-height:1.3}
    .control-meta{display:flex;gap:12px;flex-wrap:wrap}
    .meta-chip{font-size:11px;background:#e2e8f0;color:#475569;padding:3px 10px;border-radius:999px;font-weight:500}
    .status-chip{font-size:11px;padding:3px 12px;border-radius:999px;font-weight:700}
    .section{margin-bottom:22px}
    .section-title{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;color:#9ca3af;margin-bottom:10px;display:flex;align-items:center;gap:6px}
    .section-title::after{content:"";flex:1;height:1px;background:#f1f5f9}
    .info-grid{display:grid;grid-template-columns:160px 1fr;gap:6px 12px}
    .info-label{font-weight:600;color:#374151;font-size:12px}
    .info-value{color:#111827;font-size:12px}
    .ai-box{background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:14px;font-size:12px;color:#0c4a6e;line-height:1.7}
    .gap-box{background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:14px}
    .gap-severity{display:inline-block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;padding:2px 8px;border-radius:4px;margin-bottom:8px;background:#fee2e2;color:#991b1b}
    .gap-desc{font-size:12px;color:#991b1b;line-height:1.6}
    .remediation{font-size:12px;color:#374151;margin-top:8px;padding-top:8px;border-top:1px solid #fecdd3}
    .assign-box{background:#eff6ff;border:2px solid #bfdbfe;border-radius:12px;padding:18px}
    .assign-name{font-size:18px;font-weight:700;color:#1e40af;margin-bottom:4px}
    .assign-meta{font-size:12px;color:#3b82f6;margin-bottom:12px}
    .footer{margin-top:40px;padding-top:16px;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#9ca3af}
    .confidential{font-weight:700;color:#ef4444;letter-spacing:0.06em;text-transform:uppercase;font-size:10px}
    @media print{body{padding:24px}button{display:none}}
  </style>
</head>
<body>
  <div class="logo-bar">
    <div>
      <div class="logo-title">GRC Platform</div>
      <div class="logo-sub">${assessmentName} · ${frameworkName}</div>
    </div>
    <div style="text-align:right">
      <div class="doc-type">Control Assignment</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:2px">${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</div>
    </div>
  </div>

  <div class="control-header">
    <div class="control-id">${ca.control_identifier}</div>
    <div class="control-title">${ca.control_title}</div>
    <div class="control-meta">
      ${ca.control_category ? `<span class="meta-chip">${ca.control_category}</span>` : ""}
      ${ca.is_mandatory ? '<span class="meta-chip" style="background:#fee2e2;color:#991b1b">Mandatory</span>' : ""}
      <span class="status-chip" style="background:${STATUS_BG[status] ?? "#f3f4f6"};color:${STATUS_COLORS[status] ?? "#6b7280"}">${STATUS_LABELS[status] ?? status}</span>
      ${ca.ai_confidence != null ? `<span class="meta-chip">AI confidence: ${Math.round(ca.ai_confidence * 100)}%</span>` : ""}
    </div>
  </div>

  ${ca.control_description ? `
  <div class="section">
    <div class="section-title">Control Description</div>
    <p style="font-size:12px;color:#374151;line-height:1.7">${ca.control_description}</p>
  </div>` : ""}

  ${ca.implementation_notes ? `
  <div class="section">
    <div class="section-title">AI Assessment</div>
    <div class="ai-box">${ca.implementation_notes}</div>
  </div>` : ""}

  ${gap ? `
  <div class="section">
    <div class="section-title">Gap Analysis</div>
    <div class="gap-box">
      <div class="gap-severity">${gap.severity}</div>
      <div class="gap-desc">${gap.gap_description}</div>
      ${gap.remediation_steps ? `<div class="remediation"><strong>Remediation:</strong> ${gap.remediation_steps}</div>` : ""}
    </div>
  </div>` : ""}

  <div class="section">
    <div class="section-title">Control Owner Assignment</div>
    <div class="assign-box">
      <div class="assign-name">${form.name}</div>
      ${form.email ? `<div class="assign-meta">${form.email}</div>` : ""}
      <div class="info-grid" style="margin-top:12px">
        <span class="info-label">Due Date</span>
        <span class="info-value">${form.due ? new Date(form.due).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }) : "No deadline set"}</span>
        ${form.notes ? `<span class="info-label">Assignment Notes</span><span class="info-value">${form.notes}</span>` : ""}
        <span class="info-label">Assigned On</span>
        <span class="info-value">${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</span>
      </div>
    </div>
  </div>

  <div class="footer">
    <span>GRC Platform — Control Assignment Record</span>
    <span class="confidential">Confidential</span>
  </div>

  <script>window.onload=function(){window.print()}</script>
</body>
</html>`;
    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <UserCheck className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Assign Control</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                <span className="font-mono text-gray-500">{ca.control_identifier}</span> — {ca.control_title}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1 mb-1.5">
                <User className="w-3 h-3" /> Full Name *
              </label>
              <input
                type="text"
                placeholder="e.g. John Smith"
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1 mb-1.5">
                <Mail className="w-3 h-3" /> Email
              </label>
              <input
                type="email"
                placeholder="john@company.com"
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1 mb-1.5">
              <Calendar className="w-3 h-3" /> Due Date
            </label>
            <input
              type="date"
              value={form.due}
              onChange={e => setForm(p => ({ ...p, due: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 block">
              Implementation Guidance
            </label>
            <textarea
              placeholder="Describe what the control owner needs to implement or provide as evidence..."
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              rows={3}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400 resize-none"
            />
          </div>

          {saved && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              Assignment saved. PDF is opening in a new tab.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
          <button
            onClick={onClose}
            className="text-sm text-gray-600 border border-gray-200 px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={printPDF}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-700 border border-gray-200 px-4 py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Preview PDF
          </button>
          <button
            onClick={handleSaveAndPrint}
            disabled={!form.name.trim() || saving}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl disabled:opacity-40 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            Save & Export PDF
          </button>
        </div>
      </div>
    </div>
  );
}
