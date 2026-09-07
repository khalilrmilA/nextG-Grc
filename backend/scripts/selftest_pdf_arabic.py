"""Self-test for Arabic rendering in generated PDFs.

The client requires Arabic for data, not only for the interface. Before this,
an Arabic risk title exported to a report came out as a row of solid boxes —
silently, in the artefact an auditor keeps. The failure is invisible in code
review and only shows in the rendered file, so it is asserted here against a
real PDF: build one, extract the text, and check for boxes.

Run:  venv/bin/python scripts/selftest_pdf_arabic.py
"""
import sys
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pypdf import PdfReader  # noqa: E402
from reportlab.lib.styles import ParagraphStyle  # noqa: E402
from reportlab.platypus import Paragraph, SimpleDocTemplate  # noqa: E402

from app.services import pdf_arabic  # noqa: E402

failures: list[str] = []

AR = "تقييم المخاطر السيبرانية"      # "cyber risk assessment"
AR_SHORT = "خطر تسريب البيانات"       # "data leak risk"
FR = "Évaluation des risques — conformité réglementaire (à jour)"


def check(label: str, got, want) -> None:
    if got == want:
        print(f"  ok   {label}")
    else:
        failures.append(f"{label}: got {got!r}, want {want!r}")
        print(f"  FAIL {label}: got {got!r}, want {want!r}")


def render(*paragraphs: str) -> str:
    buf = BytesIO()
    SimpleDocTemplate(buf).build([
        Paragraph(p, ParagraphStyle(f"S{i}", fontName="Helvetica", fontSize=12))
        for i, p in enumerate(paragraphs)
    ])
    buf.seek(0)
    return PdfReader(buf).pages[0].extract_text() or ""


def has_arabic_glyphs(text: str) -> bool:
    return any(
        "؀" <= c <= "ۿ" or "ﭐ" <= c <= "﷿" or "ﹰ" <= c <= "﻿" for c in text
    )


def main() -> None:
    print("\ndetection")
    check("detects Arabic", pdf_arabic.has_arabic(AR), True)
    check("does not flag Latin", pdf_arabic.has_arabic(FR), False)
    check("empty string is not Arabic", pdf_arabic.has_arabic(""), False)

    print("\nfont registration")
    available = pdf_arabic.ensure_fonts()
    check("an Arabic-capable font is registered", available, True)
    if not available:
        print("  (no Arabic font on this host — install fonts-hosny-amiri or fonts-dejavu-core)")

    print("\nshaping")
    shaped = pdf_arabic.shape(AR)
    check("shaping changes the string", shaped != AR, True)
    check("Latin passes through untouched", pdf_arabic.shape(FR), FR)

    print("\nrendered PDF")
    out = render(pdf_arabic.paragraph_markup(AR), pdf_arabic.paragraph_markup(FR))
    # The regression this exists to catch: Helvetica has no Arabic glyphs, so
    # every Arabic character was emitted as U+25A0.
    check("no replacement boxes in the PDF", "■" in out, False)
    check("Arabic glyphs really present", has_arabic_glyphs(out), True)
    check("French is unchanged", FR in out, True)

    print("\nmixed table cell (the path report data takes)")
    from app.services.report_generator import _cell, _styles

    _styles()
    cell = _cell(AR_SHORT)
    check("Arabic cell is promoted to a Paragraph", isinstance(cell, Paragraph), True)
    check("Latin cell is left as a plain value", _cell("Cyber"), "Cyber")
    check("non-string cell is untouched", _cell(8.5), 8.5)

    print("\nmarkup safety")
    check("angle brackets are escaped",
          "<script>" in pdf_arabic.paragraph_markup("<script>"), False)
    check("ampersand is escaped",
          "&amp;" in pdf_arabic.paragraph_markup("Risk & Control"), True)
    check("None renders as empty", pdf_arabic.paragraph_markup(None), "")

    print()
    if failures:
        print(f"FAILED ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("all Arabic-PDF self-tests passed")


if __name__ == "__main__":
    main()
