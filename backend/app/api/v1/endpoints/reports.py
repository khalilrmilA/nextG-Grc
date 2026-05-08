"""Reports endpoints — generate and download PDF reports."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.dependencies.auth import get_current_user, get_tenant_id
from app.models.user import User
from app.models.tenant import Tenant
from app.services.report_generator import generate_report, REPORT_GENERATORS

router = APIRouter()


@router.get("/types")
async def list_report_types():
    """List all available report types."""
    return {
        "types": [
            {
                "id": "executive",
                "name": "Executive Summary",
                "description": "High-level overview of all GRC modules with KPIs",
                "icon": "layout",
            },
            {
                "id": "risk",
                "name": "Risk Register Report",
                "description": "Detailed risk register with top risks and upcoming reviews",
                "icon": "alert-triangle",
            },
            {
                "id": "compliance",
                "name": "Compliance Report",
                "description": "Compliance assessments, scores, and critical gaps",
                "icon": "check-square",
            },
            {
                "id": "vendor",
                "name": "3rd Party Risk Report",
                "description": "Vendor list, risk scores, and contracts pending review",
                "icon": "building",
            },
            {
                "id": "audit",
                "name": "Audit Report",
                "description": "Active audits and critical findings",
                "icon": "clipboard-list",
            },
        ]
    }


@router.get("/{report_type}/generate")
async def generate_and_download_report(
    report_type: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Generate and download a PDF report of the specified type."""
    if report_type not in REPORT_GENERATORS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown report type. Valid types: {list(REPORT_GENERATORS.keys())}",
        )

    # Get tenant name
    tenant_result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    tenant_name = tenant.name if tenant else "Organization"

    try:
        pdf_bytes = await generate_report(report_type, db, tenant_id, tenant_name)
    except Exception:
        import logging
        logging.getLogger(__name__).exception("report.generate.error report_type=%s", report_type)
        raise HTTPException(status_code=500, detail="Report generation failed")

    # Build filename with date
    from datetime import datetime
    date_str = datetime.utcnow().strftime("%Y-%m-%d")
    filename = f"{report_type}_report_{date_str}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get("/{report_type}/preview")
async def preview_report(
    report_type: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: str = Depends(get_tenant_id),
):
    """Preview a PDF report (inline display)."""
    if report_type not in REPORT_GENERATORS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown report type. Valid types: {list(REPORT_GENERATORS.keys())}",
        )

    tenant_result = await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    tenant = tenant_result.scalar_one_or_none()
    tenant_name = tenant.name if tenant else "Organization"

    try:
        pdf_bytes = await generate_report(report_type, db, tenant_id, tenant_name)
    except Exception:
        import logging
        logging.getLogger(__name__).exception("report.preview.error report_type=%s", report_type)
        raise HTTPException(status_code=500, detail="Report preview failed")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": "inline",
        },
    )
