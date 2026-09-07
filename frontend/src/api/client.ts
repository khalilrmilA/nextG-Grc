/**
 * Axios API client with JWT token management and automatic refresh.
 */
import axios, { AxiosInstance, InternalAxiosRequestConfig } from "axios";
import i18n from "../i18n";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";

/** Current UI language as a 2-letter code the backend can act on (en | fr | ar). */
function currentUiLanguage(): string {
  try {
    const raw = (i18n?.language || "en").toLowerCase();
    if (raw.startsWith("fr")) return "fr";
    if (raw.startsWith("ar")) return "ar";
    return "en";
  } catch {
    return "en";
  }
}

class ApiClient {
  private client: AxiosInstance;

  /**
   * Confirms an apparent outage against the health endpoint before the whole
   * interface is thrown away. Deliberately not routed through this axios
   * instance: it must not inherit interceptors, auth headers or a long timeout.
   */
  private async backendIsDown(): Promise<boolean> {
    try {
      const base = API_BASE_URL.replace(/\/api\/v\d+\/?$/, "");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${base}/health`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timer);
      return !res.ok;
    } catch {
      return true;
    }
  }


  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        "Content-Type": "application/json",
        // Declares that this request came from a person using the web UI, so
        // the audit trail can record origin=manual instead of lumping every
        // operation together as "api". The server treats it as a hint only and
        // corroborates it against the User-Agent — a script that copies this
        // header still logs as "api".
        "X-GRC-Client": "web-ui",
      },
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
    // Request: attach access token; block write requests for viewer (read-only) accounts.
    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const { access } = this.getTokens();
        if (access && config.headers) {
          config.headers.Authorization = `Bearer ${access}`;
        }
        // Tell the backend which UI language the user is in so AI-generated
        // text (analyses, policies, chat) can be returned in that language.
        // Accept-Language is a CORS-safelisted header, so no preflight impact.
        if (config.headers) {
          config.headers["Accept-Language"] = currentUiLanguage();
        }

        // Viewer role = read-only — block all mutating requests client-side.
        const method = (config.method ?? "get").toUpperCase();
        const writeMethods = ["POST", "PUT", "PATCH", "DELETE"];
        // Allow auth endpoints (login, change-password, etc.) to pass through.
        const isAuthEndpoint = (config.url ?? "").includes("/auth/");
        if (this.isViewerRole() && writeMethods.includes(method) && !isAuthEndpoint) {
          window.dispatchEvent(new CustomEvent("demo-block"));
          const err = new Error("You have read-only access. Contact your administrator to request additional permissions.") as Error & { isDemoBlock: boolean };
          err.isDemoBlock = true;
          return Promise.reject(err);
        }

        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response: auto-refresh on 401, degrade locally on server errors.
    //
    // Degraded mode: a single failing endpoint must not take the whole
    // application down. This used to send the entire SPA to /service-down on
    // ANY 5xx from ANY call, so one broken report made Risks, Compliance and
    // everything else unreachable too. A 5xx also *proves* the server is alive
    // — it answered — so a redirect is the wrong conclusion from it. The error
    // is now rejected to the caller, which shows its own message while the
    // rest of the platform keeps working.
    //
    // /service-down is reserved for the case it was meant for: the backend not
    // answering at all. Even then it is confirmed against /health first, so a
    // single aborted or timed-out request cannot masquerade as an outage.
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const status: number | undefined = error.response?.status;

        // No response at all — possibly unreachable, possibly one dead request.
        if (!error.response) {
          if (await this.backendIsDown()) {
            window.location.href = "/service-down";
          }
          return Promise.reject(error);
        }

        // 402 handling: distinguish an Elite Pack feature-gate from a license issue.
        if (status === 402) {
          const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
          const isFeatureGate =
            !!detail && typeof detail === "object" &&
            (detail as { error?: string }).error === "feature_not_in_plan";
          if (isFeatureGate) {
            // Elite Pack feature not in the tenant's plan — surface an upsell,
            // never redirect (this is not an outage and not a license problem).
            window.dispatchEvent(new CustomEvent("elite-upsell", { detail }));
            (error as unknown as { isEliteUpsell?: boolean }).isEliteUpsell = true;
            return Promise.reject(error);
          }
          // Otherwise: license required/expired (self-hosted) — go to activation.
          if (window.location.pathname !== "/license") {
            window.location.href = "/license";
          }
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
