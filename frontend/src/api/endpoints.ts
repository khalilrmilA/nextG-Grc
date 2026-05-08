/**
 * Typed API endpoint functions using the axios client.
 * Uses React Query for caching and state management.
 */
import { apiClient } from "./client";
import type {
  AuthTokens,
  Risk,
  RiskHeatmapData,
  PaginatedResponse,
  Framework,
  FrameworkControl,
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
} from "@/types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";

// ─── Auth ────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  tenant_id: string;
  tenant_name: string;
  primary_framework_id: string | null;
  selected_framework_ids: string[];
  org_size: string | null;
  primary_assessment_id: string | null;
}

export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post<AuthTokens>("/auth/login", { email, password }).then((r) => r.data),

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
      .post<{ status: string; compliance_score: number; controls_analyzed: number }>(
        `/compliance/assessments/${assessmentId}/analyze`
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

  // ── Checklist document management ──────────────────────────────────────────
  downloadDocumentUrl: (docId: string) =>
    `${API_BASE}/compliance/documents/${docId}/download`,

  toggleDocumentVisibility: (docId: string) =>
    apiClient.patch<ChecklistDocItem>(`/compliance/documents/${docId}/visibility`).then(r => r.data),

  deleteDocument: (docId: string) =>
    apiClient.delete(`/compliance/documents/${docId}`),

  deleteAssessment: (assessmentId: string) =>
    apiClient.delete(`/compliance/assessments/${assessmentId}`),
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

export const policiesApi = {
  list: (params?: { page?: number; page_size?: number }) =>
    apiClient.get<PaginatedResponse<Policy>>("/policies", { params }).then((r) => r.data),

  get: (id: string) => apiClient.get<Policy>(`/policies/${id}`).then((r) => r.data),

  create: (data: Partial<Policy>) =>
    apiClient.post<Policy>("/policies", data).then((r) => r.data),

  update: (id: string, data: Partial<Policy>) =>
    apiClient.patch<Policy>(`/policies/${id}`, data).then((r) => r.data),
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

export const dashboardApi = {
  getSummary: () => apiClient.get<DashboardSummary>("/dashboard/summary").then((r) => r.data),
  getFrameworksOverview: () => apiClient.get("/dashboard/frameworks-overview").then((r) => r.data),
  getFrameworkSummary: (frameworkId?: string) =>
    apiClient.get("/dashboard/framework-summary", { params: frameworkId ? { framework_id: frameworkId } : {} }).then((r) => r.data),
};

// ─── Subscriptions ───────────────────────────

export const subscriptionsApi = {
  get: () => apiClient.get<Subscription>("/subscriptions/current").then((r) => r.data),

  createCheckoutSession: (tier: string, billing_cycle: string) =>
    apiClient
      .post<{ checkout_url: string }>("/subscriptions/checkout", { tier, billing_cycle })
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

export const usersApi = {
  listUsers: () =>
    apiClient
      .get<{ id: string; first_name: string; last_name: string; email: string; role: string }[]>("/users")
      .then((r) => r.data),

  listAuditors: () =>
    apiClient.get<AuditorUser[]>("/users/auditors").then((r) => r.data),

  createAuditor: (data: { name: string; email: string; password: string; expires_at?: string | null }) => {
    const parts = data.name.trim().split(" ");
    const first_name = parts[0];
    const last_name = parts.slice(1).join(" ") || "-";
    return apiClient
      .post<AuditorUser>("/users/auditors", {
        first_name,
        last_name,
        email: data.email,
        temporary_password: data.password,
        expires_at: data.expires_at ?? null,
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

  createUser: (data: { email: string; first_name: string; last_name: string; role: string; expires_at?: string | null }) =>
    apiClient.post<AuditorUser & { temporary_password: string }>("/users/create", data).then((r) => r.data),

  updateUser: (user_id: string, data: { is_active?: boolean; role?: string }) =>
    apiClient.patch<{ id: string; email: string; first_name: string; last_name: string; role: string; is_active: boolean; expires_at?: string | null }>(`/users/${user_id}`, data).then((r) => r.data),

  deleteUser: (user_id: string) =>
    apiClient.delete(`/users/${user_id}`),

  resetPassword: (user_id: string) =>
    apiClient.post<{ temporary_password: string }>(`/users/${user_id}/reset-password`, {}).then((r) => r.data),
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
};

// ─── Vulnerabilities ────────────────────────
export const vulnerabilitiesApi = {
  list: (params?: { severity?: string; status_filter?: string }) =>
    apiClient.get("/vulnerabilities", { params }).then((r) => r.data),
  stats: () => apiClient.get("/vulnerabilities/stats").then((r) => r.data),
  get: (id: string) => apiClient.get(`/vulnerabilities/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/vulnerabilities", data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/vulnerabilities/${id}`, data).then((r) => r.data),
  delete: (id: string) => apiClient.delete(`/vulnerabilities/${id}`),
};

// ─── Threats ────────────────────────────────
export const threatsApi = {
  list: (params?: { category?: string }) =>
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
};

// ─── Risk Scenarios ─────────────────────────
export const riskScenariosApi = {
  list: (params?: { treatment?: string }) =>
    apiClient.get("/risk-scenarios", { params }).then((r) => r.data),
  get: (id: string) => apiClient.get(`/risk-scenarios/${id}`).then((r) => r.data),
  create: (data: Record<string, unknown>) => apiClient.post("/risk-scenarios", data).then((r) => r.data),
  update: (id: string, data: Record<string, unknown>) => apiClient.patch(`/risk-scenarios/${id}`, data).then((r) => r.data),
  delete: (id: string) => apiClient.delete(`/risk-scenarios/${id}`),
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

// ─── Data Import/Export ─────────────────────
export const dataApi = {
  exportCsv: async (module: string) => {
    const resp = await apiClient.get(`/data/export/${module}`, { responseType: "blob" });
    const blob = new Blob([resp.data], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${module}_export_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  },
  importCsv: async (module: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiClient.post(`/data/import/${module}`, fd, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
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
