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
  | "business_owner"
  | "security_analyst"
  | "executive"
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
  /** norme | reglementation | loi | politique_interne — null when unclassified. */
  source_type?: string | null;
  /** Set on a tenant fork, so /upstream-diff knows what it was cloned from. */
  cloned_from_framework_id?: string | null;
  /** Machine translation into the UI language (stored text in original_*). */
  translated?: boolean;
  original_name?: string | null;
  original_description?: string | null;
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
  // ── Referential classification (STB objectif 1) ────────────────────────────
  domain?: string | null;
  requirement_type?: string | null;
  is_mandatory?: boolean;
  /** Read off the parent framework by the routes that have it loaded. */
  source_type?: string | null;
  source_name?: string | null;
  source_short_name?: string | null;
  issuing_body?: string | null;
  /** The tenant's own applicability decision. null = not decided yet. */
  applicability?: string | null;
  applicability_justification?: string | null;
  /** Set only when the text above was overlaid with a translation. */
  lang?: string | null;
  translation_source?: string | null;
  /** Machine translation into the UI language (stored text in original_*). */
  translated?: boolean;
  original_title?: string | null;
  original_description?: string | null;
  original_guidance?: string | null;
}

export interface FrameworkControlVersion extends BaseEntity {
  control_id: string;
  version_number: number;
  title: string;
  description?: string;
  guidance?: string;
  category?: string;
  tags: string[];
  changed_by_id?: string;
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
  // STB gap 19.d — département / processus porteur du risque
  org_entity_id?: string | null;
  business_process_id?: string | null;
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
  actual_start?: string | null;
  actual_end?: string | null;
  executive_summary?: string | null;
  in_scope_systems?: string[];
  // ── Perimeter / campaign / grid (objectif 4) ──────────────────────────────
  campaign_id?: string | null;
  grid_id?: string | null;
  assessment_id?: string | null;
  process_ids?: string[];
  org_entity_ids?: string[];
  asset_ids?: string[];
  audit_plan?: string | null;
  // ── Report workflow (objectif 6) ──────────────────────────────────────────
  report_url?: string | null;
  report_status?: AuditReportStatus;
  report_submitted_at?: string | null;
  report_submitted_by_id?: string | null;
  report_approved_by_id?: string | null;
  report_approved_at?: string | null;
  report_rejected_reason?: string | null;
  report_issued_at?: string | null;
  // ── Register durability (objectif 8) ──────────────────────────────────────
  deleted_at?: string | null;
  finding_count?: number;
}

/** The audit report's own lifecycle, independent of the engagement status. */
export type AuditReportStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "issued"
  | "distributed";

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
  management_response?: string | null;
  remediation_notes?: string | null;
  /** non_conformite_majeure | non_conformite_mineure | observation | ... */
  finding_type?: string | null;
  closed_at?: string | null;
  closed_by_id?: string | null;
  closure_note?: string | null;
  closure_evidence_id?: string | null;
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
  version_count?: number;
  attestation_count?: number;
  pending_attestations?: number;
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
  /** The key of the assessment's own conformity scale, when it is graded on one.
   *  `status` stays the legacy enum so existing screens keep working. */
  status_key?: string | null;
  /** True when the control sits on "not applicable" with nothing on record. */
  requires_justification?: boolean;
  owner_id?: string | null;
  owner_name?: string | null;
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
  // ── Perimeter (STB objectif 2). "tenant" on every legacy row. ─────────────
  scope_type?: "tenant" | "org_entity" | "business_process" | "asset" | string;
  org_entity_id?: string | null;
  org_entity_name?: string | null;
  business_process_id?: string | null;
  business_process_name?: string | null;
  in_scope_assets?: string[];
  // ── Customisable conformity grid ─────────────────────────────────────────
  scale_id?: string | null;
  scale_name?: string | null;
  scale_levels?: ComplianceScaleLevel[];
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


/** One stored version of a file — mirrors FileVersionOut in compliance.py.
 *  `integrity` is recomputed server-side on every read: ok | modified |
 *  missing | unreadable | unrecorded. "unrecorded" means the file predates
 *  checksums, which is not a failure. */
export interface StoredFileVersionItem {
  id: string;
  entity_type: string;
  entity_id: string;
  version_number: number;
  file_name?: string | null;
  file_sha256?: string | null;
  file_size_bytes?: number | null;
  content_type?: string | null;
  status: "current" | "superseded" | "deleted" | string;
  note?: string | null;
  uploaded_by_id?: string | null;
  created_at: string;
  integrity: "ok" | "modified" | "missing" | "unreadable" | "unrecorded" | string;
}

// ═════════════════════════════════════════════════════════════════════════════
// Compliance & audit programme (STB Bloc 9)
//
// Everything below backs the routes added by the compliance/audit backend
// programme. Shapes mirror the response models one-for-one; a field the backend
// declares optional is optional here too, so a legacy row that predates a
// column reads as `undefined` rather than crashing a screen.
// ═════════════════════════════════════════════════════════════════════════════

// ─── Conformity scales & evaluation levels ───────────────────────────────────

/** One level of a conformity scale (compliance) or of an audit grid.
 *  `counts_as_gap` is the compliance-scale spelling, `is_gap` the grid one —
 *  both are carried so a single renderer can handle either source. */
export interface ComplianceScaleLevel {
  key: string;
  label_fr?: string | null;
  label_en?: string | null;
  label_ar?: string | null;
  color?: string | null;
  /** Drives the score: sum(weight) / count(scored). null = not scored at all. */
  weight?: number | null;
  counts_as_gap?: boolean;
  is_gap?: boolean;
  legacy_status?: string | null;
  [extra: string]: unknown;
}

export interface ComplianceScale {
  id: string;
  tenant_id: string | null;
  name: string;
  description: string | null;
  levels: ComplianceScaleLevel[];
  is_default: boolean;
  is_builtin: boolean;
  is_active: boolean;
  created_by_id: string | null;
  /** How many assessments are graded on this scale — warn before editing it. */
  assessment_count: number;
  created_at: string;
  updated_at: string;
}

export interface ComplianceScaleCreate {
  name: string;
  description?: string | null;
  levels: ComplianceScaleLevel[];
  is_default?: boolean;
}

export interface ComplianceScaleUpdate {
  name?: string;
  description?: string | null;
  levels?: ComplianceScaleLevel[];
  is_default?: boolean;
  is_active?: boolean;
}

// ─── Centralised requirements referential ────────────────────────────────────

/** One line of the referential, whichever silo it came from. */
export interface Requirement {
  /** Which silo the row came from — see the facets for the live vocabulary. */
  source_kind: string;
  /** The row's own id in that silo, for deep-linking. */
  source_id: string;
  /** "A.8.1", a policy number, or nothing. */
  ref_code: string | null;
  title: string;
  description: string | null;
  source_name: string | null;
  /** norme | reglementation | loi | politique_interne */
  source_type: string | null;
  domain: string | null;
  /** exigence | recommandation | mesure */
  requirement_type: string | null;
  /** applicable | not_applicable | partially_applicable */
  applicability: string | null;
  status: string | null;
  framework_id: string | null;
  created_at: string | null;
}

export interface RequirementListResponse {
  items: Requirement[];
  total: number;
  limit: number;
  offset: number;
}

export interface RequirementFacetBucket {
  value: string | null;
  count: number;
}

/** Counts per classification axis, for the filter sidebar. */
export interface RequirementFacets {
  total: number;
  by_source_kind: RequirementFacetBucket[];
  by_source_type: RequirementFacetBucket[];
  by_domain: RequirementFacetBucket[];
  by_requirement_type: RequirementFacetBucket[];
  by_applicability: RequirementFacetBucket[];
}

/** An internal policy that claims to cover a given requirement. */
export interface RequirementLinkedPolicy {
  id: string;
  title: string;
  policy_number: string | null;
  category: string | null;
  status: string;
  owner_id: string | null;
}

// ─── Framework governance: applicability, translations, import, upstream ─────

export type ControlApplicabilityValue =
  | "applicable"
  | "not_applicable"
  | "partially_applicable"
  | string;

export interface ControlApplicability {
  id: string;
  tenant_id: string;
  control_id: string;
  org_entity_id: string | null;
  business_process_id: string | null;
  applicability: ControlApplicabilityValue;
  justification: string | null;
  decided_by_id: string | null;
  decided_at: string | null;
  review_date: string | null;
}

/** GET applicability: the organisation-wide decision plus any per-perimeter ones. */
export interface ControlApplicabilityState {
  control_id: string;
  control_ref: string;
  /** A mandatory requirement can never be excluded — the UI must know first. */
  is_mandatory: boolean;
  organisation_wide: ControlApplicability | null;
  scoped: ControlApplicability[];
}

export interface ControlApplicabilityUpsert {
  applicability: ControlApplicabilityValue;
  justification?: string | null;
  org_entity_id?: string | null;
  business_process_id?: string | null;
  review_date?: string | null;
}

export interface ControlTranslation {
  id: string;
  control_id: string;
  lang: string;
  title: string | null;
  description: string | null;
  guidance: string | null;
  /** human | ai — an auditor is entitled to know which. */
  source: string | null;
}

export interface ControlTranslationUpsert {
  title?: string | null;
  description?: string | null;
  guidance?: string | null;
  source?: string | null;
}

/** A page of the referential search, with the facet counts a filter bar needs. */
export interface ControlSearchResponse {
  total: number;
  limit: number;
  offset: number;
  items: FrameworkControl[];
  facets: Record<string, unknown>;
}

/** Result of POST /frameworks/import — same shape for a dry run and a real one.
 *  A dry run that would have created the framework reports `framework_id: null`,
 *  because the row was rolled back. */
export interface FrameworkImportResult {
  framework_id: string | null;
  framework_name: string | null;
  framework_created: boolean;
  /** csv | xlsx | yaml | json — what the parser decided the file was. */
  format: string;
  dry_run: boolean;
  total_rows: number;
  created: number;
  updated: number;
  unchanged: number;
  parents_linked: number;
  requirements_created: number;
  file_sha256: string | null;
  errors: string[];
  error_count: number;
  errors_truncated: number;
  warnings: string[];
  warning_count: number;
  warnings_truncated: number;
}

export interface UpstreamDiffAddedControl {
  control_id: string;
  title: string;
}

export interface UpstreamDiffModifiedControl {
  control_id: string;
  /** Which of title / description / guidance / category differ. */
  fields: string[];
  /** True when this tenant edited the control itself — a sync would overwrite it. */
  locally_edited: boolean;
  upstream_title: string;
  local_title: string;
}

/** How a tenant fork has drifted from the built-in it was cloned from.
 *  The three lists are capped at 500 rows each — the counts are authoritative. */
export interface FrameworkUpstreamDiff {
  framework_id: string;
  upstream_framework_id: string;
  upstream_name: string;
  upstream_version: string;
  counts: {
    added_upstream: number;
    only_in_this_copy: number;
    modified: number;
    locally_edited: number;
  };
  added_upstream: UpstreamDiffAddedControl[];
  only_in_this_copy: UpstreamDiffAddedControl[];
  modified: UpstreamDiffModifiedControl[];
}

// ─── Assessment perimeter coverage ───────────────────────────────────────────

export interface ScopeCoverageItem {
  id: string;
  name: string;
  parent_id?: string | null;
  assessment_count: number;
  frameworks: string[];
  controls_total: number;
  controls_scoreable: number;
  open_gaps: number;
  compliance_score: number | null;
  /** Org entities only: this node plus every descendant. */
  rolled_up_score?: number | null;
  rolled_up_assessment_count?: number;
}

export interface ScopeCoverage {
  scope_type: string;
  items: ScopeCoverageItem[];
  /** Assessments with no perimeter at all — "0%" vs "not scoped yet". */
  unscoped_assessment_count: number;
}

/** A file hung off an action-plan item (proof the action was carried out). */
export interface ActionItemAttachment {
  id: string;
  action_item_id: string;
  name: string;
  description?: string | null;
  file_name?: string | null;
  file_size_bytes?: number | null;
  content_type?: string | null;
  uploaded_by_id?: string | null;
  /** false = hidden from the auditor's view. Toggled by a CISO through
   *  complianceApi.toggleActionAttachmentVisibility. */
  is_visible_to_auditor?: boolean;
  created_at: string;
}

// ─── Audit campaigns (the annual plan) ───────────────────────────────────────

export interface AuditCampaign {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  /** annuelle | trimestrielle | ponctuelle … */
  cadence: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  owner_id: string | null;
  stakeholders_notified_at: string | null;
  is_active: boolean;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditCampaignListResponse {
  items: AuditCampaign[];
  total: number;
  limit: number;
  offset: number;
}

/** An engagement as it appears inside its campaign. */
export interface AuditCampaignAudit {
  id: string;
  title: string;
  audit_type: string;
  status: string;
  lead_auditor_id: string | null;
  framework_id: string | null;
  planned_start: string | null;
  planned_end: string | null;
  report_status: string;
  findings_count: number;
}

/** What a steering committee asks for: where the plan stands, in one call. */
export interface AuditCampaignSummary {
  campaign: AuditCampaign;
  audits_total: number;
  audits_by_status: Record<string, number>;
  audits_closed: number;
  completion_pct: number;
  findings_total: number;
  findings_by_severity: Record<string, number>;
  findings_by_status: Record<string, number>;
  findings_open: number;
}

// ─── Audit grids (the customisable evaluation checklist) ─────────────────────

export interface AuditGrid {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  source_framework_id: string | null;
  /** As stored — null means "use the default". */
  levels: ComplianceScaleLevel[] | null;
  /** What the UI should actually render. */
  levels_resolved: ComplianceScaleLevel[];
  is_default: boolean;
  is_active: boolean;
  created_by_id: string | null;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface AuditGridItem {
  id: string;
  grid_id: string;
  ref_code: string | null;
  title: string;
  description: string | null;
  guidance: string | null;
  section: string | null;
  sort_order: number;
  control_id: string | null;
  is_mandatory: boolean;
}

export interface AuditGridDetail {
  grid: AuditGrid;
  items: AuditGridItem[];
}

/** One answer on one grid row, for one engagement. */
export interface AuditGridResponseItem {
  id: string;
  audit_id: string;
  item_id: string;
  verdict: string | null;
  note: string | null;
  answered_by_id: string | null;
  answered_at: string | null;
}

/** What the auditor works through for one engagement.
 *  `source` is "grid" when the engagement has one and "framework_controls"
 *  when it does not — in which case the caller keeps using the existing
 *  framework-controls checklist unchanged. */
export interface AuditGridChecklist {
  audit_id: string;
  grid: AuditGrid | null;
  items: AuditGridItem[];
  responses: AuditGridResponseItem[];
  source: "grid" | "framework_controls" | string;
  can_answer: boolean;
}

export interface AuditGridSeedResult {
  created: number;
  skipped: number;
  total_items: number;
}

// ─── Audit comments (the contradictory exchange) ─────────────────────────────

export interface AuditComment {
  id: string;
  audit_id: string | null;
  finding_id: string | null;
  control_assessment_id: string | null;
  parent_id: string | null;
  author_id: string;
  author_name: string | null;
  author_email: string | null;
  author_is_external: boolean;
  /** null once deleted — the row survives, the words do not. */
  body: string | null;
  is_internal: boolean;
  is_deleted: boolean;
  created_at: string;
  edited_at: string | null;
}

export interface AuditCommentThread {
  items: AuditComment[];
  total: number;
  /** Lets the client decide whether to offer the "internal note" toggle at all. */
  viewer_is_audit_team: boolean;
}

/** One exchange waiting on the current user — the « constats à traiter » feed. */
export interface PendingAuditComment {
  comment_id: string;
  audit_id: string | null;
  audit_title: string | null;
  finding_id: string | null;
  finding_title: string | null;
  control_assessment_id: string | null;
  author_id: string;
  author_name: string | null;
  excerpt: string;
  created_at: string;
}

// ─── Audit register, evidence, report workflow ───────────────────────────────

/** One filterable row of the audit register. */
export interface AuditRegisterRow {
  id: string;
  title: string;
  audit_type: string;
  status: string;
  campaign_id: string | null;
  framework_id: string | null;
  lead_auditor_id: string | null;
  lead_auditor_name: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  report_status: string;
  report_issued_at: string | null;
  findings_total: number;
  findings_open: number;
  nonconformities: number;
  process_ids: string[];
  org_entity_ids: string[];
  asset_ids: string[];
  deleted_at: string | null;
  created_at: string;
}

export interface AuditEvidence {
  id: string;
  audit_id: string;
  name: string;
  description: string | null;
  file_name: string | null;
  s3_key: string | null;
  uploaded_by_id: string | null;
  finding_id?: string | null;
  file_path?: string | null;
  file_size_bytes?: number | null;
  content_type?: string | null;
  file_sha256?: string | null;
  record_version?: number;
  has_file?: boolean;
  created_at: string;
}

/** One status transition on a finding — the traceability an auditor asks for. */
export interface AuditFindingStatusEvent {
  id: string;
  finding_id: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  is_automatic: boolean;
  actor_id: string | null;
  actor_name?: string | null;
  created_at: string;
}

export interface OverdueAuditFinding {
  id: string;
  audit_id: string;
  audit_title: string;
  title: string;
  severity: string;
  status: string;
  due_date: string | null;
  remediation_owner_id: string | null;
  recommendation: string | null;
}

/** One recorded transmission of an audit report to named recipients. */
export interface AuditReportDistribution {
  id: string;
  audit_id: string | null;
  report_kind: string;
  file_name: string | null;
  sha256: string | null;
  report_version: number;
  channel: string;
  /** Stored as sent — a comma-separated list, not an array. */
  recipients: string;
  note: string | null;
  distributed_by_id: string | null;
  distributed_at: string | null;
  created_at: string;
}

// ─── Audit recommendations (the follow-up register) ──────────────────────────

export interface AuditRecommendation {
  id: string;
  tenant_id: string;
  audit_id: string;
  audit_title?: string | null;
  finding_id: string | null;
  ref_code: string | null;
  title: string;
  description: string | null;
  priority: string | null;
  /** pending | in_progress | closed | rejected */
  status: string;
  owner_id: string | null;
  owner_name?: string | null;
  due_date: string | null;
  progress: number;
  is_overdue?: boolean;
  action_items_total?: number;
  action_items_done?: number;
  closed_at?: string | null;
  closed_by_id?: string | null;
  closure_note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditRecommendationSummary {
  total: number;
  pending: number;
  in_progress: number;
  closed: number;
  rejected: number;
  overdue: number;
  avg_progress: number;
  by_owner: Array<Record<string, unknown>>;
  by_priority: Record<string, number>;
  by_audit: Array<Record<string, unknown>>;
}

// ─── Auditor portal (engagement-scoped) ──────────────────────────────────────

/** The verdict scale an engagement is answered on, shipped with the checklist
 *  so the portal renders the tenant's own levels instead of hard-coded tokens. */
export interface AuditorVerdictScale {
  /** grid | assessment_scale | default */
  source: string;
  source_id: string | null;
  source_name: string | null;
  levels: ComplianceScaleLevel[];
  /** Always accepted alongside the levels above. */
  legacy_keys: string[];
}

export interface AuditorGridRow {
  item_id: string;
  ref_code: string | null;
  title: string;
  description: string | null;
  guidance: string | null;
  section: string | null;
  sort_order: number;
  control_id: string | null;
  is_mandatory: boolean;
  verdict: string | null;
  note: string | null;
  answered_at: string | null;
  answered_by_id: string | null;
}

export interface AuditorGridPayload {
  grid_id: string;
  grid_name: string;
  grid_description: string | null;
  items_total: number;
  items_answered: number;
  items: AuditorGridRow[];
}

export interface AuditorEngagementProgress {
  [metric: string]: unknown;
}

/** One assigned engagement, as the auditor portal shows it. */
export interface AuditorEngagement {
  audit_id: string;
  title: string;
  description: string | null;
  audit_type: string;
  status: string;
  scope: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  framework_id: string | null;
  framework_name: string | null;
  framework_short_name: string | null;
  assessment_id: string | null;
  assessment_name: string | null;
  campaign_id: string | null;
  grid_id: string | null;
  grid_name: string | null;
  process_ids: string[];
  org_entity_ids: string[];
  asset_ids: string[];
  findings_total: number;
  findings_open: number;
  report_status: string;
  has_report: boolean;
  report_submitted_at: string | null;
  report_approved_at: string | null;
  report_rejected_reason: string | null;
  progress: AuditorEngagementProgress;
}

export interface AuditorEngagementChecklist {
  audit_id: string;
  audit_title: string;
  assessment_id: string | null;
  verdict_scale: AuditorVerdictScale;
  /** null when the engagement has no grid — fall back to `controls`. */
  grid: AuditorGridPayload | null;
  controls: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
}

// ─── Regulatory feeds (veille réglementaire) ─────────────────────────────────

export interface RegulatoryFeed {
  id: string;
  tenant_id: string | null;
  name: string;
  url: string | null;
  /** rss | atom | html … */
  kind: string;
  /** "TN", "EU", … */
  jurisdiction: string | null;
  /** "BCT", "ANSI", "JORT", "EBA", … */
  issuing_body: string | null;
  language: string | null;
  is_active: boolean;
  is_builtin: boolean;
  last_fetched_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegulatoryFeedCreate {
  name: string;
  url?: string | null;
  kind?: string;
  jurisdiction?: string | null;
  issuing_body?: string | null;
  language?: string | null;
  is_active?: boolean;
}

export interface RegulatoryFeedTestResult {
  ok: boolean;
  items_found: number;
  error: string | null;
  sample_titles: string[];
}

export interface RegulatoryUpdateVersion {
  id: string;
  update_id: string;
  version_number: number;
  snapshot: Record<string, unknown>;
  change_reason: string | null;
  author_id: string | null;
  author_email: string | null;
  author_name?: string | null;
  created_at: string;
}

// ─── Policy ↔ requirement linkage ────────────────────────────────────────────

/** One requirement a policy claims to cover, resolved for display. */
export interface PolicyLinkedControl {
  id: string;
  /** "A.5.1" — what an auditor calls it. */
  control_ref: string;
  title: string;
  framework_id: string;
  framework_name?: string | null;
  framework_short_name?: string | null;
  domain?: string | null;
  requirement_type?: string | null;
}

export interface CoveringPolicy {
  id: string;
  title: string;
  policy_number?: string | null;
  category?: string | null;
  status?: string;
  owner_id?: string | null;
  [extra: string]: unknown;
}

/** The requirement, plus every internal policy that claims to cover it. */
export interface ControlPolicies {
  control_id: string | null;
  control_ref: string | null;
  control_title: string | null;
  framework_id: string | null;
  framework_short_name: string | null;
  policies: CoveringPolicy[];
}

// ─── Archiving ───────────────────────────────────────────────────────────────

export interface ArchiveRecord {
  id: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
  reason: string | null;
  archived_at: string;
  retention_until: string | null;
  /** null means the archiving scheduler did it, not a person. */
  archived_by_id?: string | null;
}

/** One evidence file as the snapshot recorded it, plus where it stands now. */
export interface ArchivedEvidence {
  id?: string | null;
  name?: string | null;
  file_name?: string | null;
  content_type?: string | null;
  file_size_bytes?: number | null;
  file_sha256?: string | null;
  finding_id?: string | null;
  uploaded_by_id?: string | null;
  /** stored | not_stored | missing, or a file_integrity verdict when verify=true. */
  integrity: string;
  downloadable: boolean;
}

export interface ArchiveContent {
  record: ArchiveRecord;
  archived_by_email?: string | null;
  /** snapshot | live | none — where the children below were read from. */
  children_source: string;
  children: Record<string, Array<Record<string, unknown>>>;
  evidence: ArchivedEvidence[];
}

// ─── Activity log / traçabilité ──────────────────────────────────────────────

export interface ActivityLogEntry {
  id: string;
  user_id: string;
  /** Exactly as stored — this is one of the fields the entry hash covers. */
  user_email: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_name: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  origin?: string | null;
  seq?: number | null;
  entry_hash?: string | null;
  created_at: string;
  /** access | validation | change | other — derived at read time. */
  category?: string | null;
  /** Resolved for display; never written back into the hashed row. */
  actor_email?: string | null;
  actor_name?: string | null;
  is_system?: boolean;
}

export interface ActivityLogListResponse {
  items: ActivityLogEntry[];
  total: number;
}

export interface ActivityActionCatalogue {
  categories: Record<string, string[]>;
  category_choices: string[];
  actions_present: string[];
  entity_types_present: string[];
  origins_present: string[];
  /** i18n keys the UI should render for each verb. */
  i18n_prefix: string;
}

export interface ActivityAccessByActor {
  user_id: string;
  user_email?: string | null;
  user_name?: string | null;
  is_system?: boolean;
  actions: Record<string, number>;
  total: number;
  first_at: string;
  last_at: string;
}

/** "Qui a consulté CE rapport ?" — one object, every actor who touched it. */
export interface EntityAccessReport {
  entity_type: string;
  entity_id: string;
  entity_name?: string | null;
  category: string;
  total: number;
  actors: ActivityAccessByActor[];
  recent: ActivityLogEntry[];
}

export interface ActivityRetentionPolicy {
  enabled: boolean;
  retention_days: number;
  absolute_floor_days: number;
  cutoff: string;
  total_entries: number;
  eligible_count: number;
  from_seq?: number | null;
  to_seq?: number | null;
  period_start?: string | null;
  period_end?: string | null;
}

export interface ActivityLogSeal {
  id: string;
  from_seq: number;
  to_seq: number;
  entry_count: number;
  period_start?: string | null;
  period_end?: string | null;
  entries_digest: string;
  seal_hash: string;
  reason: string;
  retention_days?: number | null;
  sealed_by_email?: string | null;
  created_at: string;
}

export interface LoginEvent {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  email: string;
  success: boolean;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

// ─── Report builder ──────────────────────────────────────────────────────────

export interface ReportBuilderDataset {
  name: string;
  label: string;
  columns: string[];
}

export interface ReportBuilderTemplate {
  id: string;
  name: string;
  dataset: string;
  columns: string[];
  filters: Record<string, unknown>;
}

// ─── Dashboards: consolidated executive view, cadence and export ─────────────
//
// Shapes mirrored from the backend rather than invented here:
//   GET /dashboard/executive-summary   (endpoints/dashboard.py)
//   GET /dashboards/{module}           (endpoints/dashboards.py)
//   GET /dashboard-export/...          (endpoints/dashboard_export.py)
// Every numeric the backend cannot compute is returned as `null` — never a
// fabricated 0 — so each of these is `number | null` on purpose. Rendering a
// null as "0" would tell a board that an unmeasured control base is a failing
// one; render it as "—" / t("dashctl.not_available").

/** Blocks whose query failed server-side. Non-empty => show "unavailable",
 *  not a zero. The values are backend block labels ("assets.by_criticality"),
 *  i.e. operator text — do not print them raw to a business user. */
export type DegradedBlocks = string[];

export interface ExecutivePosture {
  /** 0–100, or null when not one component could be computed. */
  score: number | null;
  /** Only the components that could actually be computed. */
  components: Record<string, number>;
  weights: Record<string, number>;
  /** English, auditor-facing explanation of the formula. Show it behind an
   *  info affordance; it is deliberately not translated server-side. */
  formula: string;
}

export interface ExecutiveTopRisk {
  id: string;
  title: string;
  severity: string;
  /** likelihood x impact — the same product the 5x5 heatmap plots. */
  score: number;
}

export interface ExecutiveRiskBacklogChange {
  from_date: string;
  from_open: number;
  to_date: string;
  to_open: number;
  /** to_open - from_open. Negative = the backlog shrank. */
  change: number;
}

export interface ExecutiveSummary {
  /** ISO-8601 with a trailing "Z" — the "Dernière actualisation" stamp. */
  generated_at: string;
  /** null = never configured, 0 = auto-refresh off, n = every n seconds. */
  refresh_interval_seconds: number | null;
  /** false = the cadence column is not on this database yet; hide the selector. */
  refresh_config_available: boolean;
  degraded: DegradedBlocks;
  posture: ExecutivePosture;
  assets: {
    total: number;
    by_criticality: Record<string, number>;
    critical: number;
  };
  vulnerabilities: {
    total: number;
    open: number;
    open_by_severity: Record<string, number>;
    critical_high_open: number;
    avg_cvss: number | null;
  };
  threats: {
    total: number;
    tenant_specific: number;
    by_category: Record<string, number>;
  };
  risk: {
    total_open: number;
    critical: number;
    high: number;
    by_severity: Record<string, number>;
    top: ExecutiveTopRisk[];
    backlog_change: ExecutiveRiskBacklogChange | null;
  };
  controls: {
    applied_total: number;
    applied_by_status: Record<string, number>;
    avg_progress_percent: number | null;
    total_cost: number | null;
    assessed_total: number;
    assessed_implemented: number;
    coverage_percent: number | null;
    by_status: Record<string, number>;
  };
  governance: {
    policies_total: number;
    policies_by_status: Record<string, number>;
    attestation_rate_percent: number | null;
    total_attestations: number;
    committees_total: number;
    next_committee_meeting: { name: string; next_meeting_date: string } | null;
  };
  compliance: {
    average_score: number | null;
    total_assessments: number;
    open_gaps: number;
    certification_blockers: number;
  };
  audit: {
    audits_total: number;
    audits_by_status: Record<string, number>;
    open_findings: number;
    open_findings_by_severity: Record<string, number>;
  };
  incidents: {
    open: number;
    open_by_severity: Record<string, number>;
    total: number;
  };
  vendors: {
    total: number;
    by_risk_tier: Record<string, number>;
  };
  exceptions: {
    total: number;
    by_status: Record<string, number>;
    active: number;
  };
}

// ── Per-module dashboards (GET /dashboards/{key}) ────────────────────────────
// Kept as separate interfaces rather than one union so a screen that renders a
// single module gets real completion. `_count_by` degrades to {} and `_agg`/
// `_total` degrade to null/0 on a missing table, so none of these can throw.

export interface AssetsDashboard {
  total: number;
  by_type: Record<string, number>;
  by_criticality: Record<string, number>;
  by_class: Record<string, number>;
  by_lifecycle: Record<string, number>;
}

export interface CveDashboardEntry {
  cve_id: string;
  cvss_score: number | null;
  cvss_vector: string | null;
  description?: string;
}

export interface VulnerabilitiesDashboard {
  total: number;
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  avg_cvss: number | null;
  cve: { pertinent_count: number; top: CveDashboardEntry[] };
}

export interface ThreatsDashboard {
  total: number;
  by_category: Record<string, number>;
  pending: Record<string, number>;
}

export interface RiskHeatmapCell {
  likelihood: number | null;
  impact: number | null;
  count: number;
}

export interface RisksDashboard {
  total: number;
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  heatmap: RiskHeatmapCell[];
}

export interface ControlsDashboard {
  total: number;
  by_status: Record<string, number>;
  avg_progress: number | null;
  total_cost: number | null;
}

export interface GovernanceDashboard {
  policies_total: number;
  policies_by_status: Record<string, number>;
  attestations_by_status: Record<string, number>;
  committees: {
    total: number;
    next_meeting: { id: string; name: string; next_meeting_date: string } | null;
  };
}

export interface AuditDashboard {
  audits_total: number;
  audits_by_status: Record<string, number>;
  findings_by_severity: Record<string, number>;
  findings_by_status: Record<string, number>;
}

// ── Export (GET /dashboard-export/...) ───────────────────────────────────────

/** The nine keys dashboard_export.DASHBOARD_KEYS accepts. Anything else is 404. */
export type DashboardExportKey =
  | "assets" | "vulnerabilities" | "threats" | "risks" | "controls"
  | "governance" | "audit" | "compliance" | "executive";

/** "excel" is accepted by the backend as an alias of "xlsx" — the UI says Excel. */
export type DashboardExportFormat = "xlsx" | "excel" | "pdf";

export interface DashboardExportEntry {
  key: DashboardExportKey;
  /** Already localised server-side from the ?lang= / Accept-Language. */
  label: string;
  /** ADVISORY only — enough to hide a button, never the policy. The binding
   *  check runs server-side and can refuse even when this list says otherwise. */
  roles: string[];
}

export interface DashboardExportCatalogue {
  formats: string[];
  dashboards: DashboardExportEntry[];
}

/** A 424 from the export or the cadence save: the schema is behind the code.
 *  Operator-actionable, and NOT a crash — show it, never redirect on it. */
export interface DashboardExportFailure {
  status: number;
  /** dashboard_schema_not_ready | dashboard_gate_not_evaluable |
   *  dashboard_gate_schema_not_ready | dashboard_aggregation_failed |
   *  dashboard_aggregation_signature_changed | "" when the body was plain text. */
  error: string;
  /** Developer/operator English from the backend. Log it or put it behind a
   *  "details" disclosure — it is not a translated end-user message. */
  message: string;
}


// ── Module trend series (« tendances historiques ») ──────────────────────────
// GET /vulnerabilities/trend, /threats/trend and /governance/trend all answer
// this one envelope. Read by VulnerabilitiesPage / ThreatLibraryPage /
// GovernancePage, which until now each declared their own private copy.

export interface TrendPoint {
  /** The server's abbreviated month NAME, from strftime("%b") — "Apr", and
   *  always English whatever the UI language. Do NOT print it as an axis
   *  label: build the localised label from `period` (VulnerabilitiesPage
   *  parses /^(\d{4})-(\d{2})$/ off `period` and formats it with Intl) and
   *  fall back to this only when that parse fails. */
  month: string;
  /** The machine-readable year-month, "2026-04" — the field to key a row on
   *  and to derive the localised axis label from. */
  period: string;
  /** The snapshot date this reading actually came from — null when there is none. */
  as_of: string | null;
  /** null = no reading for that month. MUST render as a gap; coercing it to 0
   *  invents a month in which nothing was open. */
  total: number | null;
  counts: Record<string, unknown>;
}

export interface TrendEnvelope {
  metric: string;
  months: number;
  /**
   * Which question the series answers — it MUST be surfaced, the three are not
   * interchangeable:
   *   trend_snapshot_daily — the balance carried, from the daily snapshots.
   *   intake_volume        — the FALLBACK: what was opened/discovered each
   *                          month (created_at), which says nothing about what
   *                          was closed. Label it as intake, never as the trend.
   *   unavailable          — the history could not be read at all. Say so;
   *                          drawing zeros here would be a fabricated finding.
   */
  source: "trend_snapshot_daily" | "intake_volume" | "unavailable";
  /** The server's own sentence about which of the three this is. */
  note: string;
  series: TrendPoint[];
}


/** One row of « l'archivage des rapports dans l'historique » — mirrors
 *  ArchivedReportOut in endpoints/reports.py. `report_type` is the stable
 *  generator key (risk, executive, …), never a localised label. */
export interface ArchivedReportItem {
  id: string;
  report_type: string;
  version_number: number;
  file_name: string | null;
  file_size_bytes: number | null;
  /** Digest of the bytes as produced; re-checked before the download is served. */
  sha256: string | null;
  status: string;
  note: string | null;
  generated_by_id: string | null;
  created_at: string;
}
