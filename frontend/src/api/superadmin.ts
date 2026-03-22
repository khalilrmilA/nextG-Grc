import { apiClient } from "./client";

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
