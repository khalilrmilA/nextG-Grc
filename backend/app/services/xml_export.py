"""Generic XML export/import — Elite Pack data exchange (RFP gap T2: "no generic
XML import/export, only scanner-report XML ingestion — generic data exchange
is JSON/CSV/XLSX only").

Mirrors the CSV export shape already used in ``data_io.py``: one root element,
one child element per record, field names as child tags. Deliberately simple —
this is a human-readable data dump, not a validated wire format, so there is
no accompanying XSD.

Security note (this matters, see CLAUDE.md): building an XML tree from
already-known Python values (``rows_to_xml``) does not parse anything, so XXE
does not apply there — it uses the standard library ``xml.etree.ElementTree``.
Only PARSING untrusted uploaded XML is an XXE risk; ``xml_to_rows`` (used by
the import endpoints in data_io.py) therefore uses ``defusedxml.ElementTree``
instead, the same dependency already used for Nessus scanner-report ingestion
in ``scanner_import.py``.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Sequence

from defusedxml.ElementTree import fromstring as safe_xml_fromstring


def _scalar_to_text(value) -> str:
    """Render a field value (str/int/float/bool/None/other) as XML element text."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def rows_to_xml(root_tag: str, record_tag: str, rows: Sequence[dict]) -> bytes:
    """Serialize a list of flat dicts into a pretty-printed XML document.

    Shape:
        <root_tag>
          <record_tag>
            <field_name>value</field_name>
            ...
          </record_tag>
          ...
        </root_tag>

    Field names are used verbatim as child tag names — callers should only
    pass dict keys that are already valid, stable identifiers (they all are,
    in every call site in data_io.py: plain snake_case column names).
    """
    root = ET.Element(root_tag)
    for row in rows:
        record = ET.SubElement(root, record_tag)
        for key, value in row.items():
            field = ET.SubElement(record, str(key))
            field.text = _scalar_to_text(value)
    ET.indent(root, space="  ")
    return b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="utf-8")


def xml_to_rows(content: bytes | str) -> list[dict]:
    """Parse an XML document shaped like ``rows_to_xml``'s output back into a
    list of flat dicts, one per record element, keyed by child tag name.

    XXE-safe (defusedxml) since this parses an untrusted upload. Root/record
    tag names are not checked — every direct child of the document root is
    treated as one record, and every child of a record element is treated as
    one field (its tag = field name, its text = field value). This keeps
    import tolerant of a hand-edited file that doesn't reuse our exact tag
    names, matching how the CSV importer only cares about column headers.
    """
    text = content.decode("utf-8", errors="replace") if isinstance(content, (bytes, bytearray)) else content
    root = safe_xml_fromstring(text)
    rows: list[dict] = []
    for record in list(root):
        row: dict = {}
        for field in list(record):
            tag = field.tag
            row[tag] = field.text if field.text is not None else ""
        rows.append(row)
    return rows
