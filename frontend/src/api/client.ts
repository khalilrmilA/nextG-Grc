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

  private setupInterceptors(): void {
    // Request: attach access token from Zustand persisted store
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const { access } = this.getTokens();
        if (access && config.headers) {
          config.headers.Authorization = `Bearer ${access}`;
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
        if (status !== undefined && status >= 500) {
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
