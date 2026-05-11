/**
 * Axios API client with JWT token management and automatic refresh.
 */
import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: { "Content-Type": "application/json" },
    });

    this.setupInterceptors();
  }

  private getTokens(): { access: string | null; refresh: string | null } {
    try {
      // New auth store format: grc_user_v2 = { accessToken, refreshToken, ... }
      const raw = localStorage.getItem("grc_user_v2");
      if (!raw) return { access: null, refresh: null };
      const parsed = JSON.parse(raw);
      return {
        access: parsed?.accessToken ?? null,
        refresh: parsed?.refreshToken ?? null,
      };
    } catch {
      return { access: null, refresh: null };
    }
  }

  private saveTokens(access: string, refresh: string): void {
    try {
      const raw = localStorage.getItem("grc_user_v2");
      const parsed = raw ? JSON.parse(raw) : {};
      parsed.accessToken = access;
      parsed.refreshToken = refresh;
      localStorage.setItem("grc_user_v2", JSON.stringify(parsed));
    } catch {}
  }

  private clearTokens(): void {
    try {
      localStorage.removeItem("grc_user_v2");
    } catch {}
  }

  private isViewerRole(): boolean {
    try {
      const raw = localStorage.getItem("grc_user_v2");
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return parsed?.role === "viewer";
    } catch {
      return false;
    }
  }

  private setupInterceptors(): void {
    // Request: attach access token; block write requests for viewer (demo) accounts.
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const { access } = this.getTokens();
        if (access && config.headers) {
          config.headers.Authorization = `Bearer ${access}`;
        }

        // Viewer role = demo/read-only — block all mutating requests client-side.
        const method = (config.method ?? "get").toUpperCase();
        const writeMethods = ["POST", "PUT", "PATCH", "DELETE"];
        // Allow auth endpoints (login, change-password, etc.) to pass through.
        const isAuthEndpoint = (config.url ?? "").includes("/auth/");
        if (this.isViewerRole() && writeMethods.includes(method) && !isAuthEndpoint) {
          window.dispatchEvent(new CustomEvent("demo-block"));
          const err = new Error("Demo accounts are read-only. Sign up to use this feature.") as Error & { isDemoBlock: boolean };
          err.isDemoBlock = true;
          return Promise.reject(err);
        }

        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response: auto-refresh on 401, redirect to service-down on server errors
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const status: number | undefined = error.response?.status;

        // No response at all = backend unreachable (network down, connection refused)
        if (!error.response) {
          window.location.href = "/service-down";
          return Promise.reject(error);
        }

        // Server-side failures — backend is broken, not a user error
        // Exception: compliance analyze endpoint handles its own errors (long-running background job)
        const url: string = error.config?.url ?? "";
        const isAnalyze = url.includes("/compliance/assessments/") && url.includes("/analyze");
        if (status !== undefined && status >= 500 && !isAnalyze) {
          window.location.href = "/service-down";
          return Promise.reject(error);
        }

        const originalRequest = error.config;

        if (status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          try {
            const { refresh } = this.getTokens();
            if (!refresh) throw new Error("No refresh token");

            const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {
              refresh_token: refresh,
            });

            this.saveTokens(data.access_token, data.refresh_token);
            originalRequest.headers.Authorization = `Bearer ${data.access_token}`;
            return this.client(originalRequest);
          } catch {
            this.clearTokens();
          }
        }

        return Promise.reject(error);
      }
    );
  }

  get instance(): AxiosInstance {
    return this.client;
  }
}

export const apiClient = new ApiClient().instance;
