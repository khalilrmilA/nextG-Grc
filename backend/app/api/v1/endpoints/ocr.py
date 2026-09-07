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
    build_searchable_pdf,
    engine_status,
    extract_document,
    shape_rtl,
)

router = APIRouter()

_GATE = require_feature("ocr_capture")

# Scanned PDFs blow past the platform-wide 2 MB upload cap, so OCR carries its own.
# 40 pages covers a full RFP/tender while keeping a single synchronous request bounded.
MAX_PAGES = 40


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
    # Reject filenames whose extension must never reach the uploads
    # volume — see security_utils.DANGEROUS_UPLOAD_EXTENSIONS.
    assert_safe_upload_name(file.filename, field_name="file")
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


def _has_arabic(text: str) -> bool:
    return any("؀" <= ch <= "ۿ" or "ݐ" <= ch <= "ݿ" for ch in (text or ""))


def _render_text_pdf(text: str, title: str = "Extracted Text") -> bytes:
    """Render extracted text into a clean, paginated PDF (ReportLab).

    Latin text uses a Unicode TTF (DejaVuSans) so French accents render. Arabic
    lines are reshaped + bidi-reordered and set in Amiri, right-aligned — so a
    mixed FR/AR extraction comes out readable in both scripts.
    """
    import io
    import os
    from xml.sax.saxutils import escape

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import cm
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    latin_font = "Helvetica"
    for path in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ):
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont("OcrBody", path))
                latin_font = "OcrBody"
                break
            except Exception:  # noqa: BLE001 — fall back to Helvetica
                pass

    arabic_font = latin_font
    for path in (
        "/usr/share/fonts/opentype/fonts-hosny-amiri/Amiri-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if os.path.exists(path):
            try:
                pdfmetrics.registerFont(TTFont("OcrArabic", path))
                arabic_font = "OcrArabic"
                break
            except Exception:  # noqa: BLE001
                pass

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4, title=title,
        topMargin=2 * cm, bottomMargin=2 * cm, leftMargin=2 * cm, rightMargin=2 * cm,
    )
    styles = getSampleStyleSheet()
    head = styles["Title"]
    head.fontName = arabic_font if _has_arabic(title) else latin_font
    body = ParagraphStyle("OcrLatin", parent=styles["BodyText"], fontName=latin_font, fontSize=10, leading=14)
    body_ar = ParagraphStyle("OcrRtl", parent=body, fontName=arabic_font, alignment=TA_RIGHT, wordWrap="RTL")

    story = [Paragraph(escape(shape_rtl(title)), head), Spacer(1, 0.4 * cm)]
    for line in (text or "").split("\n"):
        if line.strip():
            if _has_arabic(line):
                story.append(Paragraph(escape(shape_rtl(line)), body_ar))
            else:
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


@router.post("/searchable-pdf")
async def searchable_pdf(
    current_user: Annotated[User, Depends(_GATE)],
    lang: Annotated[str, Form()] = DEFAULT_LANG,
    file: UploadFile = File(...),
):
    """Rebuild a scanned (image-only) document as a *searchable* PDF.

    Keeps every page's picture but adds an invisible OCR text layer, so a file
    that was "all screenshots" (e.g. a scanned tender) becomes a full,
    selectable, searchable PDF. Digital pages are copied through untouched.
    """
    # Reject filenames whose extension must never reach the uploads
    # volume — see security_utils.DANGEROUS_UPLOAD_EXTENSIONS.
    assert_safe_upload_name(file.filename, field_name="file")
    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file")
    max_bytes = settings.OCR_MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(413, f"File exceeds {settings.OCR_MAX_UPLOAD_SIZE_MB} MB limit")
    try:
        result = await asyncio.to_thread(
            build_searchable_pdf, content, lang, file.filename, file.content_type, MAX_PAGES,
        )
    except OcrUnavailableError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:  # noqa: BLE001 — surface a clean 422, no 500
        raise HTTPException(422, f"Searchable-PDF build failed: {type(exc).__name__}: {exc}")
    stem = (file.filename or "document").rsplit(".", 1)[0] or "document"
    return Response(
        content=result["pdf"],
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{stem}-searchable.pdf"',
            "X-Total-Pages": str(result["total_pages"]),
            "X-Page-Count": str(result["page_count"]),
            "X-Truncated": "1" if result["truncated"] else "0",
            "X-Ocr-Pages": str(result["ocr_pages"]),
            "Access-Control-Expose-Headers": "X-Total-Pages, X-Page-Count, X-Truncated, X-Ocr-Pages",
        },
    )
