import { Routes, Route, Navigate, Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { useAuthStore, hasAnyRole } from "./store/auth";
import Layout from "./components/layout/Layout";
import AuditorLayout from "./components/layout/AuditorLayout";
import EliteUpsellListener from "./components/EliteUpsellListener";
import AssetsPage from "./pages/AssetsPage";
import AssetGraphPage from "./pages/AssetGraphPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import RiskTreatmentPage from "./pages/RiskTreatmentPage";
import ControlEffectivenessPage from "./pages/ControlEffectivenessPage";
import GovernancePage from "./pages/GovernancePage";
import ArchivingPage from "./pages/ArchivingPage";
import CvePage from "./pages/CvePage";
import MfaSetupPage from "./pages/MfaSetupPage";
import OcrCapturePage from "./pages/OcrCapturePage";
import SystemCheckPage from "./pages/SystemCheckPage";
import DocumentationPage from "./pages/DocumentationPage";
import LoginPage from "./pages/LoginPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import RegisterPage from "./pages/RegisterPage";
import ServiceDownPage from "./pages/ServiceDownPage";
import DashboardPage from "./pages/DashboardPage";
import RisksPage from "./pages/RisksPage";
import RiskCartographyPage from "./pages/RiskCartographyPage";
import ActionPlanPage from "./pages/ActionPlanPage";
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
import RegulatoryUpdatesPage from "./pages/RegulatoryUpdatesPage";
import WebhooksPage from "./pages/WebhooksPage";
import ContractCollaborationPage from "./pages/ContractCollaborationPage";
import VendorCollaborationPage from "./pages/VendorCollaborationPage";
import EvidenceUploadPage from "./pages/EvidenceUploadPage";
import CompanyAdminPage from "./pages/CompanyAdminPage";
import SupportPage from "./pages/SupportPage";
import LicenseActivationPage from "./pages/LicenseActivationPage";

function PrivateRoute({ children, requiredModule }: { readonly children: React.ReactNode; requiredModule?: string }) {
  const user = useAuthStore((u) => u);
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "auditor") return <Navigate to="/auditor/portal" replace />;
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

// Per-route role allowlists. Admin roles always pass. Routes not listed are open to all.
// tenant_admin = only true admin. ciso = broad security oversight role.
const ADMIN_ROLES = ["tenant_admin"];
const CISO_AND_ADMIN = [...ADMIN_ROLES, "ciso"];
// viewer = full read-only access to all modules — write ops blocked at HTTP client level
const ROUTE_ROLES: Record<string, string[]> = {
  "/analytics":           [...CISO_AND_ADMIN, "risk_manager", "compliance_manager", "control_owner", "viewer"],
  "/risks":               [...CISO_AND_ADMIN, "risk_manager", "compliance_manager", "control_owner", "viewer"],
  "/risk-cartography":    [...CISO_AND_ADMIN, "risk_manager", "compliance_manager", "control_owner", "viewer"],
  "/asset-graph":         [...CISO_AND_ADMIN, "risk_manager", "compliance_manager", "control_owner", "viewer"],
  "/action-plan":         [...CISO_AND_ADMIN, "risk_manager", "compliance_manager", "control_owner", "viewer"],
  "/risk-scenarios":      [...CISO_AND_ADMIN, "risk_manager", "compliance_manager", "control_owner", "viewer"],
  "/compliance":          [...CISO_AND_ADMIN, "risk_manager", "compliance_manager", "policy_manager", "control_owner", "viewer"],
  "/framework":           [...CISO_AND_ADMIN, "compliance_manager", "policy_manager", "viewer"],
  "/audits":              [...CISO_AND_ADMIN, "compliance_manager", "viewer"],
  "/policies":            [...CISO_AND_ADMIN, "compliance_manager", "policy_manager", "viewer"],
  "/policy-generator":    [...CISO_AND_ADMIN, "policy_manager", "viewer"],
  "/vendors":             [...CISO_AND_ADMIN, "vendor_manager", "viewer"],
  "/applied-controls":    [...CISO_AND_ADMIN, "risk_manager", "compliance_manager", "control_owner", "viewer"],
  "/security-exceptions": [...CISO_AND_ADMIN, "risk_manager", "compliance_manager", "control_owner", "viewer"],
  "/incidents":           [...CISO_AND_ADMIN, "risk_manager", "compliance_manager", "control_owner", "viewer"],
  "/vulnerabilities":     [...CISO_AND_ADMIN, "risk_manager", "compliance_manager", "control_owner", "viewer"],
  "/threats":             [...CISO_AND_ADMIN, "risk_manager", "compliance_manager", "control_owner", "viewer"],
  "/regulatory":          [...CISO_AND_ADMIN, "compliance_manager", "policy_manager", "viewer"],
  "/webhooks":            [...ADMIN_ROLES],
};

function RoleRoute({ path, children }: { readonly path: string; readonly children: React.ReactNode }) {
  const user = useAuthStore((u) => u);
  const allowed = ROUTE_ROLES[path];
  if (!allowed || !user || hasAnyRole(user, allowed)) return <>{children}</>;
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Lock className="w-8 h-8 text-red-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h1>
        <p className="text-gray-600 mb-6">Your role doesn't have permission to access this page. Contact your administrator if you need access.</p>
        <Link to="/dashboard" className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
    <EliteUpsellListener />
    <Routes>
      {/* ── Public routes (no authentication required) ── */}
      <Route path="/service-down" element={<ServiceDownPage />} />
      <Route path="/license" element={<LicenseActivationPage />} />
      <Route path="/upload/:token" element={<EvidenceUploadPage />} />
      <Route path="/vendor-collab/:shareToken" element={<VendorCollaborationPage />} />
      <Route path="/login" element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
      <Route path="/reset-password" element={<PublicOnlyRoute><ResetPasswordPage /></PublicOnlyRoute>} />
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
        <Route path="assets" element={<AssetsPage />} />
        <Route path="analytics" element={<RoleRoute path="/analytics"><AnalyticsPage /></RoleRoute>} />
        <Route path="risk-treatment" element={<RiskTreatmentPage />} />
        <Route path="control-effectiveness" element={<ControlEffectivenessPage />} />
        <Route path="governance" element={<GovernancePage />} />
        <Route path="archiving" element={<ArchivingPage />} />
        <Route path="cve" element={<CvePage />} />
        <Route path="mfa-setup" element={<MfaSetupPage />} />
        <Route path="ocr" element={<OcrCapturePage />} />
        <Route path="system-check" element={<SystemCheckPage />} />
        <Route path="documentation" element={<DocumentationPage />} />
        <Route path="risks" element={<RoleRoute path="/risks"><PrivateRoute requiredModule="risks"><RisksPage /></PrivateRoute></RoleRoute>} />
        <Route path="risk-cartography" element={<RoleRoute path="/risk-cartography"><PrivateRoute requiredModule="risks"><RiskCartographyPage /></PrivateRoute></RoleRoute>} />
        <Route path="asset-graph" element={<RoleRoute path="/asset-graph"><PrivateRoute requiredModule="asset-graph"><AssetGraphPage /></PrivateRoute></RoleRoute>} />
        <Route path="action-plan" element={<RoleRoute path="/action-plan"><PrivateRoute requiredModule="compliance"><ActionPlanPage /></PrivateRoute></RoleRoute>} />
        <Route path="compliance" element={<RoleRoute path="/compliance"><PrivateRoute requiredModule="compliance"><CompliancePage /></PrivateRoute></RoleRoute>} />
        <Route path="compliance/:assessmentId" element={<RoleRoute path="/compliance"><PrivateRoute requiredModule="compliance"><AssessmentDetailPage /></PrivateRoute></RoleRoute>} />
        <Route path="compliance/assessments/:assessmentId/remediation-plan" element={<RoleRoute path="/compliance"><PrivateRoute requiredModule="compliance"><RemediationPlannerPage /></PrivateRoute></RoleRoute>} />
        <Route path="compliance/:assessmentId/traceability" element={<RoleRoute path="/compliance"><PrivateRoute requiredModule="compliance"><TraceabilityPage /></PrivateRoute></RoleRoute>} />
        <Route path="framework" element={<RoleRoute path="/framework"><PrivateRoute requiredModule="frameworks"><FrameworksPage /></PrivateRoute></RoleRoute>} />
        <Route path="framework/custom/new" element={<RoleRoute path="/framework"><PrivateRoute requiredModule="frameworks"><CustomFrameworkPage /></PrivateRoute></RoleRoute>} />
        <Route path="framework/builder" element={<RoleRoute path="/framework"><PrivateRoute requiredModule="frameworks"><FrameworkBuilderPage /></PrivateRoute></RoleRoute>} />
        <Route path="framework/:id/edit" element={<RoleRoute path="/framework"><PrivateRoute requiredModule="frameworks"><EditFrameworkPage /></PrivateRoute></RoleRoute>} />
        <Route path="audits" element={<RoleRoute path="/audits"><PrivateRoute requiredModule="audits"><AuditsPage /></PrivateRoute></RoleRoute>} />
        <Route path="policies" element={<RoleRoute path="/policies"><PrivateRoute requiredModule="policies"><PoliciesPage /></PrivateRoute></RoleRoute>} />
        <Route path="policy-generator" element={<RoleRoute path="/policy-generator"><PrivateRoute requiredModule="policy-generator"><PolicyGeneratorPage /></PrivateRoute></RoleRoute>} />
        <Route path="vendors" element={<RoleRoute path="/vendors"><PrivateRoute requiredModule="vendors"><VendorsPage /></PrivateRoute></RoleRoute>} />
        <Route path="vendors/contract-review" element={<RoleRoute path="/vendors"><PrivateRoute requiredModule="vendors"><ContractReviewPage /></PrivateRoute></RoleRoute>} />
        <Route path="vendors/collaboration/:collabId" element={<RoleRoute path="/vendors"><PrivateRoute requiredModule="vendors"><ContractCollaborationPage /></PrivateRoute></RoleRoute>} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="incidents" element={<RoleRoute path="/incidents"><IncidentsPage /></RoleRoute>} />
        <Route path="vulnerabilities" element={<RoleRoute path="/vulnerabilities"><VulnerabilitiesPage /></RoleRoute>} />
        <Route path="threats" element={<RoleRoute path="/threats"><ThreatLibraryPage /></RoleRoute>} />
        <Route path="risk-scenarios" element={<RoleRoute path="/risk-scenarios"><RiskScenariosPage /></RoleRoute>} />
        <Route path="applied-controls" element={<RoleRoute path="/applied-controls"><AppliedControlsPage /></RoleRoute>} />
        <Route path="security-exceptions" element={<RoleRoute path="/security-exceptions"><SecurityExceptionsPage /></RoleRoute>} />
        <Route path="regulatory" element={<RoleRoute path="/regulatory"><RegulatoryUpdatesPage /></RoleRoute>} />
        <Route path="activity-log" element={<Navigate to="/super-admin" replace />} />
        <Route path="webhooks" element={<RoleRoute path="/webhooks"><WebhooksPage /></RoleRoute>} />
        <Route path="support" element={<SupportPage />} />
        <Route path="company-admin" element={<CompanyAdminPage />} />
        <Route path="cheat" element={<CheatSheetPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="help" element={<HelpPage />} />
      </Route>
    </Routes>
    </>
  );
}
