"""OCR endpoints (Elite Pack, RFP prescription 11) — extract text from scans.

Gated behind require_feature("ocr_capture"). Accepts a scanned image **or a PDF**
and returns the recognised text (French + English by default). PDFs reuse their
embedded text layer when they have one and are OCR'd page by page when they are
scans. tesseract runs in a worker thread so it never blocks the event loop.
"""
import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
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
