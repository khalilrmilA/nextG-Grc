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
      const raw = localStorage.getItem("grc-auth");
      if (!raw) return { access: null, refresh: null };
      const parsed = JSON.parse(raw);
      return {
        access: parsed?.state?.accessToken ?? null,
        refresh: parsed?.state?.refreshToken ?? null,
      };
    } catch {
      return { access: null, refresh: null };
    }
  }

  private saveTokens(access: string, refresh: string): void {
    try {
      const raw = localStorage.getItem("grc-auth");
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
      parsed.state.accessToken = access;
      parsed.state.refreshToken = refresh;
      localStorage.setItem("grc-auth", JSON.stringify(parsed));
    } catch {}
  }

  private clearTokens(): void {
    try {
      const raw = localStorage.getItem("grc-auth");
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
      parsed.state.accessToken = null;
      parsed.state.refreshToken = null;
      localStorage.setItem("grc-auth", JSON.stringify(parsed));
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

    // Response: auto-refresh on 401
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry) {
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
            // Don't force redirect — let React Router handle unauthenticated state
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
