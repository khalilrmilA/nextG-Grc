GRC Platform — Framework-First Transformation (Full Rebuild)
Context
Major platform transformation: make the entire product framework-driven from first registration.

Registration: 3-step wizard with framework selection
Dashboard: framework-specific compliance scorecard (like the Excel gap assessment template — pivot table by section, certification meter, document progress)
Document upload: mapped to mandatory documents per clause (from ISO 27001 Mandatory Document List PDF)
Gap report: per-control status table with accept/reject recommendation flow → creates action items
Auditor portal: admin creates auditor accounts; auditors see restricted view with evidence + audit checklist
Advanced: traceability matrix, certification readiness score, 90-day remediation planner, compliance journey map
AI engine: Ollama (local). Implementation order: all 6 phases sequentially.

PHASE 1 — Database Extensions + Backend Foundation
1A. Extend existing models
backend/app/models/tenant.py — add 3 columns:


primary_framework_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
selected_framework_ids: Mapped[list] = mapped_column(JSON, default=list)
org_size: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "1-50","51-200","201-1000","1000+"
backend/app/models/compliance.py — extend ComplianceGap:


recommendation_status: Mapped[str] = mapped_column(String(20), default="pending")
is_certification_blocker: Mapped[bool] = mapped_column(Boolean, default=False)
remediation_priority: Mapped[int] = mapped_column(Integer, default=50)
action_item_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
Extend UploadedDocument:


document_type_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
clause_refs: Mapped[list] = mapped_column(JSON, default=list)
ai_analysis_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
1B. New models
backend/app/models/mandatory_document.py — NEW:

framework_short_name, clause_ref, document_name, document_type_key, is_mandatory, description, sort_order
backend/app/models/action_item.py — NEW:

tenant_id, assessment_id, gap_id (FKs); title, description, owner_id, due_date, priority, status (open/in_progress/completed/cancelled), ai_generated=True
backend/app/models/auditor_assignment.py — NEW:

auditor_id, assessment_id, tenant_id, assigned_by_id, is_active, reference_document_ids (JSON)
backend/app/models/__init__.py — import all 3 new models

1C. Seed mandatory documents
backend/app/core/seed_mandatory_docs.py — NEW FILE with 40+ ISO 27001 entries:

Clause 4.1: Internal & External Issue Register
Clause 4.3: ISMS Scope Document
Clause 5.2: Information Security Policy
Clause 6.1.3: Statement of Applicability
Clause 9.2: Internal Audit Procedure/Schedule/Report
(full list from MoS PDF covering all clauses 4-10 + key Annex A docs) Called from backend/app/startup.py at first run.
1D. Backend API extensions
backend/app/api/v1/endpoints/auth.py:

Extend RegisterRequest with: primary_framework_id, selected_framework_ids, org_size
In register(): save framework fields to tenant; auto-create ComplianceAssessment in DRAFT status if framework selected
Add GET /auth/me → UserProfileResponse (includes tenant framework fields)
backend/app/api/v1/endpoints/frameworks.py:

GET /frameworks made public (no auth needed for registration step 2)
Returns FrameworkSelectionItem[] with control_count, description, regions, industries
backend/app/api/v1/endpoints/compliance.py:

GET /assessments/{id}/document-checklist → mandatory docs with upload status
POST /assessments/{id}/gaps/{gap_id}/recommendation → accept/reject → creates ActionItem
POST /assessments/{id}/gaps/bulk-action → bulk accept/reject
Extend analyze_assessment(): set is_certification_blocker (NOT_IMPLEMENTED + must requirement), remediation_priority
backend/app/api/v1/endpoints/dashboard.py:

GET /dashboard/framework-summary → section breakdown pivot, top 5 gaps, doc progress, certification readiness
Readiness formula: compliance×0.5 + doc_completeness×0.3 + blocker_resolution×0.2
backend/app/api/v1/endpoints/ai.py:

POST /ai/stream-remediation-plan → SSE stream of prioritized 90-day plan based on open gaps
backend/app/api/v1/endpoints/users.py — NEW FILE:

POST /users/auditors → create auditor within tenant (requires TENANT_ADMIN)
GET /users → list users in tenant
backend/app/api/v1/endpoints/auditor_portal.py — NEW FILE:

GET /auditor-portal/my-assignments
GET /auditor-portal/assessments/{id}/checklist
PATCH /auditor-portal/control-assessments/{id}
POST /auditor-portal/assessments/{id}/generate-report (SSE)
backend/app/api/v1/router.py — add users + auditor_portal routers

PHASE 2 — Multi-Step Registration UI
frontend/src/pages/RegisterPage.tsx — FULL REWRITE as 3-step wizard:

Step 1: name, email, password (strength meter), org name, country, industry, org_size (radio)
Step 2: Framework cards grid — primary (radio), secondary (checkbox). Loaded from GET /frameworks. Smart "Recommended" badges based on industry/country.
Step 3: Review + "Start Free Trial" → POST /auth/register
NEW: frontend/src/components/features/compliance/FrameworkSelectionCard.tsx:

framework name, short_name badge, description, regions, control_count, recommended badge
frontend/src/store/auth.ts — add to AuthUser:


primary_framework_id?: string;
selected_framework_ids?: string[];
org_size?: string;
tenant_id?: string;
After register/login: call GET /auth/me to populate these.

frontend/src/api/endpoints.ts — add:


authApi.getProfile()                         // GET /auth/me
frameworksApi.listForRegistration()          // GET /frameworks (public)
complianceApi.getDocumentChecklist(id)       // GET /assessments/{id}/document-checklist
complianceApi.actOnRecommendation(...)       // POST .../gaps/{id}/recommendation
complianceApi.bulkActOnRecommendations(...)  // POST .../gaps/bulk-action
dashboardApi.getFrameworkSummary()           // GET /dashboard/framework-summary
aiApi.streamRemediationPlan(...)             // POST /ai/stream-remediation-plan (SSE)
PHASE 3 — Framework-Specific Dashboard
frontend/src/pages/DashboardPage.tsx — FULL REWRITE:

Layout (primary framework set):


Header: "ISO 27001:2022 Compliance Dashboard" + last-analyzed date + [Switch Framework]

Row 1 (5 KPI cards):
  Overall Score % | Controls Covered X/124 | Open Gaps | Missing Docs X/40 | Cert Readiness %

Row 2 (full width):
  CertificationMeter: [0%]──[25% Initial]──[50% Defined]──[75% Managed]──[100% Certified]
  "You are here" marker at current readiness %

Row 3 (2/3 + 1/3):
  ComplianceSectionTable (pivot like Excel):
    Section          | ✓ Full | ◐ Partial | ✗ Not | N/A | %
    Clause 4 Context |   4   |     1     |   0   |  0  | 90% ← green
    A.8 Tech Controls|  18   |     8     |  22   |  3  | 54% ← red
  DocumentProgressCard:
    ████░░░░ 14/40 uploaded
    Missing: SoA, Risk Register...
    [Upload Documents →]

Row 4 (1/2 + 1/2):
  TopGapsCard: top 5 gaps with severity + [AI Remediate ✨] button
  Quick Actions: Run Analysis / View Gap Report / Create Auditor / Export
Fallback (no framework): onboarding card "Select your framework to begin"

NEW components:

frontend/src/components/features/dashboard/ComplianceSectionTable.tsx — pivot table, color rows by %
frontend/src/components/features/dashboard/CertificationMeter.tsx — SVG/div progress bar with milestones
frontend/src/components/features/dashboard/DocumentProgressCard.tsx — doc upload progress
frontend/src/components/features/dashboard/TopGapsCard.tsx — top 5 gaps + AI remediate streaming
PHASE 4 — Document Intelligence + Gap Report + Confirmations
frontend/src/pages/AssessmentDetailPage.tsx — add 2 new tabs:
Tab order: Upload & Analyze → Document Checklist → Results → Gap Report → Cross-Framework

NEW: frontend/src/components/features/compliance/DocumentChecklistTab.tsx:


Mandatory Documents (ISO 27001) — 14/40 uploaded
Clause │ Document Name               │ Status      │ Action
4.3    │ ISMS Scope Document         │ ✓ Uploaded  │ View/Replace
6.1.3  │ Statement of Applicability  │ ✗ Missing   │ [Upload ↑]
Inline per-row upload. Calls POST /assessments/{id}/documents with document_type_key.

NEW: frontend/src/components/features/compliance/GapReportTab.tsx:


Banner: "23 gaps • 8 certification blockers • 15 high priority"
Buttons: [Accept All Critical ✓] [Export] [Generate 90-day Plan ✨]

Table:
Ref   │ Control Title      │ Status    │ Severity │ Blocker │ Action
A.8.7 │ Malware Protection │ ✗ Gap     │ Critical │ 🔴 Yes  │ [✓][✗]
A.6.7 │ Remote Working     │ ◐ Partial │ High     │ ⚠️ No   │ [✓][✗]
[✓] opens GapConfirmModal. [✗] immediately rejects.

NEW: frontend/src/components/features/compliance/GapConfirmModal.tsx:

Shows gap + AI recommendation (streamed from /ai/analyze-risk)
Assign owner (team member dropdown) + due date + notes
[✓ Create Action Item] → POST .../recommendation {action:"accept", owner_id, due_date}
NEW: frontend/src/pages/RemediationPlannerPage.tsx
Route: /compliance/assessments/:assessmentId/remediation-plan
Streams 90-day plan from /ai/stream-remediation-plan. Monthly sections, weekly tasks, owners, priorities.

PHASE 5 — Auditor Portal
frontend/src/components/layout/Layout.tsx:

Detect authUser.role === "auditor" → render restricted sidebar
After login, auditor role → redirect to /auditor-portal
frontend/src/App.tsx — add routes:


/auditor-portal                             → AuditorPortalPage
/auditor-portal/assignments/:id             → AuditChecklistPage
/auditor-portal/assignments/:id/report      → AuditReportPage
NEW: frontend/src/pages/AuditorPortalPage.tsx:

Lists assigned assessments (company, framework, status, progress ring)
Reference Documents section (mandatory doc list)
NEW: frontend/src/pages/AuditChecklistPage.tsx:


Filter: [All] [To Review] [Verified ✓] [Finding !] [Observation] [N/A]
A.5.1 │ InfoSec Policies │ Evidence: 2 docs │ [✓][!][?][-]
      │ Company notes... │ [+ Add finding]
NEW: frontend/src/pages/AuditReportPage.tsx:

SSE-streamed audit report based on auditor verdicts. Download .md/.pdf.
NEW: frontend/src/components/features/audit/CreateAuditorModal.tsx:

4-step: Auditor info → Select assessments → Upload reference materials → Confirm + show temp password
Added to AuditsPage.tsx header button
NEW: frontend/src/components/features/audit/AuditChecklistRow.tsx:

Per-control row: control info + company evidence (read-only) + auditor action buttons
PHASE 6 — Advanced Features
6A. Traceability Matrix
Backend: GET /assessments/{id}/traceability-matrix → [{control_id, title, linked_risks[], linked_policies[], evidence_count, finding_count, status}]

NEW: frontend/src/pages/TraceabilityMatrixPage.tsx
Route: /compliance/assessments/:id/traceability
Scrollable table: Risk → Control → Policy → Evidence → Audit Finding. Click cell → side drawer.

6B. Compliance Journey Map
NEW: frontend/src/components/features/dashboard/ComplianceJourneyMap.tsx
SVG timeline with milestones: 0% → 25% Initial → 50% Defined → 75% Managed → 100% Certified.
Current position marker + estimated completion date.

6C. Certification Readiness Score (backend)
In GET /dashboard/framework-summary:


readiness = round(
    compliance_score * 0.5 +
    (docs_uploaded / docs_required * 100) * 0.3 +
    ((total_blockers - open_blockers) / max(total_blockers,1) * 100) * 0.2,
    1
)
6D. Document Intelligence — Auto-clause detection
After document upload: async background task calls Ollama to detect which clauses the doc covers.
Stores result in UploadedDocument.clause_refs. Used to auto-tick rows in Document Checklist.

Files Modified / Created
Backend (modified)
backend/app/models/tenant.py — +3 columns
backend/app/models/compliance.py — +4 on ComplianceGap, +3 on UploadedDocument
backend/app/api/v1/endpoints/auth.py — extend RegisterRequest + GET /me
backend/app/api/v1/endpoints/frameworks.py — make public + return selection data
backend/app/api/v1/endpoints/compliance.py — +3 endpoints + extend analyze()
backend/app/api/v1/endpoints/dashboard.py — framework-summary endpoint
backend/app/api/v1/endpoints/ai.py — remediation-plan SSE
backend/app/api/v1/router.py — add users + auditor_portal
Backend (new)
backend/app/models/mandatory_document.py
backend/app/models/action_item.py
backend/app/models/auditor_assignment.py
backend/app/core/seed_mandatory_docs.py
backend/app/api/v1/endpoints/users.py
backend/app/api/v1/endpoints/auditor_portal.py
Frontend (modified)
frontend/src/pages/RegisterPage.tsx — full rewrite 3-step wizard
frontend/src/pages/DashboardPage.tsx — full rewrite framework-aware
frontend/src/pages/AssessmentDetailPage.tsx — +2 tabs
frontend/src/pages/AuditsPage.tsx — +Create Auditor button
frontend/src/components/layout/Layout.tsx — role-aware sidebar
frontend/src/store/auth.ts — +framework fields
frontend/src/api/endpoints.ts — +new API functions
frontend/src/App.tsx — +5 new routes
Frontend (new)
frontend/src/components/features/compliance/FrameworkSelectionCard.tsx
frontend/src/components/features/compliance/DocumentChecklistTab.tsx
frontend/src/components/features/compliance/GapReportTab.tsx
frontend/src/components/features/compliance/GapConfirmModal.tsx
frontend/src/components/features/dashboard/ComplianceSectionTable.tsx
frontend/src/components/features/dashboard/CertificationMeter.tsx
frontend/src/components/features/dashboard/DocumentProgressCard.tsx
frontend/src/components/features/dashboard/TopGapsCard.tsx
frontend/src/components/features/audit/CreateAuditorModal.tsx
frontend/src/components/features/audit/AuditChecklistRow.tsx
frontend/src/pages/AuditorPortalPage.tsx
frontend/src/pages/AuditChecklistPage.tsx
frontend/src/pages/AuditReportPage.tsx
frontend/src/pages/RemediationPlannerPage.tsx
frontend/src/pages/TraceabilityMatrixPage.tsx
Verification
Register new user → 3-step wizard → framework selected → JWT → redirect to framework dashboard
Dashboard shows ISO 27001 section pivot table (not generic stats)
Compliance → auto-created assessment → Document Checklist tab shows 40 mandatory docs
Upload PDF → checklist row turns green → auto-clause detection runs in background
Run AI Analysis → Gap Report tab shows blocker vs non-blocker gaps with [✓][✗]
Click [✓] on a gap → GapConfirmModal → assign owner/date → Action Item created
"Generate 90-day Plan" → streams remediation plan
Admin creates auditor → auditor logs in → sees restricted sidebar → AuditChecklistPage
Auditor marks controls → Generate Report → streams audit report
Traceability Matrix → Risk→Control→Evidence chain visible
LEGACY PLAN (previous phases already implemented — keep for reference)
Phase 1 — Backend: New Model + Migration
1.1 Add UploadedDocument to backend/app/models/compliance.py
New ORM class at bottom of file
Fields: assessment_id (FK), tenant_id (FK), file_name, file_path (local path for dev / S3 key for prod), content_type, file_size_bytes, extracted_text (Text, cached after parsing), uploaded_by_id (FK)
Add relationship on ComplianceAssessment: uploaded_documents: Mapped[list["UploadedDocument"]]
Add ai_confidence: Mapped[float | None] column to ControlAssessment for storing AI analysis confidence score
1.2 Database migration
Since using SQLite dev (no Alembic configured for auto), add tables via Base.metadata.create_all in seed_demo.py or a new migrate.py script
Run: python migrate.py (creates new tables without dropping existing ones)
1.3 Add pypdf dependency
Add pypdf>=4.0.0 to backend/pyproject.toml (not pypdf2 — deprecated)
Create backend/uploads/ directory
1.4 Update backend/app/core/config.py
Add settings:


UPLOADS_DIR: str = "uploads"
MAX_UPLOAD_SIZE_MB: int = 10
OLLAMA_BASE_URL: str = "http://localhost:11434"
OLLAMA_ANALYSIS_MODEL: str = "deepseek-v3.1:671b-cloud"
OLLAMA_BATCH_SIZE: int = 25
Phase 2 — Backend: Compliance Endpoint (Full Implementation)
File: backend/app/api/v1/endpoints/compliance.py — complete replacement of stub

Pydantic schemas to define (top of file):
AssessmentCreate: framework_id, name, description?, scope_description?
ControlAssessmentUpdate: status?, notes?, implementation_notes?
UploadedDocumentResponse, ControlAssessmentResponse (includes control_identifier, control_title, ai_confidence, cross_framework_coverage), GapResponse, AssessmentDetailResponse, AssessmentListResponse, PaginatedAssessments
Endpoints:
POST /compliance/assessments — create assessment, validate framework exists
GET /compliance/assessments — list with pagination, ordered by created_at DESC, join Framework for name
GET /compliance/assessments/{id} — full detail with relationships + computed cross_framework_summary
POST /compliance/assessments/{id}/documents — multipart upload; extract text from PDF/DOCX/TXT; max 10MB; save to uploads/{tenant_id}/{assessment_id}/{uuid}_{sanitized_name}
POST /compliance/assessments/{id}/analyze — batch AI analysis (see below); synchronous for MVP; returns {status, compliance_score, controls_analyzed}
GET /compliance/assessments/{id}/results — alias for detail endpoint #3
PATCH /compliance/control-assessments/{id} — manual status override; recalculates compliance_score
Document text extraction helper:

def _extract_text(file_path: str, content_type: str) -> str:
    if "pdf" in content_type:
        reader = PdfReader(file_path)
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    elif "docx" in content_type or "word" in content_type:
        doc = DocxDocument(file_path)
        return "\n".join(p.text for p in doc.paragraphs)
    else:  # plain text
        return Path(file_path).read_text(encoding="utf-8", errors="ignore")
Batch AI analysis engine:

def _call_ollama_batch(doc_text: str, controls: list, model: str) -> list[dict]:
    """Synchronous — runs in thread pool. Returns list of {control_id, verdict, confidence, explanation, gap_description}."""
    # doc_text truncated to 8000 chars per batch
    # Prompt asks for JSON array with verdicts: compliant/partial/not_covered/not_applicable
    # temperature=0.1, format="json"
    # Resilient JSON parsing (strip markdown fences, regex fallback)

async def _run_batch_analysis(doc_text: str, controls: list, model: str) -> list[dict]:
    """Async wrapper: runs _call_ollama_batch in thread pool in batches of 25."""
    all_results = []
    for batch in chunks(controls, BATCH_SIZE):
        result = await asyncio.get_event_loop().run_in_executor(
            None, _call_ollama_batch, doc_text, batch, model
        )
        all_results.extend(result)
    return all_results
Verdict → ControlStatus mapping:

"compliant" → IMPLEMENTED
"partial" → PARTIALLY_IMPLEMENTED
"not_covered" → NOT_IMPLEMENTED
"not_applicable" → NOT_APPLICABLE
Gap severity: not_covered + must requirement → high; partial + must → medium; others → low

Compliance score: (implemented × 1.0 + partial × 0.5) / total_controls

Cross-framework coverage computation:
After analysis, for compliant/partial controls, read control.mapped_controls JSON (list of {framework, control}) and aggregate by framework name:


def compute_cross_framework_coverage(control_assessments, controls_map) -> dict:
    # Returns: {"NIST_CSF": {"covered": 12, "total_mapped": 18, "percent": 66.7, "controls": [...]}}
Phase 3 — Backend: AI Policy Generator
File: backend/app/api/v1/endpoints/ai.py — add endpoint + refactor

Changes:
Change DEFAULT_MODEL = "deepseek-v3.1:671b-cloud" (was deepseek-r1:1.5b)
Add optional system_prompt parameter to _blocking_stream() (default to existing SYSTEM_PROMPT)
Add _sse_generator_with_system(messages, model, system_prompt) wrapper
Add PolicyGenerateRequest schema: control_identifier, control_title, framework_short_name, control_description?, gap_description?, existing_context?, organization_context?, model?
Add POST /ai/generate-policy endpoint: builds specialized policy-generation prompt, streams SSE using same thread pool pattern
Policy system prompt: Expert GRC consultant writing complete, structured policy documents (purpose, scope, policy statements, procedures, roles, review cycle) in Markdown.

Phase 4 — Backend: Custom Framework Builder
File: backend/app/api/v1/endpoints/frameworks.py — add 5 new endpoints

New schemas:
FrameworkCreate: name, short_name, version, description, issuing_body, applicable_regions, applicable_industries
ControlCreate: control_id, title, description, guidance, category, tags
ControlUpdate: partial of ControlCreate fields
RequirementCreate: requirement_text, requirement_level (must/should/may)
New endpoints:
POST /frameworks — create custom framework (is_builtin=False, tenant_id=current, status=DRAFT); requires TENANT_ADMIN or CISO role
POST /frameworks/{id}/controls — add control; validates tenant owns framework
PATCH /frameworks/{id}/controls/{control_db_id} — update control
DELETE /frameworks/{id}/controls/{control_db_id} — delete control (status 204)
POST /frameworks/{id}/controls/{control_db_id}/requirements — add requirement
Helper: _get_tenant_framework(db, framework_id, tenant_id) — 404 if not found, 403 if builtin or wrong tenant

Phase 5 — Frontend: Shared SSE Utility
New file: frontend/src/lib/sse.ts

Extract from AIAssistant.tsx:

makeThinkFilter() — strips <think>...</think> blocks from streaming tokens
handleSseLine(line, callbacks, filter) — parses one SSE line
This avoids duplication in the new PolicyGeneratorModal.

Phase 6 — Frontend: TypeScript Types
File: frontend/src/types/index.ts — add at bottom:

UploadedDocument, ControlAssessmentDetail (with control_identifier, control_title, ai_confidence, cross_framework_coverage), GapDetail, CrossFrameworkCoverage, AssessmentDetail
FrameworkCreate, ControlCreate, RequirementCreate
PolicyGenerateRequest
Phase 7 — Frontend: API Endpoints
File: frontend/src/api/endpoints.ts

Replace stubbed complianceApi with full implementation:

listAssessments(), createAssessment(), getAssessment(), getResults()
uploadDocument(assessmentId, file) — FormData multipart
analyzeAssessment(assessmentId) — POST trigger
updateControlAssessment(id, data) — PATCH manual override
Add customFrameworkApi: create(), addControl(), updateControl(), deleteControl(), addRequirement()

Add aiApi.streamPolicyGeneration(request, onToken, onDone, signal) — fetch-based SSE stream

Phase 8 — Frontend: New Pages and Components
8.1 Update CompliancePage.tsx
Connect to real API: replace hardcoded ASSESSMENTS array with useEffect(() => complianceApi.listAssessments(), [])
"New Assessment" button → opens wizard modal (inline or extracted to AssessmentWizardModal.tsx)
Assessment cards are clickable → navigate to /compliance/:id
8.2 New page: AssessmentDetailPage.tsx (route: /compliance/:assessmentId)
Three tabs:

Upload & Analyze: File dropzone (accept .pdf,.docx,.txt), uploaded docs list, "Run AI Analysis" button with spinner ("Analyzing X controls...")
Results: Overall score badge + donut, controls table (ID | Title | Status badge | AI confidence | Gap desc | "Generate Policy" button), filter tabs (All/Compliant/Partial/Gaps)
Cross-Framework: Cards per framework found in cross_framework_summary, showing N/M controls covered + percentage bar
8.3 New component: PolicyGeneratorModal.tsx
Location: frontend/src/components/features/compliance/

Props: gap: GapDetail, frameworkShortName, assessmentContext?, onClose, onSavePolicy?
Modal: header showing control ID + title; left panel (gap context); right panel (streaming markdown output)
Uses makeThinkFilter + handleSseLine from lib/sse.ts
Buttons: Copy to clipboard, Save as Policy Draft (calls policiesApi.create()), Regenerate, Close
8.4 New page: CustomFrameworkPage.tsx (route: /frameworks/custom/new)
Two-section layout:

Section 1 — Metadata: name, short_name (auto-slugified), version, description, issuing body, regions checkboxes, "Save & Continue" button
Section 2 — Controls (shown after save): Left = control tree accordion; Right = "Add Control" form (ID, title, category dropdown, description, guidance, tags) + "Add Requirement" sub-form (text + must/should/may) + Save button; Controls appear in tree immediately; Edit/Delete per control
8.5 Update FrameworksPage.tsx
"Create Custom Framework" button (replaces "Request Framework") → navigates to /frameworks/custom/new
Custom tenant frameworks show "Custom" badge + edit pencil icon in the framework grid
8.6 Update App.tsx
Add routes (inside the authenticated layout):


<Route path="compliance/:assessmentId" element={<AssessmentDetailPage />} />
<Route path="frameworks/custom/new" element={<CustomFrameworkPage />} />
<Route path="frameworks/:frameworkId/edit" element={<CustomFrameworkPage />} />
Implementation Order

1. backend/app/models/compliance.py      — add UploadedDocument + ai_confidence field
2. backend/migrate.py                    — create new tables
3. backend/pyproject.toml               — add pypdf
4. backend/app/core/config.py           — add UPLOADS_DIR, OLLAMA settings
5. backend/app/api/v1/endpoints/compliance.py  — full implementation (largest file)
6. backend/app/api/v1/endpoints/ai.py   — add generate-policy, refactor system_prompt
7. backend/app/api/v1/endpoints/frameworks.py  — add custom framework CRUD
8. frontend/src/lib/sse.ts              — extract shared SSE utilities
9. frontend/src/types/index.ts          — add new interfaces
10. frontend/src/api/endpoints.ts       — update compliance/add new API groups
11. frontend/src/pages/CompliancePage.tsx — connect to real API
12. frontend/src/pages/AssessmentDetailPage.tsx — new page
13. frontend/src/components/features/compliance/PolicyGeneratorModal.tsx — new
14. frontend/src/pages/CustomFrameworkPage.tsx — new page
15. frontend/src/pages/FrameworksPage.tsx — add custom framework button
16. frontend/src/App.tsx                — add new routes
Critical Files
backend/app/api/v1/endpoints/compliance.py — core new backend logic
backend/app/models/compliance.py — add UploadedDocument model
backend/app/api/v1/endpoints/ai.py — refactor + add generate-policy
frontend/src/pages/AssessmentDetailPage.tsx — main UI for upload/analyze/results
frontend/src/components/features/compliance/PolicyGeneratorModal.tsx — AI policy streaming
Verification
Start backend: cd backend && uvicorn app.main:app --reload
Check Swagger: http://localhost:8000/api/v1/docs — verify new endpoints appear
Create assessment via POST /compliance/assessments
Upload test PDF (any policy document)
POST /compliance/assessments/{id}/analyze — wait for Ollama response (up to 2-3 min for cloud model)
GET /compliance/assessments/{id}/results — verify control verdicts + cross-framework summary
POST /ai/generate-policy with a gap — verify SSE streaming returns a policy document
POST /frameworks + add controls → verify custom framework appears in /frameworks
Frontend: navigate to http://localhost:3000, open Compliance, create new assessment, upload doc, run analysis, view results, open PolicyGeneratorModal
User approved the plan
This is a very large transformation — here is a clear summary of everything planned and what we're about to build:

Here's what we studied and what the full plan is
What we studied
The Excel file (ISO27001-Gap-Assessment-Template): 4 sheets — Dashboard, Pivots (section-by-section compliance % table), Requirements (124 rows: Category | Section | Ref | Assessment Question | Compliance status), Dropdowns. This is exactly what the new dashboard will replicate.
The PDF (MoS - ISO 27001 Mandatory Document List): 40+ mandatory documents mapped to clauses (e.g., Clause 4.3 → ISMS Scope Document, Clause 6.1.3 → Statement of Applicability, Clause 9.2 → Internal Audit Procedure/Schedule/Report).
The GRC Lab platform: 480+ controls, traceability matrix, missions, GRC coach, AI agent — gives us inspiration for the advanced features.
The 6 phases we're implementing
Phase 1 — Database + Backend Foundation
New DB columns on Tenant (framework selection), ComplianceGap (accept/reject workflow), UploadedDocument (clause mapping). Three new models: MandatoryDocument, ActionItem, AuditorAssignment. New endpoints: /auth/me, /assessments/{id}/document-checklist, gap recommendation, framework-summary dashboard, auditor portal, users management.

Phase 2 — 3-Step Registration Wizard
Step 1: account info + org size. Step 2: framework selection cards (primary = required, secondary = optional, smart recommendations based on industry/country). Step 3: review + launch. Auto-creates a compliance assessment on signup.

Phase 3 — Framework-Specific Dashboard
Replaces the generic dashboard with the ISO 27001 scorecard: 5 KPI cards, certification journey meter (0% → 100% Certified), section pivot table (exactly like the Excel — Clause 4-10 + A.5-A.8 with Fully/Partially/Not/NA counts + %), document upload progress, top 5 gaps.

Phase 4 — Document Checklist + Gap Report + Confirmations
New "Document Checklist" tab showing the 40 mandatory documents per clause with upload status. New "Gap Report" tab showing per-control status with [Accept ✓] [Reject ✗] buttons → GapConfirmModal → creates Action Items. 90-day Remediation Planner page (AI-streamed).

Phase 5 — Auditor Portal
Admin creates auditor accounts (4-step modal). Auditors see a restricted sidebar and portal with their assigned assessments, company evidence (read-only), audit checklist (mark Verified/Finding/Observation/N/A), and AI-generated audit report streaming.

Phase 6 — Next Level Features
Traceability Matrix (Risk → Control → Policy → Evidence → Finding), Compliance Journey Map (SVG timeline), Certification Readiness Score (weighted formula: 50% compliance + 30% docs + 20% blocker resolution), Document Intelligence (auto-detects which clauses an uploaded document covers).