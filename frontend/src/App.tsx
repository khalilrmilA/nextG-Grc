import { Routes, Route, Navigate, Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { useAuthStore } from "./store/auth";
import Layout from "./components/layout/Layout";
import AuditorLayout from "./components/layout/AuditorLayout";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import LandingPage from "./pages/LandingPage";
import ServiceDownPage from "./pages/ServiceDownPage";
import FeaturesLandingPage from "./pages/FeaturesLandingPage";
import SolutionsPage from "./pages/SolutionsPage";
import BlogPage from "./pages/BlogPage";
import NewsPage from "./pages/NewsPage";
import FAQPage from "./pages/FAQPage";
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
import EditFrameworkPage from "./pages/EditFrameworkPage";
import AuditsPage from "./pages/AuditsPage";
import PoliciesPage from "./pages/PoliciesPage";
import VendorsPage from "./pages/VendorsPage";
import ContractReviewPage from "./pages/ContractReviewPage";
import ReportsPage from "./pages/ReportsPage";
import FrameworkBuilderPage from "./pages/FrameworkBuilderPage";
import CheatSheetPage from "./pages/CheatSheetPage";
import SettingsPage from "./pages/SettingsPage";
import HelpPage from "./pages/HelpPage";
import PolicyGeneratorPage from "./pages/PolicyGeneratorPage";
import SuperAdminPage from "./pages/SuperAdminPage";
import IncidentsPage from "./pages/IncidentsPage";
import VulnerabilitiesPage from "./pages/VulnerabilitiesPage";
import ThreatLibraryPage from "./pages/ThreatLibraryPage";
import RiskScenariosPage from "./pages/RiskScenariosPage";
import AppliedControlsPage from "./pages/AppliedControlsPage";
import SecurityExceptionsPage from "./pages/SecurityExceptionsPage";
import TrustCenterConfigPage from "./pages/TrustCenterConfigPage";
import RegulatoryUpdatesPage from "./pages/RegulatoryUpdatesPage";
import ActivityLogPage from "./pages/ActivityLogPage";
import WebhooksPage from "./pages/WebhooksPage";
import RiskQuantificationPage from "./pages/RiskQuantificationPage";
import ContractCollaborationPage from "./pages/ContractCollaborationPage";
import VendorCollaborationPage from "./pages/VendorCollaborationPage";
import EvidenceUploadPage from "./pages/EvidenceUploadPage";
import ContactPage from "./pages/ContactPage";
import TermsPage from "./pages/TermsPage";

function PrivateRoute({ children, requiredModule }: { readonly children: React.ReactNode; requiredModule?: string }) {
  const user = useAuthStore((u) => u);
  if (!user) return <Navigate to="/login" replace />;
  // Auditors have their own layout — block them from main app
  if (user.role === "auditor") return <Navigate to="/auditor/portal" replace />;
  // Super admin has their own page
  if (user.role === "super_admin") return <Navigate to="/super-admin" replace />;
  // Check module access if required
  if (requiredModule && user.accessible_modules && !user.accessible_modules.includes(requiredModule)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h1>
          <p className="text-gray-600 mb-6">This module is not enabled for your organization. Contact your administrator to request access.</p>
          <Link to="/dashboard" className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

function PublicOnlyRoute({ children }: { readonly children: React.ReactNode }) {
  const user = useAuthStore((u) => u);
  if (!user) return <>{children}</>;
  if (user.role === "auditor") return <Navigate to="/auditor/portal" replace />;
  if (user.role === "super_admin") return <Navigate to="/super-admin" replace />;
  return <Navigate to="/dashboard" replace />;
}

function AuditorRoute({ children }: { readonly children: React.ReactNode }) {
  const user = useAuthStore((u) => u);
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "auditor") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function SuperAdminRoute({ children }: { readonly children: React.ReactNode }) {
  const user = useAuthStore((u) => u);
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "super_admin") return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      {/* ── Public routes (no authentication required) ── */}
      <Route path="/service-down" element={<ServiceDownPage />} />
      <Route path="/" element={<LandingPage />} />
      <Route path="/upload/:token" element={<EvidenceUploadPage />} />
      <Route path="/vendor-collab/:shareToken" element={<VendorCollaborationPage />} />
      <Route path="/features-landing" element={<FeaturesLandingPage />} />
      <Route path="/solutions" element={<SolutionsPage />} />
      <Route path="/blog" element={<BlogPage />} />
      <Route path="/news" element={<NewsPage />} />
      <Route path="/faq" element={<FAQPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
      <Route path="/register" element={<PublicOnlyRoute><RegisterPage /></PublicOnlyRoute>} />
      <Route path="/super-admin" element={<SuperAdminRoute><SuperAdminPage /></SuperAdminRoute>} />
      {/* ── Auditor-only routes (dedicated layout) ── */}
      <Route
        path="/auditor"
        element={
          <AuditorRoute>
            <AuditorLayout />
          </AuditorRoute>
        }
      >
        <Route index element={<AuditorPortalPage />} />
        <Route path="portal" element={<AuditorPortalPage />} />
        <Route path="portal/:assessmentId" element={<AuditChecklistPage />} />
        <Route path="portal/:assessmentId/report" element={<AuditReportPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="help" element={<HelpPage />} />
      </Route>

      {/* ── Main app routes (protected) ── */}
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="risks" element={<PrivateRoute requiredModule="risks"><RisksPage /></PrivateRoute>} />
        <Route path="compliance" element={<PrivateRoute requiredModule="compliance"><CompliancePage /></PrivateRoute>} />
        <Route path="compliance/:assessmentId" element={<PrivateRoute requiredModule="compliance"><AssessmentDetailPage /></PrivateRoute>} />
        <Route path="compliance/assessments/:assessmentId/remediation-plan" element={<PrivateRoute requiredModule="compliance"><RemediationPlannerPage /></PrivateRoute>} />
        <Route path="compliance/:assessmentId/traceability" element={<PrivateRoute requiredModule="compliance"><TraceabilityPage /></PrivateRoute>} />
        <Route path="frameworks" element={<PrivateRoute requiredModule="frameworks"><FrameworksPage /></PrivateRoute>} />
        <Route path="frameworks/custom/new" element={<PrivateRoute requiredModule="frameworks"><CustomFrameworkPage /></PrivateRoute>} />
        <Route path="frameworks/builder" element={<PrivateRoute requiredModule="frameworks"><FrameworkBuilderPage /></PrivateRoute>} />
        <Route path="frameworks/:id/edit" element={<PrivateRoute requiredModule="frameworks"><EditFrameworkPage /></PrivateRoute>} />
        <Route path="audits" element={<PrivateRoute requiredModule="audits"><AuditsPage /></PrivateRoute>} />
        <Route path="policies" element={<PrivateRoute requiredModule="policies"><PoliciesPage /></PrivateRoute>} />
        <Route path="policy-generator" element={<PrivateRoute requiredModule="policy-generator"><PolicyGeneratorPage /></PrivateRoute>} />
        <Route path="vendors" element={<PrivateRoute requiredModule="vendors"><VendorsPage /></PrivateRoute>} />
        <Route path="vendors/contract-review" element={<PrivateRoute requiredModule="vendors"><ContractReviewPage /></PrivateRoute>} />
        <Route path="vendors/collaboration/:collabId" element={<PrivateRoute requiredModule="vendors"><ContractCollaborationPage /></PrivateRoute>} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="incidents" element={<IncidentsPage />} />
        <Route path="vulnerabilities" element={<VulnerabilitiesPage />} />
        <Route path="threats" element={<ThreatLibraryPage />} />
        <Route path="risk-scenarios" element={<RiskScenariosPage />} />
        <Route path="risk-quantification" element={<RiskQuantificationPage />} />
        <Route path="applied-controls" element={<AppliedControlsPage />} />
        <Route path="security-exceptions" element={<SecurityExceptionsPage />} />
        <Route path="trust-center" element={<TrustCenterConfigPage />} />
        <Route path="regulatory" element={<RegulatoryUpdatesPage />} />
        <Route path="activity-log" element={<ActivityLogPage />} />
        <Route path="webhooks" element={<WebhooksPage />} />
        <Route path="cheat" element={<CheatSheetPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="help" element={<HelpPage />} />
      </Route>
    </Routes>
  );
}
