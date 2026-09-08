"""Generic Excel (.xlsx) export via openpyxl — Elite Pack reporting.

openpyxl ships in requirements.txt but was previously unused; this is the real
Excel export the RFP asks for (PDF + Excel). ``rows_to_xlsx`` turns a list of
dicts + an ordered column list into a styled worksheet and returns the bytes.

Every cell goes through :func:`_cell` first, because openpyxl refuses values
that a GRC register genuinely contains and refuses them by RAISING — which
turns one bad character in one row into a 500 on the whole export, for every
caller (data_io.py, report_builder.py, archiving.py). The three cases seen in
practice:

* a control character in free text (``\\x0b`` and ``\\x0c`` arrive constantly in
  text pasted out of PDFs and in OCR output) — ``IllegalCharacterError``;
* a timezone-aware datetime — ``TypeError: Excel does not support timezones``,
  which is what a ``DateTime(timezone=True)`` column hands back on PostgreSQL;
* anything Excel has no cell type for (a set, a UUID, an ORM object) —
  ``ValueError: Cannot convert ... to Excel``.

Cleaning here rather than at each call site keeps every export path safe at
once, and keeps numbers, booleans and naive datetimes typed so the spreadsheet
still sorts them.

The same argument applies to formula injection, which is why ``csv_safe_cell``
now runs HERE and not only in the two endpoint files that remembered to call
it. openpyxl promotes any string beginning with ``=`` to a real formula cell
(``data_type == 'f'``), so a risk title or a vendor name reading
``=cmd|'/c calc'!A0`` is executed when the workbook is opened. data_io.py and
report_builder.py guarded their own rows; archiving.py and every future caller
did not, and a defence that each call site has to remember is not a defence.
Prefixing is idempotent — a cell a caller already passed through
``csv_safe_cell`` starts with ``'``, which is not a trigger.
"""
import datetime as dt
import enum
import io
from decimal import Decimal
from typing import Any, Sequence

from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Font, PatternFill, Alignment

from app.core.security_utils import csv_safe_cell

# Excel's own hard limit on the character count of a cell.
_MAX_CELL_CHARS = 32767

# Characters Excel forbids in a sheet title.
_BAD_TITLE_CHARS = set(r":\/?*[]")


def _sheet_title(name: str) -> str:
    """A worksheet title Excel will accept: no :\\/?*[] and at most 31 chars."""
    cleaned = "".join(" " if c in _BAD_TITLE_CHARS else c for c in (name or "")).strip()
    return (cleaned or "Report")[:31]


def _cell(value: Any) -> Any:
    """Coerce a value into something openpyxl will write without raising.

    Types Excel understands are passed through unchanged so they stay sortable;
    everything else becomes cleaned text.
    """
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, enum.Enum):
        # str() on a (str, Enum) member renders "AuditStatus.Fieldwork"; the
        # bare value is what every other export format writes.
        return _cell(value.value)
    if isinstance(value, (int, float, Decimal)):
        return value
    if isinstance(value, dt.datetime):
        # openpyxl refuses tzinfo outright. Hand it the ISO string rather than
        # silently dropping the offset and pretending the instant is local.
        return value.isoformat() if value.tzinfo is not None else value
    if isinstance(value, (dt.date, dt.time, dt.timedelta)):
        return value
    if not isinstance(value, str):
        value = str(value)
    if ILLEGAL_CHARACTERS_RE.search(value):
        value = ILLEGAL_CHARACTERS_RE.sub("", value)
    # Neutralise formula injection last, so a leading "=" that only became the
    # first character after the control characters were stripped is still caught.
    value = csv_safe_cell(value)
    return value[:_MAX_CELL_CHARS] if len(value) > _MAX_CELL_CHARS else value


def rows_to_xlsx(sheet_name: str, columns: Sequence[str], rows: Sequence[dict],
                 *, lang: str = "en") -> bytes:
    """Render rows to an xlsx byte string with a styled header row.

    ``lang`` translates the HEADER ROW only — the same rule tabular_pdf follows.
    Cell values stay exactly as the caller produced them, because this workbook
    is also what /data/import/* reads back: a translated "operational" would not
    import, and a translated risk title would be wrong in any language. Without
    this, « Export Excel » was English whatever the UI language, which is the
    half of the export clause the PDF path had already closed.
    """
    # Imported lazily: report_generator pulls in the model layer, and this
    # renderer is imported by every export endpoint and by archiving.
    from app.services.report_generator import column_label

    wb = Workbook()
    ws = wb.active
    ws.title = _sheet_title(sheet_name)

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(fill_type="solid", fgColor="1F5C8B")
    for col_idx, col in enumerate(columns, start=1):
        cell = ws.cell(row=1, column=col_idx, value=_cell(column_label(lang, str(col))))
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(vertical="center")

    for row_idx, row in enumerate(rows, start=2):
        for col_idx, col in enumerate(columns, start=1):
            value: Any = row.get(col)
            if isinstance(value, (list, dict)):
                value = str(value)
            ws.cell(row=row_idx, column=col_idx, value=_cell(value))

    for col_idx, col in enumerate(columns, start=1):
        letter = ws.cell(row=1, column=col_idx).column_letter
        # Width from the HEADER AS PRINTED — "Responsable de la remédiation" is
        # twice the width of "owner_id", and sizing on the raw name clipped it.
        ws.column_dimensions[letter].width = max(
            12, min(48, len(str(ws.cell(row=1, column=col_idx).value or col)) + 4))
    ws.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
