/**
 * Typed API endpoint functions using the axios client.
 * Uses React Query for caching and state management.
 */
import { apiClient } from "./client";
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
}

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

  generateApiToken: (name: string) =>
    apiClient.post<{ token: string; token_name: string; created_at: string }>("/auth/api-tokens", { name }).then((r) => r.data),

  listApiTokens: () =>
    apiClient.get<Array<{ token_name: string; created_at: string; last_used?: string }>>("/auth/api-tokens").then((r) => r.data),

  deleteApiToken: (tokenName: string) =>
    apiClient.delete(`/auth/api-tokens/${tokenName}`),

  requestAiAccess: (feature: "document-generation" | "ai-analysis" | "all", reason: string) =>
    apiClient.post<AiAccessRequest>("/auth/ai-access/request", { feature, reason }).then((r) => r.data),

  getAiAccessStatus: () =>
    apiClient.get<{ requests: AiAccessRequest[]; quotas: AiUsageQuota[] }>("/auth/ai-access/status").then((r) => r.data),

  getAiUsage: () =>
    apiClient.get<AiTokenUsage>("/auth/ai-usage").then((r) => r.data),

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
  list: () => apiClient.get<Framework[]>("/frameworks").then((r) => r.data),

  get: (id: string) => apiClient.get<Framework>(`/frameworks/${id}`).then((r) => r.data),

  delete: (id: string) => apiClient.delete(`/frameworks/${id}`),

  getControls: (frameworkId: string) =>
    apiClient.get<FrameworkControl[]>(`/frameworks/${frameworkId}/controls`).then((r) => r.data),

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
};

// ─── Risks ───────────────────────────────────

export const risksApi = {
  list: (params?: { page?: number; page_size?: number; status?: string; severity?: string }) =>
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
};

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
  listAssessments: (params?: { page?: number; page_size?: number }) =>
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

  uploadControlEvidence: (controlAssessmentId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
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
  downloadFileVersionUrl: (versionId: string, acknowledgeIntegrityFailure = false) =>
    `${API_BASE}/compliance/files/versions/${versionId}/download` +
    (acknowledgeIntegrityFailure ? "?acknowledge_integrity_failure=true" : ""),

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

  updateActionPlanItem: (id: string, data: Partial<{ status: string; start_date: string | null; due_date: string | null; owner_id: string | null; notes: string; priority: string }>) =>
    apiClient.patch<ActionPlanItem>(`/compliance/action-plan/${id}`, data).then(r => r.data),
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
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw new Error(`AI error: ${resp.status}`);
  const { readSseStream } = await import("@/lib/sse");
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
  list: (params?: { page?: number; page_size?: number }) =>
    apiClient.get<PaginatedResponse<Audit>>("/audits", { params }).then((r) => r.data),

  get: (id: string) => apiClient.get<Audit>(`/audits/${id}`).then((r) => r.data),

  create: (data: Partial<Audit>) =>
    apiClient.post<Audit>("/audits", data).then((r) => r.data),

  getFindings: (auditId: string) =>
    apiClient.get<AuditFinding[]>(`/audits/${auditId}/findings`).then((r) => r.data),
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

export const policiesApi = {
  list: (params?: { page?: number; page_size?: number; limit?: number }) =>
    apiClient.get<Policy[]>("/policies", { params }).then((r) => r.data),

  get: (id: string) => apiClient.get<Policy>(`/policies/${id}`).then((r) => r.data),

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
};

// ─── Vendors ─────────────────────────────────

export const vendorsApi = {
  list: () =>
    apiClient.get<{ items: Vendor[]; total: number }>("/vendors").then((r) => r.data),

  get: (id: string) => apiClient.get<Vendor>(`/vendors/${id}`).then((r) => r.data),

  create: (data: Partial<Vendor>) =>
    apiClient.post<Vendor>("/vendors", data).then((r) => r.data),

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
}

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
};

// ─── Subscriptions ───────────────────────────

export const subscriptionsApi = {
  get: () => apiClient.get<Subscription>("/subscriptions/current").then((r) => r.data),

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
  listTypes: () => apiClient.get("/reports/types").then((r) => r.data),

  download: async (reportType: string) => {
    const response = await apiClient.get(`/reports/${reportType}/generate`, {
      responseType: "blob",
    });
    // Create blob URL and trigger download
    const blob = new Blob([response.data], { type: "application/pdf" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().split("T")[0];
    link.href = url;
    link.download = `${reportType}_report_${date}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },

  preview: async (reportType: string): Promise<string> => {
    const response = await apiClient.get(`/reports/${reportType}/preview`, {
      responseType: "blob",
    });
    const blob = new Blob([response.data], { type: "application/pdf" });
    return window.URL.createObjectURL(blob);
  },
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
  list: (params?: { severity?: string; status_filter?: string }) =>
    apiClient.get("/vulnerabilities", { params }).then((r) => r.data),
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
export const appliedControlsApi = {
  list: (params?: { status?: string }) =>
    apiClient.get("/applied-controls", { params }).then((r) => r.data),
  get: (id: string) => apiClient.get(`/applied-controls/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/applied-controls", data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/applied-controls/${id}`, data).then((r) => r.data),
  delete: (id: string) => apiClient.delete(`/applied-controls/${id}`),
};

// ─── Security Exceptions & Risk Acceptance ──
export const securityApi = {
  listExceptions: (params?: { status_filter?: string }) =>
    apiClient.get("/security/exceptions", { params }).then((r) => r.data),
  createException: (data: Record<string, unknown>) => apiClient.post("/security/exceptions", data).then((r) => r.data),
  approveException: (id: string) => apiClient.patch(`/security/exceptions/${id}/approve`).then((r) => r.data),
  rejectException: (id: string, reason?: string) => apiClient.patch(`/security/exceptions/${id}/reject?reason=${reason || ""}`).then((r) => r.data),
  listAcceptances: () => apiClient.get("/security/acceptances").then((r) => r.data),
  createAcceptance: (data: Record<string, unknown>) => apiClient.post("/security/acceptances", data).then((r) => r.data),
  approveAcceptance: (id: string) => apiClient.patch(`/security/acceptances/${id}/approve`).then((r) => r.data),
};

// ─── Risk Matrices ──────────────────────────
export const riskMatricesApi = {
  list: () => apiClient.get("/risk-matrices").then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/risk-matrices", data).then((r) => r.data),
  delete: (id: string) => apiClient.delete(`/risk-matrices/${id}`),
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
};

// ─── Activity Log ───────────────────────────
export const activityLogApi = {
  list: (params?: { entity_type?: string; action?: string; user_id?: string; limit?: number; offset?: number }) =>
    apiClient.get("/activity-log", { params }).then((r) => r.data),
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
export type DataIoFormat = "csv" | "xml";

export const dataApi = {
  exportCsv: async (module: string) => dataApi.exportData(module, "csv"),
  exportXml: async (module: string) => dataApi.exportData(module, "xml"),
  exportData: async (module: string, format: DataIoFormat = "csv") => {
    const resp = await apiClient.get(`/data/export/${module}`, { params: { format }, responseType: "blob" });
    const mime = format === "xml" ? "application/xml" : "text/csv";
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
  importData: async (module: string, file: File, format: DataIoFormat = "csv") => {
    const fd = new FormData();
    fd.append("file", file);
    return apiClient
      .post(`/data/import/${module}`, fd, { params: { format }, headers: { "Content-Type": "multipart/form-data" } })
      .then((r) => r.data);
  },
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
  list: (params?: { page?: number; page_size?: number }) =>
    apiClient.get("/assets", { params }).then((r) => r.data),
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
  datasets: () => apiClient.get("/report-builder/datasets").then((r) => r.data),
  exportFile: (dataset: string, format: "xlsx" | "csv") =>
    apiClient.post("/report-builder/export", { dataset, format }, { responseType: "blob" }).then((r) => r.data),
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
};

// ── Archiving + retention (Elite Pack) ───────────────────────────────────────
export const archivingApi = {
  list: () => apiClient.get("/archiving").then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/archiving", data).then((r) => r.data),
  purgeExpired: () => apiClient.post("/archiving/purge-expired").then((r) => r.data),
  exportFile: (format: "xlsx" | "csv" | "pdf") => apiClient.get("/archiving/export/download", { params: { format }, responseType: "blob" }).then((r) => r.data),
  listRules: () => apiClient.get("/archiving/rules").then((r) => r.data),
  createRule: (data: { entity_type: string; criteria: string; enabled?: boolean; retention_days?: number | null }) =>
    apiClient.post("/archiving/rules", data).then((r) => r.data),
  deleteRule: (id: string) => apiClient.delete(`/archiving/rules/${id}`),
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
  disable: () => apiClient.post("/mfa/disable").then((r) => r.data),
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
