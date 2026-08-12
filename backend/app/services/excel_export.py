"""Generic Excel (.xlsx) export via openpyxl — Elite Pack reporting.

openpyxl ships in requirements.txt but was previously unused; this is the real
Excel export the RFP asks for (PDF + Excel). ``rows_to_xlsx`` turns a list of
dicts + an ordered column list into a styled worksheet and returns the bytes.
"""
import io
from typing import Any, Sequence

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment


def rows_to_xlsx(sheet_name: str, columns: Sequence[str], rows: Sequence[dict]) -> bytes:
    """Render rows to an xlsx byte string with a styled header row."""
    wb = Workbook()
    ws = wb.active
    ws.title = (sheet_name or "Report")[:31]

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(fill_type="solid", fgColor="1F5C8B")
    for col_idx, col in enumerate(columns, start=1):
        cell = ws.cell(row=1, column=col_idx, value=str(col))
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(vertical="center")

    for row_idx, row in enumerate(rows, start=2):
        for col_idx, col in enumerate(columns, start=1):
            value: Any = row.get(col)
            if isinstance(value, (list, dict)):
                value = str(value)
            ws.cell(row=row_idx, column=col_idx, value=value)

    for col_idx, col in enumerate(columns, start=1):
        letter = ws.cell(row=1, column=col_idx).column_letter
        ws.column_dimensions[letter].width = max(12, min(48, len(str(col)) + 4))
    ws.freeze_panes = "A2"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
