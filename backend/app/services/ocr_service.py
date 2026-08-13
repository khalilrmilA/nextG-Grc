"""OCR document capture (Elite Pack) — tesseract via pytesseract.

Extracts text from scanned images **and PDFs**. French + English by default
(RFP prescription 11). For PDFs the embedded text layer is used when present
(fast + exact); pages without one are rasterised with poppler and OCR'd.

OS packages required: tesseract-ocr, tesseract-ocr-fra, poppler-utils.
Python packages (all imported lazily so a missing one can never break startup):
pytesseract, Pillow, pypdf, pdf2image.
"""
import io

_ALLOWED_LANGS = {"fra", "eng", "fra+eng", "ara", "ara+fra", "ara+eng"}
DEFAULT_LANG = "fra+eng"

# A page whose embedded text layer yields fewer characters than this is treated
# as a scan and sent through OCR instead.
_TEXT_LAYER_MIN_CHARS = 40
_RASTER_DPI = 200


class OcrUnavailableError(RuntimeError):
    """A required OCR dependency is not installed on this server."""


def _pytesseract():
    try:
        import pytesseract  # noqa: WPS433 (lazy import by design)

        return pytesseract
    except ModuleNotFoundError:  # pragma: no cover - dep not installed
        raise OcrUnavailableError("OCR is not installed on this server (pytesseract missing).")


def _pil_image():
    try:
        from PIL import Image  # noqa: WPS433

        return Image
    except ModuleNotFoundError:  # pragma: no cover
        raise OcrUnavailableError("OCR is not installed on this server (Pillow missing).")


def _pypdf():
    try:
        from pypdf import PdfReader  # noqa: WPS433

        return PdfReader
    except ModuleNotFoundError:  # pragma: no cover
        raise OcrUnavailableError("PDF support is not installed on this server (pypdf missing).")


def _pdf2image():
    try:
        from pdf2image import convert_from_bytes  # noqa: WPS433

        return convert_from_bytes
    except ModuleNotFoundError:  # pragma: no cover
        raise OcrUnavailableError(
            "Scanned-PDF support is not installed on this server (pdf2image missing)."
        )


def normalize_lang(lang: str | None) -> str:
    return lang if lang in _ALLOWED_LANGS else DEFAULT_LANG


def available_languages() -> list[str]:
    """Tesseract language packs installed on this host ([] if OCR unavailable)."""
    try:
        return sorted(_pytesseract().get_languages(config=""))
    except Exception:
        return []


def engine_status() -> dict:
    """What this host can actually do — drives the UI's capability hints."""
    langs = available_languages()
    status = {
        "ocr_available": bool(langs),
        "languages": langs,
        "selectable_languages": sorted(
            lang for lang in _ALLOWED_LANGS if all(part in langs for part in lang.split("+"))
        ),
        "pdf_text_layer": True,
        "pdf_scanned": True,
    }
    for probe, key in ((_pypdf, "pdf_text_layer"), (_pdf2image, "pdf_scanned")):
        try:
            probe()
        except OcrUnavailableError:
            status[key] = False
    return status


def is_pdf(content: bytes, filename: str | None = None, content_type: str | None = None) -> bool:
    if content[:5] == b"%PDF-":
        return True
    if (content_type or "").lower() == "application/pdf":
        return True
    return (filename or "").lower().endswith(".pdf")


def ocr_image(content: bytes, lang: str = DEFAULT_LANG) -> str:
    """Run OCR over image bytes and return the extracted text."""
    lang = normalize_lang(lang)
    image = _pil_image().open(io.BytesIO(content))
    return _ocr_pil_image(image, lang)


def _ocr_pil_image(image, lang: str) -> str:
    if image.mode not in ("L", "RGB"):
        image = image.convert("RGB")
    return _pytesseract().image_to_string(image, lang=lang).strip()


def ocr_pdf(content: bytes, lang: str = DEFAULT_LANG, max_pages: int = 20) -> dict:
    """Extract text from a PDF, page by page.

    Uses the embedded text layer where there is one and falls back to OCR on the
    rasterised page otherwise, so a digital PDF costs no OCR time at all and a
    mixed document (scan pasted into a digital report) still comes out whole.
    """
    lang = normalize_lang(lang)
    reader = _pypdf()(io.BytesIO(content))
    total_pages = len(reader.pages)
    page_count = min(total_pages, max_pages)

    pages: list[dict] = []
    scanned_indexes: list[int] = []
    for index in range(page_count):
        try:
            text = (reader.pages[index].extract_text() or "").strip()
        except Exception:
            text = ""
        if len(text) >= _TEXT_LAYER_MIN_CHARS:
            pages.append({"page": index + 1, "method": "text_layer", "chars": len(text), "text": text})
        else:
            pages.append({"page": index + 1, "method": "ocr", "chars": 0, "text": ""})
            scanned_indexes.append(index)

    if scanned_indexes:
        convert_from_bytes = _pdf2image()
        for index in scanned_indexes:
            images = convert_from_bytes(
                content, dpi=_RASTER_DPI, first_page=index + 1, last_page=index + 1
            )
            text = _ocr_pil_image(images[0], lang) if images else ""
            pages[index].update({"chars": len(text), "text": text})

    methods = {page["method"] for page in pages}
    return {
        "text": "\n\n".join(page["text"] for page in pages if page["text"]),
        "pages": pages,
        "page_count": page_count,
        "total_pages": total_pages,
        "truncated": total_pages > page_count,
        "method": methods.pop() if len(methods) == 1 else "mixed",
    }


def extract_document(
    content: bytes,
    lang: str = DEFAULT_LANG,
    filename: str | None = None,
    content_type: str | None = None,
    max_pages: int = 20,
) -> dict:
    """Dispatch on file type and return a uniform extraction result."""
    lang = normalize_lang(lang)
    if is_pdf(content, filename, content_type):
        result = ocr_pdf(content, lang, max_pages)
        result["lang"] = lang
        result["kind"] = "pdf"
        return result
    text = ocr_image(content, lang)
    return {
        "text": text,
        "pages": [{"page": 1, "method": "ocr", "chars": len(text), "text": text}],
        "page_count": 1,
        "total_pages": 1,
        "truncated": False,
        "method": "ocr",
        "lang": lang,
        "kind": "image",
    }
