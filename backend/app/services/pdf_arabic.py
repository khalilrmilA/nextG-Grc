"""Arabic text support for generated PDFs.

The client requires Arabic "tant pour l'interface que pour les données". The
interface has it; PDFs did not. ReportLab's built-in Helvetica has no Arabic
glyphs, so an Arabic risk title exported to a report came out as a row of solid
boxes — every character lost, silently, in the artefact an auditor keeps.

Two separate things have to happen, and neither is optional:

**A font that has the glyphs.** Amiri (a real Arabic typeface, SIL OFL 1.1) is
bundled with the application under ``app/assets/fonts``, so every package —
SaaS, Docker images, the appliance, a Windows dev box — renders Arabic without
depending on what the host happens to have installed. Host fonts (Amiri, DejaVu
Sans, Noto Sans Arabic) remain fallbacks. If none is present the module reports
unavailable and callers keep their Latin font — a report that renders French
correctly is better than one that fails to build.

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

# The bundled copy comes first. Before it existed, Arabic PDFs rendered only on
# the OVA (the one channel that installs fonts-hosny-amiri); every Docker image
# and Windows host fell through to boxes. The folder is shipped as data by each
# packaging channel (PyArmor copies non-.py files; Nuitka needs
# --include-data-dir=app/assets/fonts in build ova/scripts/25-protect-app.sh).
BUNDLED_FONT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "fonts"
)
BUNDLED_REGULAR = os.path.join(BUNDLED_FONT_DIR, "Amiri-Regular.ttf")
BUNDLED_BOLD = os.path.join(BUNDLED_FONT_DIR, "Amiri-Bold.ttf")

# Then the host's fonts: Amiri is a designed Arabic face; DejaVu is the fallback
# that ships almost everywhere and covers Arabic adequately.
_FONT_CANDIDATES = (
    (BUNDLED_REGULAR, BUNDLED_BOLD),
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
            "The bundled font is missing from %s (check the packaging channel "
            "ships app/assets/fonts), and no host font is installed.", BUNDLED_FONT_DIR
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


def wrapped_markup(text, max_width_pt: float, font_size: float, bold: bool = False) -> str:
    """``paragraph_markup``, but Arabic is broken into lines *before* shaping.

    ReportLab lays a Paragraph out **after** the bidi algorithm has run, so it
    wraps the visually-reordered string: the words that belong on the last line
    get drawn on the first one, and a two-line Arabic sentence reads backwards.
    Nothing warns about it — every glyph is present and correctly shaped, only
    the line order is wrong, which is exactly the kind of defect that survives
    review and lands in the client's artefact.

    So the *logical* text is wrapped here, against the width the caller will
    actually give the flowable, each line is shaped on its own, and the lines
    are joined with ``<br/>`` — which ReportLab honours as-is, because every
    line already fits its column.

    Latin text short-circuits to :func:`paragraph_markup`, so English and French
    output is byte-for-byte what it was.
    """
    if text is None:
        return ""
    text = str(text)
    if (not max_width_pt or max_width_pt <= 0 or not font_size
            or not _contains_arabic(text) or not ensure_fonts()):
        return paragraph_markup(text, bold=bold)
    try:
        from reportlab.pdfbase.pdfmetrics import stringWidth
    except Exception:  # noqa: BLE001 — measurement is an optimisation, never a failure
        return paragraph_markup(text, bold=bold)

    font = ARABIC_FONT_BOLD if bold else ARABIC_FONT
    # A margin against the metric mismatch of a mixed line: Latin runs inside an
    # Arabic paragraph are measured with the Arabic face, which is close but not
    # identical. Breaking one word early is invisible; breaking one word late
    # would let ReportLab re-wrap the line and reintroduce the bug.
    limit = max_width_pt * 0.95
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}" if current else word
        try:
            too_wide = stringWidth(shape(candidate), font, font_size) > limit
        except Exception:  # noqa: BLE001
            too_wide = False
        if current and too_wide:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    if len(lines) <= 1:
        return paragraph_markup(text, bold=bold)
    return "<br/>".join(paragraph_markup(line, bold=bold) for line in lines)
