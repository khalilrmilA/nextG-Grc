"""Arabic text support for generated PDFs.

The client requires Arabic "tant pour l'interface que pour les données". The
interface has it; PDFs did not. ReportLab's built-in Helvetica has no Arabic
glyphs, so an Arabic risk title exported to a report came out as a row of solid
boxes — every character lost, silently, in the artefact an auditor keeps.

Two separate things have to happen, and neither is optional:

**A font that has the glyphs.** Registered from the host's font set, preferring
Amiri (a real Arabic typeface) and falling back to DejaVu Sans. If neither is
present the module reports unavailable and callers keep their Latin font — a
report that renders French correctly is better than one that fails to build.

**Shaping and direction.** Arabic letters change form by position and run
right-to-left, and ReportLab does neither. ``arabic_reshaper`` selects the
contextual forms and ``python-bidi`` applies the Unicode bidirectional
algorithm, so the glyphs are emitted in visual order. Without this step the
text renders as isolated letters in reverse order — legible to nobody.

Latin text is passed through untouched: French and English keep exactly the
typography they have today.
"""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

# Registered ReportLab font names (set by ensure_fonts()).
ARABIC_FONT = "GRCArabic"
ARABIC_FONT_BOLD = "GRCArabic-Bold"

# Preferred first: Amiri is a designed Arabic face. DejaVu is the fallback that
# ships almost everywhere and covers Arabic adequately.
_FONT_CANDIDATES = (
    ("/usr/share/fonts/opentype/fonts-hosny-amiri/Amiri-Regular.ttf",
     "/usr/share/fonts/opentype/fonts-hosny-amiri/Amiri-Bold.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
     "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf",
     "/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf"),
)

_state: dict = {"checked": False, "available": False}


def _contains_arabic(text: str) -> bool:
    """True if the string holds any Arabic-script codepoint."""
    return any(
        "؀" <= ch <= "ۿ"     # Arabic
        or "ݐ" <= ch <= "ݿ"  # Arabic Supplement
        or "ࢠ" <= ch <= "ࣿ"  # Arabic Extended-A
        or "ﭐ" <= ch <= "﷿"  # Presentation Forms-A
        or "ﹰ" <= ch <= "﻿"  # Presentation Forms-B
        for ch in text
    )


has_arabic = _contains_arabic


def ensure_fonts() -> bool:
    """Register an Arabic-capable font once. True if PDFs can render Arabic."""
    if _state["checked"]:
        return _state["available"]
    _state["checked"] = True
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont

        for regular, bold in _FONT_CANDIDATES:
            if not os.path.exists(regular):
                continue
            pdfmetrics.registerFont(TTFont(ARABIC_FONT, regular))
            pdfmetrics.registerFont(TTFont(ARABIC_FONT_BOLD, bold if os.path.exists(bold) else regular))
            _state["available"] = True
            logger.info("PDF Arabic font registered from %s", regular)
            return True
        logger.warning(
            "No Arabic-capable font found; PDFs will not render Arabic text. "
            "Install fonts-hosny-amiri or fonts-dejavu-core."
        )
    except Exception as exc:  # noqa: BLE001 — never break PDF generation
        logger.warning("Arabic PDF font registration failed: %s", exc)
    return _state["available"]


def shape(text: str) -> str:
    """Contextual forms + bidirectional reordering, ready for ReportLab.

    Returns the input unchanged when it holds no Arabic, or when the shaping
    libraries are unavailable — a slightly wrong rendering beats a failed
    report.
    """
    if not text or not _contains_arabic(text):
        return text
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display

        return get_display(arabic_reshaper.reshape(text))
    except Exception:  # noqa: BLE001
        return text


def prepare(text: str, bold: bool = False) -> tuple[str, str | None]:
    """Return ``(render_text, font_name)`` for a string.

    ``font_name`` is None for Latin text, meaning "keep the caller's font", so
    French and English reports are byte-for-byte what they were before.
    """
    if not text or not _contains_arabic(text):
        return text, None
    if not ensure_fonts():
        return text, None
    return shape(text), (ARABIC_FONT_BOLD if bold else ARABIC_FONT)


def paragraph_markup(text: str, bold: bool = False) -> str:
    """Arabic-safe text for a ReportLab Paragraph.

    Wraps only Arabic content in a <font> tag, so a mixed document keeps its
    Latin typography and picks up the Arabic face exactly where it is needed.
    Escapes the markup characters ReportLab would otherwise interpret.
    """
    if text is None:
        return ""
    text = str(text)
    rendered, font = prepare(text, bold=bold)
    escaped = (
        rendered.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )
    return f'<font name="{font}">{escaped}</font>' if font else escaped
