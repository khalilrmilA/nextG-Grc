# GRC SaaS Platform - Complete Features Guide

## 📋 Table of Contents
1. [3rd Party Risk Management (TPRM)](#3rd-party-risk-management-tprm)
2. [Vendor Management](#vendor-management)
3. [Contract Management](#contract-management)
4. [AI-Powered Analysis](#ai-powered-analysis)
5. [Risk Assessment](#risk-assessment)

---

## 🏢 3rd Party Risk Management (TPRM)

### Overview
Complete vendor/3rd party risk management system with AI-powered analysis, questionnaires, and contract review capabilities.

### Access Points
- **Main Menu**: "3rd Parties (TPRM)" navigation item
- **URL**: `http://localhost:4000/vendors`

---

## 👥 Vendor Management

### Add New 3rd Party
**Location**: Click "Add 3rd Party" button on vendors page

**Form Fields**:
- **Name** (required): Vendor company name
- **Industry** (required): Select from 40+ industries:
  - Cloud Infrastructure, Telecommunications, Payment Processing, Healthcare Services, Financial Services, etc.
- **Country Code** (required): 2-letter code (US, SA, UK, etc.)
- **Risk Tier**: critical, high, medium, low
  - **Critical**: Access to core systems/sensitive data
  - **High**: Access to some systems
  - **Medium**: Limited access
  - **Low**: No system access
- **Status**: active, under_review, onboarding, offboarding, inactive
- **Risk Score**: 1-40 slider (1=lowest risk, 40=highest)
- **Contract Expiry Date**: When the vendor contract expires
- **DPA (Data Processing Agreement)**: Checkbox - required for GDPR compliance
- **Services Provided**: What services the vendor provides (e.g., "Cloud hosting", "Security monitoring")
- **Website**: Vendor's website URL
- **Notes**: Additional notes about the vendor
- **Contract File** (Optional): Upload PDF/TXT contract - AI will automatically review it

**After Creation**:
- Vendor appears in the vendors list
- If contract uploaded, AI review starts automatically in background

---

## 📄 Contract Management

### Upload Contract (During Vendor Creation or After)
**What Happens**:
1. Upload PDF or TXT file containing vendor contract
2. System extracts text from document
3. **AI automatically reviews** the contract with Ollama
4. Review includes:
   - Executive Summary
   - Key Findings
   - Data Protection & Privacy clauses
   - Liability & Insurance terms
   - Compliance & Standards requirements
   - Recommendations for negotiation
   - Overall Risk Assessment (LOW/MEDIUM/HIGH/CRITICAL)

### Contract Review Status
- **Pending**: Uploaded, waiting for AI review
- **Completed**: AI review finished, review available
- **Error**: Review failed (e.g., Ollama unavailable)

### View Contract Review
**Location**: Vendor detail modal
- Click on vendor card
- Contract review appears in blue section if available
- Shows full AI analysis

---

## 🤖 AI-Powered Analysis

### Risk Assessment Questionnaire
**Location**: Click vendor → "AI Risk Assessment" button

**Questionnaire Questions** (Radio buttons: Yes/No/N/A):
1. Does the 3rd party hold ISO 27001 certification?
2. Does the 3rd party hold SOC 2 Type II certification?
3. Does the 3rd party encrypt data at rest and in transit?
4. Does the 3rd party have a documented incident response plan?
5. Does the 3rd party conduct annual penetration testing?
6. Does the 3rd party have DPA in place?
7. Does the 3rd party have disaster recovery plan?
8. Does the 3rd party conduct security audits?
... and more

**AI Analysis Includes**:
- **Executive Summary**: 3-4 sentence overview of security posture
- **Risk Scoring Table**:
  - Overall Risk Score (X/10)
  - Compliance Readiness (X/10)
  - Incident Response Maturity (X/10)
  - Data Protection Level (X/10)
  - Third-Party Management (X/10)
- **Risk Tier Decision Matrix**:
  - 9-10: CRITICAL - Do not engage without mitigation
  - 7-8: HIGH - Engage with strict controls
  - 5-6: MEDIUM - Acceptable with standard controls
  - 1-4: LOW - Minimal risk
- **Domain Assessment** (6 areas):
  1. Compliance & Standards (ISO, SOC2, GDPR, etc.)
  2. Data Protection & Encryption
  3. Access Controls & Authentication
  4. Incident Response & Breach Notification
  5. Business Continuity & Disaster Recovery
  6. Third-Party & Sub-processor Management
- **Key Risks Identified**: Critical, High, and Medium-risk items
- **Recommendations**: Immediate, Short-term, and Long-term actions
- **Contract & SLA Requirements**: Specific clauses to include
- **Monitoring & Reassessment Plan**: With frequency matrix

**Web Search Integration**:
- Automatically searches for vendor security information
- Includes certifications, incidents, compliance status
- Shows top 5 results with titles, snippets, and sources
- AI incorporates findings into assessment

---

## 📊 Risk Assessment Flow

### Step 1: Add Vendor
- Fill in vendor information
- (Optional) Upload contract for automatic AI review

### Step 2: Complete Questionnaire
- Click vendor → "AI Risk Assessment"
- Answer security questionnaire (Yes/No/N/A)
- AI combines responses + web search + contract info

### Step 3: Review AI Analysis
- Modal shows comprehensive risk assessment
- Displays:
  - Scoring table with metrics
  - Domain-by-domain analysis
  - Key risks ranked by severity
  - Specific recommendations
  - Contract requirements
  - Monitoring plan

### Step 4: Approve & Save
- Click "Approve & Save" button (green)
- AI extracts risk score from analysis
- Risk score saved to vendor record
- Analysis stored in database
- Modal auto-closes after 2 seconds

### Step 5: View Saved Assessment
- Click vendor again
- See:
  - **Risk Score** displayed prominently
  - **AI Risk Assessment Result** in blue box
  - Previous analysis automatically loaded
  - Can regenerate new analysis anytime

---

## 🔍 Vendor Detail View

**What You See When Clicking a Vendor**:

### Header Section
- Vendor name
- Risk tier badge (Critical/High/Medium/Low)
- Status badge (Active/Under Review/Onboarding/etc.)
- Country flag

### Stats Section (3 columns)
1. **Risk Score**: X/10 (color-coded)
2. **DPA Status**: ✓ Signed or ✗ Missing (with warning if missing)
3. **Contract Expiry**: Date when contract ends

### Information Section
- **Industry**: What sector they operate in
- **Services Provided**: What they provide to you
- **Website**: Link to their website

### Contract Review (if available)
- **Blue highlighted section** with full AI analysis
- Scrollable text (max height so it doesn't take up too much space)
- Shows sections from AI review

### Actions
- **AI Risk Assessment Button**: Run new analysis or view saved one

---

## 📈 Vendor List & Filtering

### Columns Displayed
1. **Name & Details**: Vendor name, status, industry, country
2. **Risk Tier**: visual badge (color-coded)
3. **Status**: Current status
4. **Risk Score**: Numeric score with icon if >20
5. **DPA**: ✓ or ✗ icon
6. **Contract Expiry**: Date
7. **Services**: What they provide
8. **Actions**: Expand to view details

### Filtering
- **Search Bar**: Search by vendor name
- **Risk Tier Filter**: Show only Critical/High/Medium/Low
- **Status Filter**: Show only Active/Under Review/etc.

---

## 🔐 Data Security Features

### Compliance
- **Multi-tenant**: Each organization's data isolated
- **JWT Authentication**: Secure token-based access
- **Row-level Security**: Only see your organization's vendors
- **Encryption**: Data at rest and in transit

### Data Fields Protected
- Risk scores and assessments
- Contract documents
- AI reviews
- Questionnaire responses
- Web search results

---

## 🚀 Technology Stack

### Backend (Python FastAPI)
- **Framework**: FastAPI with async/await
- **Database**: SQLite (dev) / PostgreSQL (prod)
- **ORM**: SQLAlchemy async
- **AI**: Ollama (local) running at `http://localhost:11434`
- **Model**: deepseek-v3.1:671b-cloud
- **File Processing**: PyPDF2 for contract text extraction
- **Web Search**: DuckDuckGo API

### Frontend (React + TypeScript)
- **Framework**: React 18
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **HTTP Client**: Axios with React Query
- **State**: Zustand (auth), React hooks (local)
- **i18n**: react-i18next (English, French, Arabic)

### Database Models
- **Vendor**: Core vendor data
- **VendorAssessment**: Security questionnaire responses
- **VendorContract**: Uploaded contracts and AI reviews
- **VendorRisk**: Risk items associated with vendors

---

## 📝 API Endpoints (3rd Party/Vendor)

### Create
`POST /api/v1/vendors`
- Create new vendor
- Returns vendor object with ID

### List
`GET /api/v1/vendors`
- Get all vendors for organization
- Filtered by tenant

### Get
`GET /api/v1/vendors/{vendor_id}`
- Get specific vendor details
- Includes description (AI analysis)

### Update
`PATCH /api/v1/vendors/{vendor_id}`
- Update vendor information

### Delete
`DELETE /api/v1/vendors/{vendor_id}`
- Remove vendor

### Analyze
`POST /api/v1/vendors/{vendor_id}/analyze`
- Run AI analysis with web search
- Stores analysis to vendor.description
- Request: `{ questionnaire_responses: { "Q": "A" } }`

### Approve Analysis
`POST /api/v1/vendors/{vendor_id}/approve-analysis`
- Save approved risk score
- Updates vendor.risk_score
- Request: `{ risk_score: 7.5, analysis_notes: "..." }`

### Upload Contract
`POST /api/v1/vendors/{vendor_id}/upload-contract`
- Upload contract file (PDF/TXT)
- Extracts text automatically
- Triggers AI review (background)
- Returns contract object with status

---

## 🎯 Common Workflows

### Workflow 1: Onboard New Vendor with Contract
1. Click "Add 3rd Party"
2. Fill vendor info
3. Upload contract (PDF)
4. Click Save
5. Vendor created + contract queued for AI review
6. Check back in a minute to see contract review

### Workflow 2: Assess Vendor Risk
1. Click existing vendor
2. Click "AI Risk Assessment"
3. Answer security questionnaire
4. Click "Run AI 3rd Party Risk Assessment"
5. Wait for AI analysis
6. Review results
7. Click "Approve & Save"
8. Risk score updated in database

### Workflow 3: View Previous Assessment
1. Click vendor
2. See "AI Risk Assessment Result" in blue box
3. Previous analysis automatically displayed
4. Can run new analysis anytime

### Workflow 4: Monitor High-Risk Vendors
1. Filter by Risk Tier = "Critical" or "High"
2. See all high-risk vendors
3. Check contract expiry dates
4. Review latest assessments
5. Update status to trigger re-assessment

---

## ⚙️ Configuration

### Backend Settings (`backend/app/core/config.py`)
```python
# Ollama Configuration
OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_CHAT_MODEL = "deepseek-v3.1:671b-cloud"

# Database
DATABASE_URL = "sqlite+aiosqlite:///./grc_dev.db"

# API
API_V1_PREFIX = "/api/v1"
SECRET_KEY = "change-me-in-production"
```

### Frontend Settings (`.env`)
```
VITE_API_URL=http://localhost:8000/api/v1
```

---

## 🐛 Troubleshooting

### AI Analysis Not Running
- Check Ollama is running: `http://localhost:11434/api/tags`
- Verify model exists: `deepseek-v3.1:671b-cloud`
- Check backend logs for errors

### Contract Review Shows "Pending"
- AI review runs in background
- Refresh page after 30 seconds
- Check backend logs if status stuck

### Analysis Not Saving Risk Score
- Make sure "Approve & Save" button clicked
- Check score format in analysis (should contain "Score: X/10")
- Verify database connection

### File Upload Fails
- Only PDF and TXT supported
- File size limit: 50MB
- Check upload directory has write permissions

---

## 📱 Responsive Design
- Works on Desktop, Tablet, Mobile
- Modals adapt to screen size
- Touch-friendly buttons and inputs
- Scrollable content on small screens

---

## 🌍 Internationalization
- **Languages Supported**: English (en), French (fr), Arabic (ar)
- **Language Switcher**: Top right of every page
- **All Labels Translated**: Questionnaire, buttons, messages

---

## 📊 Future Enhancements

### Potential Features
- Vendor risk dashboard with charts
- Export vendor assessments to PDF
- Scheduled re-assessments
- Vendor scorecard comparison
- Risk trend analysis
- Integration with other GRC modules (risks, compliance)
- Bulk vendor import/export
- Custom questionnaire templates
- Vendor SLA tracking
- Incident tracking per vendor

---

## 🔗 Related Features in GRC Platform

### Risk Management
- Register and track risks by category
- Assign severity and probability
- Track treatment plans

### Compliance Management
- Multi-framework assessments
- Control mapping and tracking
- Gap analysis and reporting
- Evidence file attachments

### Policy Management
- Policy templates
- Version control
- Attestation workflows

### Audit Management
- Audit planning and scheduling
- Finding documentation
- Evidence collection

---

## 📞 Support & Documentation

### Key Files to Check
- `backend/app/api/v1/endpoints/vendors.py` - All vendor endpoints
- `backend/app/models/vendor.py` - Data models
- `frontend/src/pages/VendorsPage.tsx` - Main vendor UI
- `frontend/src/components/ai/VendorAIModal.tsx` - AI analysis modal
- `frontend/src/api/endpoints.ts` - API client methods

### Running Locally
```bash
# Backend (Terminal 1)
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000

# Frontend (Terminal 2)
cd frontend
npm install
npm run dev -- --port 4000

# Ollama (Terminal 3)
ollama serve
```

### Database
- Location: `backend/grc_dev.db`
- Type: SQLite (dev), PostgreSQL (prod)
- Tables: vendors, vendor_assessments, vendor_contracts, vendor_risks

---

**Last Updated**: April 2026  
**Version**: 1.0.0  
**Status**: Production Ready ✅
