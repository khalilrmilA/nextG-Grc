/**
 * Typed API endpoint functions using the axios client.
 * Uses React Query for caching and state management.
 */
import { apiClient } from "./client";
import i18n from "../i18n";
import { aiLanguageHeaders, readSseStream, withUiLanguage } from "@/lib/sse";
import type {
  StoredFileVersionItem,
  AuthTokens,
  Risk,
  RiskHeatmapData,
  PaginatedResponse,
  Framework,
  FrameworkControl,
  FrameworkControlVersion,
  ControlAssessmentDetail,
  Audit,
  AuditFinding,
  Policy,
  Vendor,
  DashboardSummary,
  Subscription,
  AssessmentDetail,
  AssessmentListItem,
  UploadedDocument,
  FrameworkCreate,
  ControlCreate,
  RequirementCreate,
  PolicyGenerateRequest,
  AppNotification,
  NotificationListResponse,
  NotificationPreference,
  DocumentChecklistResponse,
  AiAccessRequest,
  AiUsageQuota,
  AiTokenUsage,
  RiskCartography,
  RiskCartographyDetail,
  CartographyDefinition,
  DocumentLogEntry,
  // ── Compliance & audit programme (STB Bloc 9) ─────────────────────────────
  // `Requirement`, `AuditRegisterRow` and the rest of the domain shapes live in
  // "@/types" — import them from there in pages; only what this file references
  // is imported here (noUnusedLocals is on).
  RequirementListResponse,
  RequirementFacets,
  RequirementLinkedPolicy,
  ComplianceScale,
  ComplianceScaleLevel,
  ComplianceScaleCreate,
  ComplianceScaleUpdate,
  ControlApplicability,
  ControlApplicabilityState,
  ControlApplicabilityUpsert,
  ControlTranslation,
  ControlTranslationUpsert,
  ControlSearchResponse,
  FrameworkImportResult,
  FrameworkUpstreamDiff,
  ScopeCoverage,
  ActionItemAttachment,
  AuditCampaign,
  AuditCampaignListResponse,
  AuditCampaignAudit,
  AuditCampaignSummary,
  AuditGrid,
  AuditGridItem,
  AuditGridDetail,
  AuditGridResponseItem,
  AuditGridChecklist,
  AuditGridSeedResult,
  AuditComment,
  AuditCommentThread,
  PendingAuditComment,
  AuditRegisterRow,
  AuditEvidence,
  AuditFindingStatusEvent,
  OverdueAuditFinding,
  AuditReportDistribution,
  AuditRecommendation,
  AuditRecommendationSummary,
  AuditorEngagement,
  AuditorEngagementChecklist,
  RegulatoryFeed,
  RegulatoryFeedCreate,
  RegulatoryFeedTestResult,
  RegulatoryUpdateVersion,
  PolicyLinkedControl,
  ControlPolicies,
  ArchiveRecord,
  ArchiveContent,
  ActivityLogListResponse,
  ActivityActionCatalogue,
  EntityAccessReport,
  ActivityRetentionPolicy,
  ActivityLogSeal,
  LoginEvent,
  ReportBuilderDataset,
  ReportBuilderTemplate,
  // ── Dashboards: consolidated executive view, cadence and export ───────────
  ExecutiveSummary,
  DashboardExportKey,
  DashboardExportFormat,
  DashboardExportCatalogue,
  DashboardExportFailure,
  // ── Historical trends (objectifs 2, 3 and 6) ──────────────────────────────
  TrendEnvelope,
  ArchivedReportItem,
} from "@/types";

export interface ActionPlanItem {
  id: string;
  title: string;
  description?: string | null;
  priority: "critical" | "high" | "medium" | "low";
  status: "open" | "in_progress" | "completed" | "cancelled";
  start_date?: string | null;
  due_date?: string | null;
  notes?: string | null;
  ai_generated: boolean;
  assessment_id?: string | null;
  assessment_name?: string | null;
  framework_name?: string | null;
  framework_short_name?: string | null;
  gap_id?: string | null;
  control_identifier?: string | null;
  control_title?: string | null;
  gap_severity?: string | null;
  is_certification_blocker: boolean;
  owner_id?: string | null;
  owner_name?: string | null;
  /** True once the non-conformity behind this action is closed — the
   *  « exigence clôturée » state the closure loop writes back. */
  gap_resolved?: boolean;
  /** corrective | preventive. A preventive action has no gap behind it. */
  action_type?: string;
  /** e.g. "revue trimestrielle des habilitations" — preventive actions only. */
  recurrence?: string | null;
  /** Set when the action came from an audit finding rather than a compliance gap. */
  finding_id?: string | null;
}

/** The action-plan row under its domain name. Same shape as ActionPlanItem,
 *  which stays exported because existing screens import it. */
export type ActionItem = ActionPlanItem;

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";

// ─── Auth ────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  roles?: string[];
  tenant_id: string;
  tenant_name: string;
  primary_framework_id: string | null;
  selected_framework_ids: string[];
  org_size: string | null;
  primary_assessment_id: string | null;
  accessible_modules?: string[];
}

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post<AuthTokens>("/auth/login", { email, password }).then((r) => r.data),

  mfaLogin: (challenge_token: string, code: string) =>
    apiClient.post<AuthTokens>("/auth/mfa-login", { challenge_token, code }).then((r) => r.data),

  register: (data: {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
    organization_name: string;
    organization_slug: string;
    country?: string;
    industry?: string;
    org_size?: string;
    primary_framework_id?: string;
    selected_framework_ids?: string[];
  }) => apiClient.post<AuthTokens>("/auth/register", data).then((r) => r.data),

  refresh: (refresh_token: string) =>
    apiClient.post<AuthTokens>("/auth/refresh", { refresh_token }).then((r) => r.data),

  getProfile: () =>
    apiClient.get<UserProfile>("/auth/me").then((r) => r.data),

  updatePrimaryFramework: (primary_framework_id: string) =>
    apiClient.patch<UserProfile>("/auth/me/framework", { primary_framework_id }).then((r) => r.data),

  updateSelectedFrameworks: (primary_framework_id: string, selected_framework_ids: string[]) =>
    apiClient.patch<UserProfile>("/auth/me/frameworks", { primary_framework_id, selected_framework_ids }).then((r) => r.data),

  // ── Personal API tokens — NOT IMPLEMENTED SERVER-SIDE ────────────────────
  // /auth/api-tokens does not exist in backend/app (checked against the live
  // route table): all three wrappers below answer 404. Nothing calls them.
  // Left in place rather than deleted because the route may be landing in
  // another lane — but do not wire a button to them until it has.
  /** @deprecated 404 — POST /auth/api-tokens is not implemented. */
  generateApiToken: (name: string) =>
    apiClient.post<{ token: string; token_name: string; created_at: string }>("/auth/api-tokens", { name }).then((r) => r.data),

  /** @deprecated 404 — GET /auth/api-tokens is not implemented. */
  listApiTokens: () =>
    apiClient.get<Array<{ token_name: string; created_at: string; last_used?: string }>>("/auth/api-tokens").then((r) => r.data),

  /** @deprecated 404 — DELETE /auth/api-tokens/{name} is not implemented. */
  deleteApiToken: (tokenName: string) =>
    apiClient.delete(`/auth/api-tokens/${tokenName}`),

  requestAiAccess: (feature: "document-generation" | "ai-analysis" | "all", reason: string) =>
    apiClient.post<AiAccessRequest>("/auth/ai-access/request", { feature, reason }).then((r) => r.data),

  getAiAccessStatus: () =>
    apiClient.get<{ requests: AiAccessRequest[]; quotas: AiUsageQuota[] }>("/auth/ai-access/status").then((r) => r.data),

  /** AI quota for the signed-in user. The path is /auth/ai-access/usage — the
   *  whole ai_access router hangs off /auth/ai-access. It was spelled
   *  "/auth/ai-usage" here, which is not a route, so SettingsPage and
   *  AiUsageWidget (the only two callers) got a 404 and showed nothing. */
  getAiUsage: () =>
    apiClient.get<AiTokenUsage>("/auth/ai-access/usage").then((r) => r.data),

  checkAiAccess: () =>
    apiClient.get<{ has_access: boolean; tokens_used: number; tokens_limit: number; requests_used: number; requests_limit: number; percentage_used: number; reset_at: string | null }>("/ai/access-check").then((r) => r.data),

  changePassword: (current_password: string, new_password: string) =>
    apiClient.post("/auth/change-password", { current_password, new_password }),

  forgotPassword: (email: string) =>
    apiClient.post("/auth/forgot-password", { email }),

  resetPassword: (token: string, new_password: string) =>
    apiClient.post("/auth/reset-password", { token, new_password }),

  listSessions: () => apiClient.get("/auth/sessions").then((r) => r.data),
  revokeSession: (id: string) => apiClient.delete(`/auth/sessions/${id}`),
};

// ─── Frameworks ──────────────────────────────

export const frameworksApi = {
  /** The referential's frameworks. `source_type` classifies them by origin
   *  (norme | reglementation | loi | politique_interne) and `q` matches on
   *  name / short_name / issuing_body. Both are optional, so `list()` keeps
   *  behaving exactly as it always did. */
  /** `original: 1` returns the stored text instead of a machine translation into
   *  the UI language — REQUIRED wherever the result feeds an edit form or is
   *  copied into a new record, or a translation would be saved as the original. */
  list: (params?: { source_type?: string; q?: string; original?: 1 }) =>
    apiClient.get<Framework[]>("/frameworks", { params }).then((r) => r.data),

  get: (id: string, params?: { original?: 1 }) =>
    apiClient.get<Framework>(`/frameworks/${id}`, { params }).then((r) => r.data),

  delete: (id: string) => apiClient.delete(`/frameworks/${id}`),

  /** The framework's requirements, classified and in the caller's language.
   *  Every filter is optional and applied server-side; "unclassified" is a
   *  legal value for `domain` / `requirement_type` (same string as the facet
   *  key), and the values are matched case-insensitively. */
  getControls: (
    frameworkId: string,
    params?: {
      domain?: string;
      requirement_type?: string;
      is_mandatory?: boolean;
      applicability?: string;
      q?: string;
      /** Stored text, no machine translation — for edit forms and copies. */
      original?: 1;
    },
  ) =>
    apiClient.get<FrameworkControl[]>(`/frameworks/${frameworkId}/controls`, { params }).then((r) => r.data),

  getCrosswalk: (frameworkId: string, controlId: string) =>
    apiClient
      .get(`/frameworks/${frameworkId}/controls/${controlId}/crosswalk`)
      .then((r) => r.data),

  // Custom Framework Builder
  browseControls: (frameworkIds?: string[]) => {
    const params = frameworkIds && frameworkIds.length > 0 ? { framework_ids: frameworkIds.join(",") } : {};
    return apiClient.get("/frameworks/builder/browse-controls", { params }).then((r) => r.data);
  },

  getAISuggestions: (data: {
    industry: string;
    region?: string;
    use_case?: string;
    selected_control_ids?: string[];
  }) => apiClient.post("/frameworks/builder/ai-suggestions", data).then((r) => r.data),

  buildCustom: (data: {
    name: string;
    short_name: string;
    version?: string;
    description?: string;
    issuing_body?: string;
    applicable_regions?: string[];
    applicable_industries?: string[];
    controls: Array<{
      control_id: string;
      title: string;
      description?: string;
      category?: string;
      source_framework?: string;
    }>;
  }) => apiClient.post<Framework>("/frameworks/builder/create", data).then((r) => r.data),

  // ── Referential search across every framework ─────────────────────────────
  // The filter bar's data source: classification filters plus the facet counts
  // to render them with. Text is returned in the caller's UI language when a
  // translation exists (the client sends Accept-Language on every request).
  searchControls: (params?: {
    source_type?: string;
    domain?: string;
    requirement_type?: string;
    is_mandatory?: boolean;
    framework_id?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }) =>
    apiClient.get<ControlSearchResponse>("/frameworks/controls/search", { params }).then((r) => r.data),

  // ── Import a framework from a file ────────────────────────────────────────
  // Multipart: never set Content-Type by hand, the boundary is generated.
  // `dry_run` validates the file and reports what WOULD happen without writing —
  // always offer it before a real import.
  importControls: (
    file: File,
    options?: {
      framework_id?: string;
      format?: string;
      name?: string;
      short_name?: string;
      version?: string;
      source_type?: string;
      issuing_body?: string;
      description?: string;
      dry_run?: boolean;
    },
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    Object.entries(options ?? {}).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      fd.append(key, String(value));
    });
    return apiClient.post<FrameworkImportResult>("/frameworks/import", fd).then((r) => r.data);
  },

  // ── Applicability (« déclaration d'applicabilité ») ───────────────────────
  getControlApplicability: (frameworkId: string, controlDbId: string) =>
    apiClient
      .get<ControlApplicabilityState>(`/frameworks/${frameworkId}/controls/${controlDbId}/applicability`)
      .then((r) => r.data),

  setControlApplicability: (
    frameworkId: string,
    controlDbId: string,
    data: ControlApplicabilityUpsert,
  ) =>
    apiClient
      .put<ControlApplicability>(`/frameworks/${frameworkId}/controls/${controlDbId}/applicability`, data)
      .then((r) => r.data),

  // ── Control translations (fr / ar are contractual, not optional) ──────────
  listControlTranslations: (frameworkId: string, controlDbId: string) =>
    apiClient
      .get<ControlTranslation[]>(`/frameworks/${frameworkId}/controls/${controlDbId}/translations`)
      .then((r) => r.data),

  upsertControlTranslation: (
    frameworkId: string,
    controlDbId: string,
    lang: string,
    data: ControlTranslationUpsert,
  ) =>
    apiClient
      .put<ControlTranslation>(
        `/frameworks/${frameworkId}/controls/${controlDbId}/translations/${lang}`,
        data,
      )
      .then((r) => r.data),

  // ── Upstream lineage of a tenant fork ─────────────────────────────────────
  // What the built-in has gained/lost/changed since this copy was cloned.
  getUpstreamDiff: (frameworkId: string) =>
    apiClient.get<FrameworkUpstreamDiff>(`/frameworks/${frameworkId}/upstream-diff`).then((r) => r.data),

  /** Pull upstream changes in. `update_unmodified` deliberately leaves locally
   *  edited controls alone — check `modified[].locally_edited` on the diff first. */
  syncFromUpstream: (frameworkId: string, data?: { adopt_new?: boolean; update_unmodified?: boolean }) =>
    apiClient.post(`/frameworks/${frameworkId}/upstream-sync`, data ?? {}).then((r) => r.data),
};

// ─── Risks ───────────────────────────────────

export const risksApi = {
  // org_entity_id / business_process_id filter the register by département and by
  // processus — the backend applies both in SQL alongside status and severity.
  list: (params?: { page?: number; page_size?: number; status?: string; severity?: string; org_entity_id?: string; business_process_id?: string }) =>
    apiClient.get<PaginatedResponse<Risk>>("/risks", { params }).then((r) => r.data),

  get: (id: string) => apiClient.get<Risk>(`/risks/${id}`).then((r) => r.data),

  create: (data: Partial<Risk>) =>
    apiClient.post<Risk>("/risks", data).then((r) => r.data),

  update: (id: string, data: Partial<Risk>) =>
    apiClient.patch<Risk>(`/risks/${id}`, data).then((r) => r.data),

  delete: (id: string) => apiClient.delete(`/risks/${id}`),

  getHeatmap: () => apiClient.get<RiskHeatmapData>("/risks/heatmap/data").then((r) => r.data),

  setAppetite: (id: string, data: { appetite_threshold?: number | null; target_likelihood?: number | null; target_impact?: number | null }) =>
    apiClient.put<Risk>(`/risks/${id}/appetite`, data).then((r) => r.data),

  validateTarget: (id: string, calculation_notes?: string | null) =>
    apiClient.post<Risk>(`/risks/${id}/validate-target`, { calculation_notes }).then((r) => r.data),

  // Archived states (newest first). Version N is the state edit N started from.
  versions: (id: string) =>
    apiClient.get<RiskVersion[]>(`/risks/${id}/versions`).then((r) => r.data),

  // Only the status moves, oldest first.
  lifecycle: (id: string) =>
    apiClient.get<RiskVersion[]>(`/risks/${id}/lifecycle`).then((r) => r.data),

  // to_version = 0 means the risk as it stands now.
  diffVersions: (id: string, from_version: number, to_version: number) =>
    apiClient.get<RiskDiffCell[]>(`/risks/${id}/versions/diff`, { params: { from_version, to_version } }).then((r) => r.data),
};

export interface RiskVersion {
  id: string;
  risk_id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  risk_title?: string | null;
  transition_from?: string | null;
  transition_to?: string | null;
  change_reason?: string | null;
  author_id?: string | null;
  author_email?: string | null;
  created_at: string;
}

export interface RiskDiffCell {
  field: string;
  from_value: unknown;
  to_value: unknown;
}

// ─── Risk Cartography ────────────────────────

export const riskCartographyApi = {
  list: () =>
    apiClient.get<RiskCartography[]>("/risk-cartographies").then((r) => r.data),

  create: (data: { name: string; description?: string; is_default?: boolean; definition?: CartographyDefinition }) =>
    apiClient.post<RiskCartographyDetail>("/risk-cartographies", data).then((r) => r.data),

  get: (id: string) =>
    apiClient.get<RiskCartographyDetail>(`/risk-cartographies/${id}`).then((r) => r.data),

  update: (id: string, data: { name?: string; description?: string; is_default?: boolean; definition?: CartographyDefinition }) =>
    apiClient.put<RiskCartographyDetail>(`/risk-cartographies/${id}`, data).then((r) => r.data),

  delete: (id: string) => apiClient.delete(`/risk-cartographies/${id}`),

  updatePositions: (
    id: string,
    positions: Record<string, { likelihood: number; impact: number } | null>,
  ) =>
    apiClient
      .put<RiskCartographyDetail>(`/risk-cartographies/${id}/risk-positions`, positions)
      .then((r) => r.data),

  exportPdf: (id: string) =>
    apiClient.get(`/risk-cartographies/${id}/pdf`, { responseType: "blob" }),
};

// ─── Compliance ──────────────────────────────

export interface EvidenceItem {
  id: string;
  file_name: string | null;
  file_path: string | null;
  file_size_bytes: number | null;
  content_type: string | null;
  is_visible_to_auditor: boolean;
  created_at: string;
  shared_count?: number;
  is_shared?: boolean;
  valid_from?: string | null;
  valid_until?: string | null;
}

export interface ChecklistDocItem {
  id: string;
  file_name: string;
  file_path: string | null;
  file_size_bytes: number | null;
  content_type: string | null;
  is_visible_to_auditor: boolean;
  created_at: string;
}

export const complianceApi = {
  /** `include_archived` brings back assessments moved to ARCHIVED — a past
   *  perimeter, deliberately out of the live picture unless asked for. */
  listAssessments: (params?: { page?: number; page_size?: number; include_archived?: boolean }) =>
    apiClient
      .get<PaginatedResponse<AssessmentListItem>>("/compliance/assessments", { params })
      .then((r) => r.data),

  createAssessment: (data: {
    framework_id: string;
    name: string;
    description?: string;
    scope_description?: string;
  }) =>
    apiClient.post<AssessmentDetail>("/compliance/assessments", data).then((r) => r.data),

  getAssessment: (id: string) =>
    apiClient.get<AssessmentDetail>(`/compliance/assessments/${id}`).then((r) => r.data),

  getResults: (id: string) =>
    apiClient.get<AssessmentDetail>(`/compliance/assessments/${id}/results`).then((r) => r.data),

  uploadDocument: (assessmentId: string, file: File, documentTypeKey?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (documentTypeKey) formData.append("document_type_key", documentTypeKey);
    return apiClient
      .post<UploadedDocument>(`/compliance/assessments/${assessmentId}/documents`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },

  analyzeAssessment: (assessmentId: string) =>
    apiClient
      .post<{ status: string; message: string }>(
        `/compliance/assessments/${assessmentId}/analyze`
      )
      .then((r) => r.data),

  getAnalyzeStatus: (assessmentId: string) =>
    apiClient
      .get<{ status: string; compliance_score: number | null; error: string | null }>(
        `/compliance/assessments/${assessmentId}/analyze-status`
      )
      .then((r) => r.data),

  updateControlAssessment: (
    controlAssessmentId: string,
    data: Partial<ControlAssessmentDetail>
  ) =>
    apiClient
      .patch<ControlAssessmentDetail>(
        `/compliance/control-assessments/${controlAssessmentId}`,
        data
      )
      .then((r) => r.data),

  getDocumentChecklist: (assessmentId: string) =>
    apiClient
      .get<DocumentChecklistResponse>(`/compliance/assessments/${assessmentId}/document-checklist`)
      .then((r) => r.data),

  actOnRecommendation: (
    assessmentId: string,
    gapId: string,
    data: { action: "accept" | "reject"; owner_id?: string; due_date?: string; notes?: string }
  ) =>
    apiClient
      .post(`/compliance/assessments/${assessmentId}/gaps/${gapId}/recommendation`, data)
      .then((r) => r.data),

  bulkActOnRecommendations: (
    assessmentId: string,
    data: { action: "accept" | "reject"; gap_ids?: string[]; filter?: string }
  ) =>
    apiClient
      .post(`/compliance/assessments/${assessmentId}/gaps/bulk-action`, data)
      .then((r) => r.data),

  // validUntil (YYYY-MM-DD): how long this proof stays valid — drives the
  // expired / expiring badges and the 30/7/0-day reminders.
  uploadControlEvidence: (controlAssessmentId: string, file: File, validUntil?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (validUntil) formData.append("valid_until", validUntil);
    return apiClient
      .post<EvidenceItem>(
        `/compliance/control-assessments/${controlAssessmentId}/evidence`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      )
      .then((r) => r.data);
  },

  listControlEvidence: (controlAssessmentId: string) =>
    apiClient.get<EvidenceItem[]>(`/compliance/control-assessments/${controlAssessmentId}/evidence`).then(r => r.data),

  toggleEvidenceVisibility: (evidenceId: string) =>
    apiClient.patch<EvidenceItem>(`/compliance/evidence/${evidenceId}/visibility`).then(r => r.data),

  deleteEvidence: (evidenceId: string) =>
    apiClient.delete(`/compliance/evidence/${evidenceId}`),

  downloadEvidenceUrl: (evidenceId: string) =>
    `${API_BASE}/compliance/evidence/${evidenceId}/download`,

  // ── Stored-file version history & recovery ────────────────────────────────
  // History is keyed on the PARENT a file hangs off (a control assessment),
  // not the evidence row: every upload mints a new evidence id, so an
  // entity-keyed history would always hold exactly one entry.
  listFileVersions: (parentType: string, parentId: string) =>
    apiClient
      .get(`/compliance/files/${parentType}/${parentId}/versions`)
      .then((r) => r.data as StoredFileVersionItem[]),
  listDeletedFiles: () =>
    apiClient.get("/compliance/files/deleted").then((r) => r.data as StoredFileVersionItem[]),
  /** @deprecated The route is HTTPBearer-only, so a bare <a href> to this URL
   *  401s. Use `downloadFileVersion` (blob) unless you are fetching it yourself
   *  with an Authorization header, as DocumentViewerModal does. */
  downloadFileVersionUrl: (versionId: string, acknowledgeIntegrityFailure = false) =>
    `${API_BASE}/compliance/files/versions/${versionId}/download` +
    (acknowledgeIntegrityFailure ? "?acknowledge_integrity_failure=true" : ""),

  /** One stored version, authenticated. `acknowledgeIntegrityFailure` is the
   *  override that serves a file whose checksum no longer matches, so a damaged
   *  file can still be investigated rather than being simply unreachable. */
  downloadFileVersion: (versionId: string, acknowledgeIntegrityFailure = false) =>
    apiClient
      .get(`/compliance/files/versions/${versionId}/download`, {
        params: acknowledgeIntegrityFailure ? { acknowledge_integrity_failure: true } : undefined,
        responseType: "blob",
      })
      .then((r) => r.data as Blob),

  // ── Checklist document management ──────────────────────────────────────────
  downloadDocumentUrl: (docId: string) =>
    `${API_BASE}/compliance/documents/${docId}/download`,

  toggleDocumentVisibility: (docId: string) =>
    apiClient.patch<ChecklistDocItem>(`/compliance/documents/${docId}/visibility`).then(r => r.data),

  deleteDocument: (docId: string) =>
    apiClient.delete(`/compliance/documents/${docId}`),

  getDocumentLog: (assessmentId: string) =>
    apiClient.get<DocumentLogEntry[]>(`/compliance/assessments/${assessmentId}/document-log`).then(r => r.data),

  deleteAssessment: (assessmentId: string) =>
    apiClient.delete(`/compliance/assessments/${assessmentId}`),

  listActionPlan: (assessmentId?: string) =>
    apiClient.get<ActionPlanItem[]>("/compliance/action-plan", {
      params: assessmentId ? { assessment_id: assessmentId } : undefined,
    }).then(r => r.data),

  updateActionPlanItem: (id: string, data: Partial<{ status: string; start_date: string | null; due_date: string | null; owner_id: string | null; notes: string; priority: string; title: string; description: string; action_type: string; recurrence: string | null }>) =>
    apiClient.patch<ActionPlanItem>(`/compliance/action-plan/${id}`, data).then(r => r.data),

  // ── Assessment perimeter & conformity scale ───────────────────────────────
  /** Rename, re-scope, re-grade or archive an assessment. Every field is
   *  optional; an omitted field is left untouched. This is also the only way to
   *  move an assessment to "archived". */
  updateAssessment: (
    assessmentId: string,
    data: Partial<{
      name: string;
      description: string | null;
      scope_description: string | null;
      scope_type: string;
      org_entity_id: string | null;
      business_process_id: string | null;
      in_scope_assets: string[];
      scale_id: string | null;
      status: string;
      lead_assessor_id: string | null;
      assessment_start: string | null;
      assessment_end: string | null;
      next_review_date: string | null;
    }>,
  ) =>
    apiClient.patch<AssessmentDetail>(`/compliance/assessments/${assessmentId}`, data).then((r) => r.data),

  /** Create with a perimeter and/or a conformity scale. Omitting all of them
   *  keeps the historical organisation-wide behaviour. */
  createScopedAssessment: (data: {
    framework_id: string;
    name: string;
    description?: string;
    scope_description?: string;
    scope_type?: string;
    org_entity_id?: string | null;
    business_process_id?: string | null;
    in_scope_assets?: string[] | null;
    scale_id?: string | null;
  }) => apiClient.post<AssessmentDetail>("/compliance/assessments", data).then((r) => r.data),

  // ── Coverage by perimeter (« la conformité de la DSI / du processus X ») ──
  // Org entities also carry a rolled-up score covering every descendant.
  coverageByEntity: (frameworkId?: string) =>
    apiClient
      .get<ScopeCoverage>("/compliance/coverage/by-entity", {
        params: frameworkId ? { framework_id: frameworkId } : undefined,
      })
      .then((r) => r.data),

  coverageByProcess: (frameworkId?: string) =>
    apiClient
      .get<ScopeCoverage>("/compliance/coverage/by-process", {
        params: frameworkId ? { framework_id: frameworkId } : undefined,
      })
      .then((r) => r.data),

  coverageByAsset: (frameworkId?: string) =>
    apiClient
      .get<ScopeCoverage>("/compliance/coverage/by-asset", {
        params: frameworkId ? { framework_id: frameworkId } : undefined,
      })
      .then((r) => r.data),

  // ── Action plan: plan an action, not just inherit one from a gap ──────────
  /** `action_type: "preventive"` is the half of the requirement that has no gap
   *  behind it — it could not be planned anywhere before this route existed. */
  createActionPlanItem: (data: {
    title: string;
    description?: string | null;
    assessment_id?: string | null;
    gap_id?: string | null;
    owner_id?: string | null;
    start_date?: string | null;
    due_date?: string | null;
    priority?: string;
    status?: string;
    action_type?: string;
    recurrence?: string | null;
    notes?: string | null;
  }) => apiClient.post<ActionPlanItem>("/compliance/action-plan", data).then((r) => r.data),

  deleteActionPlanItem: (id: string) =>
    apiClient.delete(`/compliance/action-plan/${id}`),

  /** Filterable listing. `action_type` separates corrective from preventive;
   *  `status` filters on open | in_progress | completed | cancelled. */
  listActionPlanFiltered: (params?: { assessment_id?: string; action_type?: string; status?: string }) =>
    apiClient.get<ActionPlanItem[]>("/compliance/action-plan", { params }).then((r) => r.data),

  // ── Action-plan attachments (proof the action was actually carried out) ───
  uploadActionAttachment: (itemId: string, file: File, description?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (description) fd.append("description", description);
    return apiClient
      .post<ActionItemAttachment>(`/compliance/action-plan/${itemId}/attachments`, fd)
      .then((r) => r.data);
  },

  listActionAttachments: (itemId: string) =>
    apiClient
      .get<ActionItemAttachment[]>(`/compliance/action-plan/${itemId}/attachments`)
      .then((r) => r.data),

  /** Blob rather than a bare URL: the download needs the Authorization header.
   *  `acknowledgeIntegrityFailure` is the CISO override that serves a file whose
   *  checksum no longer matches, so a damaged file can still be investigated. */
  downloadActionAttachment: (attachmentId: string, acknowledgeIntegrityFailure = false) =>
    apiClient
      .get(`/compliance/action-plan/attachments/${attachmentId}/download`, {
        params: acknowledgeIntegrityFailure ? { acknowledge_integrity_failure: true } : undefined,
        responseType: "blob",
      })
      .then((r) => r.data as Blob),

  /** Show/hide one proof from the auditor's view. Returns the updated
   *  attachment, whose `is_visible_to_auditor` is the new state. CISO-only
   *  server-side, so offer the toggle to a CISO rather than letting others
   *  walk into the refusal. */
  toggleActionAttachmentVisibility: (attachmentId: string) =>
    apiClient
      .patch<ActionItemAttachment>(`/compliance/action-plan/attachments/${attachmentId}/visibility`)
      .then((r) => r.data),

  deleteActionAttachment: (attachmentId: string) =>
    apiClient.delete(`/compliance/action-plan/attachments/${attachmentId}`),

  // ── Evidence file governance ─────────────────────────────────────────────
  /** Every stored evidence file with its checksum verdict — the report an
   *  auditor asks for when they want to know nothing was swapped out. */
  evidenceIntegrityReport: (limit?: number) =>
    apiClient
      .get("/compliance/evidence/integrity-report", { params: limit ? { limit } : undefined })
      .then((r) => r.data),

  fileStorageSummary: () =>
    apiClient.get("/compliance/files/storage-summary").then((r) => r.data),

  /** What a purge WOULD destroy. Always show this before calling the purge. */
  fileRetentionPreview: (limit?: number) =>
    apiClient
      .get("/compliance/files/retention/preview", { params: limit ? { limit } : undefined })
      .then((r) => r.data),

  fileRetentionPurge: () =>
    apiClient.post("/compliance/files/retention/purge").then((r) => r.data),
};

// ─── Compliance scales (grilles d'évaluation) ─────────────────────────────
// The customisable conformity scale an assessment is graded on. Built-in scales
// are shared and read-only; a tenant's own are editable. Every write takes a
// governance `reason` — changing the yardstick re-scores live assessments, so
// the backend requires the justification rather than accepting a silent edit.

export const complianceScalesApi = {
  list: (isActive?: boolean) =>
    apiClient
      .get<ComplianceScale[]>("/compliance-scales", {
        params: isActive === undefined ? undefined : { is_active: isActive },
      })
      .then((r) => r.data),

  get: (scaleId: string) =>
    apiClient.get<ComplianceScale>(`/compliance-scales/${scaleId}`).then((r) => r.data),

  /** The four-level default the tender describes — a starting point for a new scale. */
  defaultLevels: () =>
    apiClient.get<ComplianceScaleLevel[]>("/compliance-scales/default-levels").then((r) => r.data),

  create: (data: ComplianceScaleCreate, reason: string) =>
    apiClient
      .post<ComplianceScale>("/compliance-scales", data, { params: { reason } })
      .then((r) => r.data),

  /** `reason` becomes mandatory once the scale grades a live assessment, and
   *  whenever the edit makes the scale the default. Check `assessment_count`
   *  first and warn ("changing this re-scores 12 assessments"). */
  update: (scaleId: string, data: ComplianceScaleUpdate, reason?: string) =>
    apiClient
      .patch<ComplianceScale>(`/compliance-scales/${scaleId}`, data, {
        params: reason ? { reason } : undefined,
      })
      .then((r) => r.data),

  setDefault: (scaleId: string, reason: string) =>
    apiClient
      .put<ComplianceScale>(`/compliance-scales/${scaleId}/default`, null, { params: { reason } })
      .then((r) => r.data),

  delete: (scaleId: string, reason: string) =>
    apiClient.delete(`/compliance-scales/${scaleId}`, { params: { reason } }),
};

// ─── Custom Framework Builder ─────────────────

export const customFrameworkApi = {
  create: (data: FrameworkCreate) =>
    apiClient.post<Framework>("/frameworks", data).then((r) => r.data),

  clone: (frameworkId: string, data?: { name?: string; short_name?: string }) =>
    apiClient.post<Framework>(`/frameworks/${frameworkId}/clone`, data ?? {}).then((r) => r.data),

  updateMeta: (frameworkId: string, data: Partial<FrameworkCreate>) =>
    apiClient.patch<Framework>(`/frameworks/${frameworkId}`, data).then((r) => r.data),

  addControl: (frameworkId: string, data: ControlCreate) =>
    apiClient.post<FrameworkControl>(`/frameworks/${frameworkId}/controls`, data).then((r) => r.data),

  updateControl: (frameworkId: string, controlDbId: string, data: Partial<ControlCreate>) =>
    apiClient
      .patch<FrameworkControl>(`/frameworks/${frameworkId}/controls/${controlDbId}`, data)
      .then((r) => r.data),

  deleteControl: (frameworkId: string, controlDbId: string) =>
    apiClient.delete(`/frameworks/${frameworkId}/controls/${controlDbId}`),

  addRequirement: (frameworkId: string, controlDbId: string, data: RequirementCreate) =>
    apiClient
      .post(`/frameworks/${frameworkId}/controls/${controlDbId}/requirements`, data)
      .then((r) => r.data),

  getControlVersions: (frameworkId: string, controlDbId: string) =>
    apiClient
      .get<FrameworkControlVersion[]>(`/frameworks/${frameworkId}/controls/${controlDbId}/versions`)
      .then((r) => r.data),
};

// ─── AI Policy Generator ──────────────────────

async function _streamAi(
  endpoint: string,
  body: object,
  onToken: (token: string) => void,
  onDone: () => void,
  signal: AbortSignal,
): Promise<void> {
  const stored = localStorage.getItem("grc_user_v2");
  const token = stored ? (JSON.parse(stored)?.accessToken ?? "") : "";
  const resp = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // The axios client sets this on every other request; this one uses raw
      // fetch and was the single hole in the origin classification, so AI
      // generation showed in the audit trail as an unidentified caller.
      "X-GRC-Client": "web-ui",
      // The UI language, not the browser's: raw fetch bypasses the axios
      // interceptor that sets it, and every AI answer follows this header
      // (or the explicit `language` body field added below, which wins).
      ...aiLanguageHeaders(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(withUiLanguage(body)),
    signal,
  });
  if (!resp.ok) throw new Error(String(i18n.t("api_client.ai_error", { status: resp.status, defaultValue: `AI error: ${resp.status}` })));
  await readSseStream(resp, onToken, onDone);
}

export const aiApi = {
  streamPolicyContent: (
    request: { title: string; category?: string; description?: string; language?: string },
    onToken: (token: string) => void,
    onDone: () => void,
    signal: AbortSignal
  ) => _streamAi("/ai/generate-policy-content", request, onToken, onDone, signal),

  streamPolicyGeneration: (
    request: PolicyGenerateRequest,
    onToken: (token: string) => void,
    onDone: () => void,
    signal: AbortSignal
  ) => _streamAi("/ai/generate-policy", request, onToken, onDone, signal),

  streamDocumentGeneration: (
    request: {
      document_type: string;
      org_name: string;
      industry: string;
      size: string;
      country: string;
      frameworks?: string;
      specific_requirements?: string;
    },
    onToken: (token: string) => void,
    onDone: () => void,
    signal: AbortSignal
  ) => _streamAi("/ai/generate-document", request, onToken, onDone, signal),

  streamRiskAnalysis: (
    title: string, description: string, category: string,
    onToken: (token: string) => void, onDone: () => void, signal: AbortSignal
  ) => _streamAi("/ai/analyze-risk", { title, description, risk_category: category }, onToken, onDone, signal),

  streamEvidenceAnalysis: (
    documentText: string, frameworkShortName: string, controls: object[],
    onToken: (token: string) => void, onDone: () => void, signal: AbortSignal
  ) => _streamAi("/ai/analyze-evidence", { document_text: documentText, framework_short_name: frameworkShortName, controls }, onToken, onDone, signal),

  streamAuditPlan: (
    request: { framework_name: string; framework_short_name: string; audit_title: string; audit_scope?: string; audit_objective?: string; controls: object[] },
    onToken: (token: string) => void, onDone: () => void, signal: AbortSignal
  ) => _streamAi("/ai/generate-audit-plan", request, onToken, onDone, signal),

  streamVendorAnalysis: (
    vendorName: string, vendorIndustry: string, vendorServices: string, responses: Record<string, string>,
    onToken: (token: string) => void, onDone: () => void, signal: AbortSignal
  ) => _streamAi("/ai/analyze-vendor", { vendor_name: vendorName, vendor_industry: vendorIndustry, vendor_services: vendorServices, questionnaire_responses: responses }, onToken, onDone, signal),

  streamRemediationPlan: (
    assessmentId: string,
    onToken: (token: string) => void, onDone: () => void, signal: AbortSignal
  ) => _streamAi("/ai/stream-remediation-plan", { assessment_id: assessmentId }, onToken, onDone, signal),
};

// ─── Audits ──────────────────────────────────

export const auditsApi = {
  /** @deprecated GET /audits answers with a bare array, not a page, and takes no
   *  `page` / `page_size` at all — they are accepted here for the callers that
   *  already pass them, but the server IGNORES them and returns everything.
   *  Kept because AuditsPage handles both shapes; new callers want `listAll`. */
  list: (params?: { page?: number; page_size?: number }) =>
    apiClient.get<PaginatedResponse<Audit>>("/audits", { params }).then((r) => r.data),

  /** The engagements, optionally narrowed to a campaign or a perimeter member
   *  (« audits couvrant ce processus »). */
  listAll: (params?: {
    status_filter?: string;
    campaign_id?: string;
    process_id?: string;
    org_entity_id?: string;
    asset_id?: string;
  }) => apiClient.get<Audit[]>("/audits", { params }).then((r) => r.data),

  get: (id: string) => apiClient.get<Audit>(`/audits/${id}`).then((r) => r.data),

  create: (data: Partial<Audit>) =>
    apiClient.post<Audit>("/audits", data).then((r) => r.data),

  update: (id: string, data: Partial<Audit>) =>
    apiClient.patch<Audit>(`/audits/${id}`, data).then((r) => r.data),

  /** Soft delete — the engagement leaves the register but survives for the
   *  trail, so `reason` (5 chars minimum) is required and `restore` undoes it. */
  delete: (id: string, reason: string) =>
    apiClient.delete(`/audits/${id}`, { params: { reason } }),

  restore: (id: string) =>
    apiClient.post<Audit>(`/audits/${id}/restore`).then((r) => r.data),

  /** The filterable register — one row per engagement with its findings roll-up.
   *  `include_deleted` is admin-only and shows soft-deleted engagements. */
  register: (params?: {
    status_filter?: string;
    audit_type?: string;
    campaign_id?: string;
    framework_id?: string;
    lead_auditor_id?: string;
    process_id?: string;
    org_entity_id?: string;
    date_from?: string;
    date_to?: string;
    q?: string;
    include_deleted?: boolean;
    limit?: number;
    offset?: number;
  }) => apiClient.get<AuditRegisterRow[]>("/audits/register", { params }).then((r) => r.data),

  savePlan: (auditId: string, auditPlan: string) =>
    apiClient.post<Audit>(`/audits/${auditId}/plan`, { audit_plan: auditPlan }).then((r) => r.data),

  // ── Findings ──────────────────────────────────────────────────────────────
  getFindings: (auditId: string) =>
    apiClient.get<AuditFinding[]>(`/audits/${auditId}/findings`).then((r) => r.data),

  listFindings: (auditId: string, params?: { status_filter?: string; severity?: string; finding_type?: string }) =>
    apiClient.get<AuditFinding[]>(`/audits/${auditId}/findings`, { params }).then((r) => r.data),

  createFinding: (auditId: string, data: {
    title: string;
    description: string;
    severity?: string;
    control_id?: string | null;
    remediation_owner_id?: string | null;
    due_date?: string | null;
    recommendation?: string | null;
    finding_type?: string | null;
  }) => apiClient.post<AuditFinding>(`/audits/${auditId}/findings`, data).then((r) => r.data),

  updateFinding: (auditId: string, findingId: string, data: Partial<AuditFinding>) =>
    apiClient.patch<AuditFinding>(`/audits/${auditId}/findings/${findingId}`, data).then((r) => r.data),

  /** Withdraw a constat. `reason` (5 chars minimum) is required — a finding that
   *  simply vanished is exactly what an auditor will not accept. */
  deleteFinding: (auditId: string, findingId: string, reason: string) =>
    apiClient.delete(`/audits/${auditId}/findings/${findingId}`, { params: { reason } }),

  /** Close a finding against its proof. `closure_evidence_id` points at a file
   *  already uploaded to this audit. */
  closeFinding: (auditId: string, findingId: string, data: {
    closure_note: string;
    closure_evidence_id?: string | null;
    status?: string;
  }) => apiClient.post<AuditFinding>(`/audits/${auditId}/findings/${findingId}/close`, data).then((r) => r.data),

  /** The audited party's answer to a constat — « réponse du management ». */
  respondToFinding: (auditId: string, findingId: string, managementResponse: string) =>
    apiClient
      .post<AuditFinding>(`/audits/${auditId}/findings/${findingId}/response`, {
        management_response: managementResponse,
      })
      .then((r) => r.data),

  findingHistory: (auditId: string, findingId: string) =>
    apiClient
      .get<AuditFindingStatusEvent[]>(`/audits/${auditId}/findings/${findingId}/history`)
      .then((r) => r.data),

  /** Every finding past its due date, across all engagements. */
  overdueFindings: () =>
    apiClient.get<OverdueAuditFinding[]>("/audits/findings/overdue").then((r) => r.data),

  // ── Evidence ──────────────────────────────────────────────────────────────
  listEvidence: (auditId: string, findingId?: string) =>
    apiClient
      .get<AuditEvidence[]>(`/audits/${auditId}/evidence`, {
        params: findingId ? { finding_id: findingId } : undefined,
      })
      .then((r) => r.data),

  /** Register a piece of evidence that lives elsewhere (no file upload). */
  createEvidence: (auditId: string, data: {
    name: string;
    description?: string | null;
    file_name?: string | null;
    s3_key?: string | null;
    finding_id?: string | null;
  }) => apiClient.post<AuditEvidence>(`/audits/${auditId}/evidence`, data).then((r) => r.data),

  /** Multipart upload — Content-Type is left to the browser so the multipart
   *  boundary is generated. Uploads are capped at 2 MB by the backend. */
  uploadEvidence: (auditId: string, file: File, options?: {
    name?: string;
    description?: string;
    finding_id?: string;
  }) => {
    const fd = new FormData();
    fd.append("file", file);
    if (options?.name) fd.append("name", options.name);
    if (options?.description) fd.append("description", options.description);
    if (options?.finding_id) fd.append("finding_id", options.finding_id);
    return apiClient.post<AuditEvidence>(`/audits/${auditId}/evidence/upload`, fd).then((r) => r.data);
  },

  /** Attach proof directly to one constat. */
  uploadFindingEvidence: (auditId: string, findingId: string, file: File, options?: {
    name?: string;
    description?: string;
  }) => {
    const fd = new FormData();
    fd.append("file", file);
    if (options?.name) fd.append("name", options.name);
    if (options?.description) fd.append("description", options.description);
    return apiClient
      .post<AuditEvidence>(`/audits/${auditId}/findings/${findingId}/evidence`, fd)
      .then((r) => r.data);
  },

  /** Blob rather than a bare URL — the download needs the Authorization header. */
  downloadEvidence: (auditId: string, evidenceId: string) =>
    apiClient
      .get(`/audits/${auditId}/evidence/${evidenceId}/download`, { responseType: "blob" })
      .then((r) => r.data as Blob),

  deleteEvidence: (auditId: string, evidenceId: string) =>
    apiClient.delete(`/audits/${auditId}/evidence/${evidenceId}`),

  // ── Report state machine ──────────────────────────────────────────────────
  // draft → submitted → approved | rejected → issued → distributed.
  // `generateReport` renders the file; `submit` sends it for approval;
  // `approve`/`reject` are the reviewer's decision; `distribute` records who
  // it was actually sent to.
  generateReport: (auditId: string) =>
    apiClient.post<Audit>(`/audits/${auditId}/report/generate`).then((r) => r.data),

  downloadReport: (auditId: string) =>
    apiClient.get(`/audits/${auditId}/report/download`, { responseType: "blob" }).then((r) => r.data as Blob),

  submitReport: (auditId: string) =>
    apiClient.post<Audit>(`/audits/${auditId}/report/submit`).then((r) => r.data),

  approveReport: (auditId: string, reason?: string) =>
    apiClient.post<Audit>(`/audits/${auditId}/report/approve`, { reason: reason ?? null }).then((r) => r.data),

  rejectReport: (auditId: string, reason: string) =>
    apiClient.post<Audit>(`/audits/${auditId}/report/reject`, { reason }).then((r) => r.data),

  /** @deprecated the pre-workflow one-shot approval. Use `approveReport`. */
  approveReportLegacy: (auditId: string) =>
    apiClient.post<Audit>(`/audits/${auditId}/approve-report`).then((r) => r.data),

  distributeReport: (auditId: string, data: { recipients: string[]; channel?: string; note?: string | null }) =>
    apiClient.post<AuditReportDistribution>(`/audits/${auditId}/report/distribute`, data).then((r) => r.data),

  listReportDistributions: (auditId: string) =>
    apiClient.get<AuditReportDistribution[]>(`/audits/${auditId}/report/distributions`).then((r) => r.data),

  // ── Recommendations (the follow-up register) ──────────────────────────────
  listRecommendations: (params?: {
    status_filter?: string;
    owner_id?: string;
    audit_id?: string;
    campaign_id?: string;
    priority?: string;
    overdue?: boolean;
    limit?: number;
    offset?: number;
  }) => apiClient.get<AuditRecommendation[]>("/audits/recommendations", { params }).then((r) => r.data),

  recommendationsSummary: (campaignId?: string) =>
    apiClient
      .get<AuditRecommendationSummary>("/audits/recommendations/summary", {
        params: campaignId ? { campaign_id: campaignId } : undefined,
      })
      .then((r) => r.data),

  /** Recompute each recommendation's progress from its action items. */
  rollupRecommendations: (auditId?: string) =>
    apiClient
      .post("/audits/recommendations/rollup", null, { params: auditId ? { audit_id: auditId } : undefined })
      .then((r) => r.data),

  listAuditRecommendations: (auditId: string) =>
    apiClient.get<AuditRecommendation[]>(`/audits/${auditId}/recommendations`).then((r) => r.data),

  createRecommendation: (auditId: string, data: {
    title: string;
    description?: string | null;
    finding_id?: string | null;
    ref_code?: string | null;
    priority?: string | null;
    owner_id?: string | null;
    due_date?: string | null;
  }) => apiClient.post<AuditRecommendation>(`/audits/${auditId}/recommendations`, data).then((r) => r.data),

  updateRecommendation: (recId: string, data: Partial<{
    title: string;
    description: string | null;
    ref_code: string | null;
    priority: string | null;
    status: string;
    owner_id: string | null;
    due_date: string | null;
    progress: number;
  }>) => apiClient.patch<AuditRecommendation>(`/audits/recommendations/${recId}`, data).then((r) => r.data),

  closeRecommendation: (recId: string, data: { closure_note: string; status?: string }) =>
    apiClient.post<AuditRecommendation>(`/audits/recommendations/${recId}/close`, data).then((r) => r.data),

  deleteRecommendation: (recId: string) =>
    apiClient.delete(`/audits/recommendations/${recId}`),

  // ── Comments scoped to one engagement ─────────────────────────────────────
  // The cross-engagement feed lives on auditCommentsApi.
  listComments: (auditId: string, findingId?: string) =>
    apiClient
      .get<AuditComment[]>(`/audits/${auditId}/comments`, {
        params: findingId ? { finding_id: findingId } : undefined,
      })
      .then((r) => r.data),

  postComment: (auditId: string, data: {
    body: string;
    finding_id?: string | null;
    parent_id?: string | null;
    is_internal?: boolean;
  }) => apiClient.post<AuditComment>(`/audits/${auditId}/comments`, data).then((r) => r.data),
};

// ─── Audit campaigns (« plan d'audit annuel ») ────────────────────────────
// A campaign groups engagements into one programme so a steering committee can
// read where the plan stands in a single call.

export const auditCampaignsApi = {
  list: (params?: {
    status?: string;
    cadence?: string;
    is_active?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
  }) => apiClient.get<AuditCampaignListResponse>("/audit-campaigns", { params }).then((r) => r.data),

  get: (campaignId: string) =>
    apiClient.get<AuditCampaign>(`/audit-campaigns/${campaignId}`).then((r) => r.data),

  create: (data: {
    name: string;
    description?: string | null;
    cadence?: string;
    status?: string;
    period_start?: string | null;
    period_end?: string | null;
    owner_id?: string | null;
  }) => apiClient.post<AuditCampaign>("/audit-campaigns", data).then((r) => r.data),

  update: (campaignId: string, data: Partial<{
    name: string;
    description: string | null;
    cadence: string;
    status: string;
    period_start: string | null;
    period_end: string | null;
    owner_id: string | null;
    is_active: boolean;
  }>) => apiClient.patch<AuditCampaign>(`/audit-campaigns/${campaignId}`, data).then((r) => r.data),

  delete: (campaignId: string) => apiClient.delete(`/audit-campaigns/${campaignId}`),

  audits: (campaignId: string) =>
    apiClient.get<AuditCampaignAudit[]>(`/audit-campaigns/${campaignId}/audits`).then((r) => r.data),

  /** Everything a steering committee asks for, in one call. */
  summary: (campaignId: string) =>
    apiClient.get<AuditCampaignSummary>(`/audit-campaigns/${campaignId}/summary`).then((r) => r.data),

  /** Announce the plan to its stakeholders. `force` re-announces a campaign that
   *  was already announced — otherwise the second call is refused. */
  notify: (campaignId: string, force = false) =>
    apiClient
      .post<AuditCampaign>(`/audit-campaigns/${campaignId}/notify`, null, { params: { force } })
      .then((r) => r.data),
};

// ─── Audit grids (« grille d'évaluation personnalisable ») ────────────────
// A reusable checklist with its own verdict levels. An engagement that points at
// a grid is answered on the grid; one that does not falls back to the framework
// controls checklist, unchanged.

export const auditGridsApi = {
  list: (params?: { is_active?: boolean; search?: string; limit?: number; offset?: number }) =>
    apiClient.get<AuditGrid[]>("/audit-grids", { params }).then((r) => r.data),

  /** Returns the grid AND its rows. */
  get: (gridId: string) =>
    apiClient.get<AuditGridDetail>(`/audit-grids/${gridId}`).then((r) => r.data),

  create: (data: {
    name: string;
    description?: string | null;
    levels?: ComplianceScaleLevel[] | null;
    source_framework_id?: string | null;
    is_default?: boolean;
  }) => apiClient.post<AuditGrid>("/audit-grids", data).then((r) => r.data),

  update: (gridId: string, data: Partial<{
    name: string;
    description: string | null;
    levels: ComplianceScaleLevel[] | null;
    is_default: boolean;
    is_active: boolean;
  }>) => apiClient.patch<AuditGrid>(`/audit-grids/${gridId}`, data).then((r) => r.data),

  delete: (gridId: string) => apiClient.delete(`/audit-grids/${gridId}`),

  addItem: (gridId: string, data: {
    title: string;
    ref_code?: string | null;
    description?: string | null;
    guidance?: string | null;
    section?: string | null;
    sort_order?: number | null;
    control_id?: string | null;
    is_mandatory?: boolean;
  }) => apiClient.post<AuditGridItem>(`/audit-grids/${gridId}/items`, data).then((r) => r.data),

  updateItem: (gridId: string, itemId: string, data: Partial<{
    title: string;
    ref_code: string | null;
    description: string | null;
    guidance: string | null;
    section: string | null;
    sort_order: number;
    is_mandatory: boolean;
  }>) => apiClient.patch<AuditGridItem>(`/audit-grids/${gridId}/items/${itemId}`, data).then((r) => r.data),

  deleteItem: (gridId: string, itemId: string) =>
    apiClient.delete(`/audit-grids/${gridId}/items/${itemId}`),

  /** Fill a grid from a framework's controls. `domain` narrows a large standard;
   *  `replace` wipes the grid's current rows first. */
  seedFromFramework: (gridId: string, data: { framework_id: string; domain?: string | null; replace?: boolean }) =>
    apiClient.post<AuditGridSeedResult>(`/audit-grids/${gridId}/seed-from-framework`, data).then((r) => r.data),

  // ── Working through a grid on one engagement ──────────────────────────────
  /** `source` says whether this engagement has a grid at all — when it reads
   *  "framework_controls" the caller keeps using the existing checklist. */
  checklist: (auditId: string) =>
    apiClient.get<AuditGridChecklist>(`/audit-grids/audits/${auditId}/checklist`).then((r) => r.data),

  /** Upsert one answer. `verdict` is a key of the grid's levels, or null to clear. */
  setResponse: (auditId: string, itemId: string, data: { verdict?: string | null; note?: string | null }) =>
    apiClient.put<AuditGridResponseItem>(`/audit-grids/audits/${auditId}/responses/${itemId}`, data).then((r) => r.data),

  /** Save a whole page of answers at once, keyed by grid item id. */
  setResponsesBulk: (auditId: string, responses: Record<string, { verdict?: string | null; note?: string | null }>) =>
    apiClient.put<AuditGridResponseItem[]>(`/audit-grids/audits/${auditId}/responses`, { responses }).then((r) => r.data),
};

// ─── Audit comments (« échange contradictoire ») ──────────────────────────
// Threads hang off an audit, a finding, or a control assessment. An internal
// note is invisible to the audited party — `viewer_is_audit_team` on the thread
// says whether to offer that toggle at all, instead of having the POST refused.

export const auditCommentsApi = {
  list: (params: {
    audit_id?: string;
    finding_id?: string;
    control_assessment_id?: string;
    limit?: number;
    offset?: number;
  }) => apiClient.get<AuditCommentThread>("/audit-comments", { params }).then((r) => r.data),

  create: (data: {
    body: string;
    audit_id?: string | null;
    finding_id?: string | null;
    control_assessment_id?: string | null;
    parent_id?: string | null;
    is_internal?: boolean;
  }) => apiClient.post<AuditComment>("/audit-comments", data).then((r) => r.data),

  update: (commentId: string, body: string) =>
    apiClient.patch<AuditComment>(`/audit-comments/${commentId}`, { body }).then((r) => r.data),

  /** Soft delete: the row survives for the trail, the words do not. */
  delete: (commentId: string) => apiClient.delete(`/audit-comments/${commentId}`),

  /** The « constats à traiter » feed — exchanges waiting on the current user. */
  pending: (limit?: number) =>
    apiClient
      .get<PendingAuditComment[]>("/audit-comments/pending", { params: limit ? { limit } : undefined })
      .then((r) => r.data),
};

// ─── Requirements referential (« référentiel centralisé ») ────────────────
// One flat, filterable view over every silo that holds a requirement: framework
// controls, internal policies, regulatory obligations. `scope` defaults to
// "selected" (the tenant's chosen frameworks); pass "all" to search everything.

export const requirementsApi = {
  list: (params?: {
    source_kind?: string;
    source_type?: string;
    domain?: string;
    requirement_type?: string;
    applicability?: string;
    framework_id?: string;
    search?: string;
    scope?: "selected" | "all";
    limit?: number;
    offset?: number;
  }) => apiClient.get<RequirementListResponse>("/requirements", { params }).then((r) => r.data),

  /** Counts per classification axis — what the filter sidebar renders. */
  facets: (params?: {
    source_kind?: string;
    source_type?: string;
    domain?: string;
    requirement_type?: string;
    applicability?: string;
    framework_id?: string;
    search?: string;
    scope?: "selected" | "all";
  }) => apiClient.get<RequirementFacets>("/requirements/facets", { params }).then((r) => r.data),

  /** Every internal policy that claims to cover this requirement. */
  policiesForControl: (controlId: string) =>
    apiClient
      .get<RequirementLinkedPolicy[]>(`/requirements/controls/${controlId}/policies`)
      .then((r) => r.data),
};

// ─── Policies ────────────────────────────────

export interface PolicyVersion {
  id: string;
  policy_id: string;
  version_number: number;
  content: string;
  change_summary?: string;
  is_current: boolean;
  authored_by_id?: string;
  approved_by_id?: string;
  approved_at?: string;
  created_at: string;
}

export interface PolicyAttestation {
  id: string;
  policy_id: string;
  policy_version_id: string;
  user_id: string;
  status: "pending" | "acknowledged";
  due_date?: string;
  acknowledged_at?: string;
  created_at: string;
}

export interface MyPolicyAttestation {
  id: string;
  policy_id: string;
  policy_version_id: string;
  status: "pending" | "acknowledged" | "declined" | "expired";
  due_date?: string | null;
  acknowledged_at?: string | null;
  overdue: boolean;
  policy_title: string;
  policy_number?: string | null;
  policy_status: string;
  version_number?: number | null;
  content?: string | null;
  current_version_number?: number | null;
  created_at: string;
}

export const policiesApi = {
  /** GET /policies declares NO query parameters (list_policies in policies.py):
   *  it always returns every policy of the tenant, newest first. `page`,
   *  `page_size` and `limit` are accepted here only so the existing callers
   *  keep compiling — the server ignores them, so do not build a pager on
   *  them, and expect the whole register in the response. */
  list: (params?: { page?: number; page_size?: number; limit?: number }) =>
    apiClient.get<Policy[]>("/policies", { params }).then((r) => r.data),

  get: (id: string) => apiClient.get<Policy>(`/policies/${id}`).then((r) => r.data),

  // The signed-in user's own acknowledgements (any role) — the My policies page.
  myAttestations: () =>
    apiClient.get<MyPolicyAttestation[]>("/policies/my-attestations").then((r) => r.data),

  create: (data: Partial<Policy>) =>
    apiClient.post<Policy>("/policies", data).then((r) => r.data),

  update: (id: string, data: Partial<Policy>) =>
    apiClient.patch<Policy>(`/policies/${id}`, data).then((r) => r.data),

  delete: (id: string) => apiClient.delete(`/policies/${id}`),

  getVersions: (id: string) =>
    apiClient.get<PolicyVersion[]>(`/policies/${id}/versions`).then((r) => r.data),

  createVersion: (id: string, data: { content: string; change_summary?: string }) =>
    apiClient.post<PolicyVersion>(`/policies/${id}/versions`, data).then((r) => r.data),

  /** Return a policy to an earlier version. Appends a new current version
   *  holding the old content — the superseded version stays in the history. */
  restorePolicyVersion: (id: string, versionId: string) =>
    apiClient
      .post<PolicyVersion>(`/policies/${id}/versions/${versionId}/restore`)
      .then((r) => r.data),

  listAttestations: (id: string) =>
    apiClient.get<PolicyAttestation[]>(`/policies/${id}/attestations`).then((r) => r.data),

  createAttestations: (id: string, data: { user_ids: string[]; due_date?: string }) =>
    apiClient.post<PolicyAttestation[]>(`/policies/${id}/attestations`, data).then((r) => r.data),

  exportPdf: (id: string) =>
    apiClient.get(`/policies/${id}/export-pdf`, { responseType: "blob" }).then((r) => r.data as Blob),

  acknowledgeAttestation: (policyId: string, attestationId: string) =>
    apiClient
      .patch<PolicyAttestation>(`/policies/${policyId}/attestations/${attestationId}/acknowledge`)
      .then((r) => r.data),

  approveVersion: (policyId: string, versionId: string) =>
    apiClient.patch<PolicyVersion>(`/policies/${policyId}/versions/${versionId}/approve`).then((r) => r.data),

  // ── Policy ↔ requirement linkage ──────────────────────────────────────────
  /** The requirements this policy claims to cover, resolved for display —
   *  `linked_controls` holds bare ids, this returns the refs an auditor reads. */
  listLinkedControls: (policyId: string) =>
    apiClient.get<PolicyLinkedControl[]>(`/policies/${policyId}/controls`).then((r) => r.data),

  /** Rewrite the requirement links. Pass the complete list — this replaces, it
   *  does not merge. */
  setLinkedControls: (policyId: string, linkedControls: string[]) =>
    apiClient.patch<Policy>(`/policies/${policyId}`, { linked_controls: linkedControls }).then((r) => r.data),

  /** The other direction: given a requirement, which policies cover it. */
  byControl: (controlId: string) =>
    apiClient.get<ControlPolicies>(`/policies/by-control/${controlId}`).then((r) => r.data),
};

// ─── Vendors ─────────────────────────────────

export interface VendorAssessmentRecord {
  id: string;
  vendor_id: string;
  name: string;
  kind?: "prescreen" | "ai_analysis" | string | null;
  status: string;
  risk_level?: string | null;
  assessment_score?: number | null;
  applied_risk_score?: number | null;
  narrative?: string | null;
  result?: { strengths?: string[]; concerns?: string[]; red_flags?: string[]; recommendations?: string[] } | null;
  answers?: Record<string, string> | null;
  assessed_by_id?: string | null;
  approved_by_id?: string | null;
  approved_at?: string | null;
  created_at: string;
}

export const vendorsApi = {
  list: () =>
    apiClient.get<{ items: Vendor[]; total: number }>("/vendors").then((r) => r.data),

  get: (id: string) => apiClient.get<Vendor>(`/vendors/${id}`).then((r) => r.data),

  create: (data: Partial<Vendor>) =>
    apiClient.post<Vendor>("/vendors", data).then((r) => r.data),

  // Partial update: only the keys sent are changed. Ending the relationship
  // (offboarding / inactive) goes through offboard(), which records date + reason.
  update: (id: string, data: Record<string, unknown>) =>
    apiClient.patch<Vendor>(`/vendors/${id}`, data).then((r) => r.data),

  // 409 when a contract carries a CISO decision or a signature — offboard instead.
  delete: (id: string) => apiClient.delete(`/vendors/${id}`),

  offboard: (id: string, data: { status: "offboarding" | "inactive"; effective_date: string; reason: string }) =>
    apiClient.post<Vendor>(`/vendors/${id}/offboard`, data).then((r) => r.data),

  // Prescreen + approved AI analyses, newest first.
  listAssessments: (id: string) =>
    apiClient.get<VendorAssessmentRecord[]>(`/vendors/${id}/assessments`).then((r) => r.data),

  createAssessment: (id: string, data: Record<string, unknown>) =>
    apiClient.post<VendorAssessmentRecord>(`/vendors/${id}/assessments`, data).then((r) => r.data),

  approveAnalysis: (vendorId: string, riskScore: number, analysisNotes?: string) =>
    apiClient.post<Vendor>(`/vendors/${vendorId}/approve-analysis`, {
      risk_score: riskScore,
      analysis_notes: analysisNotes,
    }).then((r) => r.data),

  analyzeStream: (options: {
    vendorId: string;
    questionnaireResponses: Record<string, string>;
    onChunk: (chunk: string) => void;
    onDone: () => void;
    signal: AbortSignal;
  }) => {
    const { vendorId, questionnaireResponses, onChunk, onDone, signal } = options;
    // Call vendor-specific analyze endpoint and stream the response
    apiClient.post(`/vendors/${vendorId}/analyze`, {
      questionnaire_responses: questionnaireResponses,
    }, { signal }).then((resp) => {
      // Extract analysis text from response
      let text: string = "";

      if (resp.data?.analysis && typeof resp.data.analysis === "string") {
        text = resp.data.analysis;
      } else if (typeof resp.data === "string") {
        text = resp.data;
      } else if (typeof resp.data === "object") {
        text = JSON.stringify(resp.data, null, 2);
      } else {
        text = String(resp.data || "");
      }

      const chunkSize = 20; // Emit chunks of 20 chars

      let index = 0;
      const interval = setInterval(() => {
        if (index >= text.length) {
          clearInterval(interval);
          onDone();
          return;
        }

        const chunk = text.slice(index, index + chunkSize);
        onChunk(chunk);
        index += chunkSize;
      }, 50); // 50ms between chunks for visual effect

    }).catch((err) => {
      console.error("Analysis error:", err);
      onDone();
    });

    return {
      close: () => {
        // Abort the request
        signal.dispatchEvent(new Event("abort"));
      },
    };
  },

  uploadContract: async (vendorId: string, file: File) => {
    const formData = new FormData();
    formData.append("contract_file", file);
    return apiClient.post(`/vendors/${vendorId}/upload-contract`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
  },

  // Contract validation workflow
  listContractsPendingReview: () =>
    apiClient.get("/vendors/contracts/pending-review").then((r) => r.data),

  listVendorContracts: (vendorId: string) =>
    apiClient.get(`/vendors/${vendorId}/contracts`).then((r) => r.data),

  getContract: (contractId: string) =>
    apiClient.get(`/vendors/contracts/${contractId}`).then((r) => r.data),

  cisoReviewContract: (contractId: string, action: "approve" | "reject", comments?: string) =>
    apiClient.post(`/vendors/contracts/${contractId}/ciso-review`, {
      action,
      comments,
    }).then((r) => r.data),

  sendContractToVendor: (contractId: string) =>
    apiClient.post(`/vendors/contracts/${contractId}/send-to-vendor`).then((r) => r.data),

  // Risk cartography
  getRiskCartography: (vendorId: string) =>
    apiClient.get(`/vendors/${vendorId}/cartography`).then((r) => r.data),

  // Prescreen questionnaire (AI analysis BEFORE saving vendor)
  prescreenQuestionnaire: (data: {
    vendor_name: string;
    vendor_industry?: string;
    vendor_country?: string;
    responses: Record<string, string>;
  }) => apiClient.post("/vendors/prescreen", data).then((r) => r.data),
};

// ─── Dashboard ───────────────────────────────

export interface RiskTrendPoint {
  month: string;
  period: string;
  critical: number;
  high: number;
}

export interface DashboardWidgetItem {
  id: string;
  visible: boolean;
}

export interface DashboardLayout {
  dashboard_key: string;
  widget_config: DashboardWidgetItem[];
  is_default: boolean;
  /**
   * Auto-refresh cadence for this dashboard — the « mise à jour ... selon un
   * intervalle configuré » half of the tender clause.
   *   null = never configured (apply the client default),
   *      0 = auto-refresh explicitly OFF,
   *      n = refresh every n seconds.
   */
  refresh_interval_seconds?: number | null;
  /**
   * false when dashboard_layouts.refresh_interval_seconds is not physically on
   * this database yet (create_all() does not add columns to an EXISTING table —
   * scripts/migrate_add_dashboard_refresh.py has to be run). The selector must
   * be hidden while this is false: a PUT carrying the field answers 424.
   */
  refresh_config_available?: boolean;
  /** Bounds echoed by the backend so the UI never hardcodes them. */
  refresh_min_seconds?: number;
  refresh_max_seconds?: number;
}

/** Partial PUT body for /dashboard/layout — omitted fields are left unchanged
 *  server-side, so cadence and widget order save independently. */
export interface DashboardLayoutPatch {
  widget_config?: DashboardWidgetItem[];
  refresh_interval_seconds?: number;
}

/** The nine dashboard keys the backend knows (widget defaults + export). */
export const DASHBOARD_KEYS = [
  "assets", "vulnerabilities", "threats", "risks", "controls",
  "governance", "audit", "compliance", "executive",
] as const;

export const dashboardApi = {
  getSummary: () => apiClient.get<DashboardSummary>("/dashboard/summary").then((r) => r.data),
  getFrameworksOverview: () => apiClient.get("/dashboard/frameworks-overview").then((r) => r.data),
  getFrameworkSummary: (frameworkId?: string) =>
    apiClient.get("/dashboard/framework-summary", { params: frameworkId ? { framework_id: frameworkId } : {} }).then((r) => r.data),
  getRiskTrend: (months?: number) =>
    apiClient.get<{ series: RiskTrendPoint[]; source: string; note: string }>("/dashboard/risk-trend", {
      params: months ? { months } : {},
    }).then((r) => r.data),
  // Widget personalization (Elite Pack — custom_dashboards). GET always works
  // (falls back to a sensible default); PUT 402s for non-Elite tenants and is
  // handled by the global elite-upsell listener.
  getLayout: (dashboardKey: string = "main") =>
    apiClient.get<DashboardLayout>("/dashboard/layout", { params: { dashboard_key: dashboardKey } }).then((r) => r.data),
  saveLayout: (widgetConfig: DashboardWidgetItem[], dashboardKey: string = "main") =>
    apiClient.put<DashboardLayout>("/dashboard/layout", { widget_config: widgetConfig }, { params: { dashboard_key: dashboardKey } }).then((r) => r.data),

  /**
   * Save only the auto-refresh cadence, leaving the widget layout untouched.
   *
   * Kept separate from saveLayout on purpose: the backend gates a widget_config
   * write on custom_dashboards (402 for a non-Elite tenant) but NOT the cadence,
   * which is a tender requirement rather than an up-sell. Sending both together
   * would drag the cadence behind the plan gate for the 16 of 18 tenants that
   * are not Elite.
   *
   * @param seconds 0 turns auto-refresh off; otherwise 30..3600 (422 outside).
   *                Check `refresh_config_available` from getLayout() first — a
   *                PUT of this field on an unmigrated database answers 424.
   */
  saveRefreshInterval: (seconds: number, dashboardKey: string = "main") =>
    apiClient
      .put<DashboardLayout>("/dashboard/layout", { refresh_interval_seconds: seconds }, {
        params: { dashboard_key: dashboardKey },
      })
      .then((r) => r.data),

  /** Escape hatch for saving both halves at once (same 402/424 caveats). */
  updateLayout: (patch: DashboardLayoutPatch, dashboardKey: string = "main") =>
    apiClient
      .put<DashboardLayout>("/dashboard/layout", patch, { params: { dashboard_key: dashboardKey } })
      .then((r) => r.data),

  /**
   * Objectif 9 — the consolidated cross-module view « réservée aux profils
   * exécutifs ». STRICTLY gated server-side (require_roles_strict): a
   * tenant_admin who is not also `executive`/`ciso` gets a 403 here, which is
   * the point of the clause and NOT a bug to work around. Callers should hide
   * the entry point rather than let the user walk into the 403.
   *
   * Not billing-gated, so it never produces the Elite up-sell dialog.
   */
  getExecutiveSummary: () =>
    apiClient.get<ExecutiveSummary>("/dashboard/executive-summary").then((r) => r.data),
};

// ─── Dashboard export (PDF / Excel) ──────────────────────────────────────────
//
// « Export PDF/Excel » appears in seven of the nine tender objectives. This is
// the dashboard itself as an artefact — not the Report Builder (a flat dataset
// from another screen) and not the five canned narrative PDFs.
//
// The artefact is written in the caller's language: `lang` is sent as a query
// parameter as well as via Accept-Language because the backend lets ?lang= win,
// and a download triggered outside axios (an <a href>) cannot set a header.

/** Filename the server chose, from Content-Disposition, with a sane fallback. */
function exportFilenameFrom(disposition: unknown, fallback: string): string {
  if (typeof disposition !== "string") return fallback;
  // filename="assets_dashboard_20260908.xlsx"
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return match?.[1] ? decodeURIComponent(match[1]) : fallback;
}

/**
 * Normalise an export failure into something a screen can act on.
 *
 * Necessary because responseType:"blob" makes axios hand back the ERROR body as
 * a Blob too, so `error.response.data.detail` is `undefined` and printing it
 * yields "[object Blob]". A 424 here is operator-actionable (the schema is
 * behind the code) and MUST be shown, never treated as a crash.
 */
export async function parseDashboardExportError(err: unknown): Promise<DashboardExportFailure> {
  const response = (err as { response?: { status?: number; data?: unknown } })?.response;
  const status = response?.status ?? 0;
  let raw: unknown = response?.data;
  if (raw instanceof Blob) {
    try {
      raw = JSON.parse(await raw.text());
    } catch {
      raw = undefined;
    }
  }
  const detail = (raw as { detail?: unknown } | undefined)?.detail;
  if (detail && typeof detail === "object") {
    const d = detail as { error?: string; message?: string };
    return { status, error: d.error ?? "", message: d.message ?? "" };
  }
  return { status, error: "", message: typeof detail === "string" ? detail : "" };
}

export const dashboardExportApi = {
  /**
   * The nine dashboards with localised labels and an ADVISORY role list.
   * `roles` is a hint for hiding buttons — the binding check runs on the export
   * itself and can still refuse (403), so never treat this as the policy.
   */
  keys: (lang?: string) =>
    apiClient
      .get<DashboardExportCatalogue>("/dashboard-export/keys", { params: lang ? { lang } : undefined })
      .then((r) => r.data),

  /**
   * One dashboard as a binary artefact.
   * 200 blob | 400 bad format | 402 feature_not_in_plan (global upsell listener)
   * | 403 role | 404 unknown key | 424 schema/gate not ready (show the message).
   */
  exportDashboard: (
    key: DashboardExportKey,
    format: DashboardExportFormat = "xlsx",
    lang?: string,
  ): Promise<Blob> =>
    apiClient
      .get(`/dashboard-export/${key}`, { params: { format, ...(lang ? { lang } : {}) }, responseType: "blob" })
      .then((r) => r.data as Blob),

  /** Same call, keeping the server-chosen filename (date-stamped per dashboard). */
  exportDashboardFile: (
    key: DashboardExportKey,
    format: DashboardExportFormat = "xlsx",
    lang?: string,
  ): Promise<{ blob: Blob; filename: string }> =>
    apiClient
      .get(`/dashboard-export/${key}`, { params: { format, ...(lang ? { lang } : {}) }, responseType: "blob" })
      .then((r) => ({
        blob: r.data as Blob,
        filename: exportFilenameFrom(
          (r.headers as unknown as Record<string, unknown> | undefined)?.["content-disposition"],
          `${key}_dashboard.${format === "pdf" ? "pdf" : "xlsx"}`,
        ),
      })),
};

// ─── Subscriptions ───────────────────────────

export const subscriptionsApi = {
  get: () => apiClient.get<Subscription>("/subscriptions/current").then((r) => r.data),

  /** @deprecated 404 — POST /subscriptions/checkout does not exist in
   *  backend/app; there is no self-serve billing on this platform. A tier
   *  change goes through PATCH /subscriptions/current (admin-gated), which is
   *  `update()` below. Kept, not deleted, in case the route is being added
   *  elsewhere — but nothing may call this until it is. */
  createCheckoutSession: (tier: string, billing_cycle: string) =>
    apiClient
      .post<{ checkout_url: string }>("/subscriptions/checkout", { tier, billing_cycle })
      .then((r) => r.data),

  /**
   * What this tenant may actually use.
   *
   * features is computed with the same has_feature() that require_feature
   * enforces with, so the navigation cannot offer a page whose endpoints
   * answer 402. Do not swap this for /current/limits: that is the merged tier
   * map, which does not apply Elite god mode and would hide features an Elite
   * tenant is entitled to.
   */
  getEntitlements: () =>
    apiClient
      .get<{ tier: string; features: Record<string, boolean>; limits: Record<string, unknown> }>(
        "/subscriptions/current/entitlements",
      )
      .then((r) => r.data),
};

// ─── Notifications ────────────────────────────

export const notificationsApi = {
  list: (params?: { status_filter?: "all" | "unread"; limit?: number; offset?: number }) =>
    apiClient.get<NotificationListResponse>("/notifications", { params }).then((r) => r.data),

  markRead: (id: string) =>
    apiClient.patch<AppNotification>(`/notifications/${id}/read`).then((r) => r.data),

  markAllRead: () =>
    apiClient.patch("/notifications/read-all"),

  delete: (id: string) =>
    apiClient.delete(`/notifications/${id}`),

  clearAll: () =>
    apiClient.delete("/notifications"),

  getPreferences: () =>
    apiClient.get<NotificationPreference[]>("/notifications/preferences").then((r) => r.data),

  updatePreferences: (preferences: NotificationPreference[]) =>
    apiClient
      .put<NotificationPreference[]>("/notifications/preferences", { preferences })
      .then((r) => r.data),

  checkDeadlines: () =>
    apiClient.post("/notifications/check-deadlines").then((r) => r.data),
};

// ─── Reports ─────────────────────────────────

export const reportsApi = {
  /** The five report types, LOCALISED. Match on `id`, never on the label —
   *  the name changes with the UI language. */
  listTypes: (lang?: string) =>
    apiClient.get("/reports/types", { params: lang ? { lang } : undefined }).then((r) => r.data),

  /**
   * Generate and download. The document is already produced in the UI language
   * (the client sends Accept-Language on every request and the generator falls
   * back to it); `lang` is for the case the tender actually asks about —
   * deliberately producing the French or Arabic edition from a session in
   * another language. It is echoed into the file name so two languages of the
   * same report do not overwrite each other in the user's Downloads folder.
   *
   * `archive: false` skips the historique — use it for a throwaway copy.
   */
  download: async (reportType: string, lang?: string, archive = true) => {
    const response = await apiClient.get(`/reports/${reportType}/generate`, {
      params: { ...(lang ? { lang } : {}), ...(archive ? {} : { archive: false }) },
      responseType: "blob",
    });
    // Create blob URL and trigger download
    const blob = new Blob([response.data], { type: "application/pdf" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().split("T")[0];
    link.href = url;
    link.download = `${reportType}_report_${date}${lang ? `_${lang}` : ""}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },

  preview: async (reportType: string, lang?: string): Promise<string> => {
    const response = await apiClient.get(`/reports/${reportType}/preview`, {
      params: lang ? { lang } : undefined,
      responseType: "blob",
    });
    const blob = new Blob([response.data], { type: "application/pdf" });
    return window.URL.createObjectURL(blob);
  },

  // ── « Archivage des rapports dans l'historique » ──────────────────────────
  // The purpose-built pair, replacing the roundabout read through
  // complianceApi.listFileVersions("report:<type>", tenantId): these are gated
  // on the report-archive role set rather than on the file-versions one, and
  // the download re-verifies the sha256 before serving (409 if the bytes on
  // disk no longer match what was recorded — that is the point of an archive).
  /** Every report this tenant has produced, newest first. */
  history: (params?: { report_type?: string; limit?: number }) =>
    apiClient.get<ArchivedReportItem[]>("/reports/history", { params }).then((r) => r.data),

  /** One archived version, exactly as it was produced. Blob rather than a bare
   *  URL: the route is HTTPBearer-only, so an <a href> would 401. */
  downloadArchivedReport: (versionId: string) =>
    apiClient
      .get(`/reports/history/${versionId}/download`, { responseType: "blob" })
      .then((r) => r.data as Blob),
};

// ─── Scheduled Reports (Elite Pack) ───────────────────────────
export const reportSchedulesApi = {
  list: () => apiClient.get("/report-schedules").then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/report-schedules", data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/report-schedules/${id}`, data).then((r) => r.data),
  delete: (id: string) => apiClient.delete(`/report-schedules/${id}`),
  runNow: (id: string) => apiClient.post(`/report-schedules/${id}/run`).then((r) => r.data),
};

// ─── Auditor Portal ───────────────────────────

export interface AuditorAssignment {
  assignment_id: string;
  assessment_id: string;
  assessment_name: string;
  framework_name: string;
  framework_short_name: string;
  status: string;
  compliance_score?: number;
  controls_total: number;
  controls_verified: number;
  reference_document_ids: string[];
}

export interface AuditChecklistLinkedDoc {
  id: string;
  file_name: string;
  document_name: string | null;
  clause_ref: string | null;
  content_type: string | null;
  file_size_bytes: number | null;
  is_evidence?: boolean;
}

export interface AuditChecklistControl {
  control_assessment_id: string;
  control_identifier: string;
  control_title: string;
  control_category?: string;
  control_description?: string;
  status: string;
  company_notes?: string;
  implementation_notes?: string;
  auditor_notes?: string;
  linked_checklist_documents?: AuditChecklistLinkedDoc[];
}

export interface AuditChecklistDocument {
  id: string;
  file_name: string;
  document_type_key: string | null;
  clause_ref: string | null;
  document_name: string | null;
  content_type: string | null;
  file_size_bytes: number | null;
  created_at: string;
  is_evidence?: boolean;
}

export interface AuditChecklist {
  assessment_id: string;
  controls: AuditChecklistControl[];
  documents: AuditChecklistDocument[];
}

export const auditorPortalApi = {
  getMyAssignments: () =>
    apiClient.get<AuditorAssignment[]>("/auditor-portal/my-assignments").then((r) => r.data),

  getChecklist: (assessmentId: string) =>
    apiClient
      .get<AuditChecklist>(`/auditor-portal/assessments/${assessmentId}/checklist`)
      .then((r) => r.data),

  recordVerdict: (controlAssessmentId: string, verdict: string, notes: string) =>
    apiClient
      .patch(`/auditor-portal/control-assessments/${controlAssessmentId}`, {
        verdict,
        auditor_notes: notes,
      })
      .then((r) => r.data),

  generateReport: (
    assessmentId: string,
    onToken: (token: string) => void,
    onDone: () => void,
    signal: AbortSignal,
  ) =>
    _streamAi(
      `/auditor-portal/assessments/${assessmentId}/generate-report`,
      {},
      onToken,
      onDone,
      signal,
    ),

  // ── Engagement-scoped portal (« affectation des auditeurs ») ──────────────
  /** The engagements this auditor was given — assignments seen from their side. */
  getMyAudits: () =>
    apiClient.get<AuditorEngagement[]>("/auditor-portal/audits").then((r) => r.data),

  getMyAudit: (auditId: string) =>
    apiClient.get<AuditorEngagement>(`/auditor-portal/audits/${auditId}`).then((r) => r.data),

  /** The engagement's checklist plus the verdict scale it is answered on. When
   *  `grid` is null the engagement has no grid and `controls` is the checklist. */
  getEngagementChecklist: (auditId: string) =>
    apiClient
      .get<AuditorEngagementChecklist>(`/auditor-portal/audits/${auditId}/checklist`)
      .then((r) => r.data),

  /** Record a verdict on one grid row. `verdict` must be a key of the scale the
   *  checklist shipped — free text is rejected server-side. */
  recordGridVerdict: (auditId: string, itemId: string, data: { verdict?: string | null; note?: string | null }) =>
    apiClient.put(`/auditor-portal/audits/${auditId}/grid-items/${itemId}`, data).then((r) => r.data),

  listEngagementFindings: (auditId: string) =>
    apiClient.get<AuditFinding[]>(`/auditor-portal/audits/${auditId}/findings`).then((r) => r.data),

  /** « Ajout de constats » — the auditor files their own finding from the portal. */
  createEngagementFinding: (auditId: string, data: {
    title: string;
    description: string;
    severity?: string;
    finding_type?: string | null;
    control_id?: string | null;
    recommendation?: string | null;
    due_date?: string | null;
    remediation_owner_id?: string | null;
  }) => apiClient.post<AuditFinding>(`/auditor-portal/audits/${auditId}/findings`, data).then((r) => r.data),

  listEngagementEvidence: (auditId: string) =>
    apiClient.get<AuditEvidence[]>(`/auditor-portal/audits/${auditId}/evidence`).then((r) => r.data),

  /** Multipart — Content-Type is left to the browser so the boundary is generated. */
  uploadEngagementEvidence: (auditId: string, file: File, options?: {
    name?: string;
    description?: string;
    finding_id?: string;
  }) => {
    const fd = new FormData();
    fd.append("file", file);
    if (options?.name) fd.append("name", options.name);
    if (options?.description) fd.append("description", options.description);
    if (options?.finding_id) fd.append("finding_id", options.finding_id);
    return apiClient.post<AuditEvidence>(`/auditor-portal/audits/${auditId}/evidence`, fd).then((r) => r.data);
  },

  downloadEngagementEvidence: (evidenceId: string) =>
    apiClient
      .get(`/auditor-portal/evidence/${evidenceId}/download`, { responseType: "blob" })
      .then((r) => r.data as Blob),
};

// ─── Users ────────────────────────────────────

export interface AuditorUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  expires_at?: string | null;
}

export interface AuditorAssignmentRecord {
  id: string;
  auditor_id: string;
  auditor_email: string;
  auditor_name: string;
  assessment_id: string;
  assessment_name: string;
  is_active: boolean;
}

export interface TenantUserRecord {
  id: string; first_name: string; last_name: string; email: string;
  role: string; roles: string[]; excluded_roles: string[]; effective_roles: string[];
  is_active: boolean; expires_at?: string | null;
}

export const usersApi = {
  list: () =>
    apiClient
      .get<TenantUserRecord[]>("/users")
      .then((r) => r.data),

  /** @deprecated use list() */
  listUsers: () => usersApi.list(),

  listAuditors: () =>
    apiClient.get<AuditorUser[]>("/users/auditors").then((r) => r.data),

  createAuditor: (data: { name: string; email: string; password: string; expires_at?: string | null }) => {
    const parts = data.name.trim().split(" ");
    const first_name = parts[0];
    const last_name = parts.slice(1).join(" ") || "-";
    return apiClient
      .post<AuditorUser>("/users/auditors", {
        first_name, last_name, email: data.email,
        temporary_password: data.password, expires_at: data.expires_at ?? null,
      })
      .then((r) => r.data);
  },

  listAssignments: () =>
    apiClient.get<AuditorAssignmentRecord[]>("/users/auditors/assignments").then((r) => r.data),

  assignAuditor: (auditor_id: string, assessment_id: string) =>
    apiClient.post<AuditorAssignmentRecord>("/users/auditors/assign", { auditor_id, assessment_id }).then((r) => r.data),

  unassignAuditor: (assignment_id: string) =>
    apiClient.delete(`/users/auditors/assignments/${assignment_id}`),

  deleteAuditor: (auditor_id: string) =>
    apiClient.delete(`/users/auditors/${auditor_id}`),

  /** Create a new team member with one or more roles. Returns the one-time temporary password. */
  createUser: (data: { email: string; first_name: string; last_name: string; roles: string[]; expires_at?: string | null }) =>
    apiClient.post<TenantUserRecord & { temporary_password: string }>("/users/create", data).then((r) => r.data),

  /** excluded_roles: replaces the user's group-role carve-outs (the "custom rules" mechanism). */
  update: (user_id: string, data: { is_active?: boolean; roles?: string[]; excluded_roles?: string[] }) =>
    apiClient.patch<TenantUserRecord>(`/users/${user_id}`, data).then((r) => r.data),

  /** @deprecated use update() */
  updateUser: (user_id: string, data: { is_active?: boolean; role?: string }) =>
    usersApi.update(user_id, { is_active: data.is_active, roles: data.role ? [data.role] : undefined }),

  delete: (user_id: string) =>
    apiClient.delete(`/users/${user_id}`),

  /** @deprecated use delete() */
  deleteUser: (user_id: string) => usersApi.delete(user_id),

  resetPassword: (user_id: string) =>
    apiClient.post<{ temporary_password: string }>(`/users/${user_id}/reset-password`, {}).then((r) => r.data),
};

export interface TeamGroupRecord {
  id: string;
  name: string;
  description: string | null;
  member_ids: string[];
  roles: string[];
}

/** Team Groups — bundle users and grant them a shared set of roles (distinct
 * from governanceApi's RACI groups, which have no bearing on access control). */
export const groupsApi = {
  list: () => apiClient.get<TeamGroupRecord[]>("/groups").then((r) => r.data),

  create: (data: { name: string; description?: string | null; member_ids: string[]; roles: string[] }) =>
    apiClient.post<TeamGroupRecord>("/groups", data).then((r) => r.data),

  update: (group_id: string, data: { name?: string; description?: string | null; member_ids?: string[]; roles?: string[] }) =>
    apiClient.patch<TeamGroupRecord>(`/groups/${group_id}`, data).then((r) => r.data),

  delete: (group_id: string) => apiClient.delete(`/groups/${group_id}`),
};

// ─── Traceability Matrix ──────────────────────

export interface TraceabilityRow {
  control_id: string;
  control_identifier: string;
  control_title: string;
  control_category?: string;
  control_status: string;
  ai_confidence?: number;
  gap_id: string | null;
  gap_description: string | null;
  gap_severity: string | null;
  recommendation_status: string | null;
  is_certification_blocker: boolean;
  remediation_priority: number | null;
  action_items: {
    id: string;
    title: string;
    status: string;
    priority: string;
    due_date?: string;
  }[];
}

export interface TraceabilityMatrix {
  assessment_id: string;
  assessment_name: string;
  rows: TraceabilityRow[];
  summary: {
    total_controls: number;
    compliant: number;
    partial: number;
    gaps: number;
    action_items_total: number;
    action_items_open: number;
  };
}

export const traceabilityApi = {
  getMatrix: (assessmentId: string) =>
    apiClient
      .get<TraceabilityMatrix>(`/compliance/assessments/${assessmentId}/traceability`)
      .then((r) => r.data),
};

// ─── Share Links ─────────────────────────────

export interface ShareLink {
  id: string;
  token: string;
  label?: string | null;
  instructions?: string | null;
  expires_at?: string | null;
  is_active: boolean;
  max_uses?: number | null;
  use_count: number;
  upload_url: string;
}

export interface ShareLinkInfo {
  token: string;
  label?: string | null;
  instructions?: string | null;
  control_title?: string | null;
  control_identifier?: string | null;
  expires_at?: string | null;
  max_uses?: number | null;
  use_count: number;
  is_valid: boolean;
}

export const shareLinksApi = {
  create: (caId: string, data: { label?: string; instructions?: string; expires_at?: string | null; max_uses?: number | null }) =>
    apiClient.post<ShareLink>(`/compliance/control-assessments/${caId}/share-links`, data).then(r => r.data),

  list: (caId: string) =>
    apiClient.get<ShareLink[]>(`/compliance/control-assessments/${caId}/share-links`).then(r => r.data),

  revoke: (linkId: string) =>
    apiClient.delete(`/compliance/share-links/${linkId}`),

  getInfo: (token: string) =>
    fetch(`${API_BASE}/public/evidence-upload/${token}`).then(r => r.json() as Promise<ShareLinkInfo>),

  uploadFile: (token: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${API_BASE}/public/evidence-upload/${token}`, { method: "POST", body: form }).then(r => r.json());
  },
};

// ─── Incidents ──────────────────────────────
export const incidentsApi = {
  list: (params?: { status_filter?: string; severity?: string }) =>
    apiClient.get("/incidents", { params }).then((r) => r.data),
  stats: () => apiClient.get("/incidents/stats").then((r) => r.data),
  get: (id: string) => apiClient.get(`/incidents/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/incidents", data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/incidents/${id}`, data).then((r) => r.data),
  delete: (id: string) => apiClient.delete(`/incidents/${id}`),
  scenarioDraft: (id: string) => apiClient.get(`/incidents/${id}/scenario-draft`).then((r) => r.data),
};

// ─── Vulnerabilities ────────────────────────
export const vulnerabilitiesApi = {
  /** Bounded at limit=1000 (5000 max). The register-wide total is NOT in the
   *  body — use `listWithTotal` when the screen states a count. */
  list: (params?: { severity?: string; status_filter?: string; limit?: number; offset?: number }) =>
    apiClient.get("/vulnerabilities", { params }).then((r) => r.data),

  /** Same call, carrying X-Total-Count so a page can say "showing X of Y"
   *  honestly. The header is readable same-origin (prod is proxied through the
   *  gateway); on a cross-origin dev split it is absent until the backend's
   *  CORS exposes it, so `totalKnown` says whether `total` is the real total or
   *  just this page's length — never print a silent 0. */
  listWithTotal: (params?: { severity?: string; status_filter?: string; limit?: number; offset?: number }) =>
    apiClient.get("/vulnerabilities", { params }).then((r) => {
      const items = (Array.isArray(r.data) ? r.data : []) as Record<string, unknown>[];
      const header = (r.headers as unknown as Record<string, unknown> | undefined)?.["x-total-count"];
      const total = Number(header);
      return { items, total: Number.isFinite(total) ? total : items.length, totalKnown: Number.isFinite(total) };
    }),
  stats: () => apiClient.get("/vulnerabilities/stats").then((r) => r.data),
  get: (id: string) => apiClient.get(`/vulnerabilities/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/vulnerabilities", data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/vulnerabilities/${id}`, data).then((r) => r.data),
  validate: (id: string) => apiClient.post(`/vulnerabilities/${id}/validate`).then((r) => r.data),
  scoreImpact: (id: string, data: Record<string, unknown>) => apiClient.post(`/vulnerabilities/${id}/impact`, data).then((r) => r.data),
  impactHistory: (id: string) => apiClient.get(`/vulnerabilities/${id}/impact-history`).then((r) => r.data),
  // The risk scenarios this vulnerability's impact evaluation is attached to.
  scenarios: (id: string) => apiClient.get(`/vulnerabilities/${id}/risk-scenarios`).then((r) => r.data),
  setScenarios: (id: string, scenarioIds: string[]) =>
    apiClient.put(`/vulnerabilities/${id}/risk-scenarios`, { scenario_ids: scenarioIds }).then((r) => r.data),
  delete: (id: string) => apiClient.delete(`/vulnerabilities/${id}`),

  /**
   * « Tendances historiques » — one point per calendar month.
   *
   * Gated require_feature("custom_dashboards") + require_roles_strict(...), the
   * same pair as the module dashboard whose history this is. So it has FIVE
   * outcomes a caller must handle and none of them may eject the user:
   *   200 source=trend_snapshot_daily — the real balance; render total:null as
   *       a GAP, never as 0, and show `as_of`.
   *   200 source=intake_volume — the fallback: what was opened that month, not
   *       what stayed open. Label it as intake (i18n moduledash.trend_intake).
   *   200 source=unavailable — say the history could not be read; draw nothing.
   *   402 — Elite up-sell; client.ts already dispatches the `elite-upsell` event.
   *   403 — restricted profile (strict roles: a tenant_admin does NOT auto-pass).
   *       Expected, not an error: show the restriction, do not surface a crash.
   */
  trend: (months = 6) =>
    apiClient.get<TrendEnvelope>("/vulnerabilities/trend", { params: { months } }).then((r) => r.data),
};

// ─── Threats ────────────────────────────────
export const threatsApi = {
  list: (params?: { category?: string; threat_type?: string; probability_level?: string; severity_level?: string; review_overdue?: boolean }) =>
    apiClient.get("/threats", { params }).then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/threats", data).then((r) => r.data),
  delete: (id: string) => apiClient.delete(`/threats/${id}`),
  importMitre: () =>
    apiClient.post("/threats/import-mitre").then((r) => r.data as { imported: number; skipped: number; message: string }),
  fetchNews: () =>
    apiClient.post("/threats/fetch-news").then((r) => r.data as { created: number; skipped: number; message: string; names: string[] }),
  listPending: () =>
    apiClient.get("/threats/pending").then((r) => r.data),
  approve: (id: string) => apiClient.post(`/threats/${id}/approve`).then((r) => r.data),
  reject: (id: string) => apiClient.delete(`/threats/${id}/reject`),
  updateProfile: (id: string, data: Record<string, unknown>) => apiClient.put(`/threats/${id}/profile`, data).then((r) => r.data),
  // Copy a built-in catalogue entry into this tenant's register so it can be profiled.
  adopt: (id: string) => apiClient.post(`/threats/${id}/adopt`).then((r) => r.data),
  // Sign a profile off (CISO / risk manager) and start the review clock.
  validateProfile: (id: string) => apiClient.post(`/threats/${id}/profile/validate`).then((r) => r.data),
  // Record a periodic review that found nothing to change.
  reviewProfile: (id: string, note?: string) =>
    apiClient.post(`/threats/${id}/profile/review`, { note: note || null }).then((r) => r.data),
  history: (id: string) => apiClient.get(`/threats/${id}/history`).then((r) => r.data),
  // Threat watch — what the feeds bring in, before it is anything else.
  watch: (params?: { kind?: string; status_filter?: string }) =>
    apiClient.get("/threats/watch", { params }).then((r) => r.data),
  dismissWatch: (id: string) => apiClient.post(`/threats/watch/${id}/dismiss`).then((r) => r.data),
  promoteWatch: (id: string, data: Record<string, unknown>) =>
    apiClient.post(`/threats/watch/${id}/promote`, data).then((r) => r.data),

  /**
   * « Tendances historiques » — one point per calendar month.
   *
   * Gated require_feature("custom_dashboards") + require_roles_strict(...), the
   * same pair as the module dashboard whose history this is. So it has FIVE
   * outcomes a caller must handle and none of them may eject the user:
   *   200 source=trend_snapshot_daily — the real balance; render total:null as
   *       a GAP, never as 0, and show `as_of`.
   *   200 source=intake_volume — the fallback: what was opened that month, not
   *       what stayed open. Label it as intake (i18n moduledash.trend_intake).
   *   200 source=unavailable — say the history could not be read; draw nothing.
   *   402 — Elite up-sell; client.ts already dispatches the `elite-upsell` event.
   *   403 — restricted profile (strict roles: a tenant_admin does NOT auto-pass).
   *       Expected, not an error: show the restriction, do not surface a crash.
   */
  trend: (months = 6) =>
    apiClient.get<TrendEnvelope>("/threats/trend", { params: { months } }).then((r) => r.data),
};

// ─── Risk Scenarios ─────────────────────────
export const riskScenariosApi = {
  list: (params?: { treatment?: string; sort?: "priority" }) =>
    apiClient.get("/risk-scenarios", { params }).then((r) => r.data),
  get: (id: string) => apiClient.get(`/risk-scenarios/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/risk-scenarios", data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/risk-scenarios/${id}`, data).then((r) => r.data),
  delete: (id: string) => apiClient.delete(`/risk-scenarios/${id}`),
};

export const scenarioPriorityApi = {
  // How this organisation ranks its scenarios; changing it re-scores them all.
  get: () => apiClient.get("/risk-scenarios/priority-criteria").then((r) => r.data),
  update: (data: Record<string, unknown>) =>
    apiClient.patch("/risk-scenarios/priority-criteria", data).then((r) => r.data),
};

export const scenarioVersionsApi = {
  list: (scenarioId: string) => apiClient.get(`/scenario-versions/${scenarioId}`).then((r) => r.data),
  snapshot: (scenarioId: string, change_reason?: string) =>
    apiClient.post(`/scenario-versions/${scenarioId}/snapshot`, { change_reason }).then((r) => r.data),
  diff: (scenarioId: string, from_version: number, to_version: number) =>
    apiClient.get(`/scenario-versions/${scenarioId}/diff`, { params: { from_version, to_version } }).then((r) => r.data),
};

// ─── Applied Controls ───────────────────────
/** Filters GET /applied-controls accepts (list_controls in applied_controls.py). */
export interface AppliedControlListParams {
  status?: string;
  validation_status?: string;
  expiring_within_days?: number;
  include_evaluation?: boolean;
  limit?: number;
  offset?: number;
}

export const appliedControlsApi = {
  // The register, for reporting or an audit — carries each control's latest
  // effectiveness evaluation on the same row.
  exportUrl: (format: "csv" | "xml" = "csv") => `/data/export/applied-controls?format=${format}`,
  history: (id: string) => apiClient.get(`/applied-controls/${id}/history`).then((r) => r.data),

  /** `status` / `validation_status` are independent (a control can be
   *  implemented and never signed off); `expiring_within_days` is the
   *  obsolescence filter and includes already-expired controls;
   *  `include_evaluation` attaches each control's latest effectiveness
   *  evaluation. The register-wide total is in X-Total-Count only — use
   *  `listWithTotal` when the screen states a count. */
  list: (params?: AppliedControlListParams) =>
    apiClient.get("/applied-controls", { params }).then((r) => r.data),

  /** Same call, keeping the total the response body cannot carry.
   *  X-Total-Count is readable same-origin (prod goes through the gateway); on
   *  a cross-origin dev split it is absent until CORS exposes it, hence the
   *  fall back to the page length rather than a wrong "0". */
  listWithTotal: (params?: AppliedControlListParams) =>
    apiClient.get("/applied-controls", { params }).then((r) => {
      const items = (Array.isArray(r.data) ? r.data : []) as Record<string, unknown>[];
      const header = (r.headers as unknown as Record<string, unknown> | undefined)?.["x-total-count"];
      const total = Number(header);
      return { items, total: Number.isFinite(total) ? total : items.length, totalKnown: Number.isFinite(total) };
    }),

  get: (id: string) => apiClient.get(`/applied-controls/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/applied-controls", data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/applied-controls/${id}`, data).then((r) => r.data),

  /** DELETE /applied-controls/{id} requires ?reason= (3 chars minimum) — the
   *  no-argument version this used to be could only ever answer 422. Removing a
   *  control removes a claimed mitigation from every risk that counted on it,
   *  which is why the backend refuses to do it unexplained. */
  delete: (id: string, reason: string) =>
    apiClient.delete(`/applied-controls/${id}`, { params: { reason } }),

  /** « Alertes sur les contrôles obsolètes » — expired / expiring / deprecated /
   *  unverified, with the reason on every row. */
  obsolescence: (params?: { window_days?: number; limit?: number }) =>
    apiClient.get("/applied-controls/obsolescence", { params }).then((r) => r.data),

  /** « Historique des modifications » for the WHOLE register (GET /history),
   *  including controls since deleted — not the per-control `history(id)`. */
  registerHistory: (params?: { action?: string; control_id?: string; limit?: number; offset?: number }) =>
    apiClient.get("/applied-controls/history", { params }).then((r) => r.data),

  /** Security-referent sign-off (CISO / risk manager). */
  validate: (id: string, notes?: string) =>
    apiClient.post(`/applied-controls/${id}/validate`, { notes: notes ?? null }).then((r) => r.data),

  /** Send the control back for rework. */
  reject: (id: string, notes?: string) =>
    apiClient.post(`/applied-controls/${id}/reject`, { notes: notes ?? null }).then((r) => r.data),
};

// ─── Security Exceptions & Risk Acceptance ──
export const securityApi = {
  listExceptions: (params?: { status_filter?: string }) =>
    apiClient.get("/security/exceptions", { params }).then((r) => r.data),
  createException: (data: Record<string, unknown>) => apiClient.post("/security/exceptions", data).then((r) => r.data),
  approveException: (id: string) => apiClient.patch(`/security/exceptions/${id}/approve`).then((r) => r.data),
  // params, not string interpolation: a justification containing & or # used to
  // truncate the reason or invent extra query parameters.
  rejectException: (id: string, reason?: string) =>
    apiClient.patch(`/security/exceptions/${id}/reject`, null, { params: { reason: reason || "" } }).then((r) => r.data),
  listAcceptances: () => apiClient.get("/security/acceptances").then((r) => r.data),
  createAcceptance: (data: Record<string, unknown>) => apiClient.post("/security/acceptances", data).then((r) => r.data),
  approveAcceptance: (id: string) => apiClient.patch(`/security/acceptances/${id}/approve`).then((r) => r.data),
  // Both need a written reason (422 otherwise). Reject: pending only, four-eyes.
  // Revoke: approved only — the covered risks go back to their prior status.
  rejectAcceptance: (id: string, reason: string) =>
    apiClient.patch(`/security/acceptances/${id}/reject`, { reason }).then((r) => r.data),
  revokeAcceptance: (id: string, reason: string) =>
    apiClient.patch(`/security/acceptances/${id}/revoke`, { reason }).then((r) => r.data),
};

// ─── Risk Matrices ──────────────────────────
// Changing the matrix re-scores every risk graded on it, so each write carries a
// governance `reason` — required by the route (min 5 chars), not optional.
export const riskMatricesApi = {
  list: () => apiClient.get("/risk-matrices").then((r) => r.data),
  create: (data: Record<string, unknown>, reason: string) =>
    apiClient.post("/risk-matrices", data, { params: { reason } }).then((r) => r.data),
  setDefault: (id: string, reason: string) =>
    apiClient.put(`/risk-matrices/${id}/default`, null, { params: { reason } }).then((r) => r.data),
  delete: (id: string, reason: string) =>
    apiClient.delete(`/risk-matrices/${id}`, { params: { reason } }),
};

// ─── Trust Center ───────────────────────────
export const trustCenterApi = {
  getConfig: () => apiClient.get("/trust-center/config").then((r) => r.data),
  updateConfig: (data: Record<string, unknown>) => apiClient.put("/trust-center/config", data).then((r) => r.data),
  getPublic: (slug: string) => apiClient.get(`/trust-center/public/${slug}`).then((r) => r.data),
};

// ─── Regulatory Updates ─────────────────────
export const regulatoryApi = {
  list: (params?: { status_filter?: string }) =>
    apiClient.get("/regulatory", { params }).then((r) => r.data),
  get: (id: string) => apiClient.get(`/regulatory/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/regulatory", data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/regulatory/${id}`, data).then((r) => r.data),
  delete: (id: string) => apiClient.delete(`/regulatory/${id}`),
  fetchNews: () =>
    apiClient.post("/regulatory/fetch-news").then((r) => r.data as { created: number; skipped: number; message: string; titles: string[] }),
  approve: (id: string) => apiClient.post(`/regulatory/${id}/approve`).then((r) => r.data),
  reject: (id: string) => apiClient.delete(`/regulatory/${id}/reject`),
  controlDraft: (id: string) => apiClient.get(`/regulatory/${id}/control-draft`).then((r) => r.data),

  /** Who changed a regulatory obligation, when and why. */
  versions: (id: string) =>
    apiClient.get<RegulatoryUpdateVersion[]>(`/regulatory/${id}/versions`).then((r) => r.data),

  // ── Veille réglementaire: the sources the watch actually reads ────────────
  // Built-in feeds are shared and read-only (`is_builtin`); a tenant's own are
  // editable. `last_error` is what to surface when a feed silently stops.
  listFeeds: () => apiClient.get<RegulatoryFeed[]>("/regulatory/feeds").then((r) => r.data),

  createFeed: (data: RegulatoryFeedCreate) =>
    apiClient.post<RegulatoryFeed>("/regulatory/feeds", data).then((r) => r.data),

  updateFeed: (feedId: string, data: Partial<RegulatoryFeedCreate>) =>
    apiClient.patch<RegulatoryFeed>(`/regulatory/feeds/${feedId}`, data).then((r) => r.data),

  deleteFeed: (feedId: string) => apiClient.delete(`/regulatory/feeds/${feedId}`),

  /** Fetch the feed once and report what came back, without importing anything. */
  testFeed: (feedId: string) =>
    apiClient.post<RegulatoryFeedTestResult>(`/regulatory/feeds/${feedId}/test`).then((r) => r.data),
};

// ─── Activity Log ───────────────────────────
// The trail is hash-chained: `seq` and `entry_hash` come straight off the stored
// row, while `actor_email` / `actor_name` are resolved at read time and are NOT
// part of the hash. `category` (access | validation | change | other) is derived,
// so an examiner can separate "qui a consulté" from "qui a validé".
export const activityLogApi = {
  list: (params?: {
    entity_type?: string;
    action?: string;
    user_id?: string;
    /** "Qui a consulté CE rapport ?" needs the object, not just its type. */
    entity_id?: string;
    category?: string;
    /** manual | batch | api — how the action reached the platform. */
    origin?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
  }) => apiClient.get<ActivityLogListResponse>("/activity-log", { params }).then((r) => r.data),

  /** The verbs, entity types and origins this tenant's trail actually contains,
   *  so the filter dropdowns match the data instead of a hard-coded guess.
   *  `i18n_prefix` names the namespace to render each verb through. */
  actions: () =>
    apiClient.get<ActivityActionCatalogue>("/activity-log/actions").then((r) => r.data),

  /** Everyone who touched one object, with per-verb counts and the recent tail. */
  entityAccessReport: (entityType: string, entityId: string, params?: { category?: string; recent_limit?: number }) =>
    apiClient
      .get<EntityAccessReport>(`/activity-log/access/${entityType}/${entityId}`, { params })
      .then((r) => r.data),

  /** Sign-in history — who, when, from where, and whether it worked. */
  loginEvents: (params?: { success?: boolean; limit?: number; offset?: number }) =>
    apiClient.get<LoginEvent[]>("/activity-log/login-events", { params }).then((r) => r.data),

  /** Recompute the hash chain and report where (if anywhere) it breaks. */
  verifyChain: () => apiClient.get("/activity-log/verify").then((r) => r.data),

  getRetention: () =>
    apiClient.get<ActivityRetentionPolicy>("/activity-log/retention").then((r) => r.data),

  setRetention: (data: { enabled?: boolean; retention_days?: number }) =>
    apiClient.patch<ActivityRetentionPolicy>("/activity-log/retention", data).then((r) => r.data),

  /** Seal-then-purge: the sealed digest is the only record of what was destroyed.
   *  `reason` must be at least 20 characters and `confirm` must be true. */
  seal: (data: { reason: string; retention_days?: number | null; confirm: boolean }) =>
    apiClient.post("/activity-log/retention/seal", data).then((r) => r.data),

  listSeals: () => apiClient.get<ActivityLogSeal[]>("/activity-log/seals").then((r) => r.data),
};

// ─── Webhooks ───────────────────────────────
export const webhooksApi = {
  listEvents: () => apiClient.get("/webhooks/events").then((r) => r.data),
  list: () => apiClient.get("/webhooks").then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/webhooks", data).then((r) => r.data),
  delete: (id: string) => apiClient.delete(`/webhooks/${id}`),
  test: (id: string) => apiClient.post(`/webhooks/${id}/test`).then((r) => r.data),
};

// ─── Data Import/Export (CSV + XML — see backend/app/api/v1/endpoints/data_io.py) ───
/** What /data/export/* accepts (_EXPORT_FORMATS in data_io.py). Imports only
 *  ever read csv or xml — see DataIoImportFormat below. */
export type DataIoFormat = "csv" | "xml" | "xlsx" | "pdf";

/** What /data/import/* can parse. xlsx/pdf are export-only — the route answers
 *  400 for them — so a screen must not offer them as import choices. */
export type DataIoImportFormat = "csv" | "xml";

const DATA_IO_MIME: Record<DataIoFormat, string> = {
  csv: "text/csv",
  xml: "application/xml",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export const dataApi = {
  exportCsv: async (module: string) => dataApi.exportData(module, "csv"),
  exportXml: async (module: string) => dataApi.exportData(module, "xml"),
  /** `extraParams` carries the per-dataset filters a few exports accept:
   *  `audit_id` on audit-findings, `framework_id` on framework-controls.
   *  `lang` translates the header row (xlsx/csv) and the document heading
   *  (pdf); omitted, the backend falls back to the Accept-Language this client
   *  sends on every request, so the export is already in the UI language —
   *  pass it only to override that. */
  exportData: async (module: string, format: DataIoFormat = "csv", extraParams?: Record<string, string | undefined>, lang?: string) => {
    const resp = await apiClient.get(`/data/export/${module}`, {
      params: { format, ...(lang ? { lang } : {}), ...(extraParams ?? {}) },
      responseType: "blob",
    });
    const mime = DATA_IO_MIME[format] ?? "application/octet-stream";
    const blob = new Blob([resp.data], { type: mime });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${module}_export_${new Date().toISOString().split("T")[0]}.${format}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },
  importCsv: async (module: string, file: File) => dataApi.importData(module, file, "csv"),
  importXml: async (module: string, file: File) => dataApi.importData(module, file, "xml"),
  // Typed on the wide DataIoFormat rather than DataIoImportFormat because
  // callers hold ONE format state for both buttons (DataActions does); the
  // narrow type is exported for a screen that separates them. Passing xlsx or
  // pdf here is a 400 from the route, not a silent no-op.
  importData: async (module: string, file: File, format: DataIoFormat = "csv") => {
    const fd = new FormData();
    fd.append("file", file);
    return apiClient
      .post(`/data/import/${module}`, fd, { params: { format }, headers: { "Content-Type": "multipart/form-data" } })
      .then((r) => r.data);
  },

  // ── Named exports for the datasets that take a filter ─────────────────────
  /** Every constat, or only one engagement's. */
  exportAuditFindings: (format: DataIoFormat = "csv", auditId?: string, lang?: string) =>
    dataApi.exportData("audit-findings", format, auditId ? { audit_id: auditId } : undefined, lang),

  /** The framework catalogue itself (one row per framework). */
  exportFrameworks: (format: DataIoFormat = "csv", lang?: string) =>
    dataApi.exportData("frameworks", format, undefined, lang),

  /** The controls of one framework — or of all of them when `frameworkId` is
   *  omitted, which on a 94-framework tenant is a very large file. */
  exportFrameworkControls: (format: DataIoFormat = "csv", frameworkId?: string, lang?: string) =>
    dataApi.exportData("framework-controls", format, frameworkId ? { framework_id: frameworkId } : undefined, lang),
};

// ─── Contract Collaboration ─────────────────

export interface CollabData {
  id: string;
  vendor_id: string;
  vendor_name: string;
  contract_id: string;
  status: string;
  contract_text: string | null;
  ai_suggestions: string | null;
  action_plan: string | null;
  share_token: string;
  share_expires_at: string | null;
  vendor_email: string | null;
  agreed_at: string | null;
  agreed_by_internal: boolean;
  agreed_by_vendor: boolean;
  plan_finalized_at: string | null;
  agreement_document: string | null;
  ciso_signed_at: string | null;
  ciso_signature: string | null;
  vendor_signed_at: string | null;
  vendor_signature: string | null;
  signed_contract_id: string | null;
  created_at: string;
  ai_review?: string | null;
}

export interface CollabMessage {
  id: string;
  collaboration_id: string;
  sender_type: "internal" | "vendor";
  sender_name: string;
  message: string;
  created_at: string;
}

export const contractCollabApi = {
  // ── Internal (authenticated) ────────────────────────────────────────────
  create: (contractId: string, vendorEmail?: string) =>
    apiClient.post<CollabData>("/contract-collab", { contract_id: contractId, vendor_email: vendorEmail, share_days: 30 }).then(r => r.data),

  get: (collabId: string) =>
    apiClient.get<CollabData>(`/contract-collab/${collabId}`).then(r => r.data),

  updateContent: (collabId: string, data: { contract_text?: string; ai_suggestions?: string; action_plan?: string }) =>
    apiClient.put<CollabData>(`/contract-collab/${collabId}/content`, data).then(r => r.data),

  sendMessage: (collabId: string, data: { message: string; sender_name?: string }) =>
    apiClient.post<CollabMessage>(`/contract-collab/${collabId}/messages`, data).then(r => r.data),

  getMessages: (collabId: string) =>
    apiClient.get<CollabMessage[]>(`/contract-collab/${collabId}/messages`).then(r => r.data),

  agree: (collabId: string) =>
    apiClient.post<CollabData>(`/contract-collab/${collabId}/agree`).then(r => r.data),

  finalizePlan: (collabId: string, deadlines: { id: string; deadline: string }[]) =>
    apiClient.post<CollabData>(`/contract-collab/${collabId}/finalize-plan`, { deadlines }).then(r => r.data),

  // ── Vendor (token-based, public) ────────────────────────────────────────
  vendorGet: (shareToken: string) =>
    apiClient.get<CollabData>(`/contract-collab/vendor/${shareToken}`).then(r => r.data),

  vendorUpdateContent: (shareToken: string, data: { contract_text?: string }) =>
    apiClient.put<CollabData>(`/contract-collab/vendor/${shareToken}/content`, data).then(r => r.data),

  vendorSendMessage: (shareToken: string, data: { message: string; sender_name?: string }) =>
    apiClient.post<CollabMessage>(`/contract-collab/vendor/${shareToken}/messages`, data).then(r => r.data),

  vendorGetMessages: (shareToken: string) =>
    apiClient.get<CollabMessage[]>(`/contract-collab/vendor/${shareToken}/messages`).then(r => r.data),

  vendorAgree: (shareToken: string) =>
    apiClient.post<CollabData>(`/contract-collab/vendor/${shareToken}/agree`).then(r => r.data),

  vendorUpdateActionItem: (shareToken: string, itemId: string, done: boolean) =>
    apiClient.post<CollabData>(`/contract-collab/vendor/${shareToken}/action-item`, { item_id: itemId, done }).then(r => r.data),

  sign: (collabId: string, signature: string) =>
    apiClient.post<CollabData>(`/contract-collab/${collabId}/sign`, { signature }).then(r => r.data),

  vendorSign: (shareToken: string, signature: string) =>
    apiClient.post<CollabData>(`/contract-collab/vendor/${shareToken}/sign`, { signature }).then(r => r.data),
};

// ─── Risk Quantification ────────────────────
export const riskQuantApi = {
  quantify: (data: { risk_id: string; annual_loss_min: number; annual_loss_max: number; annual_loss_most_likely: number; probability_percent: number; control_effectiveness: number }) =>
    apiClient.post("/risks/quantify", data).then((r) => r.data),
};

// ─── Support Tickets ─────────────────────────

export type TicketStatus = "open" | "in_progress" | "waiting_user" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type ChatStatus = "pending" | "active" | "ended";

export interface TicketSender {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  content: string;
  is_support: boolean;
  sender: TicketSender;
  created_at: string;
}

export interface ChatSessionData {
  id: string;
  ticket_id: string;
  status: ChatStatus;
  requested_at: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface SupportTicketDetail {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  created_at: string;
  updated_at: string;
  user: TicketSender;
  messages: TicketMessage[];
  chat_session: ChatSessionData | null;
}

export interface SupportTicketListItem {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  created_at: string;
  updated_at: string;
  user: TicketSender;
  message_count: number;
  has_chat: boolean;
}

export const supportApi = {
  list: (params?: { status?: string; priority?: string }) =>
    apiClient.get<SupportTicketListItem[]>("/support/tickets", { params }).then((r) => r.data),

  get: (id: string) =>
    apiClient.get<SupportTicketDetail>(`/support/tickets/${id}`).then((r) => r.data),

  create: (data: { title: string; description: string; priority: TicketPriority }) =>
    apiClient.post<SupportTicketDetail>("/support/tickets", data).then((r) => r.data),

  update: (id: string, data: { status?: TicketStatus; priority?: TicketPriority }) =>
    apiClient.patch<SupportTicketDetail>(`/support/tickets/${id}`, data).then((r) => r.data),

  delete: (id: string) =>
    apiClient.delete(`/support/tickets/${id}`),

  getMessages: (ticketId: string) =>
    apiClient.get<TicketMessage[]>(`/support/tickets/${ticketId}/messages`).then((r) => r.data),

  postMessage: (ticketId: string, content: string) =>
    apiClient.post<TicketMessage>(`/support/tickets/${ticketId}/messages`, { content }).then((r) => r.data),

  getChatStatus: (ticketId: string) =>
    apiClient.get<ChatSessionData | null>(`/support/tickets/${ticketId}/chat`).then((r) => r.data),

  requestChat: (ticketId: string) =>
    apiClient.post<ChatSessionData>(`/support/tickets/${ticketId}/chat`).then((r) => r.data),

  updateChat: (ticketId: string, action: "accept" | "end") =>
    apiClient.patch<ChatSessionData>(`/support/tickets/${ticketId}/chat`, null, { params: { action } }).then((r) => r.data),
};

// ── Assets (Elite Pack) ──────────────────────────────────────────────────────
// GET /assets returns { items, total, page, page_size }. CIA + lifecycle endpoints
// are Elite-gated and 402 → elite-upsell for non-elite tenants.
export const assetsApi = {
  /** `asset_type`, `criticality`, `asset_class` and `status` are all applied in
   *  SQL by list_assets — filtering client-side over one loaded page only ever
   *  searches the 200 most recent assets. `status` is the operational state
   *  (operational | degraded | out_of_service | quarantined | lost), which is a
   *  different question from the lifecycle stage. */
  list: (params?: {
    page?: number;
    page_size?: number;
    asset_type?: string;
    criticality?: string;
    asset_class?: string;
    status?: string;
  }) => apiClient.get("/assets", { params }).then((r) => r.data),
  stats: () => apiClient.get("/assets/stats").then((r) => r.data),
  // Lightweight {id, name, asset_type} for pickers and graphs. The list
  // endpoint caps page_size at 200, so callers that need the whole inventory
  // (5k-10k assets at enterprise scale) must not page through /assets.
  options: () => apiClient.get("/assets/options").then((r) => r.data),
  get: (id: string) => apiClient.get(`/assets/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/assets", data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/assets/${id}`, data).then((r) => r.data),
  remove: (id: string) => apiClient.delete(`/assets/${id}`),
  cia: (id: string) => apiClient.get(`/assets/${id}/cia`).then((r) => r.data),
  setCia: (id: string, data: Record<string, unknown>) => apiClient.put(`/assets/${id}/cia`, data).then((r) => r.data),
  eolSoon: () => apiClient.get("/assets/lifecycle/eol-soon").then((r) => r.data),
};

// ─── Asset Cartography (Elite Pack) ──────────────────────────
export const assetGraphApi = {
  cartography: (params?: { entity?: string; asset_type?: string }) =>
    apiClient.get("/asset-graph/cartography", { params }).then((r) => r.data),
  listEntities: () => apiClient.get("/asset-graph/org-entities").then((r) => r.data),
  createEntity: (data: Record<string, unknown>) => apiClient.post("/asset-graph/org-entities", data).then((r) => r.data),
  updateEntity: (id: string, data: Record<string, unknown>) => apiClient.patch(`/asset-graph/org-entities/${id}`, data).then((r) => r.data),
  deleteEntity: (id: string) => apiClient.delete(`/asset-graph/org-entities/${id}`),
  listProcesses: (entityId?: string) => apiClient.get("/asset-graph/business-processes", { params: entityId ? { entity_id: entityId } : {} }).then((r) => r.data),
  createProcess: (data: Record<string, unknown>) => apiClient.post("/asset-graph/business-processes", data).then((r) => r.data),
  updateProcess: (id: string, data: Record<string, unknown>) => apiClient.patch(`/asset-graph/business-processes/${id}`, data).then((r) => r.data),
  deleteProcess: (id: string) => apiClient.delete(`/asset-graph/business-processes/${id}`),
};

// ── Module dashboards (Elite Pack) ───────────────────────────────────────────
export const eliteDashboardsApi = {
  assets: () => apiClient.get("/dashboards/assets").then((r) => r.data),
  vulnerabilities: () => apiClient.get("/dashboards/vulnerabilities").then((r) => r.data),
  threats: () => apiClient.get("/dashboards/threats").then((r) => r.data),
  risks: () => apiClient.get("/dashboards/risks").then((r) => r.data),
  controls: () => apiClient.get("/dashboards/controls").then((r) => r.data),
  governance: () => apiClient.get("/dashboards/governance").then((r) => r.data),
  audit: () => apiClient.get("/dashboards/audit").then((r) => r.data),
};

// ── Report builder (Elite Pack) ──────────────────────────────────────────────
export const reportBuilderApi = {
  /** Every dataset the builder can report on — `audit_findings` among them —
   *  each with the columns it exposes. */
  datasets: () => apiClient.get<ReportBuilderDataset[]>("/report-builder/datasets").then((r) => r.data),

  exportFile: (
    dataset: string,
    format: "xlsx" | "csv" | "pdf",
    options?: { columns?: string[]; filters?: Record<string, unknown> },
  ) =>
    apiClient
      .post(
        "/report-builder/export",
        { dataset, format, columns: options?.columns, filters: options?.filters ?? {} },
        { responseType: "blob" },
      )
      .then((r) => r.data as Blob),

  // ── Saved templates ───────────────────────────────────────────────────────
  listTemplates: () =>
    apiClient.get<ReportBuilderTemplate[]>("/report-builder/templates").then((r) => r.data),

  createTemplate: (data: { name: string; dataset: string; columns?: string[]; filters?: Record<string, unknown> }) =>
    apiClient.post<ReportBuilderTemplate>("/report-builder/templates", data).then((r) => r.data),

  deleteTemplate: (templateId: string) =>
    apiClient.delete(`/report-builder/templates/${templateId}`),

  runTemplate: (templateId: string, format: "xlsx" | "csv" | "pdf" = "xlsx") =>
    apiClient
      .post(`/report-builder/templates/${templateId}/run`, null, { params: { format }, responseType: "blob" })
      .then((r) => r.data as Blob),
};

// ── Risk treatment plans (Elite Pack) ────────────────────────────────────────
export const riskTreatmentApi = {
  list: (riskId?: string) => apiClient.get("/risk-treatment", { params: riskId ? { risk_id: riskId } : undefined }).then((r) => r.data),
  tracking: () => apiClient.get("/risk-treatment/tracking").then((r) => r.data),
  trackingByResponsible: () => apiClient.get("/risk-treatment/tracking/by-responsible").then((r) => r.data),
  upsert: (data: Record<string, unknown>) => apiClient.post("/risk-treatment", data).then((r) => r.data),
  risks: () => apiClient.get("/risks", { params: { page_size: 200 } }).then((r) => r.data),
  // M8.2 gap fix: supersede workflow + plan-level version history.
  supersede: (riskId: string, data: Record<string, unknown>) =>
    apiClient.post(`/risk-treatment/${riskId}/supersede`, data).then((r) => r.data),
  versions: (riskId: string) => apiClient.get(`/risk-treatment/${riskId}/versions`).then((r) => r.data),
};

// ── Control effectiveness evaluations (Elite Pack) ───────────────────────────
export const controlEvalApi = {
  list: () => apiClient.get("/control-evaluations").then((r) => r.data),
  due: () => apiClient.get("/control-evaluations/due").then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/control-evaluations", data).then((r) => r.data),
  controls: () => apiClient.get("/applied-controls").then((r) => r.data),
  // Controls declared ineffective whose follow-up is still open.
  actionRequired: () => apiClient.get("/control-evaluations/action-required").then((r) => r.data),
  setRemediation: (id: string, data: Record<string, unknown>) =>
    apiClient.patch(`/control-evaluations/${id}/remediation`, data).then((r) => r.data),
};

// ── Vulnerability scanner import (Elite Pack) ────────────────────────────────
export const vulnImportApi = {
  upload: (file: File, tool: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("tool", tool);
    return apiClient.post("/vuln-import/upload", fd, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
  },
  journal: () => apiClient.get("/vuln-import/journal").then((r) => r.data),
};

// ── Scanner connectors (live API sync — Elite Pack) ──────────────────────────
export const scannerConnectorsApi = {
  list: () => apiClient.get("/vuln-import/connectors").then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/vuln-import/connectors", data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/vuln-import/connectors/${id}`, data).then((r) => r.data),
  remove: (id: string) => apiClient.delete(`/vuln-import/connectors/${id}`),
  test: (id: string) => apiClient.post(`/vuln-import/connectors/${id}/test`).then((r) => r.data),
  sync: (id: string) => apiClient.post(`/vuln-import/connectors/${id}/sync`).then((r) => r.data),
};

// ── Governance: RACI + document repository (Elite Pack) ──────────────────────
export const governanceApi = {
  raciList: () => apiClient.get("/governance/raci").then((r) => r.data),
  raciCreate: (data: Record<string, unknown>) => apiClient.post("/governance/raci", data).then((r) => r.data),
  raciDelete: (id: string) => apiClient.delete(`/governance/raci/${id}`),
  raciPreviewRole: (role: string) => apiClient.get("/governance/raci/roles/preview", { params: { role } }).then((r) => r.data),
  groupsList: () => apiClient.get("/governance/groups").then((r) => r.data),
  groupCreate: (data: Record<string, unknown>) => apiClient.post("/governance/groups", data).then((r) => r.data),
  groupDelete: (id: string) => apiClient.delete(`/governance/groups/${id}`),
  docsList: () => apiClient.get("/governance/documents").then((r) => r.data),
  docsCreate: (data: Record<string, unknown>) => apiClient.post("/governance/documents", data).then((r) => r.data),
  /** Spelled PUT by the route, but the body is a partial: an omitted field is
   *  left untouched, and changing `content` archives the previous version
   *  first (pass `change_summary` with it). Fields: title, content,
   *  typology, module, entity, access_level, change_summary. */
  docsUpdate: (id: string, data: Record<string, unknown>) =>
    apiClient.put(`/governance/documents/${id}`, data).then((r) => r.data),
  docsGet: (id: string) => apiClient.get(`/governance/documents/${id}`).then((r) => r.data),
  docsVersions: (id: string) => apiClient.get(`/governance/documents/${id}/versions`).then((r) => r.data),
  docsDelete: (id: string) => apiClient.delete(`/governance/documents/${id}`),

  // Per-document ACL (M11.3)
  accessList: (docId: string) => apiClient.get(`/governance/documents/${docId}/access`).then((r) => r.data),
  accessGrant: (docId: string, data: { user_id?: string | null; role?: string | null; permission: string }) =>
    apiClient.post(`/governance/documents/${docId}/access`, data).then((r) => r.data),
  accessRevoke: (docId: string, accessId: string) => apiClient.delete(`/governance/documents/${docId}/access/${accessId}`),

  // Steering committees (M14.6)
  committeesList: () => apiClient.get("/governance/committees").then((r) => r.data),
  committeeCreate: (data: Record<string, unknown>) => apiClient.post("/governance/committees", data).then((r) => r.data),
  committeeUpdate: (id: string, data: Record<string, unknown>) => apiClient.patch(`/governance/committees/${id}`, data).then((r) => r.data),
  committeeDelete: (id: string) => apiClient.delete(`/governance/committees/${id}`),

  /**
   * « Tendances historiques » — one point per calendar month.
   *
   * Gated require_feature("custom_dashboards") + require_roles_strict(...), the
   * same pair as the module dashboard whose history this is. So it has FIVE
   * outcomes a caller must handle and none of them may eject the user:
   *   200 source=trend_snapshot_daily — the real balance; render total:null as
   *       a GAP, never as 0, and show `as_of`.
   *   200 source=intake_volume — the fallback: what was opened that month, not
   *       what stayed open. Label it as intake (i18n moduledash.trend_intake).
   *   200 source=unavailable — say the history could not be read; draw nothing.
   *   402 — Elite up-sell; client.ts already dispatches the `elite-upsell` event.
   *   403 — restricted profile (strict roles: a tenant_admin does NOT auto-pass).
   *       Expected, not an error: show the restriction, do not surface a crash.
   */
  trend: (months = 6) =>
    apiClient.get<TrendEnvelope>("/governance/trend", { params: { months } }).then((r) => r.data),
};

// ── Archiving + retention (Elite Pack) ───────────────────────────────────────
export const archivingApi = {
  list: () => apiClient.get("/archiving").then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/archiving", data).then((r) => r.data),
  /** Destroys every record past its retention date. `reason` is REQUIRED by the
   *  route (5 chars minimum) and is sealed into the audit trail with the
   *  manifest of what was purged; the zero-argument version this used to be
   *  could only ever answer 422. Always offer `dryRun` first. */
  purgeExpired: (reason: string, dryRun = false) =>
    apiClient
      .post("/archiving/purge-expired", null, { params: { reason, dry_run: dryRun } })
      .then((r) => r.data),
  exportFile: (format: "xlsx" | "csv" | "pdf") => apiClient.get("/archiving/export/download", { params: { format }, responseType: "blob" }).then((r) => r.data),
  listRules: () => apiClient.get("/archiving/rules").then((r) => r.data),
  createRule: (data: { entity_type: string; criteria: string; enabled?: boolean; retention_days?: number | null }) =>
    apiClient.post("/archiving/rules", data).then((r) => r.data),
  deleteRule: (id: string) => apiClient.delete(`/archiving/rules/${id}`),

  listFiltered: (params?: { entity_type?: string; limit?: number }) =>
    apiClient.get<ArchiveRecord[]>("/archiving", { params }).then((r) => r.data),

  get: (archiveId: string) =>
    apiClient.get<ArchiveRecord>(`/archiving/${archiveId}`).then((r) => r.data),

  /** The archived snapshot with its children and evidence manifest.
   *  `verify` re-reads every archived file and checks it against the sha256
   *  taken at upload — it streams the bytes, so keep it off for a listing. */
  content: (archiveId: string, verify = false) =>
    apiClient
      .get<ArchiveContent>(`/archiving/${archiveId}/content`, { params: verify ? { verify: true } : undefined })
      .then((r) => r.data),

  /** Blob rather than a bare URL — the download needs the Authorization header.
   *  `acknowledgeIntegrityFailure` is the CISO override that serves a file whose
   *  checksum no longer matches, so a damaged file can still be investigated. */
  downloadEvidence: (archiveId: string, evidenceId: string, acknowledgeIntegrityFailure = false) =>
    apiClient
      .get(`/archiving/${archiveId}/evidence/${evidenceId}/download`, {
        params: acknowledgeIntegrityFailure ? { acknowledge_integrity_failure: true } : undefined,
        responseType: "blob",
      })
      .then((r) => r.data as Blob),
};

// ── CVE knowledge base (Elite Pack) ──────────────────────────────────────────
export const cveApi = {
  search: (params?: Record<string, unknown>) => apiClient.get("/cve", { params }).then((r) => r.data),
  sync: (days = 7, refreshDays?: number) =>
    apiClient.post("/cve/sync", null, { params: { days, refresh_days: refreshDays } }).then((r) => r.data),
  annotate: (cveId: string, data: Record<string, unknown>) => apiClient.put(`/cve/${cveId}/annotation`, data).then((r) => r.data),
  // Full sheet: NVD's data joined to MITRE's weakness text (names + mitigations).
  detail: (cveId: string) => apiClient.get(`/cve/${cveId}`).then((r) => r.data),
  // MITRE CWE catalog, for the flaw-type filter's autocomplete.
  cwe: (q?: string, limit = 25) => apiClient.get("/cve/cwe", { params: { q, limit } }).then((r) => r.data),
};

// ── MFA / TOTP (Elite Pack) ──────────────────────────────────────────────────
export const mfaApi = {
  status: () => apiClient.get("/mfa/status").then((r) => r.data),
  enroll: () => apiClient.post("/mfa/enroll").then((r) => r.data),
  verify: (code: string) => apiClient.post("/mfa/verify", { code }).then((r) => r.data),
  // A confirmed device can only be removed with a current code from it.
  disable: (code?: string) => apiClient.post("/mfa/disable", { code: code ?? null }).then((r) => r.data),
};

// ── OCR document capture (Elite Pack) ────────────────────────────────────────
export const ocrApi = {
  status: () => apiClient.get("/ocr/status").then((r) => r.data),
  extract: (file: File, lang: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("lang", lang);
    return apiClient.post("/ocr/extract", fd, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
  },
  exportPdf: (text: string, filename?: string, title?: string) =>
    apiClient.post("/ocr/export-pdf", { text, filename, title }, { responseType: "blob" }).then((r) => r.data as Blob),
  searchablePdf: (file: File, lang: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("lang", lang);
    return apiClient
      .post("/ocr/searchable-pdf", fd, { headers: { "Content-Type": "multipart/form-data" }, responseType: "blob" })
      .then((r) => ({ blob: r.data as Blob, truncated: r.headers["x-truncated"] === "1", totalPages: Number(r.headers["x-total-pages"] || 0), pageCount: Number(r.headers["x-page-count"] || 0) }));
  },
};

// ── AD/LDAP SSO (Elite Pack) ─────────────────────────────────────────────────
export const ssoApi = {
  status: (tenantSlug?: string) => apiClient.get("/sso/ldap/status", { params: tenantSlug ? { tenant_slug: tenantSlug } : {} }).then((r) => r.data),
  login: (data: { username: string; password: string; tenant_slug?: string }) => apiClient.post("/sso/ldap/login", data).then((r) => r.data),
};

// ── Directory (AD/LDAP) configuration — tenant admin, Settings > Directory ───
// The bind password is write-only: `get` reports whether one is stored, never
// its value, and omitting it from `update` keeps the stored one.
export const directoryApi = {
  get: () => apiClient.get("/tenants/current/ldap").then((r) => r.data),
  update: (data: Record<string, unknown>) => apiClient.patch("/tenants/current/ldap", data).then((r) => r.data),
  test: (data: { probe_username?: string | null; draft?: Record<string, unknown> }) =>
    apiClient.post("/tenants/current/ldap/test", data).then((r) => r.data),
};

// ── System self-test (in-app acceptance checks) ──────────────────────────────
export const systemApi = {
  selfTest: () => apiClient.get("/system/self-test").then((r) => r.data),
};
