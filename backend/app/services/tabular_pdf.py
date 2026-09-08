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

``lang`` does two jobs: it lays the page out right-to-left for Arabic, and it
translates the CHROME — the column headers and the meta line. Cell values are
never translated: the same rows are also served as csv/xlsx and read back by
/data/import/*, and a translated status would not import.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Sequence

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

# Beyond this a table stops being a document and becomes a data dump; the
# caller is told rather than handed a 400-page PDF.
MAX_ROWS = 2000
# More columns than this cannot be read on a landscape A4 page.
MAX_COLUMNS = 12

# The renderer's own chrome. Not a second vocabulary: the column names come from
# report_generator.column_label, this is only the sentence this file writes
# itself, which stayed English in a French or Arabic document.
_META = {
    "en": {"rows": "{n} row(s)", "generated": "generated {stamp}",
           "truncated": "truncated to the first {n}", "dropped": "columns not shown: {cols}"},
    "fr": {"rows": "{n} ligne(s)", "generated": "généré le {stamp}",
           "truncated": "tronqué aux {n} premières lignes", "dropped": "colonnes non affichées : {cols}"},
    "ar": {"rows": "{n} سطر", "generated": "أُنشئ في {stamp}",
           "truncated": "مقتطع إلى أول {n} سطر", "dropped": "أعمدة غير معروضة: {cols}"},
}


def _meta_text(lang: str, key: str, **fmt) -> str:
    table = _META.get(lang) or _META["en"]
    return (table.get(key) or _META["en"][key]).format(**fmt)


def _cell_style(rtl: bool = False):
    base = getSampleStyleSheet()["BodyText"]
    return ParagraphStyle(
        "cell", parent=base, fontSize=7, leading=8.5,
        alignment=TA_RIGHT if rtl else TA_LEFT,
        wordWrap="CJK",   # wraps inside long unbroken tokens (ids, URLs)
    )


def rows_to_pdf(
    title: str,
    columns: Sequence[str],
    rows: Sequence[dict],
    *,
    subtitle: str | None = None,
    lang: str | None = None,
) -> bytes:
    """Render rows to a landscape A4 PDF. Returns the file bytes.

    ``lang="ar"`` lays the table out right-to-left. It is only about direction:
    Arabic *content* is detected per cell, so an Arabic value in an otherwise
    French export still renders correctly without the caller declaring anything.
    """
    from app.services import pdf_arabic
    # Imported here rather than at module scope: report_generator pulls in the
    # model layer, and this renderer is imported by every export endpoint.
    from app.services.report_generator import column_label

    def markup(value) -> str:
        """Shaped, escaped, and carrying an Arabic font where it is needed.

        The previous version called ``shape()`` and stopped there. Shaping
        selects the contextual glyph forms, but the cell was still drawn in
        Helvetica, which has no Arabic glyphs — so every Arabic register export
        came out as a row of solid boxes. paragraph_markup does the missing
        half (it wraps the Arabic runs in the registered face) and, just as
        importantly, escapes ``&``/``<``/``>`` — a value containing one of those
        used to corrupt or break the Paragraph.
        """
        return pdf_arabic.paragraph_markup("" if value is None else str(value))

    code = (lang or "en").lower()[:2]
    rtl = code == "ar"

    all_columns = [c for c in columns if c]
    if not all_columns:
        # ReportLab raises ("must have at least a row and a column") on a table
        # with no columns, so an empty register used to 500 the whole export.
        # data_io.py guards its own call site; a guard every caller has to
        # remember is not a guard, so it lives here too — same "No data
        # available" placeholder, so the two paths produce the same document.
        all_columns = ["info"]
        rows = [{"info": "No data available"}]
    columns = all_columns[:MAX_COLUMNS]
    # A dropped COLUMN is invisible in the finished document in a way a dropped
    # row is not — nothing on the page says the register had more fields. The
    # referential and findings exports both carry more than MAX_COLUMNS, so the
    # reader is told which ones are missing and where to get them (any of the
    # other three formats is complete).
    dropped = all_columns[MAX_COLUMNS:]
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
    cell = _cell_style(rtl)
    heading = ParagraphStyle("tabtitle", parent=styles["Heading2"],
                             alignment=TA_RIGHT if rtl else TA_LEFT)
    meta_style = ParagraphStyle("tabmeta", parent=styles["Normal"],
                                alignment=TA_RIGHT if rtl else TA_LEFT)
    story = [Paragraph(markup(title), heading)]

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    meta = (f"{_meta_text(code, 'rows', n=len(rows))} · "
            f"{_meta_text(code, 'generated', stamp=stamp)}")
    if subtitle:
        meta = f"{subtitle} · {meta}"
    if truncated:
        meta += " · " + _meta_text(code, "truncated", n=MAX_ROWS)
    if dropped:
        meta += " · " + _meta_text(
            code, "dropped", cols=", ".join(column_label(code, c) for c in dropped))
    story += [Paragraph(markup(meta), meta_style), Spacer(1, 8)]

    # Width by content: sample the rows so one wide column does not squeeze the
    # rest into unreadable slivers.
    available = doc.width
    weights = []
    for c in columns:
        longest = max([len(str(c))] + [len(str(r.get(c, ""))[:120]) for r in rows[:200]] or [len(str(c))])
        weights.append(max(6, min(longest, 60)))
    total = sum(weights) or 1
    widths = [available * (w / total) for w in weights]

    header = [Paragraph(f"<b>{markup(column_label(code, c))}</b>", cell) for c in columns]
    body = [
        [Paragraph(markup(str(r.get(c, ""))[:300]), cell) for c in columns]
        for r in rows
    ]

    # A right-to-left document reads the first column on the right-hand edge, so
    # the column order and its widths are mirrored together.
    if rtl:
        header = list(reversed(header))
        widths = list(reversed(widths))
        body = [list(reversed(row)) for row in body]

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
