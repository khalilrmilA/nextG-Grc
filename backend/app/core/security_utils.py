"""Security utilities — outbound URL validation, filename sanitization, content sniffing."""
from __future__ import annotations

import ipaddress
import re
import socket
from pathlib import Path
from urllib.parse import urlparse

from fastapi import HTTPException


_ALLOWED_SCHEMES = {"http", "https"}
_FORBIDDEN_HOSTS = {"localhost", "metadata.google.internal", "metadata"}

# Magic-byte signatures for the file types we accept on uploads.
# (offset, signature_bytes). Multiple entries per type means OR.
_MAGIC_SIGNATURES: dict[str, list[tuple[int, bytes]]] = {
    "application/pdf": [(0, b"%PDF-")],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
        (0, b"PK\x03\x04"),
    ],
    "image/png": [(0, b"\x89PNG\r\n\x1a\n")],
    "image/jpeg": [(0, b"\xff\xd8\xff")],
    "image/jpg": [(0, b"\xff\xd8\xff")],
    "text/plain": [],  # text has no reliable magic bytes
}

_EXTENSION_FOR_MIME = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "text/plain": ".txt",
}


def _is_private_ip(host: str) -> bool:
    """Return True if host resolves to a private/loopback/link-local/reserved address."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        # Cannot resolve — treat as untrusted; refuse the request.
        return True
    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            return True
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return True
    return False


def validate_outbound_url(url: str) -> str:
    """Validate that `url` is safe to make a server-side request to.

    Rejects non-HTTP(S) schemes, localhost-style hostnames, and any host that
    resolves to a private / loopback / link-local / reserved IP. Used to block
    SSRF on webhook delivery and other outbound HTTP from user-supplied URLs.
    """
    if not url or not isinstance(url, str):
        raise HTTPException(400, "URL is required")
    parsed = urlparse(url.strip())
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise HTTPException(400, "URL must use http or https")
    if not parsed.hostname:
        raise HTTPException(400, "URL must include a hostname")
    if parsed.hostname.lower() in _FORBIDDEN_HOSTS:
        raise HTTPException(400, "URL host is not allowed")
    if _is_private_ip(parsed.hostname):
        raise HTTPException(400, "URL resolves to a private or local address")
    return url


_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]")


def sanitize_filename(filename: str | None, default: str = "file") -> str:
    """Return a safe, traversal-free filename.

    Strips path components, normalises separators, and removes any character
    that isn't alphanumeric, dot, dash, or underscore. Multiple consecutive
    dots are collapsed to prevent `..`-style traversal in the resulting name.
    """
    if not filename:
        return default
    base = Path(filename).name  # drop directories
    base = _FILENAME_SAFE_RE.sub("_", base)
    base = re.sub(r"\.{2,}", ".", base).strip(". _")
    return base or default


def assert_path_within(base_dir: Path, candidate: Path) -> Path:
    """Resolve `candidate` and assert it is contained within `base_dir`.

    Raises HTTPException(400) if the path escapes base_dir. Returns the
    resolved candidate path.
    """
    base = base_dir.resolve()
    resolved = candidate.resolve()
    try:
        resolved.relative_to(base)
    except ValueError:
        raise HTTPException(400, "Invalid file path")
    return resolved


def verify_file_signature(content: bytes, expected_mime: str) -> bool:
    """Check that `content`'s magic bytes match the declared MIME type.

    Text/plain is allowed without a signature check (no reliable magic).
    Returns True if accepted; False if the bytes don't match the MIME.
    """
    sigs = _MAGIC_SIGNATURES.get(expected_mime)
    if sigs is None:
        return False  # MIME we don't know about
    if not sigs:
        return True  # text/plain — no header check
    for offset, signature in sigs:
        if content[offset : offset + len(signature)] == signature:
            return True
    return False


def server_extension_for(mime: str) -> str:
    """Return a server-controlled file extension for a known MIME type."""
    return _EXTENSION_FOR_MIME.get(mime, ".bin")


def sanitize_for_prompt(text: str | None, max_len: int = 5000) -> str:
    """Strip control characters and length-cap free text before embedding in
    an LLM prompt. Used to mitigate prompt injection from attacker-controlled
    fields (vendor names, contract bodies, evidence text, etc.)."""
    if not text:
        return ""
    cleaned = "".join(c for c in str(text) if c == "\n" or c == "\t" or 0x20 <= ord(c) < 0x7F or ord(c) > 0xA0)
    return cleaned[:max_len]


_CSV_FORMULA_TRIGGERS = ("=", "+", "-", "@", "\t", "\r")


def csv_safe_cell(value) -> str:
    """Return a CSV cell value with formula-injection protection.

    Excel/LibreOffice treat cells starting with =, +, -, @, \\t, or \\r as
    formulas. Prefix any such cell with a single quote so the spreadsheet
    treats it as text instead of evaluating it.
    """
    if value is None:
        return ""
    s = str(value)
    if s and s[0] in _CSV_FORMULA_TRIGGERS:
        return "'" + s
    return s


async def assert_user_in_tenant(db, user_id, tenant_id, *, field_name: str = "user_id"):
    """Raise HTTPException(400) if `user_id` does not belong to `tenant_id`.

    Closes cross-tenant IDOR via attacker-supplied foreign-key user IDs.
    Pass-through if user_id is falsy (the field was optional and not provided).
    """
    if not user_id:
        return
    from sqlalchemy import select
    from app.models.user import User
    result = await db.execute(
        select(User.id).where(User.id == user_id, User.tenant_id == tenant_id)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(400, f"Invalid {field_name}: not in this tenant")
