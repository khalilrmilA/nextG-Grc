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

  // Build a lookup map: control_identifier → gap details
  const gapMap = new Map(data.gaps.map((g) => [g.control_identifier, g]));

  // Split controls into groups
  const compliant   = data.controls.filter((c) => c.status === "implemented");
  const partial     = data.controls.filter((c) => c.status === "partially_implemented");
  const nonCompliant= data.controls.filter((c) => c.status === "not_implemented");
  const notApplicable = data.controls.filter((c) => c.status === "not_applicable");
  const notAssessed = data.controls.filter(
    (c) => !["implemented","partially_implemented","not_implemented","not_applicable"].includes(c.status)
  );

  // Progress bar percentage
  const pct = data.complianceScore ?? 0;
  const barFill = Math.max(0, Math.min(100, pct));

  // ── Reusable row renderers ──────────────────────────────────────────────────

  function renderCompliantRow(c: ControlExportRow) {
    return `
      <tr>
        <td style="font-family:monospace;font-size:11px;white-space:nowrap;color:#166534;font-weight:600">${c.control_identifier}</td>
        <td style="font-size:12px;font-weight:500">${c.control_title}</td>
        <td style="font-size:11px;color:#6b7280">${c.control_category ?? "—"}</td>
        <td style="font-size:11px;color:#374151">${c.implementation_notes || c.notes || "—"}</td>
      </tr>`;
  }

  function renderPartialRow(c: ControlExportRow) {
    const gap = gapMap.get(c.control_identifier);
    return `
      <tr>
        <td style="font-family:monospace;font-size:11px;white-space:nowrap;color:#92400e;font-weight:600">${c.control_identifier}</td>
        <td style="font-size:12px;font-weight:500">${c.control_title}</td>
        <td style="font-size:11px;color:#6b7280">${c.control_category ?? "—"}</td>
        <td style="font-size:11px;color:#374151">${c.implementation_notes || c.notes || "—"}</td>
        <td style="font-size:11px;color:#92400e">${gap?.gap_description ?? "—"}</td>
        <td style="font-size:11px;color:#6b7280">${gap?.remediation_steps ?? "—"}</td>
      </tr>`;
  }

  function renderGapRow(c: ControlExportRow) {
    const gap = gapMap.get(c.control_identifier);
    const sev = gap?.severity ?? "low";
    const blocker = gap?.is_certification_blocker === true;
    return `
      <tr>
        <td style="font-family:monospace;font-size:11px;white-space:nowrap;color:#991b1b;font-weight:600">
          ${c.control_identifier}
          ${blocker ? `<br/><span style="background:#fee2e2;color:#991b1b;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;text-transform:uppercase">BLOCKER</span>` : ""}
        </td>
        <td style="font-size:12px;font-weight:500">${c.control_title}</td>
        <td style="font-size:11px;color:#6b7280">${c.control_category ?? "—"}</td>
        <td>
          <span style="background:${severityBg(sev)};color:${severityColor(sev)};padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase">
            ${sev}
          </span>
        </td>
        <td style="font-size:11px;color:#374151">${gap?.gap_description ?? c.notes ?? "—"}</td>
        <td style="font-size:11px;color:#6b7280">${gap?.remediation_steps ?? "—"}</td>
      </tr>`;
  }

  function renderNaRow(c: ControlExportRow) {
    return `
      <tr>
        <td style="font-family:monospace;font-size:11px;white-space:nowrap;color:#6b7280;font-weight:600">${c.control_identifier}</td>
        <td style="font-size:12px;font-weight:500">${c.control_title}</td>
        <td style="font-size:11px;color:#6b7280">${c.control_category ?? "—"}</td>
        <td style="font-size:11px;color:#9ca3af">${c.notes ?? "—"}</td>
      </tr>`;
  }

  function sectionHeader(color: string, bg: string, title: string, count: number, icon: string) {
    return `
      <div style="display:flex;align-items:center;gap:10px;margin:32px 0 10px;padding:10px 16px;background:${bg};border-left:4px solid ${color};border-radius:0 8px 8px 0">
        <span style="font-size:18px">${icon}</span>
        <div>
          <div style="font-size:15px;font-weight:700;color:${color}">${title}</div>
          <div style="font-size:11px;color:#6b7280;margin-top:1px">${count} control${count !== 1 ? "s" : ""}</div>
        </div>
      </div>`;
  }

  function emptyRow(colspan: number, msg: string) {
    return `<tr><td colspan="${colspan}" style="text-align:center;color:#9ca3af;padding:20px;font-style:italic">${msg}</td></tr>`;
  }

  // ── Sections HTML ────────────────────────────────────────────────────────────

  const s1 = compliant.length > 0
    ? compliant.map(renderCompliantRow).join("")
    : emptyRow(4, "No compliant controls");

  const s2 = partial.length > 0
    ? partial.map(renderPartialRow).join("")
    : emptyRow(6, "No partially implemented controls");

  const s3 = nonCompliant.length > 0
    ? nonCompliant.map(renderGapRow).join("")
    : emptyRow(6, "No gaps identified");

  const s4 = notApplicable.length > 0
    ? notApplicable.map(renderNaRow).join("")
    : emptyRow(4, "No controls marked as Not Applicable");

  const s5html = notAssessed.length > 0
    ? `${sectionHeader("#6b7280","#f9fafb","Not Yet Assessed", notAssessed.length, "⏳")}
       <table>
         <thead><tr>
           <th>Control ID</th><th>Title</th><th>Category</th><th>Notes</th>
         </tr></thead>
         <tbody>${notAssessed.map(renderNaRow).join("")}</tbody>
       </table>`
    : "";

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
    .meta { color: #6b7280; font-size: 13px; margin-top: 4px; }
    .score-row { display: flex; gap: 12px; margin: 24px 0 8px; flex-wrap: wrap; }
    .card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 18px; flex: 1; min-width: 120px; text-align: center; }
    .card .num { font-size: 26px; font-weight: 700; }
    .card .lbl { font-size: 11px; color: #6b7280; margin-top: 3px; }
    .progress-wrap { margin: 8px 0 24px; }
    .progress-bar-bg { height: 12px; background: #f3f4f6; border-radius: 6px; overflow: hidden; }
    .progress-bar-fill { height: 100%; border-radius: 6px; background: linear-gradient(to right, #22c55e, #86efac); width: ${barFill}%; }
    .progress-label { font-size: 11px; color: #6b7280; margin-top: 4px; text-align: right; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #f3f4f6; text-align: left; padding: 8px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #6b7280; letter-spacing: .05em; }
    td { padding: 8px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafafa; }
    .footer { margin-top: 48px; border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 11px; color: #9ca3af; text-align: center; }
    @media print {
      .page { padding: 20px; }
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e3a5f;padding-bottom:16px;margin-bottom:20px">
    <div>
      <h1>Compliance Assessment Report</h1>
      <p class="meta">${data.assessmentName} &nbsp;·&nbsp; ${data.frameworkName}</p>
    </div>
    <div style="text-align:right">
      <div style="font-size:11px;color:#9ca3af">Generated</div>
      <div style="font-size:13px;font-weight:600">${data.generatedAt}</div>
      ${data.org ? `<div style="font-size:12px;color:#6b7280;margin-top:2px">${data.org}</div>` : ""}
    </div>
  </div>

  <!-- Summary cards -->
  <div class="score-row">
    <div class="card" style="border-top:3px solid ${scoreColor}">
      <div class="num" style="color:${scoreColor}">${data.complianceScore != null ? data.complianceScore + "%" : "—"}</div>
      <div class="lbl">Compliance Score</div>
    </div>
    <div class="card" style="border-top:3px solid #166534">
      <div class="num" style="color:#166534">${data.statusCounts.implemented}</div>
      <div class="lbl">✅ Compliant</div>
    </div>
    <div class="card" style="border-top:3px solid #d97706">
      <div class="num" style="color:#d97706">${data.statusCounts.partially_implemented}</div>
      <div class="lbl">⚠️ Partial</div>
    </div>
    <div class="card" style="border-top:3px solid #dc2626">
      <div class="num" style="color:#dc2626">${data.statusCounts.not_implemented}</div>
      <div class="lbl">❌ Non-Compliant</div>
    </div>
    <div class="card" style="border-top:3px solid #9ca3af">
      <div class="num" style="color:#6b7280">${data.statusCounts.not_applicable}</div>
      <div class="lbl">N/A</div>
    </div>
    <div class="card" style="border-top:3px solid #6366f1">
      <div class="num">${data.statusCounts.total}</div>
      <div class="lbl">Total Controls</div>
    </div>
  </div>

  <!-- Progress bar -->
  <div class="progress-wrap">
    <div class="progress-bar-bg"><div class="progress-bar-fill"></div></div>
    <div class="progress-label">${pct}% compliant</div>
  </div>

  <!-- SECTION 1: Compliant -->
  ${sectionHeader("#166534", "#f0fdf4", "Compliant Controls", compliant.length, "✅")}
  <table>
    <thead><tr>
      <th style="width:100px">Control ID</th>
      <th>Title</th>
      <th style="width:160px">Category</th>
      <th>Implementation Notes</th>
    </tr></thead>
    <tbody>${s1}</tbody>
  </table>

  <!-- SECTION 2: Partial -->
  ${sectionHeader("#d97706", "#fffbeb", "Partially Implemented Controls", partial.length, "⚠️")}
  <table>
    <thead><tr>
      <th style="width:100px">Control ID</th>
      <th>Title</th>
      <th style="width:140px">Category</th>
      <th>Notes</th>
      <th>Gap Description</th>
      <th>Remediation Steps</th>
    </tr></thead>
    <tbody>${s2}</tbody>
  </table>

  <!-- SECTION 3: Non-Compliant / Gaps -->
  ${sectionHeader("#dc2626", "#fef2f2", "Non-Compliant Controls (Gaps)", nonCompliant.length, "❌")}
  <table>
    <thead><tr>
      <th style="width:110px">Control ID</th>
      <th>Title</th>
      <th style="width:130px">Category</th>
      <th style="width:90px">Severity</th>
      <th>Gap Description</th>
      <th>Remediation Steps</th>
    </tr></thead>
    <tbody>${s3}</tbody>
  </table>

  <!-- SECTION 4: Not Applicable -->
  ${sectionHeader("#6b7280", "#f9fafb", "Not Applicable", notApplicable.length, "➖")}
  <table>
    <thead><tr>
      <th style="width:100px">Control ID</th>
      <th>Title</th>
      <th style="width:160px">Category</th>
      <th>Justification</th>
    </tr></thead>
    <tbody>${s4}</tbody>
  </table>

  <!-- SECTION 5: Not Yet Assessed (conditional) -->
  ${s5html}

  <div class="footer">
    GRCEye &nbsp;·&nbsp; ${data.frameworkShortName} Compliance Report &nbsp;·&nbsp; ${data.generatedAt}
    &nbsp;·&nbsp; ${data.statusCounts.total} controls total
  </div>
</div>
</body>
</html>`;

  const safe = data.assessmentName.replace(/[^a-z0-9]/gi, "_");
  downloadFile(html, `compliance_report_${safe}.html`, "text/html;charset=utf-8;");
}

// ─── Déclaration d'Applicabilité (DdA / SoA) ─────────────────────────────────

export interface DdAControl {
  control_identifier: string;
  control_title: string;
  control_category?: string | null;
  control_description?: string | null;
  status: string;
  notes?: string | null;
  implementation_notes?: string | null;
  not_applicable_justification?: string | null;
  is_mandatory?: boolean;
}

export interface DdAData {
  assessmentName: string;
  frameworkName: string;
  frameworkShortName: string;
  org: string;
  generatedAt: string;
  complianceScore: number | null;
  controls: DdAControl[];
}

export function exportDdA(data: DdAData) {
  const applicable   = data.controls.filter((c) => c.status !== "not_applicable");
  const notApplicable= data.controls.filter((c) => c.status === "not_applicable");
  const total        = data.controls.length;
  const pct          = data.complianceScore;
  const scoreColor   = pct == null ? "#6b7280" : pct >= 80 ? "#166534" : pct >= 60 ? "#d97706" : "#dc2626";

  function statusLabel(s: string): string {
    if (s === "implemented")           return "Implémenté";
    if (s === "partially_implemented") return "Partiel";
    if (s === "not_implemented")       return "Non implémenté";
    if (s === "in_progress")           return "En cours";
    if (s === "not_applicable")        return "Non applicable";
    return "Non évalué";
  }
  function statusIcon(s: string): string {
    if (s === "implemented")           return "✅";
    if (s === "partially_implemented") return "⚠️";
    if (s === "not_implemented")       return "❌";
    if (s === "in_progress")           return "🔄";
    if (s === "not_applicable")        return "➖";
    return "⬜";
  }
  function statusStyle(s: string): string {
    if (s === "implemented")           return "background:#dcfce7;color:#166534";
    if (s === "partially_implemented") return "background:#fef9c3;color:#854d0e";
    if (s === "not_implemented")       return "background:#fee2e2;color:#991b1b";
    if (s === "in_progress")           return "background:#dbeafe;color:#1e40af";
    return "background:#f3f4f6;color:#6b7280";
  }
  function applicableStyle(s: string): string {
    return s === "not_applicable"
      ? "background:#f3f4f6;color:#6b7280"
      : "background:#eff6ff;color:#1d4ed8";
  }
  function applicableLabel(s: string): string {
    return s === "not_applicable" ? "Non" : "Oui";
  }
  function justification(c: DdAControl): string {
    if (c.status === "not_applicable") return c.not_applicable_justification || c.notes || "—";
    return c.implementation_notes || c.notes || "—";
  }

  // Group controls by category
  const categories = [...new Set(data.controls.map((c) => c.control_category || "Général"))];

  const categorySections = categories.map((cat) => {
    const catControls = data.controls.filter((c) => (c.control_category || "Général") === cat);
    const rows = catControls.map((c) => `
      <tr>
        <td style="font-family:monospace;font-size:11px;font-weight:700;white-space:nowrap;color:#1e3a5f">${c.control_identifier}</td>
        <td style="font-size:12px">${c.control_title}
          ${c.is_mandatory ? `<span style="background:#fef3c7;color:#92400e;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;margin-left:4px;vertical-align:middle">OBLIGATOIRE</span>` : ""}
          ${c.control_description ? `<div style="font-size:10px;color:#9ca3af;margin-top:2px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.control_description.slice(0,120)}${c.control_description.length > 120 ? "…" : ""}</div>` : ""}
        </td>
        <td style="text-align:center">
          <span style="${applicableStyle(c.status)};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">${applicableLabel(c.status)}</span>
        </td>
        <td style="text-align:center">
          <span style="${statusStyle(c.status)};padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600">${statusIcon(c.status)} ${statusLabel(c.status)}</span>
        </td>
        <td style="font-size:11px;color:#374151;max-width:260px">${justification(c)}</td>
      </tr>`).join("");

    return `
      <tr>
        <td colspan="5" style="padding:10px 12px 4px;background:#f8fafc;border-top:2px solid #e2e8f0">
          <span style="font-size:12px;font-weight:700;color:#1e3a5f;text-transform:uppercase;letter-spacing:.05em">${cat}</span>
          <span style="font-size:11px;color:#94a3b8;margin-left:6px">(${catControls.length} contrôles)</span>
        </td>
      </tr>
      ${rows}`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <title>Déclaration d'Applicabilité — ${data.assessmentName}</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#0f172a; background:#fff; }
    .page { max-width:1150px; margin:0 auto; padding:40px 32px; }
    table { width:100%; border-collapse:collapse; }
    th { background:#1e3a5f; color:#fff; text-align:left; padding:9px 12px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; }
    td { padding:9px 12px; border-bottom:1px solid #f1f5f9; vertical-align:top; }
    tr:hover td { background:#fafbff; }
    .footer { margin-top:40px; border-top:2px solid #e2e8f0; padding-top:14px; font-size:11px; color:#94a3b8; display:flex; justify-content:space-between; }
    @media print {
      .page { padding:16px; }
      tr { page-break-inside:avoid; }
      thead { display:table-header-group; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Official header -->
  <div style="border:2px solid #1e3a5f;border-radius:8px;padding:20px 24px;margin-bottom:28px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">
          Document officiel de conformité
        </div>
        <h1 style="font-size:24px;font-weight:800;color:#1e3a5f;line-height:1.2">
          Déclaration d'Applicabilité
        </h1>
        <div style="font-size:13px;color:#475569;margin-top:3px">
          Statement of Applicability (SoA) — ${data.frameworkName}
        </div>
      </div>
      <div style="text-align:right;min-width:200px">
        <div style="font-size:20px;font-weight:800;color:${scoreColor}">${pct != null ? pct+"%" : "—"}</div>
        <div style="font-size:10px;color:#94a3b8;margin-bottom:8px">Score de conformité</div>
        <div style="font-size:12px;color:#374151"><b>Organisation :</b> ${data.org || "—"}</div>
        <div style="font-size:12px;color:#374151"><b>Date :</b> ${data.generatedAt}</div>
        <div style="font-size:12px;color:#374151"><b>Assessment :</b> ${data.assessmentName}</div>
      </div>
    </div>

    <!-- Summary stats row -->
    <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:90px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#166534">${applicable.filter(c=>c.status==="implemented").length}</div>
        <div style="font-size:10px;color:#166534;font-weight:600">✅ Implémenté</div>
      </div>
      <div style="flex:1;min-width:90px;background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#854d0e">${applicable.filter(c=>c.status==="partially_implemented").length}</div>
        <div style="font-size:10px;color:#854d0e;font-weight:600">⚠️ Partiel</div>
      </div>
      <div style="flex:1;min-width:90px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#dc2626">${applicable.filter(c=>c.status==="not_implemented").length}</div>
        <div style="font-size:10px;color:#dc2626;font-weight:600">❌ Non implémenté</div>
      </div>
      <div style="flex:1;min-width:90px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#6b7280">${notApplicable.length}</div>
        <div style="font-size:10px;color:#6b7280;font-weight:600">➖ Non applicable</div>
      </div>
      <div style="flex:1;min-width:90px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#1e3a5f">${total}</div>
        <div style="font-size:10px;color:#475569;font-weight:600">Total contrôles</div>
      </div>
    </div>
  </div>

  <!-- Intro paragraph (ISO 27001 standard wording) -->
  <div style="background:#f8fafc;border-left:4px solid #1e3a5f;padding:12px 16px;margin-bottom:24px;font-size:12px;color:#374151;line-height:1.6">
    <b>Objet :</b> Ce document constitue la Déclaration d'Applicabilité (DdA) de l'organisation conformément aux exigences du référentiel
    <b>${data.frameworkName}</b>. Il liste l'ensemble des contrôles du référentiel, indique pour chacun s'il est applicable ou non,
    son état d'implémentation, et fournit la justification correspondante. Ce document est généré automatiquement depuis les données
    de l'assessment <b>${data.assessmentName}</b> à la date du <b>${data.generatedAt}</b>.
  </div>

  <!-- Main table (grouped by category) -->
  <table>
    <thead>
      <tr>
        <th style="width:100px">Contrôle</th>
        <th>Titre &amp; Description</th>
        <th style="width:80px;text-align:center">Applicable</th>
        <th style="width:130px;text-align:center">Statut</th>
        <th style="width:280px">Justification / Notes d'implémentation</th>
      </tr>
    </thead>
    <tbody>
      ${categorySections}
    </tbody>
  </table>

  <!-- Signature block -->
  <div style="margin-top:40px;display:flex;gap:32px">
    <div style="flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:16px">
      <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;margin-bottom:12px">Approuvé par (CISO / DG)</div>
      <div style="border-bottom:1px solid #94a3b8;margin-bottom:6px;height:32px"></div>
      <div style="font-size:11px;color:#94a3b8">Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date : ___/___/______</div>
    </div>
    <div style="flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:16px">
      <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;margin-bottom:12px">Validé par (Responsable SSI)</div>
      <div style="border-bottom:1px solid #94a3b8;margin-bottom:6px;height:32px"></div>
      <div style="font-size:11px;color:#94a3b8">Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date : ___/___/______</div>
    </div>
    <div style="flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:16px">
      <div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;margin-bottom:12px">Version du document</div>
      <div style="font-size:13px;color:#374151;margin-top:4px">Version : 1.0</div>
      <div style="font-size:12px;color:#374151">Date d'émission : ${data.generatedAt}</div>
      <div style="font-size:12px;color:#374151">Référentiel : ${data.frameworkShortName}</div>
    </div>
  </div>

  <div class="footer">
    <span>GRCEye — Déclaration d'Applicabilité (DdA)</span>
    <span>${data.frameworkShortName} · ${data.assessmentName}</span>
    <span>Généré le ${data.generatedAt}</span>
  </div>
</div>
</body>
</html>`;

  const safe = data.assessmentName.replace(/[^a-z0-9]/gi, "_");
  downloadFile(html, `DdA_${data.frameworkShortName}_${safe}.html`, "text/html;charset=utf-8;");
}
