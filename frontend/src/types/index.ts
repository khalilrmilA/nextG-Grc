// ─────────────────────────────────────────────
// Core shared types for the GRC Platform
// ─────────────────────────────────────────────

export interface BaseEntity {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ─── Auth ───────────────────────────────────

export interface User extends BaseEntity {
  tenant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  is_verified: boolean;
  avatar_url?: string;
}

export type UserRole =
  | "super_admin"
  | "ciso"
  | "risk_manager"
  | "compliance_manager"
  | "auditor"
  | "policy_manager"
  | "vendor_manager"
  | "control_owner"
  | "viewer";

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  must_change_password?: boolean;
  mfa_required?: boolean;
  mfa_challenge_token?: string | null;
}

// ─── Tenant ─────────────────────────────────

export interface Tenant extends BaseEntity {
  name: string;
  slug: string;
  domain?: string;
  logo_url?: string;
  industry?: string;
  country?: string;
  features: Record<string, boolean | number>;
  is_active: boolean;
}

// ─── Framework ──────────────────────────────

export interface Framework extends BaseEntity {
  name: string;
  short_name: string;
  version: string;
  description?: string;
  issuing_body?: string;
  applicable_regions: string[];
  applicable_industries: string[];
  status: "active" | "deprecated" | "draft";
  is_builtin: boolean;
  control_count: number;
}

export interface FrameworkControl extends BaseEntity {
  framework_id: string;
  control_id: string;
  title: string;
  description?: string;
  guidance?: string;
  category?: string;
  parent_id?: string;
  sort_order: number;
  mapped_controls: CrosswalkMapping[];
  tags: string[];
}

export interface CrosswalkMapping {
  framework: string;
  control: string;
}

// ─── Risk ────────────────────────────────────

export type RiskStatus =
  | "identified"
  | "assessed"
  | "treatment_planned"
  | "treatment_in_progress"
  | "treated"
  | "accepted"
  | "closed";

export type RiskSeverity = "critical" | "high" | "medium" | "low" | "info";

export type RiskTreatmentOption = "mitigate" | "accept" | "transfer" | "avoid";

export interface Risk extends BaseEntity {
  tenant_id: string;
  title: string;
  description?: string;
  risk_category?: string;
  owner_id?: string;
  status: RiskStatus;
  likelihood?: number;
  impact?: number;
  inherent_risk_score?: number;
  residual_likelihood?: number;
  residual_impact?: number;
  residual_risk_score?: number;
  severity?: RiskSeverity;
  tags: string[];
  linked_controls: string[];
  linked_assets: string[];
  appetite_threshold?: number | null;
  over_appetite?: boolean | null;
  target_likelihood?: number | null;
  target_impact?: number | null;
  target_over_appetite?: boolean | null;
  target_validated_at?: string | null;
  target_calculation_notes?: string | null;
  reopen_reason?: string | null;
}

export interface RiskHeatmapData {
  grid: Record<string, Array<{ id: string; title: string; severity: RiskSeverity }>>;
  total_risks: number;
  by_severity: Record<RiskSeverity, number>;
}

// ─── Risk Cartography ────────────────────────

export interface CartographyRiskLevel {
  name: string;
  color: string;
  min_score: number;
  max_score: number;
}

export interface CartographyScope {
  type: "all" | "control" | "category" | "tag";
  value?: string;
}

export interface CartographyDefinition {
  grid_rows: number;
  grid_cols: number;
  likelihood_labels: string[];
  impact_labels: string[];
  risk_levels: CartographyRiskLevel[];
  scope?: CartographyScope;
}

export interface RiskCartography {
  id: string;
  name: string;
  description?: string;
  is_default: boolean;
  definition: CartographyDefinition;
  risk_count?: number;
  created_at: string;
  updated_at: string;
}

export interface CartographyRisk {
  id: string;
  title: string;
  severity: string | null;
  native_likelihood: number | null;
  native_impact: number | null;
  effective_likelihood: number;
  effective_impact: number;
  is_overridden: boolean;
}

export interface RiskCartographyDetail extends RiskCartography {
  risk_positions: Record<string, { likelihood: number; impact: number }>;
  risks: CartographyRisk[];
}

// ─── Compliance ──────────────────────────────

export type ControlStatus =
  | "not_started"
  | "in_progress"
  | "implemented"
  | "not_applicable"
  | "partially_implemented"
  | "not_implemented";

export interface ComplianceAssessment extends BaseEntity {
  tenant_id: string;
  framework_id: string;
  name: string;
  description?: string;
  status: "draft" | "in_progress" | "under_review" | "completed" | "archived";
  lead_assessor_id?: string;
  scope_description?: string;
  assessment_start?: string;
  assessment_end?: string;
  next_review_date?: string;
  compliance_score?: number;
}

export interface ControlAssessment extends BaseEntity {
  assessment_id: string;
  control_id: string;
  status: ControlStatus;
  owner_id?: string;
  notes?: string;
  implementation_notes?: string;
  not_applicable_justification?: string;
}

export interface Evidence extends BaseEntity {
  control_assessment_id: string;
  tenant_id: string;
  name: string;
  description?: string;
  evidence_type: "document" | "screenshot" | "log" | "configuration" | "report" | "attestation" | "automated";
  file_name?: string;
  file_size_bytes?: number;
  content_type?: string;
  source_integration?: string;
  is_automated: boolean;
  valid_from?: string;
  valid_until?: string;
  uploaded_by_id?: string;
}

// ─── Audit ───────────────────────────────────

export interface Audit extends BaseEntity {
  tenant_id: string;
  title: string;
  description?: string;
  audit_type: "internal" | "external" | "regulatory" | "certification";
  status: "planning" | "fieldwork" | "review" | "reporting" | "closed";
  lead_auditor_id?: string;
  framework_id?: string;
  planned_start?: string;
  planned_end?: string;
  scope?: string;
  recurrence?: "annual" | "semi_annual" | "none" | null;
  recurrence_spawned_at?: string | null;
}

export interface AuditFinding extends BaseEntity {
  audit_id: string;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low" | "observation";
  status: "open" | "in_remediation" | "remediated" | "accepted" | "closed";
  control_id?: string;
  remediation_owner_id?: string;
  due_date?: string;
  recommendation?: string;
}

// ─── Policy ──────────────────────────────────

export interface Policy extends BaseEntity {
  tenant_id: string;
  title: string;
  policy_number?: string;
  description?: string;
  category?: string;
  owner_id?: string;
  status: "draft" | "in_review" | "approved" | "published" | "retired";
  linked_controls: string[];
  review_frequency_months: number;
  next_review_date?: string;
  policy_type?: string;
  version?: number | string;
  effective_date?: string | null;
  expiration_date?: string | null;
  business_process_id?: string | null;
  org_entity_id?: string | null;
}

// ─── Vendor ──────────────────────────────────

export type VendorRiskTier = "critical" | "high" | "medium" | "low";

export interface Vendor extends BaseEntity {
  tenant_id: string;
  name: string;
  website?: string;
  country?: string;
  industry?: string;
  risk_tier: VendorRiskTier;
  status: "active" | "under_review" | "onboarding" | "offboarding" | "inactive";
  owner_id?: string;
  has_data_processing_agreement: boolean;
  risk_score?: number;
  primary_contact_name?: string;
  primary_contact_email?: string;
  services_provided?: string;
  description?: string;
}

// ─── Dashboard ───────────────────────────────

export interface DashboardSummary {
  risk: {
    total_open: number;
    critical: number;
    high: number;
    by_severity: Record<string, number>;
  };
  compliance: {
    average_score: number | null;
    total_assessments: number;
    control_coverage_percent: number;
    controls_by_status: Record<string, number>;
  };
  audit: {
    open_findings: number;
  };
  vendor: {
    total_vendors: number;
  };
  policy: {
    attestation_rate_percent: number;
    total_attestations: number;
  };
}

// ─── Compliance — Document Analysis (new) ────

export interface UploadedDocument {
  id: string;
  assessment_id: string;
  file_name: string;
  file_size_bytes?: number;
  content_type?: string;
  created_at: string;
}

export interface LinkedChecklistDocument {
  id: string;
  file_name: string;
  document_name?: string | null;
  clause_ref?: string | null;
  document_type_key?: string | null;
  file_size_bytes?: number | null;
  content_type?: string | null;
}

export interface ControlAssessmentDetail extends BaseEntity {
  assessment_id: string;
  control_id: string;
  control_identifier: string;
  control_title: string;
  control_category?: string;
  control_description?: string;
  status: ControlStatus;
  notes?: string;
  implementation_notes?: string;
  not_applicable_justification?: string;
  ai_confidence?: number;
  cross_framework_coverage: CrosswalkMapping[];
  is_mandatory?: boolean;
  linked_checklist_documents?: LinkedChecklistDocument[];
}

export interface GapDetail {
  id: string;
  control_id: string;
  control_identifier: string;
  control_title: string;
  control_description?: string;
  gap_description: string;
  severity: "critical" | "high" | "medium" | "low";
  remediation_steps?: string;
  // Phase 4 extended fields
  recommendation_status?: "pending" | "accepted" | "rejected";
  is_certification_blocker?: boolean;
  remediation_priority?: number;
  action_item_id?: string | null;
}

export interface DocumentLogEntry {
  id: string;
  file_name: string;
  file_size_bytes: number | null;
  content_type: string | null;
  document_type_key: string | null;
  clause_refs: string[];
  ai_analysis_summary: string | null;
  is_visible_to_auditor: boolean;
  uploaded_by_id: string | null;
  uploaded_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistUploadedDoc {
  id: string;
  file_name: string;
  file_path: string | null;
  content_type: string | null;
  file_size_bytes: number | null;
  is_visible_to_auditor: boolean;
  created_at: string;
  kind?: "document" | "evidence";
}

export interface MandatoryDocumentStatus {
  document_type_key: string;
  clause_ref: string;
  document_name: string;
  is_mandatory: boolean;
  description?: string;
  sort_order: number;
  uploaded_document?: UploadedDocument | null;
  uploaded_documents?: ChecklistUploadedDoc[];
  is_uploaded: boolean;
}

export interface DocumentChecklistResponse {
  framework_short_name: string;
  total: number;
  uploaded: number;
  items: MandatoryDocumentStatus[];
  other_uploads?: ChecklistUploadedDoc[];
}

export interface CrossFrameworkCoverage {
  [frameworkShortName: string]: {
    framework_name: string;
    framework_short_name: string;
    assessment_id: string;
    compliance_score: number;
    total: number;
    covered: number;
    gaps: number;
    percent: number;
    // legacy fields
    total_mapped: number;
    controls: string[];
  };
}

export interface AssessmentDetail extends BaseEntity {
  tenant_id: string;
  framework_id: string;
  framework_name: string;
  framework_short_name: string;
  name: string;
  description?: string;
  status: "draft" | "in_progress" | "under_review" | "completed" | "archived";
  compliance_score?: number;
  scope_description?: string;
  uploaded_documents: UploadedDocument[];
  control_assessments: ControlAssessmentDetail[];
  gaps: GapDetail[];
  cross_framework_summary: CrossFrameworkCoverage;
}

export interface AssessmentListItem extends BaseEntity {
  framework_id: string;
  framework_name: string;
  framework_short_name: string;
  name: string;
  status: string;
  compliance_score?: number;
  document_count: number;
}

// ─── Custom Framework Builder (new) ──────────

export interface FrameworkCreate {
  name: string;
  short_name: string;
  version: string;
  description?: string;
  issuing_body?: string;
  applicable_regions: string[];
  applicable_industries: string[];
}

export interface ControlCreate {
  control_id: string;
  title: string;
  description?: string;
  guidance?: string;
  category?: string;
  tags: string[];
}

export interface RequirementCreate {
  requirement_text: string;
  requirement_level: "must" | "should" | "may";
}

// ─── AI Policy Generator (new) ───────────────

export interface PolicyGenerateRequest {
  control_identifier: string;
  control_title: string;
  framework_short_name: string;
  control_description?: string;
  gap_description?: string;
  existing_context?: string;
  organization_context?: string;
  model?: string;
}

// ─── Notifications ───────────────────────────

export type NotificationType =
  | "risk_new" | "risk_overdue" | "risk_status_changed"
  | "audit_assigned" | "audit_due" | "audit_finding_new"
  | "policy_review_due" | "policy_published"
  | "vendor_alert" | "vendor_assessment_due"
  | "compliance_score_drop" | "compliance_analysis_done"
  | "weekly_digest" | "system";

export type NotificationChannel = "email" | "in_app";
export type NotificationStatus = "unread" | "read" | "dismissed";

export interface AppNotification {
  id: string;
  type: NotificationType;
  status: NotificationStatus;
  title: string;
  message: string;
  data?: { link?: string; [key: string]: unknown };
  created_at: string;
  read_at?: string | null;
}

export interface NotificationListResponse {
  items: AppNotification[];
  unread_count: number;
  total: number;
}

export interface NotificationPreference {
  notification_type: NotificationType;
  channel: NotificationChannel;
  enabled: boolean;
}

// ─── Subscription ────────────────────────────

export type SubscriptionTier = "starter" | "professional" | "enterprise";

export interface Subscription extends BaseEntity {
  tenant_id: string;
  tier: SubscriptionTier;
  status: "trialing" | "active" | "past_due" | "canceled" | "paused";
  billing_cycle: "monthly" | "annual";
  trial_ends_at?: string;
  current_period_end?: string;
  limits: Record<string, boolean | number>;
}

// ─── AI Access & Usage ────────────────────────

export interface AiAccessRequest extends BaseEntity {
  tenant_id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  feature: "document-generation" | "ai-analysis" | "all";
  reason: string;
  status: "pending" | "approved" | "denied";
  admin_notes?: string;
  requested_at: string;
  responded_at?: string;
}

export interface AiUsageQuota extends BaseEntity {
  tenant_id: string;
  user_id: string;
  feature: "document-generation" | "ai-analysis";
  monthly_limit: number;
  monthly_used: number;
  reset_date: string;
  is_approved: boolean;
}

export interface AiTokenUsage {
  tokens_used: number;
  tokens_limit: number;
  requests_made: number;
  requests_limit: number;
  reset_at: string;
  percentage_used: number;
}
