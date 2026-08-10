import { apiClient } from "./client";

export interface LicenseStatus {
  enforcement: boolean;
  status: "valid" | "expired" | "missing" | "invalid" | "unconfigured";
  customer_name: string | null;
  plan: string | null;
  expires_at: string | null;
  days_remaining: number | null;
  activated_at: string | null;
}

export const licenseApi = {
  getStatus: () =>
    apiClient.get<LicenseStatus>("/license/status").then((r) => r.data),

  activate: (license_key: string) =>
    apiClient.post<LicenseStatus>("/license/activate", { license_key }).then((r) => r.data),
};
