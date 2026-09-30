/**
 * Export utilities — generates CSV and printable HTML reports
 * No external dependencies needed (uses browser APIs only)
 *
 * Every user-visible string goes through i18n.t() and is resolved at CALL time,
 * so an export is written in whatever language the UI is in when the button is
 * pressed (keys: export.*, report_pdf.*, dda.* in i18n/sweep/g7_exports.ts).
 */
import i18n from "@/i18n";

// ─── i18n helpers ─────────────────────────────────────────────────────────────

type ExportLang = "en" | "fr" | "ar";

function currentLang(): ExportLang {
  const raw = (i18n.language || "en").toLowerCase();
  if (raw.startsWith("fr")) return "fr";
  if (raw.startsWith("ar")) return "ar";
  return "en";
}

function tr(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(key, options as never));
}

/** Translate a raw enum value (e.g. "in_progress") with a readable fallback. */
function trEnum(key: string, raw: string | null | undefined): string {
  if (!raw) return "";
  return tr(key, { defaultValue: raw.replaceAll("_", " ") });
}

/** Keeps letters of any script (French accents, Arabic) — strips only what a
 *  filesystem or the download attribute cannot take. */
function fileSafe(s: string): string {
  return (s || "").replace(/[^\p{L}\p{N}_-]+/gu, "_");
}

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
  // UTF-8 BOM: without it Excel opens the file as ANSI and mangles accented
  // French and all Arabic text.
  return "﻿" + lines.join("\r\n");
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

function severityLabel(s: string | null | undefined): string {
  if (!s) return "";
  return trEnum(`compliance.severities.${s}`, s).toLocaleUpperCase(currentLang());
}

export function exportGapsCSV(gaps: GapExportRow[], assessmentName: string) {
  const headers = [
    tr("export.col.control_id"), tr("export.col.control_title"), tr("export.col.severity"),
    tr("export.col.certification_blocker"), tr("export.col.gap_description"),
    tr("export.col.remediation_steps"), tr("export.col.status"),
  ];
  const rows = gaps.map((g) => [
    g.control_identifier,
    g.control_title,
    severityLabel(g.severity),
    g.is_certification_blocker === true ? tr("export.yes") : tr("export.no"),
    g.gap_description,
    g.remediation_steps ?? "",
    trEnum(`export.rec_status.${g.recommendation_status ?? "pending"}`, g.recommendation_status ?? "pending"),
  ]);
  const csv = buildCsv(headers, rows);
  const safe = fileSafe(assessmentName);
  downloadFile(csv, `${fileSafe(tr("export.file.gap_report"))}_${safe}.csv`, "text/csv;charset=utf-8;");
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
    tr("export.col.title"), tr("export.col.category"), tr("export.col.status"), tr("export.col.severity"),
    tr("export.col.likelihood"), tr("export.col.impact"), tr("export.col.inherent_score"),
    tr("export.col.residual_score"), tr("export.col.tags"), tr("export.col.description"),
  ];
  const rows = risks.map((r) => [
    r.title,
    trEnum(`risks.categories.${r.risk_category}`, r.risk_category),
    trEnum(`risks.statuses.${r.status}`, r.status),
    severityLabel(r.severity),
    r.likelihood ?? "",
    r.impact ?? "",
    r.inherent_risk_score ?? "",
    r.residual_risk_score ?? "",
    (r.tags ?? []).join("; "),
    r.description ?? "",
  ]);
  const csv = buildCsv(headers, rows);
  downloadFile(csv, `${fileSafe(tr("export.file.risk_register"))}_${new Date().toISOString().slice(0,10)}.csv`, "text/csv;charset=utf-8;");
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
    tr("export.col.framework"), tr("export.col.control_id"), tr("export.col.control_title"),
    tr("export.col.category"), tr("export.col.status"), tr("export.col.notes"),
    tr("export.col.implementation_notes"),
  ];
  const rows = controls.map((c) => [
    frameworkName,
    c.control_identifier,
    c.control_title,
    c.control_category ?? "",
    trEnum(`compliance.statuses.${c.status}`, c.status),
    c.notes ?? "",
    c.implementation_notes ?? "",
  ]);
  const csv = buildCsv(headers, rows);
  const safe = fileSafe(assessmentName);
  downloadFile(csv, `${fileSafe(tr("export.file.compliance_assessment"))}_${safe}.csv`, "text/csv;charset=utf-8;");
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
  if (s === "critical") return "#F9E1E1";
  if (s === "high") return "#ffedd5";
  if (s === "medium") return "#FBF6E3";
  return "#ECECE9";
}
function severityColor(s: string) {
  if (s === "critical") return "#772829";
  if (s === "high") return "#9a3412";
  if (s === "medium") return "#665A29";
  return "#3D4249";
}

/** Builds the printable compliance report as a standalone HTML document. */
export function buildComplianceReportHtml(data: ReportData): string {
  const lang = currentLang();
  const dir = lang === "ar" ? "rtl" : "ltr";
  const scoreColor = data.complianceScore == null ? "#5B6068"
    : data.complianceScore >= 80 ? "#31613F"
    : data.complianceScore >= 60 ? "#665A29"
    : "#772829";

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

  // Column headers
  const hId = tr("report_pdf.col_control_id");
  const hTitle = tr("report_pdf.col_title");
  const hCat = tr("report_pdf.col_category");
  const hNotes = tr("report_pdf.col_notes");
  const hImpl = tr("report_pdf.col_impl_notes");
  const hGap = tr("report_pdf.col_gap");
  const hRem = tr("report_pdf.col_remediation");
  const hSev = tr("report_pdf.col_severity");
  const hJust = tr("report_pdf.col_justification");

  // ── Reusable row renderers ──────────────────────────────────────────────────

  function renderCompliantRow(c: ControlExportRow) {
    return `
      <tr>
        <td style="font-family:monospace;font-size:11px;white-space:nowrap;color:#31613F;font-weight:600">${c.control_identifier}</td>
        <td style="font-size:12px;font-weight:500">${c.control_title}</td>
        <td style="font-size:11px;color:#5B6068">${c.control_category ?? "—"}</td>
        <td style="font-size:11px;color:#3D4249">${c.implementation_notes || c.notes || "—"}</td>
      </tr>`;
  }

  function renderPartialRow(c: ControlExportRow) {
    const gap = gapMap.get(c.control_identifier);
    return `
      <tr>
        <td style="font-family:monospace;font-size:11px;white-space:nowrap;color:#665A29;font-weight:600">${c.control_identifier}</td>
        <td style="font-size:12px;font-weight:500">${c.control_title}</td>
        <td style="font-size:11px;color:#5B6068">${c.control_category ?? "—"}</td>
        <td style="font-size:11px;color:#3D4249">${c.implementation_notes || c.notes || "—"}</td>
        <td style="font-size:11px;color:#665A29">${gap?.gap_description ?? "—"}</td>
        <td style="font-size:11px;color:#5B6068">${gap?.remediation_steps ?? "—"}</td>
      </tr>`;
  }

  function renderGapRow(c: ControlExportRow) {
    const gap = gapMap.get(c.control_identifier);
    const sev = gap?.severity ?? "low";
    const blocker = gap?.is_certification_blocker === true;
    return `
      <tr>
        <td style="font-family:monospace;font-size:11px;white-space:nowrap;color:#772829;font-weight:600">
          ${c.control_identifier}
          ${blocker ? `<br/><span style="background:#F9E1E1;color:#772829;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:700;text-transform:uppercase">${tr("report_pdf.blocker")}</span>` : ""}
        </td>
        <td style="font-size:12px;font-weight:500">${c.control_title}</td>
        <td style="font-size:11px;color:#5B6068">${c.control_category ?? "—"}</td>
        <td>
          <span style="background:${severityBg(sev)};color:${severityColor(sev)};padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase">
            ${trEnum(`compliance.severities.${sev}`, sev)}
          </span>
        </td>
        <td style="font-size:11px;color:#3D4249">${gap?.gap_description ?? c.notes ?? "—"}</td>
        <td style="font-size:11px;color:#5B6068">${gap?.remediation_steps ?? "—"}</td>
      </tr>`;
  }

  function renderNaRow(c: ControlExportRow) {
    return `
      <tr>
        <td style="font-family:monospace;font-size:11px;white-space:nowrap;color:#5B6068;font-weight:600">${c.control_identifier}</td>
        <td style="font-size:12px;font-weight:500">${c.control_title}</td>
        <td style="font-size:11px;color:#5B6068">${c.control_category ?? "—"}</td>
        <td style="font-size:11px;color:#8E9299">${c.notes ?? "—"}</td>
      </tr>`;
  }

  function sectionHeader(color: string, bg: string, title: string, count: number, icon: string) {
    return `
      <div style="display:flex;align-items:center;gap:10px;margin:32px 0 10px;padding:10px 16px;background:${bg};border-inline-start:4px solid ${color};border-start-end-radius:8px;border-end-end-radius:8px">
        <span style="font-size:18px">${icon}</span>
        <div>
          <div style="font-size:15px;font-weight:700;color:${color}">${title}</div>
          <div style="font-size:11px;color:#5B6068;margin-top:1px">${tr("report_pdf.controls_count", { count })}</div>
        </div>
      </div>`;
  }

  function emptyRow(colspan: number, msg: string) {
    return `<tr><td colspan="${colspan}" style="text-align:center;color:#8E9299;padding:20px;font-style:italic">${msg}</td></tr>`;
  }

  // ── Sections HTML ────────────────────────────────────────────────────────────

  const s1 = compliant.length > 0
    ? compliant.map(renderCompliantRow).join("")
    : emptyRow(4, tr("report_pdf.empty_compliant"));

  const s2 = partial.length > 0
    ? partial.map(renderPartialRow).join("")
    : emptyRow(6, tr("report_pdf.empty_partial"));

  const s3 = nonCompliant.length > 0
    ? nonCompliant.map(renderGapRow).join("")
    : emptyRow(6, tr("report_pdf.empty_gaps"));

  const s4 = notApplicable.length > 0
    ? notApplicable.map(renderNaRow).join("")
    : emptyRow(4, tr("report_pdf.empty_na"));

  const s5html = notAssessed.length > 0
    ? `${sectionHeader("#5B6068","#F6F6F4",tr("report_pdf.sec_not_assessed"), notAssessed.length, "⏳")}
       <table>
         <thead><tr>
           <th>${hId}</th><th>${hTitle}</th><th>${hCat}</th><th>${hNotes}</th>
         </tr></thead>
         <tbody>${notAssessed.map(renderNaRow).join("")}</tbody>
       </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8" />
  <title>${tr("report_pdf.doc_title", { name: data.assessmentName })}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Tahoma, sans-serif; color: #15181C; background: #fff; }
    .page { max-width: 1100px; margin: 0 auto; padding: 40px 32px; }
    h1 { font-size: 26px; font-weight: 700; color: #0A3B63; }
    .meta { color: #5B6068; font-size: 13px; margin-top: 4px; }
    .score-row { display: flex; gap: 12px; margin: 24px 0 8px; flex-wrap: wrap; }
    .card { background: #F6F6F4; border: 1px solid #D9DAD6; border-radius: 10px; padding: 14px 18px; flex: 1; min-width: 120px; text-align: center; }
    .card .num { font-size: 26px; font-weight: 700; }
    .card .lbl { font-size: 11px; color: #5B6068; margin-top: 3px; }
    .progress-wrap { margin: 8px 0 24px; }
    .progress-bar-bg { height: 12px; background: #ECECE9; border-radius: 6px; overflow: hidden; }
    .progress-bar-fill { height: 100%; border-radius: 6px; background: linear-gradient(to ${dir === "rtl" ? "left" : "right"}, #5BBD74, #86efac); width: ${barFill}%; }
    .progress-label { font-size: 11px; color: #5B6068; margin-top: 4px; text-align: end; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #ECECE9; text-align: start; padding: 8px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #5B6068; letter-spacing: ${lang === "ar" ? "0" : ".05em"}; }
    td { padding: 8px 10px; border-bottom: 1px solid #ECECE9; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #fafafa; }
    .footer { margin-top: 48px; border-top: 1px solid #D9DAD6; padding-top: 16px; font-size: 11px; color: #8E9299; text-align: center; }
    @media print {
      .page { padding: 20px; }
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0A3B63;padding-bottom:16px;margin-bottom:20px">
    <div>
      <h1>${tr("report_pdf.heading")}</h1>
      <p class="meta">${data.assessmentName} &nbsp;·&nbsp; ${data.frameworkName}</p>
    </div>
    <div style="text-align:end">
      <div style="font-size:11px;color:#8E9299">${tr("report_pdf.generated")}</div>
      <div style="font-size:13px;font-weight:600">${data.generatedAt}</div>
      ${data.org ? `<div style="font-size:12px;color:#5B6068;margin-top:2px">${data.org}</div>` : ""}
    </div>
  </div>

  <!-- Summary cards -->
  <div class="score-row">
    <div class="card" style="border-top:3px solid ${scoreColor}">
      <div class="num" style="color:${scoreColor}">${data.complianceScore != null ? data.complianceScore + "%" : "—"}</div>
      <div class="lbl">${tr("report_pdf.compliance_score")}</div>
    </div>
    <div class="card" style="border-top:3px solid #31613F">
      <div class="num" style="color:#31613F">${data.statusCounts.implemented}</div>
      <div class="lbl">✅ ${tr("report_pdf.compliant")}</div>
    </div>
    <div class="card" style="border-top:3px solid #AE983F">
      <div class="num" style="color:#AE983F">${data.statusCounts.partially_implemented}</div>
      <div class="lbl">⚠️ ${tr("report_pdf.partial")}</div>
    </div>
    <div class="card" style="border-top:3px solid #DB4241">
      <div class="num" style="color:#DB4241">${data.statusCounts.not_implemented}</div>
      <div class="lbl">❌ ${tr("report_pdf.non_compliant")}</div>
    </div>
    <div class="card" style="border-top:3px solid #8E9299">
      <div class="num" style="color:#5B6068">${data.statusCounts.not_applicable}</div>
      <div class="lbl">${tr("report_pdf.na")}</div>
    </div>
    <div class="card" style="border-top:3px solid #3F92D6">
      <div class="num">${data.statusCounts.total}</div>
      <div class="lbl">${tr("report_pdf.total_controls")}</div>
    </div>
  </div>

  <!-- Progress bar -->
  <div class="progress-wrap">
    <div class="progress-bar-bg"><div class="progress-bar-fill"></div></div>
    <div class="progress-label">${tr("report_pdf.pct_compliant", { pct })}</div>
  </div>

  <!-- SECTION 1: Compliant -->
  ${sectionHeader("#31613F", "#f0fdf4", tr("report_pdf.sec_compliant"), compliant.length, "✅")}
  <table>
    <thead><tr>
      <th style="width:100px">${hId}</th>
      <th>${hTitle}</th>
      <th style="width:160px">${hCat}</th>
      <th>${hImpl}</th>
    </tr></thead>
    <tbody>${s1}</tbody>
  </table>

  <!-- SECTION 2: Partial -->
  ${sectionHeader("#AE983F", "#fffbeb", tr("report_pdf.sec_partial"), partial.length, "⚠️")}
  <table>
    <thead><tr>
      <th style="width:100px">${hId}</th>
      <th>${hTitle}</th>
      <th style="width:140px">${hCat}</th>
      <th>${hNotes}</th>
      <th>${hGap}</th>
      <th>${hRem}</th>
    </tr></thead>
    <tbody>${s2}</tbody>
  </table>

  <!-- SECTION 3: Non-Compliant / Gaps -->
  ${sectionHeader("#DB4241", "#FCF0F0", tr("report_pdf.sec_gaps"), nonCompliant.length, "❌")}
  <table>
    <thead><tr>
      <th style="width:110px">${hId}</th>
      <th>${hTitle}</th>
      <th style="width:130px">${hCat}</th>
      <th style="width:90px">${hSev}</th>
      <th>${hGap}</th>
      <th>${hRem}</th>
    </tr></thead>
    <tbody>${s3}</tbody>
  </table>

  <!-- SECTION 4: Not Applicable -->
  ${sectionHeader("#5B6068", "#F6F6F4", tr("report_pdf.sec_na"), notApplicable.length, "➖")}
  <table>
    <thead><tr>
      <th style="width:100px">${hId}</th>
      <th>${hTitle}</th>
      <th style="width:160px">${hCat}</th>
      <th>${hJust}</th>
    </tr></thead>
    <tbody>${s4}</tbody>
  </table>

  <!-- SECTION 5: Not Yet Assessed (conditional) -->
  ${s5html}

  <div class="footer">
    GRC Eye &nbsp;·&nbsp; ${tr("report_pdf.footer_report", { fw: data.frameworkShortName })} &nbsp;·&nbsp; ${data.generatedAt}
    &nbsp;·&nbsp; ${tr("report_pdf.footer_total", { count: data.statusCounts.total })}
  </div>
</div>
</body>
</html>`;
}

export function exportComplianceReport(data: ReportData) {
  const html = buildComplianceReportHtml(data);
  const safe = fileSafe(data.assessmentName);
  downloadFile(html, `${fileSafe(tr("export.file.compliance_report"))}_${safe}.html`, "text/html;charset=utf-8;");
}

// ─── Déclaration d'Applicabilité (DdA / SoA) ─────────────────────────────────
//
// Originally a French-only regulatory document. It now follows the UI language
// (keys dda.*); in French the output is the same wording as before.

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

const DATE_LOCALE: Record<ExportLang, string> = { en: "en-US", fr: "fr-FR", ar: "ar-u-nu-latn" };

/** Builds the Statement of Applicability as a standalone HTML document. */
export function buildDdAHtml(data: DdAData): string {
  const lang = currentLang();
  const dir = lang === "ar" ? "rtl" : "ltr";
  // The only caller formats "today" in fr-FR regardless of the UI language
  // (the document used to be French-only). When that is what we received and
  // the UI is not French, re-render today's date in the UI locale.
  const longDate = { day: "2-digit", month: "long", year: "numeric" } as const;
  const generatedAt =
    lang !== "fr" && data.generatedAt === new Date().toLocaleDateString("fr-FR", longDate)
      ? new Date().toLocaleDateString(DATE_LOCALE[lang], longDate)
      : data.generatedAt;

  const applicable   = data.controls.filter((c) => c.status !== "not_applicable");
  const notApplicable= data.controls.filter((c) => c.status === "not_applicable");
  const total        = data.controls.length;
  const pct          = data.complianceScore;
  const scoreColor   = pct == null ? "#5B6068" : pct >= 80 ? "#31613F" : pct >= 60 ? "#AE983F" : "#DB4241";

  function statusLabel(s: string): string {
    if (s === "implemented")           return tr("dda.st_implemented");
    if (s === "partially_implemented") return tr("dda.st_partial");
    if (s === "not_implemented")       return tr("dda.st_not_implemented");
    if (s === "in_progress")           return tr("dda.st_in_progress");
    if (s === "not_applicable")        return tr("dda.st_not_applicable");
    return tr("dda.st_not_assessed");
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
    if (s === "implemented")           return "background:#dcfce7;color:#31613F";
    if (s === "partially_implemented") return "background:#FBF6E3;color:#665A29";
    if (s === "not_implemented")       return "background:#F9E1E1;color:#772829";
    if (s === "in_progress")           return "background:#dbeafe;color:#0B4A7E";
    return "background:#ECECE9;color:#5B6068";
  }
  function applicableStyle(s: string): string {
    return s === "not_applicable"
      ? "background:#ECECE9;color:#5B6068"
      : "background:#eff6ff;color:#0C5D9E";
  }
  function applicableLabel(s: string): string {
    return s === "not_applicable" ? tr("dda.no") : tr("dda.yes");
  }
  function justification(c: DdAControl): string {
    if (c.status === "not_applicable") return c.not_applicable_justification || c.notes || "—";
    return c.implementation_notes || c.notes || "—";
  }

  // Group controls by category
  const general = tr("dda.general");
  const categories = [...new Set(data.controls.map((c) => c.control_category || general))];

  const categorySections = categories.map((cat) => {
    const catControls = data.controls.filter((c) => (c.control_category || general) === cat);
    const rows = catControls.map((c) => `
      <tr>
        <td style="font-family:monospace;font-size:11px;font-weight:700;white-space:nowrap;color:#0A3B63">${c.control_identifier}</td>
        <td style="font-size:12px">${c.control_title}
          ${c.is_mandatory ? `<span style="background:#fef3c7;color:#665A29;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;margin-inline-start:4px;vertical-align:middle;text-transform:uppercase">${tr("dda.mandatory")}</span>` : ""}
          ${c.control_description ? `<div style="font-size:10px;color:#8E9299;margin-top:2px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.control_description.slice(0,120)}${c.control_description.length > 120 ? "…" : ""}</div>` : ""}
        </td>
        <td style="text-align:center">
          <span style="${applicableStyle(c.status)};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700">${applicableLabel(c.status)}</span>
        </td>
        <td style="text-align:center">
          <span style="${statusStyle(c.status)};padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600">${statusIcon(c.status)} ${statusLabel(c.status)}</span>
        </td>
        <td style="font-size:11px;color:#3D4249;max-width:260px">${justification(c)}</td>
      </tr>`).join("");

    return `
      <tr>
        <td colspan="5" style="padding:10px 12px 4px;background:#F6F6F4;border-top:2px solid #D9DAD6">
          <span style="font-size:12px;font-weight:700;color:#0A3B63;text-transform:uppercase;letter-spacing:${lang === "ar" ? "0" : ".05em"}">${cat}</span>
          <span style="font-size:11px;color:#8E9299;margin-inline-start:6px">${tr("dda.controls_count", { count: catControls.length })}</span>
        </td>
      </tr>
      ${rows}`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${dir}">
<head>
  <meta charset="UTF-8"/>
  <title>${tr("dda.doc_title", { name: data.assessmentName })}</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,sans-serif; color:#0f172a; background:#fff; }
    .page { max-width:1150px; margin:0 auto; padding:40px 32px; }
    table { width:100%; border-collapse:collapse; }
    th { background:#0A3B63; color:#fff; text-align:start; padding:9px 12px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:${lang === "ar" ? "0" : ".06em"}; }
    td { padding:9px 12px; border-bottom:1px solid #ECECE9; vertical-align:top; }
    tr:hover td { background:#fafbff; }
    .footer { margin-top:40px; border-top:2px solid #D9DAD6; padding-top:14px; font-size:11px; color:#8E9299; display:flex; justify-content:space-between; }
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
  <div style="border:2px solid #0A3B63;border-radius:8px;padding:20px 24px;margin-bottom:28px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="font-size:11px;font-weight:700;color:#5B6068;text-transform:uppercase;letter-spacing:${lang === "ar" ? "0" : ".08em"};margin-bottom:4px">
          ${tr("dda.kicker")}
        </div>
        <h1 style="font-size:24px;font-weight:800;color:#0A3B63;line-height:1.2">
          ${tr("dda.heading")}
        </h1>
        <div style="font-size:13px;color:#3D4249;margin-top:3px">
          ${tr("dda.subtitle", { fw: data.frameworkName })}
        </div>
      </div>
      <div style="text-align:end;min-width:200px">
        <div style="font-size:20px;font-weight:800;color:${scoreColor}">${pct != null ? pct+"%" : "—"}</div>
        <div style="font-size:10px;color:#8E9299;margin-bottom:8px">${tr("dda.compliance_score")}</div>
        <div style="font-size:12px;color:#3D4249"><b>${tr("dda.organisation")}</b> ${data.org || "—"}</div>
        <div style="font-size:12px;color:#3D4249"><b>${tr("dda.date")}</b> ${generatedAt}</div>
        <div style="font-size:12px;color:#3D4249"><b>${tr("dda.assessment")}</b> ${data.assessmentName}</div>
      </div>
    </div>

    <!-- Summary stats row -->
    <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:90px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#31613F">${applicable.filter(c=>c.status==="implemented").length}</div>
        <div style="font-size:10px;color:#31613F;font-weight:600">✅ ${tr("dda.st_implemented")}</div>
      </div>
      <div style="flex:1;min-width:90px;background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#665A29">${applicable.filter(c=>c.status==="partially_implemented").length}</div>
        <div style="font-size:10px;color:#665A29;font-weight:600">⚠️ ${tr("dda.st_partial")}</div>
      </div>
      <div style="flex:1;min-width:90px;background:#FCF0F0;border:1px solid #fecaca;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#DB4241">${applicable.filter(c=>c.status==="not_implemented").length}</div>
        <div style="font-size:10px;color:#DB4241;font-weight:600">❌ ${tr("dda.st_not_implemented")}</div>
      </div>
      <div style="flex:1;min-width:90px;background:#F6F6F4;border:1px solid #D9DAD6;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#5B6068">${notApplicable.length}</div>
        <div style="font-size:10px;color:#5B6068;font-weight:600">➖ ${tr("dda.st_not_applicable")}</div>
      </div>
      <div style="flex:1;min-width:90px;background:#F6F6F4;border:1px solid #D9DAD6;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:20px;font-weight:800;color:#0A3B63">${total}</div>
        <div style="font-size:10px;color:#3D4249;font-weight:600">${tr("dda.total_controls")}</div>
      </div>
    </div>
  </div>

  <!-- Intro paragraph (ISO 27001 standard wording) -->
  <div style="background:#F6F6F4;border-inline-start:4px solid #0A3B63;padding:12px 16px;margin-bottom:24px;font-size:12px;color:#3D4249;line-height:1.6">
    <b>${tr("dda.intro_label")}</b> ${tr("dda.intro", { fw: data.frameworkName, assessment: data.assessmentName, date: generatedAt })}
  </div>

  <!-- Main table (grouped by category) -->
  <table>
    <thead>
      <tr>
        <th style="width:100px">${tr("dda.col_control")}</th>
        <th>${tr("dda.col_title_desc")}</th>
        <th style="width:80px;text-align:center">${tr("dda.col_applicable")}</th>
        <th style="width:130px;text-align:center">${tr("dda.col_status")}</th>
        <th style="width:280px">${tr("dda.col_justification")}</th>
      </tr>
    </thead>
    <tbody>
      ${categorySections}
    </tbody>
  </table>

  <!-- Signature block -->
  <div style="margin-top:40px;display:flex;gap:32px">
    <div style="flex:1;border:1px solid #D9DAD6;border-radius:8px;padding:16px">
      <div style="font-size:11px;font-weight:700;color:#5B6068;text-transform:uppercase;margin-bottom:12px">${tr("dda.approved_by")}</div>
      <div style="border-bottom:1px solid #8E9299;margin-bottom:6px;height:32px"></div>
      <div style="font-size:11px;color:#8E9299">${tr("dda.signature")} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${tr("dda.date_line")}</div>
    </div>
    <div style="flex:1;border:1px solid #D9DAD6;border-radius:8px;padding:16px">
      <div style="font-size:11px;font-weight:700;color:#5B6068;text-transform:uppercase;margin-bottom:12px">${tr("dda.validated_by")}</div>
      <div style="border-bottom:1px solid #8E9299;margin-bottom:6px;height:32px"></div>
      <div style="font-size:11px;color:#8E9299">${tr("dda.signature")} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${tr("dda.date_line")}</div>
    </div>
    <div style="flex:1;border:1px solid #D9DAD6;border-radius:8px;padding:16px">
      <div style="font-size:11px;font-weight:700;color:#5B6068;text-transform:uppercase;margin-bottom:12px">${tr("dda.doc_version")}</div>
      <div style="font-size:13px;color:#3D4249;margin-top:4px">${tr("dda.version")}</div>
      <div style="font-size:12px;color:#3D4249">${tr("dda.issue_date", { date: generatedAt })}</div>
      <div style="font-size:12px;color:#3D4249">${tr("dda.framework", { fw: data.frameworkShortName })}</div>
    </div>
  </div>

  <div class="footer">
    <span>${tr("dda.footer_title")}</span>
    <span>${data.frameworkShortName} · ${data.assessmentName}</span>
    <span>${tr("dda.generated_on", { date: generatedAt })}</span>
  </div>
</div>
</body>
</html>`;
}

export function exportDdA(data: DdAData) {
  const html = buildDdAHtml(data);
  const safe = fileSafe(data.assessmentName);
  downloadFile(html, `${fileSafe(tr("export.file.dda"))}_${fileSafe(data.frameworkShortName)}_${safe}.html`, "text/html;charset=utf-8;");
}

// ─── Chart image export (PNG) — dependency-free ───────────────────────────────
//
// « Export graphique » for the tender: every chart on screen must leave the
// platform as a picture that can be pasted into a steering-committee deck.
//
// No library is used and none may be added (nothing can be installed on the
// production host). The mechanism is the browser's own: a recharts chart is
// plain inline <svg> in the DOM, so it is cloned, its *computed* styles are
// written back onto the clone as inline attributes (a detached SVG has no
// stylesheet, so anything coming from a CSS class would otherwise be lost),
// serialised, loaded into an <img> through a data: URL and painted onto a
// <canvas>. The canvas stays untainted because the serialised SVG references
// nothing external, so toBlob() is allowed to hand the bytes back.
//
// Screens whose "chart" is CSS bars rather than an <svg> (Analytics) call
// exportBarChartAsPng, which builds the SVG from the same numbers the bars are
// drawn from — the picture is generated from the data, never scraped.

/** Style properties that actually change how an SVG paints. Copying the whole
 *  computed style would produce a multi-megabyte file for no visual gain. */
const SVG_STYLE_PROPS = [
  "fill", "fill-opacity", "fill-rule",
  "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray",
  "stroke-linecap", "stroke-linejoin",
  "opacity", "display", "visibility",
  "font-family", "font-size", "font-weight", "font-style",
  "text-anchor", "dominant-baseline", "letter-spacing",
  "paint-order", "shape-rendering",
] as const;

function inlineComputedStyles(source: Element, clone: Element): void {
  const computed = window.getComputedStyle(source);
  let css = "";
  for (const prop of SVG_STYLE_PROPS) {
    const value = computed.getPropertyValue(prop);
    // "none" is kept on purpose (a grid line's fill:none must survive the trip);
    // only the no-op defaults are dropped, to keep the serialised file small.
    if (value && value !== "normal" && value !== "auto") {
      css += `${prop}:${value};`;
    }
  }
  if (css) clone.setAttribute("style", css);

  const sourceChildren = source.children;
  const cloneChildren = clone.children;
  for (let i = 0; i < sourceChildren.length && i < cloneChildren.length; i++) {
    inlineComputedStyles(sourceChildren[i], cloneChildren[i]);
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Filesystem-safe name. Letters of any script are kept, so a translated title
 *  (French accents, Arabic) survives instead of collapsing to "chart". */
export function safeFileName(name: string): string {
  return (name || "chart").replace(/[^\p{L}\p{N}_-]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "chart";
}

/** Rasterise a standalone SVG document string and download it as a PNG. */
function rasterizeSvg(
  svgMarkup: string,
  width: number,
  height: number,
  filename: string,
  background: string,
  scale: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    // A data: URL rather than a blob: URL — Safari refuses to load a blob-backed
    // SVG into an <img> that will be drawn to a canvas. encodeURIComponent (not
    // btoa) so Arabic and French labels survive the trip.
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(false);
          return;
        }
        // Charts are drawn for a white page; without this the PNG is
        // transparent and unreadable in most document editors.
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.drawImage(image, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(false);
            return;
          }
          downloadBlob(blob, filename.endsWith(".png") ? filename : `${filename}.png`);
          resolve(true);
        }, "image/png");
      } catch {
        resolve(false);
      }
    };
    image.onerror = () => resolve(false);
  });
}

export interface ChartExportOptions {
  /** Caption drawn above the chart — usually the card's own heading. */
  title?: string;
  /** Small line under the title (period, filter, tenant…). */
  subtitle?: string;
  background?: string;
  /** Pixel density. 2 keeps text crisp when the PNG is enlarged in a deck. */
  scale?: number;
  /** Written right-to-left when the UI is in Arabic. */
  rtl?: boolean;
}

/**
 * Export the first inline <svg> inside `container` (a recharts chart) as a PNG.
 *
 * Returns false rather than throwing when there is nothing to export or the
 * browser refuses the conversion, so a caller can show its own message.
 */
export async function exportChartAsPng(
  container: HTMLElement | null,
  filename: string,
  options: ChartExportOptions = {},
): Promise<boolean> {
  if (!container) return false;
  const source = container.querySelector("svg");
  if (!source) return false;

  const rect = source.getBoundingClientRect();
  const width = Math.round(rect.width || source.clientWidth || 640);
  const height = Math.round(rect.height || source.clientHeight || 320);
  if (width < 2 || height < 2) return false;

  const title = options.title?.trim();
  const subtitle = options.subtitle?.trim();
  const padding = 16;
  const headerHeight = (title ? 26 : 0) + (subtitle ? 18 : 0);
  const totalWidth = width + padding * 2;
  const totalHeight = height + headerHeight + padding * 2;
  const background = options.background ?? "#ffffff";
  const rtl = options.rtl === true;
  const textX = rtl ? totalWidth - padding : padding;
  const anchor = rtl ? "end" : "start";

  const clone = source.cloneNode(true) as SVGSVGElement;
  inlineComputedStyles(source, clone);
  // Serialising an SVG lifted out of an HTML document does not always carry the
  // namespace, and an <img> refuses a namespace-less SVG outright.
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
  clone.setAttribute("x", String(padding));
  clone.setAttribute("y", String(headerHeight + padding));

  const serialised = new XMLSerializer().serializeToString(clone);
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" ` +
    `viewBox="0 0 ${totalWidth} ${totalHeight}"${rtl ? ' direction="rtl"' : ""}>` +
    `<rect width="100%" height="100%" fill="${background}"/>` +
    (title
      ? `<text x="${textX}" y="${padding + 14}" text-anchor="${anchor}" font-family="Helvetica, Arial, sans-serif" ` +
        `font-size="14" font-weight="600" fill="#15181C">${escapeXml(title)}</text>`
      : "") +
    (subtitle
      ? `<text x="${textX}" y="${padding + (title ? 32 : 14)}" text-anchor="${anchor}" font-family="Helvetica, Arial, sans-serif" ` +
        `font-size="11" fill="#5B6068">${escapeXml(subtitle)}</text>`
      : "") +
    serialised +
    `</svg>`;

  return rasterizeSvg(markup, totalWidth, totalHeight, filename, background, options.scale ?? 2);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const CHART_PALETTE = [
  "#2185D3", "#3F92D6", "#5BBD74", "#E4C64F",
  "#DB4241", "#0C5D9E", "#72B0E4", "#EF852E",
];

export interface BarChartEntry {
  label: string;
  value: number;
  color?: string;
}

/**
 * Build a horizontal bar chart as a standalone SVG document from raw numbers.
 *
 * Used by the screens whose bars are CSS divs rather than an <svg>: the picture
 * is generated from the same values the page displays, so it cannot drift from
 * what the user is looking at.
 */
export function buildBarChartSvg(
  title: string,
  entries: BarChartEntry[],
  options: ChartExportOptions = {},
): { markup: string; width: number; height: number } {
  const rtl = options.rtl === true;
  const background = options.background ?? "#ffffff";
  const width = 640;
  const padding = 20;
  const rowHeight = 26;
  const labelWidth = 190;
  const valueWidth = 54;
  const subtitle = options.subtitle?.trim();
  const headerHeight = 24 + (subtitle ? 18 : 0);
  const height = headerHeight + padding * 2 + Math.max(1, entries.length) * rowHeight;
  const max = Math.max(1, ...entries.map((e) => (Number.isFinite(e.value) ? e.value : 0)));
  const trackWidth = width - padding * 2 - labelWidth - valueWidth;

  const rows = entries
    .map((entry, index) => {
      const value = Number.isFinite(entry.value) ? entry.value : 0;
      const y = headerHeight + padding + index * rowHeight;
      const barWidth = Math.max(2, Math.round((value / max) * trackWidth));
      const colour = entry.color ?? CHART_PALETTE[index % CHART_PALETTE.length];
      // Mirrored horizontally in Arabic so bars grow away from the label, as
      // they do on screen.
      const labelX = rtl ? width - padding : padding;
      const trackX = rtl ? padding + valueWidth : padding + labelWidth;
      const barX = rtl ? trackX + trackWidth - barWidth : trackX;
      const valueX = rtl ? padding : width - padding;
      return (
        `<text x="${labelX}" y="${y + 15}" text-anchor="${rtl ? "end" : "start"}" font-family="Helvetica, Arial, sans-serif" ` +
        `font-size="11" fill="#4b5563">${escapeXml(entry.label)}</text>` +
        `<rect x="${trackX}" y="${y + 6}" width="${trackWidth}" height="10" rx="5" fill="#ECECE9"/>` +
        `<rect x="${barX}" y="${y + 6}" width="${barWidth}" height="10" rx="5" fill="${colour}"/>` +
        `<text x="${valueX}" y="${y + 15}" text-anchor="${rtl ? "start" : "end"}" font-family="Helvetica, Arial, sans-serif" ` +
        `font-size="11" font-weight="600" fill="#15181C">${escapeXml(String(value))}</text>`
      );
    })
    .join("");

  const titleX = rtl ? width - padding : padding;
  const anchor = rtl ? "end" : "start";
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}"${rtl ? ' direction="rtl"' : ""}>` +
    `<rect width="100%" height="100%" fill="${background}"/>` +
    `<text x="${titleX}" y="${padding + 8}" text-anchor="${anchor}" font-family="Helvetica, Arial, sans-serif" ` +
    `font-size="14" font-weight="600" fill="#15181C">${escapeXml(title)}</text>` +
    (subtitle
      ? `<text x="${titleX}" y="${padding + 26}" text-anchor="${anchor}" font-family="Helvetica, Arial, sans-serif" ` +
        `font-size="11" fill="#5B6068">${escapeXml(subtitle)}</text>`
      : "") +
    rows +
    `</svg>`;

  return { markup, width, height };
}

/** Build a bar chart from raw values and download it as a PNG. */
export async function exportBarChartAsPng(
  title: string,
  entries: BarChartEntry[],
  filename: string,
  options: ChartExportOptions = {},
): Promise<boolean> {
  if (!entries.length) return false;
  const { markup, width, height } = buildBarChartSvg(title, entries, options);
  return rasterizeSvg(
    markup,
    width,
    height,
    filename,
    options.background ?? "#ffffff",
    options.scale ?? 2,
  );
}
