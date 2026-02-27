/**
 * Typed API endpoint functions using the axios client.
 * Uses React Query for caching and state management.
 */
import { apiClient } from "./client";
import type {
  AuthTokens,
  User,
  Risk,
  RiskHeatmapData,
  PaginatedResponse,
  Framework,
  FrameworkControl,
  ComplianceAssessment,
  ControlAssessment,
  Evidence,
  Audit,
  AuditFinding,
  Policy,
  Vendor,
  DashboardSummary,
  Subscription,
} from "@/types";

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
    apiClient.get<PaginatedResponse<ComplianceAssessment>>("/compliance", { params }).then((r) => r.data),

  getAssessment: (id: string) =>
    apiClient.get<ComplianceAssessment>(`/compliance/${id}`).then((r) => r.data),

  createAssessment: (data: Partial<ComplianceAssessment>) =>
    apiClient.post<ComplianceAssessment>("/compliance", data).then((r) => r.data),

  getControlAssessments: (assessmentId: string) =>
    apiClient.get<ControlAssessment[]>(`/compliance/${assessmentId}/controls`).then((r) => r.data),

  updateControlAssessment: (assessmentId: string, controlId: string, data: Partial<ControlAssessment>) =>
    apiClient.patch<ControlAssessment>(`/compliance/${assessmentId}/controls/${controlId}`, data).then((r) => r.data),

  uploadEvidence: (controlAssessmentId: string, file: File, metadata: Partial<Evidence>) => {
    const formData = new FormData();
    formData.append("file", file);
    Object.entries(metadata).forEach(([k, v]) => formData.append(k, String(v)));
    return apiClient
      .post<Evidence>(`/compliance/control-assessments/${controlAssessmentId}/evidence`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },
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
