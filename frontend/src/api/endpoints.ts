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
} from "@/types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";

// ─── Auth ────────────────────────────────────

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
  }) => apiClient.post<AuthTokens>("/auth/register", data).then((r) => r.data),

  refresh: (refresh_token: string) =>
    apiClient.post<AuthTokens>("/auth/refresh", { refresh_token }).then((r) => r.data),
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
  list: (params?: { page?: number; page_size?: number }) =>
    apiClient.get<PaginatedResponse<Vendor>>("/vendors", { params }).then((r) => r.data),

  get: (id: string) => apiClient.get<Vendor>(`/vendors/${id}`).then((r) => r.data),

  create: (data: Partial<Vendor>) =>
    apiClient.post<Vendor>("/vendors", data).then((r) => r.data),
};

// ─── Dashboard ───────────────────────────────

export const dashboardApi = {
  getSummary: () => apiClient.get<DashboardSummary>("/dashboard/summary").then((r) => r.data),
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
