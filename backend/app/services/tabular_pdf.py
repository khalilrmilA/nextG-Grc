"""Render a list of row dicts to a landscape PDF table.

The register exports could produce CSV and XML. Both requirement blocks that
mention exporting ask for Excel **or PDF** — CSV is neither, and an auditor
handed a CSV of a risk register has to open and format it before it is
readable, which is exactly the friction the rule is written against.

Deliberately generic: one renderer for every module's export, so risks, assets,
controls and the report builder all produce the same document rather than four
divergent layouts. Column widths are computed from the content so a register
with two long columns does not clip them to make room for six short ones.

Arabic runs through :mod:`app.services.pdf_arabic`, which is already the
codebase's answer for right-to-left text in ReportLab.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Sequence

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

# Beyond this a table stops being a document and becomes a data dump; the
# caller is told rather than handed a 400-page PDF.
MAX_ROWS = 2000
# More columns than this cannot be read on a landscape A4 page.
MAX_COLUMNS = 12


def _cell_style():
    base = getSampleStyleSheet()["BodyText"]
    return ParagraphStyle(
        "cell", parent=base, fontSize=7, leading=8.5, alignment=TA_LEFT,
        wordWrap="CJK",   # wraps inside long unbroken tokens (ids, URLs)
    )


def rows_to_pdf(
    title: str,
    columns: Sequence[str],
    rows: Sequence[dict],
    *,
    subtitle: str | None = None,
) -> bytes:
    """Render rows to a landscape A4 PDF. Returns the file bytes."""
    from app.services import pdf_arabic

    try:
        pdf_arabic.ensure_fonts()
        shape = pdf_arabic.shape
    except Exception:  # noqa: BLE001 — a missing font must not fail the export
        def shape(value):  # type: ignore[misc]
            return value

    columns = list(columns)[:MAX_COLUMNS]
    truncated = len(rows) > MAX_ROWS
    rows = list(rows)[:MAX_ROWS]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        leftMargin=0.4 * inch, rightMargin=0.4 * inch,
        topMargin=0.45 * inch, bottomMargin=0.45 * inch,
        title=title,
    )
    styles = getSampleStyleSheet()
    cell = _cell_style()
    story = [Paragraph(shape(title), styles["Heading2"])]

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    meta = f"{len(rows)} row(s) · generated {stamp}"
    if subtitle:
        meta = f"{subtitle} · {meta}"
    if truncated:
        meta += f" · truncated to the first {MAX_ROWS}"
    story += [Paragraph(shape(meta), styles["Normal"]), Spacer(1, 8)]

    header = [Paragraph(f"<b>{shape(c.replace('_', ' '))}</b>", cell) for c in columns]
    body = [
        [Paragraph(shape(str(r.get(c, ""))[:300]), cell) for c in columns]
        for r in rows
    ]

    # Width by content: sample the rows so one wide column does not squeeze the
    # rest into unreadable slivers.
    available = doc.width
    weights = []
    for c in columns:
        longest = max([len(str(c))] + [len(str(r.get(c, ""))[:120]) for r in rows[:200]] or [len(str(c))])
        weights.append(max(6, min(longest, 60)))
    total = sum(weights) or 1
    widths = [available * (w / total) for w in weights]

    table = Table([header] + body, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F3B52")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#C9CFD9")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F4F6F8")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(table)
    doc.build(story)
    return buf.getvalue()
