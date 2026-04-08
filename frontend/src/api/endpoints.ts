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

  uploadDocument: (assessmentId: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
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
      .post<{ id: string; file_name: string; file_size_bytes: number; content_type: string }>(
        `/compliance/control-assessments/${controlAssessmentId}/evidence`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      )
      .then((r) => r.data);
  },
};

// ─── Custom Framework Builder ─────────────────

export const customFrameworkApi = {
  create: (data: FrameworkCreate) =>
    apiClient.post<Framework>("/frameworks", data).then((r) => r.data),

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
}

export interface AuditChecklist {
  assessment_id: string;
  controls: AuditChecklistControl[];
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

export const usersApi = {
  listUsers: () =>
    apiClient
      .get<{ id: string; name: string; email: string; role: string }[]>("/users")
      .then((r) => r.data),

  createAuditor: (data: { name: string; email: string; password: string }) => {
    const parts = data.name.trim().split(" ");
    const first_name = parts[0];
    const last_name = parts.slice(1).join(" ") || "-";
    return apiClient
      .post<{ id: string; email: string; role: string }>("/users/auditors", {
        first_name,
        last_name,
        email: data.email,
        temporary_password: data.password,
      })
      .then((r) => r.data);
  },
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
