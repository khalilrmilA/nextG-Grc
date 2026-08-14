"""OCR endpoints (Elite Pack, RFP prescription 11) — extract text from scans.

Gated behind require_feature("ocr_capture"). Accepts a scanned image **or a PDF**
and returns the recognised text (French + English by default). PDFs reuse their
embedded text layer when they have one and are OCR'd page by page when they are
scans. tesseract runs in a worker thread so it never blocks the event loop.
"""
import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel

from app.core.config import settings
from app.models.user import User
from app.api.v1.dependencies.features import require_feature
from app.services.ocr_service import (
    DEFAULT_LANG,
    OcrUnavailableError,
    available_languages,
    engine_status,
    extract_document,
)

router = APIRouter()

_GATE = require_feature("ocr_capture")

# Scanned PDFs blow past the platform-wide 2 MB upload cap, so OCR carries its own.
MAX_PAGES = 20


class OcrPageOut(BaseModel):
    page: int
    method: str
    chars: int
    text: str


class OcrOut(BaseModel):
    lang: str
    kind: str
    method: str
    chars: int
    page_count: int
    total_pages: int
    truncated: bool
    text: str
    pages: list[OcrPageOut]


class OcrLangsOut(BaseModel):
    languages: list[str]


class OcrStatusOut(BaseModel):
    ocr_available: bool
    languages: list[str]
    selectable_languages: list[str]
    pdf_text_layer: bool
    pdf_scanned: bool
    max_upload_mb: int
    max_pages: int


@router.get("/languages", response_model=OcrLangsOut)
async def languages(current_user: Annotated[User, Depends(_GATE)]):
    return OcrLangsOut(languages=available_languages())


@router.get("/status", response_model=OcrStatusOut)
async def status(current_user: Annotated[User, Depends(_GATE)]):
    """What this host can do: engine, language packs, PDF support, limits."""
    return OcrStatusOut(
        **engine_status(),
        max_upload_mb=settings.OCR_MAX_UPLOAD_SIZE_MB,
        max_pages=MAX_PAGES,
    )


@router.post("/extract", response_model=OcrOut)
async def extract(
    current_user: Annotated[User, Depends(_GATE)],
    lang: Annotated[str, Form()] = DEFAULT_LANG,
    file: UploadFile = File(...),
):
    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file")
    max_bytes = settings.OCR_MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(413, f"File exceeds {settings.OCR_MAX_UPLOAD_SIZE_MB} MB limit")
    try:
        result = await asyncio.to_thread(
            extract_document,
            content,
            lang,
            file.filename,
            file.content_type,
            MAX_PAGES,
        )
    except OcrUnavailableError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:  # noqa: BLE001 — surface a clean 422, no 500
        raise HTTPException(422, f"OCR failed: {type(exc).__name__}: {exc}")
    return OcrOut(chars=len(result["text"]), **result)


class OcrPdfIn(BaseModel):
    text: str
    filename: str | None = None
    title: str | None = None


def _render_text_pdf(text: str, title: str = "Extracted Text") -> bytes:
    """Render extracted text into a clean, paginated PDF (ReportLab).

    Prefers a Unicode TTF (DejaVuSans) so French accents and most scripts render;
    falls back to Helvetica (Latin-1) when no TTF is on the host.
    """
    import io
    import os
    from xml.sax.saxutils import escape

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    font_name = "Helvetica"
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ):
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont("OcrBody", path))
                font_name = "OcrBody"
                break
            except Exception:  # noqa: BLE001 — fall back to Helvetica
                pass

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4, title=title,
        topMargin=2 * cm, bottomMargin=2 * cm, leftMargin=2 * cm, rightMargin=2 * cm,
    )
    styles = getSampleStyleSheet()
    head = styles["Title"]; head.fontName = font_name
    body = styles["BodyText"]; body.fontName = font_name; body.fontSize = 10; body.leading = 14

    story = [Paragraph(escape(title), head), Spacer(1, 0.4 * cm)]
    for line in (text or "").split("\n"):
        if line.strip():
            story.append(Paragraph(escape(line), body))
        else:
            story.append(Spacer(1, 0.25 * cm))
    if len(story) <= 2:
        story.append(Paragraph("(no text)", body))
    doc.build(story)
    return buf.getvalue()


@router.post("/export-pdf")
async def export_pdf(body: OcrPdfIn, current_user: Annotated[User, Depends(_GATE)]):
    """Turn extracted text into a downloadable PDF."""
    if not (body.text or "").strip():
        raise HTTPException(400, "No text to export")
    pdf = await asyncio.to_thread(_render_text_pdf, body.text, body.title or "Extracted Text")
    stem = (body.filename or "extraction").rsplit(".", 1)[0] or "extraction"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{stem}.pdf"'},
    )
