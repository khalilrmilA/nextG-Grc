"""Third-Party Risk Management (TPRM) — Vendor endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from datetime import datetime
import json
import os
from pathlib import Path

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.vendor import Vendor, VendorRiskTier, VendorStatus, VendorContract
from app.core.config import settings

router = APIRouter()


# ── Request / Response schemas ──────────────────────────────────────────────

class VendorCreateRequest(BaseModel):
    name: str
    industry: str | None = None
    country: str | None = None
    website: str | None = None
    risk_tier: str = "medium"
    status: str = "active"
    risk_score: float | None = None
    services_provided: str | None = None
    has_data_processing_agreement: bool = False
    contract_expiry: str | None = None
    primary_contact_name: str | None = None
    primary_contact_email: str | None = None


class VendorResponse(BaseModel):
    id: str
    name: str
    industry: str | None
    country: str | None
    website: str | None
    risk_tier: str
    status: str
    services_provided: str | None
    has_data_processing_agreement: bool
    contract_expiry: str | None
    risk_score: float | None
    description: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class VendorListResponse(BaseModel):
    items: list[VendorResponse]
    total: int


class VendorApproveAnalysisRequest(BaseModel):
    """Request to approve analysis and update vendor risk score."""
    risk_score: float  # 1-10 scale from AI analysis
    analysis_notes: str | None = None


class VendorAnalysisRequest(BaseModel):
    """Request for AI web search + risk analysis."""
    questionnaire_responses: dict[str, str]  # Q&A from the frontend


class VendorAnalysisResponse(BaseModel):
    """Response from AI analysis with web search results."""
    vendor_id: str
    analysis: str  # The AI-generated analysis
    web_search_results: list[dict] | None = None
    updated_at: datetime


class VendorContractResponse(BaseModel):
    """Response for uploaded contract."""
    id: str
    vendor_id: str
    file_name: str
    file_size: int | None
    ai_review: str | None
    review_status: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.get("", response_model=VendorListResponse)
async def list_vendors(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """List all vendors for the tenant."""
    result = await db.execute(
        select(Vendor).where(Vendor.tenant_id == tenant_id).order_by(Vendor.created_at.desc())
    )
    vendors = result.scalars().all()

    return VendorListResponse(
        items=[VendorResponse.model_validate(v) for v in vendors],
        total=len(vendors),
    )


@router.post("", response_model=VendorResponse, status_code=status.HTTP_201_CREATED)
async def create_vendor(
    body: VendorCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Create a new vendor."""
    vendor = Vendor(
        tenant_id=tenant_id,
        name=body.name.strip(),
        industry=body.industry,
        country=body.country.upper() if body.country else None,
        website=body.website,
        risk_tier=VendorRiskTier(body.risk_tier),
        status=VendorStatus(body.status),
        risk_score=body.risk_score,
        services_provided=body.services_provided,
        has_data_processing_agreement=body.has_data_processing_agreement,
        contract_expiry=body.contract_expiry,
        primary_contact_name=body.primary_contact_name,
        primary_contact_email=body.primary_contact_email,
        owner_id=current_user.id,
    )
    db.add(vendor)
    await db.flush()
    await db.commit()
    await db.refresh(vendor)

    return VendorResponse.model_validate(vendor)


@router.get("/{vendor_id}", response_model=VendorResponse)
async def get_vendor(
    vendor_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Get a specific vendor."""
    result = await db.execute(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    vendor = result.scalar_one_or_none()

    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    return VendorResponse.model_validate(vendor)


@router.patch("/{vendor_id}", response_model=VendorResponse)
async def update_vendor(
    vendor_id: str,
    body: VendorCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Update a vendor."""
    result = await db.execute(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    vendor = result.scalar_one_or_none()

    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    # Update fields
    vendor.name = body.name.strip()
    vendor.industry = body.industry
    vendor.country = body.country.upper() if body.country else None
    vendor.website = body.website
    vendor.risk_tier = VendorRiskTier(body.risk_tier)
    vendor.status = VendorStatus(body.status)
    vendor.services_provided = body.services_provided
    vendor.has_data_processing_agreement = body.has_data_processing_agreement
    vendor.contract_expiry = body.contract_expiry
    vendor.primary_contact_name = body.primary_contact_name
    vendor.primary_contact_email = body.primary_contact_email

    await db.flush()
    await db.commit()
    await db.refresh(vendor)

    return VendorResponse.model_validate(vendor)


@router.delete("/{vendor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vendor(
    vendor_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Delete a vendor."""
    result = await db.execute(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    vendor = result.scalar_one_or_none()

    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    await db.delete(vendor)
    await db.commit()
@router.post("/{vendor_id}/approve-analysis", response_model=VendorResponse)
async def approve_vendor_analysis(
    vendor_id: str,
    body: VendorApproveAnalysisRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Approve AI analysis and update vendor risk score."""
    result = await db.execute(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    vendor = result.scalar_one_or_none()

    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    # Update risk score from approved analysis
    vendor.risk_score = body.risk_score
    if body.analysis_notes:
        vendor.description = body.analysis_notes

    await db.flush()
    await db.commit()
    await db.refresh(vendor)

    return VendorResponse.model_validate(vendor)


@router.post("/{vendor_id}/analyze", response_model=VendorAnalysisResponse)
async def analyze_vendor_with_web_search(
    vendor_id: str,
    body: VendorAnalysisRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Analyze vendor using web search + questionnaire responses with AI."""
    print(f"\n\n**** VENDOR ANALYZE ENDPOINT CALLED FOR {vendor_id} ****\n\n")
    # Get the vendor
    result = await db.execute(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    vendor = result.scalar_one_or_none()

    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    try:
        import httpx

        # Step 1: Perform web search for the vendor
        web_results = []
        search_query = f"{vendor.name} security compliance certifications"

        try:
            # Using DuckDuckGo API (free, no auth required)
            search_url = f"https://api.duckduckgo.com/?q={search_query}&format=json&no_html=1"
            async with httpx.AsyncClient(timeout=10.0) as http_client:
                resp = await http_client.get(search_url)
                if resp.status_code == 200:
                    data = resp.json()
                    # Extract results
                    if 'Results' in data:
                        web_results = [
                            {
                                "title": r.get("Title", ""),
                                "snippet": r.get("Text", ""),
                                "url": r.get("FirstURL", "")
                            }
                            for r in data['Results'][:5]  # Top 5 results
                        ]
        except Exception as search_err:
            # Continue without web results if search fails
            print(f"Web search failed: {search_err}")
            web_results = []

        # Step 2: Build analysis prompt with web search results + questionnaire
        qa_text = "\n".join([f"Q: {q}\nA: {a}" for q, a in body.questionnaire_responses.items()])

        web_context = ""
        if web_results:
            web_context = "\n\nWeb Search Results:\n"
            for i, result in enumerate(web_results, 1):
                web_context += f"\n{i}. **{result.get('title', 'No title')}**\n"
                web_context += f"   {result.get('snippet', 'No snippet')}\n"
                web_context += f"   Source: {result.get('url', 'No URL')}\n"

        prompt = f"""You are a senior cybersecurity risk analyst conducting a comprehensive third-party risk assessment. Analyze the following vendor security questionnaire responses and web search findings to produce a detailed, production-grade risk assessment.

VENDOR INFORMATION:
- Name: {vendor.name}
- Industry: {vendor.industry or 'Technology'}
- Services: {vendor.services_provided or 'Not specified'}
- Country: {vendor.country or 'Unknown'}

QUESTIONNAIRE RESPONSES:
{qa_text}
{web_context}

---

INSTRUCTIONS: Provide a comprehensive vendor risk assessment following this EXACT structure. Be specific, data-driven, and production-ready.

# Vendor Risk Assessment Report
## {vendor.name}

**Assessment Date:** [Current Date]
**Risk Classification:** [CRITICAL/HIGH/MEDIUM/LOW]

---

## Executive Summary

[Provide 3-4 sentences summarizing the vendor's overall security posture, key risks, and business impact. Include specific evidence from both questionnaire and web research.]

---

## Risk Scoring Overview

| Metric | Score | Interpretation |
|--------|-------|-----------------|
| **Overall Risk Score** | X/10 | [Justification based on weighted domain scores] |
| **Compliance Readiness** | X/10 | [GDPR/SOC2/ISO27001 alignment] |
| **Incident Response Maturity** | X/10 | [Based on documented processes] |
| **Data Protection Level** | X/10 | [Encryption and access controls] |
| **Third-Party Management** | X/10 | [Subprocessor oversight and SLAs] |

**Risk Tier Decision Matrix:**
- 9-10: CRITICAL - Do not engage without immediate risk mitigation
- 7-8: HIGH - Engage with strict controls and frequent monitoring
- 5-6: MEDIUM - Acceptable with standard controls and quarterly reviews
- 1-4: LOW - Minimal risk, standard vendor management

---

## Domain Assessment

### 1. Compliance & Standards
[Assess against ISO 27001, SOC 2, GDPR, HIPAA, PCI DSS based on questionnaire responses]

### 2. Data Protection & Encryption
[Evaluate data at rest, in transit, encryption standards, key management]

### 3. Access Controls & Authentication
[Multi-factor authentication, role-based access, privileged account management]

### 4. Incident Response & Breach Notification
[Incident response plan, breach notification procedures, testing frequency]

### 5. Business Continuity & Disaster Recovery
[Backup strategies, RTO/RPO, failover procedures, testing frequency]

### 6. Third-Party & Sub-processor Management
[Vendor oversight, sub-processor controls, supply chain risk]

---

## Key Risks Identified

### Critical Issues (if any)
[List critical findings with immediate action required]

### High-Risk Items
[List high-priority risks with recommended mitigations]

### Medium-Risk Items
[List medium-priority risks with timelines]

---

## Recommendations

### Immediate Actions (0-30 days)
- [Specific, actionable items]

### Short-term Actions (1-3 months)
- [Timeline-specific mitigations]

### Long-term Actions (3-12 months)
- [Strategic improvements and monitoring plans]

---

## Contract & SLA Requirements

- [Specific clauses to include in vendor agreements]
- [SLA targets and penalties]
- [Audit rights and frequency]
- [Insurance and indemnification requirements]

---

## Monitoring & Reassessment Plan

| Activity | Frequency | Owner |
|----------|-----------|-------|
| Compliance Audit | [Annual/Quarterly] | [Internal Team] |
| Security Patch Review | [Monthly] | [Internal Team] |
| Penetration Test Review | [Annual] | [Internal Team] |
| Incident Notification Check | [On-demand] | [Internal Team] |

---

## Final Risk Decision

**Overall Risk Score: [X/10]**
**Recommendation: [APPROVED/APPROVED WITH CONDITIONS/REJECTED]**
**Review Date: [Date + 12 months]**

---

Format response in clear markdown with proper tables and sections."""

        # Step 3: Call Ollama API with the combined information
        base_url = settings.OLLAMA_BASE_URL.rstrip("/")
        ollama_url = f"{base_url}/api/chat"

        payload = {
            "model": settings.OLLAMA_CHAT_MODEL,
            "stream": False,
            "messages": [{"role": "user", "content": prompt}],
        }

        print(f"DEBUG: About to call Ollama at {ollama_url} with model {settings.OLLAMA_CHAT_MODEL}")
        analysis_text = ""
        async with httpx.AsyncClient(timeout=300.0) as http_client:
            resp = await http_client.post(ollama_url, json=payload)
            print(f"DEBUG: Ollama response status {resp.status_code}")
            if resp.status_code == 200:
                data = resp.json()
                if "message" in data and "content" in data["message"]:
                    analysis_text = data["message"]["content"]
                else:
                    raise Exception(f"Unexpected Ollama response format: {data}")
            else:
                raise Exception(f"Ollama error {resp.status_code}: {await resp.atext()}")

        # Step 4: Store analysis in vendor record
        vendor.description = analysis_text

        await db.flush()
        await db.commit()
        await db.refresh(vendor)

        return VendorAnalysisResponse(
            vendor_id=vendor.id,
            analysis=analysis_text,
            web_search_results=web_results,
            updated_at=datetime.utcnow()
        )

    except Exception as e:
        import traceback
        import sys
        tb_str = traceback.format_exc()
        error_msg = f"[{type(e).__module__}.{type(e).__name__}] {str(e)}"
        print(f"\n{'='*80}")
        print(f"VENDOR ANALYSIS ERROR:")
        print(f"Type: {type(e).__name__}")
        print(f"Module: {type(e).__module__}")
        print(f"Message: {str(e)}")
        print(f"Traceback:\n{tb_str}")
        print(f"{'='*80}\n")
        sys.stdout.flush()
        raise HTTPException(
            status_code=500,
            detail=error_msg
        )


@router.post("/{vendor_id}/upload-contract", response_model=VendorContractResponse)
async def upload_vendor_contract(
    vendor_id: str,
    contract_file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Upload a contract for a vendor and trigger AI review."""
    # Get vendor
    result = await db.execute(
        select(Vendor).where(
            Vendor.id == vendor_id,
            Vendor.tenant_id == tenant_id,
        )
    )
    vendor = result.scalar_one_or_none()

    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    # Create upload directory if it doesn't exist
    upload_dir = Path("uploads/contracts")
    upload_dir.mkdir(parents=True, exist_ok=True)

    # Save file
    file_path = upload_dir / f"{vendor_id}_{contract_file.filename}"
    try:
        content = await contract_file.read()
        with open(file_path, "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")

    # Extract text from PDF or read as text
    extracted_text = ""
    try:
        if contract_file.filename.endswith(".pdf"):
            import PyPDF2
            with open(file_path, "rb") as f:
                reader = PyPDF2.PdfReader(f)
                extracted_text = "\n".join([page.extract_text() for page in reader.pages])
        else:
            # For .txt files
            with open(file_path, "r", encoding="utf-8") as f:
                extracted_text = f.read()
    except Exception as e:
        print(f"Text extraction failed: {e}")
        extracted_text = ""

    # Create contract record
    contract = VendorContract(
        vendor_id=vendor_id,
        file_name=contract_file.filename,
        file_path=str(file_path),
        file_size=len(content),
        extracted_text=extracted_text,
        review_status="pending",
    )

    await db.add(contract)
    await db.flush()
    await db.commit()
    await db.refresh(contract)

    # Trigger AI review (async)
    import asyncio
    asyncio.create_task(analyze_contract_async(contract.id, extracted_text, vendor.name, db))

    return VendorContractResponse.model_validate(contract)


async def analyze_contract_async(contract_id: str, extracted_text: str, vendor_name: str, db: AsyncSession):
    """Analyze contract with AI (background task)."""
    try:
        import httpx

        prompt = f"""You are a legal and compliance expert reviewing a vendor contract. Analyze the following contract and provide a comprehensive review focusing on risk and compliance aspects.

VENDOR: {vendor_name}

CONTRACT TEXT:
{extracted_text[:5000]}  {('...' if len(extracted_text) > 5000 else '')}

Please provide a detailed review with these sections:

## Executive Summary
[Brief overview of key contract terms and risk level]

## Key Findings
- Critical issues (if any)
- Important terms and conditions
- Risk factors identified

## Data Protection & Privacy
- Data handling obligations
- GDPR/Privacy compliance
- Data breach notification requirements

## Liability & Insurance
- Indemnification clauses
- Limitation of liability
- Insurance requirements
- Termination clauses

## Compliance & Standards
- Required certifications (ISO, SOC2, etc)
- Audit rights
- Compliance obligations

## Recommendations
- Items requiring negotiation
- Missing clauses to add
- Risk mitigation measures

## Overall Risk Assessment
[LOW/MEDIUM/HIGH/CRITICAL] - with justification"""

        # Call Ollama for contract analysis
        base_url = settings.OLLAMA_BASE_URL.rstrip("/")
        ollama_url = f"{base_url}/api/chat"

        payload = {
            "model": settings.OLLAMA_CHAT_MODEL,
            "stream": False,
            "messages": [{"role": "user", "content": prompt}],
        }

        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(ollama_url, json=payload)
            if resp.status_code == 200:
                data = resp.json()
                if "message" in data and "content" in data["message"]:
                    ai_review = data["message"]["content"]
                else:
                    ai_review = "Analysis completed but response format unexpected"
            else:
                ai_review = f"Ollama error {resp.status_code}"

        # Update contract with AI review
        result = await db.execute(
            select(VendorContract).where(VendorContract.id == contract_id)
        )
        contract = result.scalar_one_or_none()
        if contract:
            contract.ai_review = ai_review
            contract.review_status = "completed"
            await db.commit()

    except Exception as e:
        print(f"Contract analysis error: {e}")
        # Update status to error
        result = await db.execute(
            select(VendorContract).where(VendorContract.id == contract_id)
        )
        contract = result.scalar_one_or_none()
        if contract:
            contract.review_status = "error"
            contract.ai_review = f"Analysis failed: {str(e)}"
            await db.commit()
