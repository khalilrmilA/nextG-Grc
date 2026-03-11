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
import RemediationPlannerPage from "./pages/RemediationPlannerPage";
import AuditorPortalPage from "./pages/AuditorPortalPage";
import AuditChecklistPage from "./pages/AuditChecklistPage";
import AuditReportPage from "./pages/AuditReportPage";
import TraceabilityPage from "./pages/TraceabilityPage";
import FrameworksPage from "./pages/FrameworksPage";
import CustomFrameworkPage from "./pages/CustomFrameworkPage";
import AuditsPage from "./pages/AuditsPage";
import PoliciesPage from "./pages/PoliciesPage";
import VendorsPage from "./pages/VendorsPage";
import CheatSheetPage from "./pages/CheatSheetPage";
import SettingsPage from "./pages/SettingsPage";
import HelpPage from "./pages/HelpPage";
import PolicyGeneratorPage from "./pages/PolicyGeneratorPage";

function PrivateRoute({ children }: { readonly children: React.ReactNode }) {
  const user = useAuthStore((u) => u);

  return user ? <>{children}</> : <Navigate to="/login" replace />;
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
        <Route path="compliance/assessments/:assessmentId/remediation-plan" element={<RemediationPlannerPage />} />
        <Route path="compliance/:assessmentId/traceability" element={<TraceabilityPage />} />
        <Route path="auditor-portal" element={<AuditorPortalPage />} />
        <Route path="auditor-portal/:assessmentId" element={<AuditChecklistPage />} />
        <Route path="auditor-portal/:assessmentId/report" element={<AuditReportPage />} />
        <Route path="frameworks" element={<FrameworksPage />} />
        <Route path="frameworks/custom/new" element={<CustomFrameworkPage />} />
        <Route path="audits" element={<AuditsPage />} />
        <Route path="policies" element={<PoliciesPage />} />
        <Route path="policy-generator" element={<PolicyGeneratorPage />} />
        <Route path="vendors" element={<VendorsPage />} />
        <Route path="cheat" element={<CheatSheetPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="help" element={<HelpPage />} />
      </Route>
    </Routes>
  );
}
