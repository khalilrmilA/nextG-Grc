/**
 * Export utilities — generates CSV and printable HTML reports
 * No external dependencies needed (uses browser APIs only)
 */

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function buildCsv(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(csvEscape).join(","),
    ...rows.map((r) => r.map(csvEscape).join(",")),
  ];
  return lines.join("\r\n");
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Gap Report export ────────────────────────────────────────────────────────

export interface GapExportRow {
  control_identifier: string;
  control_title: string;
  severity: string;
  gap_description: string;
  remediation_steps?: string | null;
  is_certification_blocker?: boolean;
  recommendation_status?: string;
}

export function exportGapsCSV(gaps: GapExportRow[], assessmentName: string) {
  const headers = [
    "Control ID", "Control Title", "Severity", "Certification Blocker",
    "Gap Description", "Remediation Steps", "Status",
  ];
  const rows = gaps.map((g) => [
    g.control_identifier,
    g.control_title,
    g.severity.toUpperCase(),
    g.is_certification_blocker === true ? "YES" : "NO",
    g.gap_description,
    g.remediation_steps ?? "",
    g.recommendation_status ?? "pending",
  ]);
  const csv = buildCsv(headers, rows);
  const safe = assessmentName.replace(/[^a-z0-9]/gi, "_");
  downloadFile(csv, `gap_report_${safe}.csv`, "text/csv;charset=utf-8;");
}

// ─── Risk Register export ─────────────────────────────────────────────────────

export interface RiskExportRow {
  title: string;
  risk_category?: string | null;
  status: string;
  severity?: string | null;
  likelihood?: number | null;
  impact?: number | null;
  inherent_risk_score?: number | null;
  residual_risk_score?: number | null;
  tags?: string[];
  description?: string | null;
}

export function exportRisksCSV(risks: RiskExportRow[]) {
  const headers = [
    "Title", "Category", "Status", "Severity",
    "Likelihood (1-5)", "Impact (1-5)", "Inherent Score", "Residual Score",
    "Tags", "Description",
  ];
  const rows = risks.map((r) => [
    r.title,
    r.risk_category ?? "",
    r.status.replaceAll("_", " "),
    (r.severity ?? "").toUpperCase(),
    r.likelihood ?? "",
    r.impact ?? "",
    r.inherent_risk_score ?? "",
    r.residual_risk_score ?? "",
    (r.tags ?? []).join("; "),
    r.description ?? "",
  ]);
  const csv = buildCsv(headers, rows);
  downloadFile(csv, `risk_register_${new Date().toISOString().slice(0,10)}.csv`, "text/csv;charset=utf-8;");
}

// ─── Compliance Summary export ────────────────────────────────────────────────

export interface ControlExportRow {
  control_identifier: string;
  control_title: string;
  control_category?: string | null;
  status: string;
  notes?: string | null;
  implementation_notes?: string | null;
}

export function exportComplianceCSV(
  controls: ControlExportRow[],
  assessmentName: string,
  frameworkName: string
) {
  const headers = [
    "Framework", "Control ID", "Control Title", "Category",
    "Status", "Notes", "Implementation Notes",
  ];
  const rows = controls.map((c) => [
    frameworkName,
    c.control_identifier,
    c.control_title,
    c.control_category ?? "",
    c.status.replaceAll("_", " "),
    c.notes ?? "",
    c.implementation_notes ?? "",
  ]);
  const csv = buildCsv(headers, rows);
  const safe = assessmentName.replace(/[^a-z0-9]/gi, "_");
  downloadFile(csv, `compliance_assessment_${safe}.csv`, "text/csv;charset=utf-8;");
}

// ─── Full HTML Report (print-to-PDF) ─────────────────────────────────────────

export interface ReportData {
  assessmentName: string;
  frameworkName: string;
  frameworkShortName: string;
  complianceScore: number | null;
  generatedAt: string;
  org: string;
  statusCounts: {
    implemented: number;
    partially_implemented: number;
    not_implemented: number;
    not_applicable: number;
    total: number;
  };
  gaps: GapExportRow[];
  controls: ControlExportRow[];
}

function severityBg(s: string) {
  if (s === "critical") return "#fee2e2";
  if (s === "high") return "#ffedd5";
  if (s === "medium") return "#fef9c3";
  return "#f3f4f6";
}
function severityColor(s: string) {
  if (s === "critical") return "#991b1b";
  if (s === "high") return "#9a3412";
  if (s === "medium") return "#854d0e";
  return "#374151";
}
function statusColor(s: string) {
  if (s === "implemented") return "#166534";
  if (s === "partially_implemented") return "#854d0e";
  if (s === "not_implemented") return "#991b1b";
  return "#6b7280";
}
function statusBg(s: string) {
  if (s === "implemented") return "#dcfce7";
  if (s === "partially_implemented") return "#fef9c3";
  if (s === "not_implemented") return "#fee2e2";
  return "#f3f4f6";
}

export function exportComplianceReport(data: ReportData) {
  const scoreColor = data.complianceScore == null ? "#6b7280"
    : data.complianceScore >= 80 ? "#166534"
    : data.complianceScore >= 60 ? "#854d0e"
    : "#991b1b";

  const gapsHtml = data.gaps.length === 0
    ? `<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:16px;">No open gaps</td></tr>`
    : data.gaps.map((g) => `
      <tr>
        <td style="font-family:monospace;font-size:12px">${g.control_identifier}</td>
        <td>${g.control_title}</td>
        <td>
          <span style="background:${severityBg(g.severity)};color:${severityColor(g.severity)};
            padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;text-transform:uppercase">
            ${g.severity}
          </span>
          ${g.is_certification_blocker === true ? `<span style="background:#fee2e2;color:#991b1b;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:4px">BLOCKER</span>` : ""}
        </td>
        <td style="font-size:12px;color:#374151">${g.gap_description}</td>
        <td style="font-size:12px;color:#6b7280">${g.remediation_steps ?? "—"}</td>
      </tr>`).join("");

  const controlsHtml = data.controls.map((c) => `
    <tr>
      <td style="font-family:monospace;font-size:12px">${c.control_identifier}</td>
      <td style="font-size:12px">${c.control_title}</td>
      <td style="font-size:12px;color:#6b7280">${c.control_category ?? "—"}</td>
      <td>
        <span style="background:${statusBg(c.status)};color:${statusColor(c.status)};
          padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">
          ${c.status.replaceAll("_", " ")}
        </span>
      </td>
      <td style="font-size:12px;color:#6b7280">${c.notes ?? "—"}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Compliance Report — ${data.assessmentName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827; background: #fff; }
    .page { max-width: 1100px; margin: 0 auto; padding: 40px 32px; }
    h1 { font-size: 26px; font-weight: 700; color: #1e3a5f; }
    h2 { font-size: 16px; font-weight: 600; color: #1e3a5f; margin: 32px 0 12px; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px; }
    .meta { color: #6b7280; font-size: 13px; margin-top: 4px; }
    .score-row { display: flex; gap: 16px; margin: 24px 0; flex-wrap: wrap; }
    .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px 20px; flex: 1; min-width: 140px; text-align: center; }
    .card .num { font-size: 28px; font-weight: 700; }
    .card .lbl { font-size: 12px; color: #6b7280; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #f3f4f6; text-align: left; padding: 8px 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; color: #6b7280; letter-spacing: .05em; }
    td { padding: 8px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .footer { margin-top: 40px; border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 11px; color: #9ca3af; text-align: center; }
    @media print { .page { padding: 20px; } h2 { page-break-before: auto; } }
  </style>
</head>
<body>
<div class="page">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e3a5f;padding-bottom:16px;margin-bottom:8px">
    <div>
      <h1>Compliance Assessment Report</h1>
      <p class="meta">${data.assessmentName} &nbsp;·&nbsp; ${data.frameworkName}</p>
    </div>
    <div style="text-align:right">
      <div style="font-size:11px;color:#9ca3af">Generated</div>
      <div style="font-size:13px;font-weight:600">${data.generatedAt}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:2px">${data.org}</div>
    </div>
  </div>

  <div class="score-row">
    <div class="card">
      <div class="num" style="color:${scoreColor}">${data.complianceScore ?? "—"}${data.complianceScore != null ? "%" : ""}</div>
      <div class="lbl">Compliance Score</div>
    </div>
    <div class="card">
      <div class="num" style="color:#166534">${data.statusCounts.implemented}</div>
      <div class="lbl">Compliant</div>
    </div>
    <div class="card">
      <div class="num" style="color:#854d0e">${data.statusCounts.partially_implemented}</div>
      <div class="lbl">Partial</div>
    </div>
    <div class="card">
      <div class="num" style="color:#991b1b">${data.statusCounts.not_implemented}</div>
      <div class="lbl">Gaps</div>
    </div>
    <div class="card">
      <div class="num" style="color:#6b7280">${data.statusCounts.not_applicable}</div>
      <div class="lbl">Not Applicable</div>
    </div>
    <div class="card">
      <div class="num">${data.statusCounts.total}</div>
      <div class="lbl">Total Controls</div>
    </div>
  </div>

  <h2>Open Gaps (${data.gaps.length})</h2>
  <table>
    <thead><tr>
      <th>Control ID</th><th>Title</th><th>Severity</th><th>Gap Description</th><th>Remediation Steps</th>
    </tr></thead>
    <tbody>${gapsHtml}</tbody>
  </table>

  <h2>Control Assessment Detail (${data.controls.length} controls)</h2>
  <table>
    <thead><tr>
      <th>Control ID</th><th>Title</th><th>Category</th><th>Status</th><th>Notes</th>
    </tr></thead>
    <tbody>${controlsHtml}</tbody>
  </table>

  <div class="footer">
    ComplyZone · ${data.frameworkShortName} Compliance Report · ${data.generatedAt}
  </div>
</div>
</body>
</html>`;

  const safe = data.assessmentName.replace(/[^a-z0-9]/gi, "_");
  downloadFile(html, `compliance_report_${safe}.html`, "text/html;charset=utf-8;");
}
