import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { HelmetProvider } from "react-helmet-async";
import App from "./App";
import { FrameworkProvider } from "./context/FrameworkContext";
import { EntitlementsProvider } from "./context/EntitlementsContext";
import "./index.css";
import "./store/appearance"; // side-effect: applies saved theme/density to <html> immediately
import i18n from "./i18n";   // side-effect: initialises i18next + applies RTL direction

// Clear stale Zustand auth (had accessToken: null, caused 401 redirect loops)
// Also clear old sessionStorage key from previous auth implementation
try {
  localStorage.removeItem("grc-auth");
  sessionStorage.removeItem("grc_user");
} catch { /* ignore */ }

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: "monospace", background: "#1e1e2e", color: "#ff5555", minHeight: "100vh" }}>
          <h2 style={{ color: "#ff79c6" }}>React Render Error</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "#888", marginTop: 12 }}>{this.state.error.stack}</pre>
          <button
            onClick={() => { this.setState({ error: null }); }}
            style={{ marginTop: 20, padding: "8px 16px", background: "#6272a4", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HelmetProvider>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <BrowserRouter>
              <FrameworkProvider>
                <EntitlementsProvider>
                  <App />
                </EntitlementsProvider>
              </FrameworkProvider>
            </BrowserRouter>
          </QueryClientProvider>
        </I18nextProvider>
      </HelmetProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
