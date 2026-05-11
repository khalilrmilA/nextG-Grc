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
}

export interface TenantSubscription {
  tenant_id: string;
  tenant_name: string;
  tier: string;
  status: string;
  trial_ends_at: string | null;
}

export const superAdminUsersApi = {
  listAll: () =>
    apiClient.get<SuperAdminUser[]>("/admin/users").then((r) => r.data),

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

  updateTenantAccess: (tenant_id: string, enabled_modules: string[]) =>
    apiClient
      .patch(`/admin/tenant-access/${tenant_id}`, { enabled_modules })
      .then((r) => r.data),
};

export const superAdminSubscriptionsApi = {
  listAll: () =>
    apiClient.get<TenantSubscription[]>("/admin/subscriptions").then((r) => r.data),

  update: (tenant_id: string, data: { tier?: string; status?: string; trial_ends_at?: string | null }) =>
    apiClient.patch<TenantSubscription>(`/admin/subscriptions/${tenant_id}`, data).then((r) => r.data),
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
