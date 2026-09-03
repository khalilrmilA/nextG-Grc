import { apiClient } from "./client";
import type { AiAccessRequest } from "@/types";

export interface SuperAdminUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  tenant_id: string;
  tenant_name: string;
  is_active: boolean;
  created_at: string;
}

export interface SuperAdminFramework {
  id: string;
  name: string;
  short_name: string;
  version: string;
  description?: string;
  controls_count?: number;
  created_at: string;
}

export interface AccessControlEntry {
  tenant_id: string;
  tenant_name: string;
  plan: string;
  enabled_modules: string[];
  /** Effective map: pack defaults with this tenant's overrides applied. */
  features: Record<string, boolean>;
  /** Only the deliberate deviations from the pack default. */
  overrides: Record<string, boolean>;
}

export interface FeatureCatalogueEntry {
  key: string;
  /** "platform" or "elite_pack". Used to group the switches. */
  group: string;
}

export interface FeatureCatalogue {
  packs: string[];
  features: FeatureCatalogueEntry[];
  /** pack name -> feature key -> default value for that pack. */
  pack_defaults: Record<string, Record<string, boolean>>;
}

export interface TenantSubscription {
  tenant_id: string;
  tenant_name: string;
  tier: string;
  status: string;
  trial_ends_at: string | null;
}

export interface CreateUserPayload {
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  tenant_id: string;
  password?: string;
}

export interface CreatedUser extends SuperAdminUser {
  temporary_password: string;
}

export const superAdminUsersApi = {
  listAll: () =>
    apiClient.get<SuperAdminUser[]>("/admin/users").then((r) => r.data),

  create: (data: CreateUserPayload) =>
    apiClient.post<CreatedUser>("/admin/users", data).then((r) => r.data),

  setActive: (id: string, is_active: boolean) =>
    apiClient.patch<SuperAdminUser>(`/admin/users/${id}`, { is_active }).then((r) => r.data),

  setRole: (id: string, role: string) =>
    apiClient.patch<SuperAdminUser>(`/admin/users/${id}`, { role }).then((r) => r.data),

  delete: (id: string) =>
    apiClient.delete(`/admin/users/${id}`),
};

export const superAdminFrameworksApi = {
  listAll: () =>
    apiClient.get<SuperAdminFramework[]>("/frameworks").then((r) => r.data),

  createFromData: (data: {
    name: string;
    short_name: string;
    version: string;
    description?: string;
    yaml_content?: string;
  }) =>
    apiClient.post<SuperAdminFramework>("/frameworks", data).then((r) => r.data),

  uploadPdf: (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    return apiClient
      .post<SuperAdminFramework>("/frameworks/upload-pdf", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },

  delete: (id: string) =>
    apiClient.delete(`/frameworks/${id}`),
};

export const superAdminAccessApi = {
  listTenantAccess: () =>
    apiClient.get<AccessControlEntry[]>("/admin/tenant-access").then((r) => r.data),

  getFeatureCatalogue: () =>
    apiClient
      .get<FeatureCatalogue>("/admin/feature-catalogue")
      .then((r) => r.data),

  // The body is {pack?, features?}. It previously sent {enabled_modules}, which
  // TenantAccessUpdate does not declare; pydantic drops unknown fields, so the
  // request returned 200 having changed nothing and the next refresh discarded
  // the edit. Sending a shape the endpoint does not read is worse than an error
  // because it looks like it worked.
  updateTenantAccess: (
    tenant_id: string,
    body: { pack?: string; features?: Record<string, boolean> },
  ) =>
    apiClient
      .patch<AccessControlEntry>(`/admin/tenant-access/${tenant_id}`, body)
      .then((r) => r.data),
};

export const superAdminSubscriptionsApi = {
  listAll: () =>
    apiClient.get<TenantSubscription[]>("/admin/subscriptions").then((r) => r.data),

  update: (tenant_id: string, data: { tier?: string; status?: string; trial_ends_at?: string | null }) =>
    apiClient.patch<TenantSubscription>(`/admin/subscriptions/${tenant_id}`, data).then((r) => r.data),
};

export interface IssuedLicense {
  id: string;
  customer_name: string;
  contact_email: string;
  license_key: string;
  plan: string;
  issued_at: string;
  expires_at: string;
  notes: string | null;
  status: "active" | "revoked";
}

export const superAdminLicensesApi = {
  list: () =>
    apiClient.get<IssuedLicense[]>("/admin/licenses").then((r) => r.data),

  create: (data: { customer_name: string; contact_email: string; duration_days: number; plan: string; notes?: string | null }) =>
    apiClient.post<IssuedLicense>("/admin/licenses", data).then((r) => r.data),

  revoke: (id: string) =>
    apiClient.post<IssuedLicense>(`/admin/licenses/${id}/revoke`).then((r) => r.data),

  reactivate: (id: string) =>
    apiClient.post<IssuedLicense>(`/admin/licenses/${id}/reactivate`).then((r) => r.data),
};

export const superAdminAiAccessApi = {
  listAiRequests: (status?: "pending" | "approved" | "denied") =>
    apiClient
      .get<AiAccessRequest[]>("/admin/ai-access/requests", { params: status ? { status } : {} })
      .then((r) => r.data),

  approveRequest: (requestId: string, adminNotes?: string) =>
    apiClient
      .patch<AiAccessRequest>(`/admin/ai-access/requests/${requestId}/approve`, { admin_notes: adminNotes })
      .then((r) => r.data),

  denyRequest: (requestId: string, reason: string) =>
    apiClient
      .patch<AiAccessRequest>(`/admin/ai-access/requests/${requestId}/deny`, { admin_notes: reason })
      .then((r) => r.data),

  setUserQuota: (userId: string, feature: string, monthlyLimit: number) =>
    apiClient
      .post(`/admin/ai-usage/quota`, { user_id: userId, feature, monthly_limit: monthlyLimit })
      .then((r) => r.data),
};
