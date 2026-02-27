import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import Layout from "./components/layout/Layout";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import LandingPage from "./pages/LandingPage";
import DashboardPage from "./pages/DashboardPage";
import RisksPage from "./pages/RisksPage";
import CompliancePage from "./pages/CompliancePage";
import AssessmentDetailPage from "./pages/AssessmentDetailPage";
import FrameworksPage from "./pages/FrameworksPage";
import CustomFrameworkPage from "./pages/CustomFrameworkPage";
import AuditsPage from "./pages/AuditsPage";
import PoliciesPage from "./pages/PoliciesPage";
import VendorsPage from "./pages/VendorsPage";

function PrivateRoute({ children }: { readonly children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const hydrated = useAuthStore((s) => s._hasHydrated);

  // Wait for Zustand to rehydrate from localStorage before deciding
  if (!hydrated) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading...</div>
      </div>
    );
  }

  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/landing" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="risks" element={<RisksPage />} />
        <Route path="compliance" element={<CompliancePage />} />
        <Route path="compliance/:assessmentId" element={<AssessmentDetailPage />} />
        <Route path="frameworks" element={<FrameworksPage />} />
        <Route path="frameworks/custom/new" element={<CustomFrameworkPage />} />
        <Route path="audits" element={<AuditsPage />} />
        <Route path="policies" element={<PoliciesPage />} />
        <Route path="vendors" element={<VendorsPage />} />
      </Route>
    </Routes>
  );
}
