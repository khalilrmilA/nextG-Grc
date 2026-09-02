"""Structured AI calls: call -> extract JSON -> validate -> ONE corrective retry -> explicit AiResult.

This is component B of the AI foundation. It sits on top of ``ai_provider.ai_complete``
(transport, component E) and turns "ask the model for JSON" into one honest, typed result:

    res = await ai_structured(messages, SCHEMA, user_id=..., tenant_id=..., task="vendors.prescreen",
                              **ai_provider.decoding("analysis"))
    if not res.ok:
        raise HTTPException(status_code=424, detail=res.failure_detail())   # never 5xx (SPA redirect trap)
    data = res.data                                                          # validated dict / list / Pydantic instance

What one call does, in order
    1. Injects the schema as text into the system prompt (``schema_hint``) unless the caller says
       the prompt already carries it (``schema_in_prompt=False``). The cloud model does not enforce
       a JSON-schema ``format`` object, so ``json_mode=True`` (bare ``format:"json"``) is the floor
       and validation always happens here, in Python.
    2. Calls the model (``call_fn`` defaults to ``ai_provider.ai_complete``; tests pass a stub).
    3. ``extract_json``: tolerates ``` fences, ``<think>`` blocks, prose before/after, nested braces
       inside strings; ``coerce_shape``: bridges ``[...]`` <-> ``{"results": [...]}`` wrappers.
    4. ``validate_against``: enum normalisation (unambiguous case/space/dash slips only), then
       Pydantic / TypeAdapter / an in-module JSON-Schema-subset validator with lax numeric coercion.
       Optional ``check(data) -> list[str]`` adds semantic consistency rules.
    5. On failure, ONE repair round (``retries=1``): the model sees its previous reply plus the exact
       error lines (``REPAIR_PROMPT``). Empty or cut-off replies are re-asked from the base prompt
       instead (replaying a fragment invites the model to "continue" it); ``num_predict`` is doubled
       on a cut-off reply only when the caller set one.
    6. Still failing -> optional ``partial_items`` salvage (valid list items survive, invalid ones
       are reported in ``AiResult.invalid_items``), else ``AiResult(ok=False, kind=..., error=...)``.

Never raises for anything the model or the transport did wrong: every failure is an
``AiResult(ok=False, kind=..., error=..., validation_errors=[...])`` so call sites have one honest
path (HTTP 424 / ``ai_analysis_error`` / SSE error frame) and no silent defaults. Programming
errors (a schema that is not a dict / Pydantic model / typing form, or malformed ``messages``)
DO raise ``TypeError`` / ``ValueError`` before any model call.

Importing this module has no side effects (no network, no DB, no module-level mutable state), so
it is safe under multiple uvicorn workers and in daemon threads (``ai_structured_sync``).
"""
from __future__ import annotations

import asyncio
import copy
import json
import logging
import math
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal, Union, get_args, get_origin

from pydantic import BaseModel, TypeAdapter, ValidationError

from app.core.config import settings
from app.services import ai_provider

try:  # Component D is the single source of localised failure text; E's wrapper is the fallback.
    from app.services.ai_locale import failure_message as _locale_failure_message
except Exception:  # noqa: BLE001 — D unimportable: ai_provider.failure_message has its own table
    _locale_failure_message = None

logger = logging.getLogger("app.ai.structured")

__all__ = [
    "AiResult", "AiStructuredError", "JsonExtractError", "FailureKind", "FAILURE_KINDS", "LOCALE_KIND",
    "SchemaLike", "MAX_REPLAY_CHARS", "MAX_ERROR_LINES", "NUM_PREDICT_CAP", "WRAPPER_KEYS",
    "REPAIR_PROMPT", "SCHEMA_HINT_HEADER",
    "extract_json", "looks_truncated", "json_schema_of", "schema_hint", "coerce_shape",
    "normalize_enums", "validate_against", "format_validation_error", "classify_exception",
    "ai_structured", "ai_structured_sync",
]

# ---------------------------------------------------------------------------
# Types and constants
# ---------------------------------------------------------------------------

#: Accepted ``schema`` forms: a JSON-Schema dict (subset, see ``validate_against``), a Pydantic
#: ``BaseModel`` subclass, or a typing form such as ``list[Model]`` / ``dict[str, int]``.
SchemaLike = Any

#: Why an ``AiResult`` is not ok. ``"input"`` is reserved for caller-side pre-flight failures
#: (component C uses it for "no text / no controls / job too large"); B itself never emits it.
FailureKind = Literal["transport", "timeout", "provider", "empty", "truncated", "malformed", "validation", "input"]
FAILURE_KINDS: tuple[str, ...] = get_args(FailureKind)

#: B kind -> ``ai_locale`` failure kind (used by ``AiResult.user_message``).
LOCALE_KIND: dict[str, str] = {
    "transport": "unreachable",
    "timeout": "timeout",
    "provider": "error",
    "empty": "empty",
    "truncated": "truncated",
    "malformed": "invalid_output",
    "validation": "invalid_output",
    "input": "invalid_output",
}

#: ``ai_provider.AICallError.kind`` -> B kind (anything not listed is a ``"provider"`` failure).
_PROVIDER_KIND: dict[str, str] = {
    "timeout": "timeout",
    "unreachable": "transport",
    "empty": "empty",
    "truncated": "truncated",
}

MAX_REPLAY_CHARS = 12_000   # previous reply replayed into the repair turn (the model must see its whole output)
MAX_ERROR_LINES = 12        # validation lines fed back to the model / kept in AiResult.validation_errors
NUM_PREDICT_CAP = 32_768    # cap when doubling num_predict after a truncated reply
WRAPPER_KEYS = ("results", "items", "data", "controls", "suggestions", "clauses", "findings", "verdicts",
                "matches", "output")

#: THE repair text sent to the model on the retry turn. ``{errors}`` and ``{kind}`` are
#: substituted with ``str.format`` (``kind`` is "object" or "array", the schema's root type).
REPAIR_PROMPT = (
    "Your previous reply could not be used because it did not match the required JSON format:\n"
    "{errors}\n\n"
    "Return the SAME analysis again as one valid JSON {kind} that matches the schema exactly. "
    "Rules: JSON only; no markdown fences; no text before or after the JSON; keep every key name "
    "exactly as specified; enum fields must use exactly the listed English values; every required key "
    "must be present; identifiers must be copied character for character from the input; numbers must "
    "be JSON numbers, not strings. Do not change your verdicts, scores or findings and do not add or "
    "remove items unless the problem listed above requires it - only fix the format."
)

#: Header of the schema text injected into the system prompt (``{kind}`` substituted).
SCHEMA_HINT_HEADER = (
    "OUTPUT FORMAT (mandatory)\n"
    "Reply with ONLY one JSON {kind} that matches the JSON Schema below exactly: the same key names, "
    "every required key present, enum fields using one of the listed English values spelled exactly as "
    "shown, numbers as JSON numbers (not strings), and null only where the schema allows it. "
    "No markdown fences, no comments, and no text before or after the JSON.\n"
    "JSON Schema:\n"
)

_ROLES = ("system", "user", "assistant")
_MAX_CANDIDATES = 200       # bracket positions tried by extract_json's scan
_MAX_DEPTH = 64             # recursion guard for schema walks
_SNIPPET_CHARS = 60         # "(got '...')" excerpt length in error lines

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_FENCE_RE = re.compile(r"```[a-zA-Z0-9_-]*[ \t]*\r?\n?(.*?)```", re.DOTALL)
_DANGLING_FENCE_RE = re.compile(r"^\s*```[a-zA-Z0-9_-]*\s*")
_BRACKET_RE = re.compile(r"[{\[]")
_LINE_START_BRACKET_RE = re.compile(r"(?m)^[ \t]*[{\[]")
_ENUM_KEY_RE = re.compile(r"[\s\-]+")
_INT_RE = re.compile(r"[-+]?\d+")
_NUMBER_RE = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")

_MISSING = object()


# ---------------------------------------------------------------------------
# Exceptions and result
# ---------------------------------------------------------------------------

class JsonExtractError(ValueError):
    """``extract_json`` found no usable JSON.

    ``truncated`` is True when the text looks like a JSON value that was cut off (an opened
    object/array/string that never closes) — the caller re-asks instead of replaying the fragment.
    """

    def __init__(self, message: str, *, truncated: bool = False):
        super().__init__(message)
        self.truncated = bool(truncated)


class AiStructuredError(RuntimeError):
    """Raised ONLY by ``AiResult.unwrap()`` for callers who prefer exception style.

    ``result`` carries the full ``AiResult``; ``kind`` mirrors ``result.kind``; the message is
    ``result.failure_detail()`` (admin-safe: never a URL, key or upstream body).
    """

    def __init__(self, result: "AiResult"):
        self.result = result
        self.kind = result.kind
        super().__init__(result.failure_detail() or "AI structured call failed.")


@dataclass
class AiResult:
    """Outcome of one ``ai_structured`` call.

    Canonical shape (first six fields) plus additive diagnostics:

    ok                 True when ``data`` is validated output (possibly ``partial``).
    data               Validated value — Pydantic instance / list / dict, already enum-normalised
                       and type-coerced. ``None`` when not ok.
    error              One human-readable sentence, safe to show a tenant admin (never a URL,
                       API key, upstream body or raw exception text). ``None`` on a clean success;
                       on a partial success it says how many items were dropped.
    raw                Last raw model reply (``None`` when the transport failed before any text).
    attempts           Model calls actually made (1, or 2 with ``retries=1``).
    model              Model name used (``kwargs["model"]`` or the deployment default).
    kind               ``FailureKind`` when not ok; ``None`` on success (also on partial success).
    validation_errors  ``"- path: message"`` lines from the last failing attempt (empty on success).
    partial            True when ``ok`` came from ``partial_items`` salvage.
    invalid_items      ``[{"index": i, "item": <raw item>, "errors": "..."}]`` dropped by salvage.
                       Call sites must record these as explicit per-item "analysis_failed"
                       outcomes — never as a default verdict.
    """

    ok: bool
    data: Any | None
    error: str | None
    raw: str | None
    attempts: int
    model: str
    kind: FailureKind | None = None
    validation_errors: list[str] = field(default_factory=list)
    partial: bool = False
    invalid_items: list[dict] = field(default_factory=list)

    def unwrap(self) -> Any:
        """Return ``data`` or raise ``AiStructuredError(self)`` when not ok."""
        if self.ok:
            return self.data
        raise AiStructuredError(self)

    def failure_detail(self) -> str:
        """``""`` when ok, else ``"<kind>: <error>"`` plus (for ``kind == "validation"``) the first
        three validation lines. Drop it straight into ``HTTPException(424, detail=...)`` or a
        persisted ``ai_analysis_error`` column."""
        if self.ok:
            return ""
        detail = "%s: %s" % (self.kind or "error", self.error or "The AI request failed.")
        if self.kind == "validation" and self.validation_errors:
            detail += "\n" + "\n".join(self.validation_errors[:3])
        return detail

    def user_message(self, lang: str = "en") -> str:
        """Localised (en/fr/ar), honest, user-facing sentence for the failure; ``""`` when ok."""
        if self.ok:
            return ""
        locale_kind = LOCALE_KIND.get(self.kind or "", "invalid_output")
        if _locale_failure_message is not None:
            try:
                return _locale_failure_message(locale_kind, lang)
            except Exception:  # noqa: BLE001 — copy helpers must never break an error path
                logger.debug("ai_locale.failure_message failed", exc_info=True)
        return ai_provider.failure_message(locale_kind, lang)


# ---------------------------------------------------------------------------
# JSON extraction
# ---------------------------------------------------------------------------

def _candidate_texts(text: str) -> list[str]:
    """Texts to try, in order: the best fenced block (a block starting with ``{``/``[`` wins,
    else the first non-empty one), then the whole reply with fence markers removed."""
    text = _THINK_RE.sub("", text).strip()
    out: list[str] = []
    blocks = [b.strip() for b in _FENCE_RE.findall(text)]
    json_blocks = [b for b in blocks if b[:1] in ("{", "[")]
    if json_blocks:
        out.append(json_blocks[0])
    else:
        non_empty = [b for b in blocks if b]
        if non_empty:
            out.append(non_empty[0])
    whole = _DANGLING_FENCE_RE.sub("", text).strip()
    if whole.endswith("```"):
        whole = whole[:-3].rstrip()
    if whole and whole not in out:
        out.append(whole)
    return out


def _decode_first(text: str) -> tuple[Any, bool]:
    """``(value, True)`` for the first decodable JSON value in ``text``; ``(None, False)`` if none.
    Fast path: the whole text. Slow path: ``raw_decode`` from every ``{``/``[`` in order — a real
    parser, so braces inside strings and prose before/after are handled without greedy regexes.

    Two guards: (1) when the whole text fails to parse AND it opens a JSON value that never closes,
    ``JsonExtractError(truncated=True)`` is raised instead of scanning — the scan would otherwise
    return a complete INNER value (``results[0]`` of a cut-off batch reply) as a silent wrong
    success; (2) ``RecursionError`` from CPython's JSON scanner on pathologically nested input (a
    model stuck emitting ``[[[[``) is treated like any undecodable candidate, never propagated."""
    try:
        return json.loads(text), True
    except (ValueError, RecursionError):
        pass
    if _unclosed_json(text):
        raise JsonExtractError("the JSON reply was cut off before it was complete", truncated=True)
    decoder = json.JSONDecoder()
    for n, m in enumerate(_BRACKET_RE.finditer(text)):
        if n >= _MAX_CANDIDATES:
            break
        try:
            value, _end = decoder.raw_decode(text, m.start())
        except (ValueError, RecursionError):
            continue
        return value, True
    return None, False


def extract_json(text: str) -> Any:
    """Turn a model reply into a Python value.

    Handles ``` fences (with or without a language tag, even unclosed), ``<think>`` blocks,
    leading and trailing prose, a bare array, and nested braces inside strings; returns the
    first balanced JSON object or array (a bare scalar is returned too — the validator rejects
    it). Raises ``JsonExtractError`` (``truncated=True`` when the JSON was evidently cut off —
    a reply that opens a value it never closes is truncation even when an inner item is
    complete; a pathologically nested reply is malformed, never a ``RecursionError``).
    """
    if text is None or not str(text).strip():
        raise JsonExtractError("the reply was empty")
    text = str(text)
    for candidate in _candidate_texts(text):
        value, found = _decode_first(candidate)
        if found:
            return value
    raise JsonExtractError("no JSON object or array found in the reply", truncated=looks_truncated(text))


def _json_start(text: str) -> int | None:
    """Index of the first ``{``/``[`` that opens a line (or the text); None when there is none."""
    m = _LINE_START_BRACKET_RE.search(text)
    return m.end() - 1 if m else None


def _unclosed_json(candidate: str) -> bool | None:
    """``None`` when ``candidate`` has no ``{``/``[`` at the start of a line; otherwise whether the
    string-aware, escape-aware depth scan from the first one never returns to depth 0 (the value
    was cut off). Iterative, O(n) — safe on pathologically nested input."""
    start = _json_start(candidate)
    if start is None:
        return None
    depth, in_string, escaped = 0, False, False
    for ch in candidate[start:]:
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
            if depth <= 0:
                return False
    return True


def looks_truncated(text: str) -> bool:
    """Heuristic: after fence stripping the reply starts a JSON object/array (at the start of a
    line) and a string-aware, escape-aware depth scan never returns to depth 0 — i.e. the value
    was cut off (reasoning tokens count against ``num_predict`` on gpt-oss). Pure, O(n)."""
    if not text or not str(text).strip():
        return False
    for candidate in _candidate_texts(str(text)):
        state = _unclosed_json(candidate)
        if state is not None:
            return state
    return False


# ---------------------------------------------------------------------------
# Schema helpers
# ---------------------------------------------------------------------------

def _is_model_class(schema: Any) -> bool:
    return isinstance(schema, type) and issubclass(schema, BaseModel)


def json_schema_of(schema: SchemaLike) -> dict:
    """JSON-schema view of any ``SchemaLike``: a dict is returned as-is, a Pydantic model class
    via ``model_json_schema()``, anything else via ``TypeAdapter(schema).json_schema()``.
    Raises ``TypeError`` for an unsupported schema object — a programming error, not a model
    problem, and the one place this module raises on purpose."""
    if isinstance(schema, dict):
        return schema
    if _is_model_class(schema):
        return schema.model_json_schema()
    if schema is None or isinstance(schema, (str, bytes, bool, int, float, list, tuple, set)):
        raise TypeError("schema must be a dict, a pydantic model class, or a typing form")
    try:
        return TypeAdapter(schema).json_schema()
    except Exception as exc:  # noqa: BLE001 — pydantic raises several classes here
        raise TypeError("schema must be a dict, a pydantic model class, or a typing form") from exc


def _defs_of(js: dict) -> dict:
    defs = js.get("$defs") or js.get("definitions") or {}
    return defs if isinstance(defs, dict) else {}


def _resolve(node: Any, defs: dict) -> dict:
    """Follow ``$ref`` (``#/$defs/x`` or ``#/definitions/x``); unknown refs resolve to ``{}``."""
    seen = 0
    while isinstance(node, dict) and isinstance(node.get("$ref"), str) and seen < 16:
        seen += 1
        ref = node["$ref"]
        name = ref.rsplit("/", 1)[-1] if ref.startswith("#/") else ""
        target = defs.get(name)
        if not isinstance(target, dict):
            return {}
        extra = {k: v for k, v in node.items() if k != "$ref"}
        node = {**target, **extra} if extra else target
    return node if isinstance(node, dict) else {}


def _types_of(node: dict) -> list[str]:
    """Declared JSON types of a (resolved) node, in declaration order; inferred from
    ``properties`` / ``items`` / ``enum`` when ``type`` is absent; empty = unconstrained."""
    t = node.get("type")
    if isinstance(t, str):
        return [t]
    if isinstance(t, list):
        out: list[str] = []
        for x in t:
            if isinstance(x, str) and x not in out:
                out.append(x)
        return out
    if "properties" in node:
        return ["object"]
    if "items" in node:
        return ["array"]
    if "enum" in node and isinstance(node["enum"], list):
        out = []
        for m in node["enum"]:
            jt = _json_type(m)
            if jt not in out:
                out.append(jt)
        return out
    return []


def _json_type(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, (list, tuple)):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "unknown"


def _type_matches(value: Any, types: list[str]) -> bool:
    jt = _json_type(value)
    return jt in types or (jt == "integer" and "number" in types)


def _root_kind(js: dict) -> str:
    types = _types_of(_resolve(js, _defs_of(js)))
    return "array" if "array" in types and "object" not in types else "object"


def _array_fields(root: dict, defs: dict) -> list[str]:
    props = root.get("properties") or {}
    out = []
    for key, sub in props.items():
        sub = _resolve(sub, defs) if isinstance(sub, dict) else {}
        types = _types_of(sub)
        if not types:
            for branch in (sub.get("anyOf") or sub.get("oneOf") or []):
                types += _types_of(_resolve(branch, defs))
        if "array" in types:
            out.append(key)
    return out


def _strip_titles(node: Any) -> Any:
    """Drop pydantic's ``"title": "<str>"`` noise recursively (a property *named* ``title`` — a
    dict under ``properties`` — is kept)."""
    if isinstance(node, dict):
        return {k: _strip_titles(v) for k, v in node.items() if not (k == "title" and isinstance(v, str))}
    if isinstance(node, list):
        return [_strip_titles(v) for v in node]
    return node


def _schema_hint_js(js: dict) -> str:
    return SCHEMA_HINT_HEADER.format(kind=_root_kind(js)) + json.dumps(
        _strip_titles(js), separators=(",", ":"), ensure_ascii=False, default=str)


def schema_hint(schema: SchemaLike) -> str:
    """Compact, deterministic "OUTPUT FORMAT" block: ``SCHEMA_HINT_HEADER`` (``{kind}`` = the
    schema's root type) followed by the JSON schema with pydantic ``title`` noise removed
    (``description`` and ``enum`` kept). Same input -> same string, so ``ai_structured`` can
    detect that a system prompt already carries it and never inject it twice."""
    return _schema_hint_js(json_schema_of(schema))


# ---------------------------------------------------------------------------
# Shape coercion and enum normalisation (pure)
# ---------------------------------------------------------------------------

def _coerce_shape_js(data: Any, js: dict) -> Any:
    defs = _defs_of(js)
    root = _resolve(js, defs)
    types = _types_of(root)
    if "object" in types:
        props = root.get("properties") or {}
        array_fields = _array_fields(root, defs)
        if isinstance(data, list):
            return {array_fields[0]: data} if len(array_fields) == 1 else data
        if isinstance(data, dict) and len(data) == 1 and props:
            (key, value), = data.items()
            if key not in props:
                if isinstance(value, dict) and any(k in props for k in value):
                    return value
                if isinstance(value, list) and len(array_fields) == 1:
                    return {array_fields[0]: value}
        return data
    if "array" in types and isinstance(data, dict):
        lists = [v for v in data.values() if isinstance(v, list)]
        if len(lists) == 1:
            return lists[0]
        for key in WRAPPER_KEYS:
            if isinstance(data.get(key), list):
                return data[key]
    return data


def coerce_shape(data: Any, schema: SchemaLike) -> Any:
    """Bridge the wrapper ambiguities that used to crash call sites; pure, never raises for data.

    Schema root is an object:
      * a bare list and the schema has exactly one array-typed field -> ``{field: list}``;
      * a single-key dict whose key is not a declared property: a dict value that shares at least
        one declared key is unwrapped (``{"result": {...}}``), a list value is renamed onto the single
        array field (``{"controls": [...]}`` -> ``{"results": [...]}``).
    Schema root is an array:
      * a dict with exactly one list value -> that list; else the first ``WRAPPER_KEYS`` list.
    Anything else is returned unchanged. ``$ref`` to ``#/$defs/...`` is resolved.
    """
    return _coerce_shape_js(data, json_schema_of(schema))


def _enum_key(value: str) -> str:
    return _ENUM_KEY_RE.sub("_", value.strip().strip("\"'").lower())


def _enum_members(node: dict) -> list | None:
    if isinstance(node.get("enum"), list):
        return node["enum"]
    if "const" in node:
        return [node["const"]]
    return None


def _in_enum(value: Any, members: list) -> bool:
    for m in members:
        if isinstance(value, bool) != isinstance(m, bool):
            continue
        try:
            if value == m:
                return True
        except Exception:  # noqa: BLE001
            continue
    return False


def _pick_branch(value: Any, branches: list, defs: dict) -> dict | None:
    for branch in branches:
        b = _resolve(branch, defs)
        types = _types_of(b)
        if not types or _type_matches(value, types):
            return b
    return None


def _normalize(value: Any, node: Any, defs: dict, depth: int) -> Any:
    if depth > _MAX_DEPTH or not isinstance(node, dict):
        return value
    node = _resolve(node, defs)
    branches = node.get("anyOf") or node.get("oneOf")
    if isinstance(branches, list) and branches:
        branch = _pick_branch(value, branches, defs)
        return _normalize(value, branch, defs, depth + 1) if branch is not None else value
    if isinstance(value, str):
        members = _enum_members(node)
        if members and not _in_enum(value, members):
            key = _enum_key(value)
            hits = [m for m in members if isinstance(m, str) and _enum_key(m) == key]
            if len(hits) == 1:
                return hits[0]
        return value
    if isinstance(value, dict):
        props = node.get("properties") or {}
        if not props:
            return value
        return {k: (_normalize(v, props[k], defs, depth + 1) if k in props else v) for k, v in value.items()}
    if isinstance(value, list):
        items = node.get("items")
        if isinstance(items, dict):
            return [_normalize(v, items, defs, depth + 1) for v in value]
    return value


def normalize_enums(data: Any, json_schema: dict) -> Any:
    """Walk ``data`` guided by ``json_schema`` (``properties`` / ``items`` / ``anyOf`` / ``oneOf`` /
    ``$ref``) and fix unambiguous enum slips: a string that is not a member but whose
    case/space/dash-folded key (``"Not Covered"`` -> ``"not_covered"``) matches exactly ONE member
    is replaced by that member. Everything else is untouched; returns a copy; never raises."""
    try:
        return _normalize(data, json_schema, _defs_of(json_schema) if isinstance(json_schema, dict) else {}, 0)
    except Exception:  # noqa: BLE001 — pure helper; a pathological schema must not break the call
        logger.debug("normalize_enums skipped", exc_info=True)
        return data


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _snippet(value: Any) -> str:
    s = str(value)
    return s if len(s) <= _SNIPPET_CHARS else s[:_SNIPPET_CHARS - 1] + "…"


def _got(value: Any) -> str:
    if value is _MISSING:
        return ""
    if value is None or isinstance(value, (str, int, float, bool)):
        return " (got %r)" % _snippet(value)
    if isinstance(value, dict):
        return " (got a JSON object)"
    if isinstance(value, (list, tuple)):
        return " (got a JSON array)"
    return ""


def _line(path: str, msg: str, value: Any = _MISSING) -> str:
    return "- %s: %s%s" % (path or "<root>", msg, _got(value))


def _join_path(path: str, key: Any) -> str:
    return "%s.%s" % (path, key) if path else str(key)


_TYPE_MSG = {
    "string": "Input should be a valid string",
    "integer": "Input should be a valid integer",
    "number": "Input should be a valid number",
    "boolean": "Input should be a valid boolean",
    "array": "Input should be a valid array",
    "object": "Input should be a valid object",
    "null": "Input should be null",
}


def _type_msg(types: list[str]) -> str:
    if len(types) == 1:
        return _TYPE_MSG.get(types[0], "Input should be a valid %s" % types[0])
    return "Input should be one of: " + ", ".join(types)


def _coerce_type(value: Any, types: list[str]) -> tuple[bool, Any]:
    """Exact JSON-type match first (strings stripped), then the lax, unambiguous coercions:
    integer <- integral float / digit string; number <- numeric string; boolean <- true/false/
    yes/no; string <- int/float; null <- ""/"null"/"None". ``bool`` is never a number."""
    if _type_matches(value, types):
        return True, (value.strip() if isinstance(value, str) else value)
    if isinstance(value, bool):
        return False, value
    for t in types:
        if t == "null" and isinstance(value, str) and value.strip() in ("", "null", "None"):
            return True, None
        if t == "integer":
            if isinstance(value, float) and math.isfinite(value) and value.is_integer():
                return True, int(value)
            if isinstance(value, str) and _INT_RE.fullmatch(value.strip()):
                return True, int(value.strip())
        elif t == "number":
            if isinstance(value, str) and _NUMBER_RE.fullmatch(value.strip()):
                s = value.strip()
                try:
                    f = float(s)
                except ValueError:
                    continue
                if math.isfinite(f):
                    return True, (int(s) if _INT_RE.fullmatch(s) else f)
        elif t == "boolean":
            if isinstance(value, str):
                s = value.strip().lower()
                if s in ("true", "yes"):
                    return True, True
                if s in ("false", "no"):
                    return True, False
        elif t == "string":
            if isinstance(value, (int, float)) and math.isfinite(value):
                return True, str(value)
    return False, value


def _join_members(members: list) -> str:
    return ", ".join(repr(m) for m in members)


def _check(value: Any, node: Any, path: str, defs: dict, errors: list[str], depth: int = 0) -> Any:
    """JSON-Schema-subset validator returning a coerced copy of ``value`` and appending
    ``"- path: message"`` lines to ``errors``."""
    if depth > _MAX_DEPTH or not isinstance(node, dict):
        return value
    node = _resolve(node, defs)
    branches = node.get("anyOf") or node.get("oneOf")
    if isinstance(branches, list) and branches:
        best: tuple[list[str], Any] | None = None
        for branch in branches:
            sub: list[str] = []
            candidate = _check(value, branch, path, defs, sub, depth + 1)
            if not sub:
                return candidate
            if best is None or len(sub) < len(best[0]):
                best = (sub, candidate)
        errors.extend(best[0] if best else [_line(path, "Input did not match any allowed form", value)])
        return value
    types = _types_of(node)
    if types:
        ok, value = _coerce_type(value, types)
        if not ok:
            errors.append(_line(path, _type_msg(types), value))
            return value
    members = _enum_members(node)
    if members is not None and not _in_enum(value, members):
        errors.append(_line(path, "Input should be " + _join_members(members), value))
        return value
    if isinstance(value, dict):
        return _check_object(value, node, path, defs, errors, depth)
    if isinstance(value, (list, tuple)):
        return _check_array(list(value), node, path, defs, errors, depth)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        _check_number(value, node, path, errors)
    elif isinstance(value, str):
        _check_string(value, node, path, errors)
    return value


def _check_object(value: dict, node: dict, path: str, defs: dict, errors: list[str], depth: int) -> dict:
    props = node.get("properties") if isinstance(node.get("properties"), dict) else {}
    required = node.get("required") if isinstance(node.get("required"), list) else []
    out: dict = {}
    for key, sub in props.items():
        p = _join_path(path, key)
        if key in value:
            out[key] = _check(value[key], sub, p, defs, errors, depth + 1)
        elif key in required:
            errors.append(_line(p, "Field required"))
        else:
            resolved = _resolve(sub, defs) if isinstance(sub, dict) else {}
            if "default" in resolved:
                out[key] = copy.deepcopy(resolved["default"])
    for key in required:
        if key not in props and key not in value:
            errors.append(_line(_join_path(path, key), "Field required"))
    additional = node.get("additionalProperties", True)
    for key, v in value.items():
        if key in props:
            continue
        if additional is False:
            continue  # dropped silently, like pydantic extra="ignore"
        if isinstance(additional, dict):
            out[key] = _check(v, additional, _join_path(path, key), defs, errors, depth + 1)
        else:
            out[key] = v
    return out


def _check_array(value: list, node: dict, path: str, defs: dict, errors: list[str], depth: int) -> list:
    min_items, max_items = node.get("minItems"), node.get("maxItems")
    if isinstance(min_items, int) and not isinstance(min_items, bool) and len(value) < min_items:
        errors.append(_line(path, "List should have at least %d item(s) (got %d)" % (min_items, len(value))))
    if isinstance(max_items, int) and not isinstance(max_items, bool) and len(value) > max_items:
        errors.append(_line(path, "List should have at most %d item(s) (got %d)" % (max_items, len(value))))
    items = node.get("items")
    if isinstance(items, dict):
        return [_check(v, items, _join_path(path, i), defs, errors, depth + 1) for i, v in enumerate(value)]
    return list(value)


def _check_number(value: Any, node: dict, path: str, errors: list[str]) -> None:
    def num(key):
        v = node.get(key)
        return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None

    if isinstance(value, float) and not math.isfinite(value):
        # json.loads accepts the non-standard NaN / Infinity literals; nan also slips past every
        # bound comparison and json.dumps would emit it again, which browsers cannot parse.
        errors.append(_line(path, "Input should be a finite number", value))
        return
    lo, hi, xlo, xhi = num("minimum"), num("maximum"), num("exclusiveMinimum"), num("exclusiveMaximum")
    if lo is not None and value < lo:
        errors.append(_line(path, "Input should be greater than or equal to %s" % lo, value))
    if hi is not None and value > hi:
        errors.append(_line(path, "Input should be less than or equal to %s" % hi, value))
    if xlo is not None and value <= xlo:
        errors.append(_line(path, "Input should be greater than %s" % xlo, value))
    if xhi is not None and value >= xhi:
        errors.append(_line(path, "Input should be less than %s" % xhi, value))


def _check_string(value: str, node: dict, path: str, errors: list[str]) -> None:
    lo, hi, pattern = node.get("minLength"), node.get("maxLength"), node.get("pattern")
    if isinstance(lo, int) and not isinstance(lo, bool) and len(value) < lo:
        errors.append(_line(path, "String should have at least %d character(s)" % lo, value))
    if isinstance(hi, int) and not isinstance(hi, bool) and len(value) > hi:
        errors.append(_line(path, "String should have at most %d character(s)" % hi, value))
    if isinstance(pattern, str):
        try:
            if re.search(pattern, value) is None:
                errors.append(_line(path, "String should match pattern %r" % pattern, value))
        except re.error:
            pass


def _format_lines(lines: list[str], limit: int = MAX_ERROR_LINES) -> str:
    if len(lines) > limit:
        return "\n".join(lines[:limit] + ["- (%d more)" % (len(lines) - limit)])
    return "\n".join(lines)


def format_validation_error(exc: ValidationError, limit: int = MAX_ERROR_LINES) -> str:
    """Pydantic ``ValidationError`` -> ``"- results.2.verdict: Input should be ... (got 'x')"``
    lines (root path ``<root>``), first ``limit`` then ``"- (N more)"``."""
    try:
        raw_errors = exc.errors(include_url=False)
    except Exception:  # noqa: BLE001
        return "- <root>: %s" % _snippet(str(exc))
    lines = []
    for err in raw_errors:
        loc = ".".join(str(x) for x in (err.get("loc") or ())) or "<root>"
        inp = err.get("input", _MISSING)
        if not (inp is None or isinstance(inp, (str, int, float, bool))):
            inp = _MISSING
        lines.append(_line(loc, str(err.get("msg") or "invalid value"), inp))
    return _format_lines(lines, limit)


def _validate_js(data: Any, schema: SchemaLike, js: dict, *, normalize: bool) -> tuple[bool, str | None, Any]:
    if normalize:
        data = normalize_enums(data, js)
    if isinstance(schema, dict):
        errors: list[str] = []
        value = _check(data, js, "", _defs_of(js), errors)
        if errors:
            return False, _format_lines(errors), None
        return True, None, value
    try:
        if _is_model_class(schema):
            value = schema.model_validate(data)
        else:
            value = TypeAdapter(schema).validate_python(data)
    except ValidationError as exc:
        return False, format_validation_error(exc), None
    except Exception as exc:  # noqa: BLE001 — a validator raising TypeError etc. is still "bad data" here
        return False, _line("<root>", "%s: %s" % (type(exc).__name__, _snippet(str(exc)))), None
    return True, None, value


def validate_against(data: Any, schema_or_model: SchemaLike, *, normalize: bool = True) -> tuple[bool, str | None, Any]:
    """``(True, None, validated_value)`` or ``(False, "- path: message\\n- ...", None)``. Never
    raises for bad data (only ``TypeError`` for an unsupported schema object).

    * ``normalize=True`` first applies ``normalize_enums`` (unambiguous case/space/dash slips).
    * Pydantic model class -> ``Model.model_validate`` (lax mode: ``"0.8"`` -> 0.8).
    * Typing form (``list[Model]``, ...) -> ``TypeAdapter(schema).validate_python``.
    * dict -> in-module JSON-Schema-subset validator returning a coerced COPY. Keywords: ``type``
      (single or list), ``enum``, ``const``, ``properties``, ``required``, ``additionalProperties``
      (``False`` drops unknown keys silently, like pydantic ``extra="ignore"``; a schema validates
      them), ``items``, ``minItems``/``maxItems``, ``minimum``/``maximum``/``exclusiveMinimum``/
      ``exclusiveMaximum``, ``minLength``/``maxLength``/``pattern``, ``anyOf``/``oneOf`` (first
      branch that validates; otherwise the errors of the closest branch), ``$ref`` (``#/$defs/x``,
      ``#/definitions/x``), ``default`` (filled in for a missing non-required property). Unknown
      keywords are ignored. Lax coercions are deterministic and unambiguous only (see
      ``_coerce_type``); ``bool`` is never accepted as a number; ``NaN`` / ``Infinity`` (which
      ``json.loads`` accepts) are never accepted as numbers.
    """
    return _validate_js(data, schema_or_model, json_schema_of(schema_or_model), normalize=normalize)


# ---------------------------------------------------------------------------
# Exception classification
# ---------------------------------------------------------------------------

def _is_timeout(exc: BaseException) -> bool:
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return True
    try:
        import httpx
    except Exception:  # noqa: BLE001
        return False
    return isinstance(exc, httpx.TimeoutException)


def _is_connect(exc: BaseException) -> bool:
    try:
        import httpx
        if isinstance(exc, (httpx.ConnectError, httpx.NetworkError)):
            return True
    except Exception:  # noqa: BLE001
        pass
    return isinstance(exc, (ConnectionError, OSError))


def classify_exception(exc: BaseException) -> tuple[FailureKind, str]:
    """``(kind, admin-safe message)`` for an exception raised by the model call.

    * ``ai_provider.AICallError`` -> its ``kind`` mapped (``timeout``, ``unreachable`` -> transport,
      ``empty``, ``truncated``; everything else -> ``provider``) with its own safe ``detail``;
    * other ``AIProviderError`` -> ``("provider", str(exc))`` (configuration messages are safe);
    * timeouts (``asyncio``/builtin/``httpx.TimeoutException``) -> ``timeout``;
    * ``httpx.ConnectError`` / ``ConnectionError`` / ``OSError`` -> ``transport``;
    * anything else -> ``("transport", "AI call failed (<ExceptionName>).")`` — ``str(exc)`` is never
      embedded (httpx messages carry the full URL); the caller logs the traceback.
    ``asyncio.CancelledError`` / ``KeyboardInterrupt`` are re-raised, never classified.
    """
    if isinstance(exc, (asyncio.CancelledError, KeyboardInterrupt)):
        raise exc
    if isinstance(exc, ai_provider.AICallError):
        kind = _PROVIDER_KIND.get(str(getattr(exc, "kind", "") or ""), "provider")
        detail = getattr(exc, "detail", None) or str(exc) or "The AI request failed."
        return kind, str(detail)  # type: ignore[return-value]
    if isinstance(exc, ai_provider.AIProviderError):
        return "provider", (str(exc) or "The AI provider configuration is unusable.")
    if _is_timeout(exc):
        return "timeout", "The AI service did not answer in time."
    if _is_connect(exc):
        return "transport", "The AI service could not be reached."
    return "transport", "AI call failed (%s)." % type(exc).__name__


# ---------------------------------------------------------------------------
# The structured call
# ---------------------------------------------------------------------------

def _inject_hint(messages: list[dict], hint: str) -> list[dict]:
    """Copy of ``messages`` with ``hint`` appended to the first system message (unless it already
    contains it) or inserted as a new first system message. Never adds a second system message."""
    out = [dict(m) for m in messages]
    if not hint:
        return out
    if out and str(out[0].get("role") or "").strip().lower() == "system":
        content = "" if out[0].get("content") is None else str(out[0]["content"])
        if hint not in content:
            out[0]["content"] = (content.rstrip() + "\n\n" + hint) if content.strip() else hint
        return out
    out.insert(0, {"role": "system", "content": hint})
    return out


def _prepare_messages(messages: Any, js: dict, schema_in_prompt: bool | str) -> list[dict]:
    if not isinstance(messages, (list, tuple)) or not messages:
        raise ValueError("messages must be a non-empty list of {'role', 'content'} dicts")
    for m in messages:
        if not isinstance(m, dict) or str(m.get("role") or "").strip().lower() not in _ROLES:
            raise ValueError("every message needs a role in %s and a content" % (_ROLES,))
    base = [dict(m) for m in messages]
    if schema_in_prompt is True:
        return _inject_hint(base, _schema_hint_js(js))
    if isinstance(schema_in_prompt, str):
        return _inject_hint(base, schema_in_prompt)
    return base


def _model_name(kwargs: dict) -> str:
    name = kwargs.get("model")
    if name:
        return str(name)
    try:
        return ai_provider.env_ai_config().model
    except Exception:  # noqa: BLE001 — informational only
        return "unknown"


def _run_check(check: Callable[[Any], Any], data: Any) -> list[str]:
    try:
        issues = check(data)
    except Exception as exc:  # noqa: BLE001 — a buggy check must not turn into a 500 for the tenant
        logger.warning("ai_structured: check() raised %s; treated as a validation failure",
                       type(exc).__name__, exc_info=True)
        return ["consistency check failed (%s)" % type(exc).__name__]
    if not issues:
        return []
    if isinstance(issues, str):
        issues = [issues]
    return [str(i).strip() for i in issues if str(i).strip()]


def _issues_text(issues: list[str]) -> str:
    return "\n".join(i if i.startswith("- ") else "- %s" % i for i in issues[:MAX_ERROR_LINES])


def _final_error(kind: str | None, attempts: int) -> str:
    n = "%d attempt(s)" % attempts
    if kind == "empty":
        return "The AI service returned an empty answer after %s." % n
    if kind == "truncated":
        return "The AI output was cut off before the JSON was complete after %s." % n
    if kind == "malformed":
        return "The AI reply did not contain valid JSON after %s." % n
    return "The AI reply did not match the required format after %s." % n


def _log_attempt(kind: str, attempts: int, retries: int, task: Any, errors: str, raw: str | None) -> None:
    head = " | ".join(errors.splitlines()[:3])
    logger.warning("ai_structured: %s on attempt %d/%d (task=%s): %s", kind, attempts, retries + 1, task or "-", head)
    if raw and getattr(settings, "AI_LOG_PROMPTS", False):
        logger.debug("ai_structured raw reply (task=%s): %s", task or "-", raw[:20000])


def _unwrap_optional(annotation: Any) -> Any:
    if get_origin(annotation) is Union:
        args = [a for a in get_args(annotation) if a is not type(None)]
        if len(args) == 1:
            return args[0]
    return annotation


def _item_schema(schema: SchemaLike, js: dict, partial_items: str) -> SchemaLike | None:
    """Schema for ONE element of the salvaged list: a typing form / model class when the root is
    Pydantic (so items validate as model instances), else the JSON-schema ``items`` dict with the
    root's ``$defs`` attached."""
    if partial_items == "" and not isinstance(schema, dict) and not _is_model_class(schema):
        ann = _unwrap_optional(schema)
        args = get_args(ann)
        if get_origin(ann) in (list, tuple, set, frozenset) and args:
            return args[0]
    if partial_items and _is_model_class(schema):
        fld = getattr(schema, "model_fields", {}).get(partial_items)
        if fld is not None:
            ann = _unwrap_optional(fld.annotation)
            args = get_args(ann)
            if get_origin(ann) in (list, tuple, set, frozenset) and args:
                return args[0]
    defs = _defs_of(js)
    root = _resolve(js, defs)
    node = root if partial_items == "" else _resolve((root.get("properties") or {}).get(partial_items) or {}, defs)
    items = node.get("items")
    if not isinstance(items, dict):
        for branch in (node.get("anyOf") or node.get("oneOf") or []):
            b = _resolve(branch, defs)
            if isinstance(b.get("items"), dict):
                items = b["items"]
                break
    if not isinstance(items, dict):
        return None
    return {**items, "$defs": defs} if defs and "$defs" not in items else items


def _kept_count(data: Any, partial_items: str) -> int:
    """Number of items in the salvaged list (informational, for the log line only)."""
    items = data if partial_items == "" else (
        getattr(data, partial_items, None) if isinstance(data, BaseModel) else (data or {}).get(partial_items))
    return len(items) if isinstance(items, (list, tuple)) else 0


def _salvage(parsed: Any, schema: SchemaLike, js: dict, partial_items: str, raw: str | None, attempts: int,
             model_name: str, errors: str, check: Callable[[Any], Any] | None) -> AiResult | None:
    if partial_items == "":
        items_raw = parsed
    elif isinstance(parsed, dict):
        items_raw = parsed.get(partial_items)
    else:
        return None
    if not isinstance(items_raw, list):
        return None
    item_schema = _item_schema(schema, js, partial_items)
    if item_schema is None:
        return None
    good, bad = [], []
    for i, item in enumerate(items_raw):
        ok, err, _ = validate_against(item, item_schema)
        if ok:
            good.append(item)
        else:
            bad.append({"index": i, "item": item, "errors": err or ""})
    if not good or not bad:
        return None
    rebuilt = good if partial_items == "" else {**parsed, partial_items: good}
    ok, _err, data = _validate_js(rebuilt, schema, js, normalize=True)
    if ok and check is not None and _run_check(check, data):
        ok = False
    if not ok:
        return None
    return AiResult(ok=True, data=data, raw=raw, attempts=attempts, model=model_name, kind=None,
                    error="%d item(s) failed validation and were dropped" % len(bad),
                    validation_errors=errors.splitlines(), partial=True, invalid_items=bad)


async def ai_structured(
    messages: list[dict],
    schema: SchemaLike,
    *,
    retries: int = 1,
    check: Callable[[Any], Any] | None = None,
    schema_in_prompt: bool | str = True,
    partial_items: str | None = None,
    temperature: float = 0.0,
    json_mode: bool = True,
    call_fn: Callable[..., Awaitable[str]] | None = None,
    **ai_complete_kwargs,
) -> AiResult:
    """Call the model for JSON, extract, validate, repair once, and return an ``AiResult``.

    messages          Same list you would pass to ``ai_complete`` (system prompt first). Never
                      mutated; the schema text is injected into a copy.
    schema            dict (JSON-Schema subset) | Pydantic model class | typing form (``list[Model]``).
    retries           Repair rounds (NOT model calls): ``1`` -> at most 2 calls; ``0`` -> one call.
    check             ``check(validated_data) -> list[str]`` semantic validator (e.g.
                      ``ai_prompts.consistency_issues``); a non-empty list is a failure whose lines
                      are fed back to the model on the repair turn. Word issues for the model
                      ("missing verdict for A.5.18"). A raising ``check`` counts as a failure too.
    schema_in_prompt  ``True``: inject ``schema_hint(schema)`` into the system prompt (skipped when
                      the identical text is already there); a ``str``: inject that text verbatim;
                      ``False``: the caller's prompt already carries the schema (component A).
    partial_items     Name of the root list field (``""`` for a root array) whose valid items are
                      salvaged after the final failure -> ``ok=True, partial=True, invalid_items=[...]``.
    temperature       Default 0.0 (greedy) — overrides ``ai_complete``'s 0.1; pass explicitly to change.
    json_mode         Always passed through (``format:"json"`` is the floor the cloud model honours).
    call_fn           Test seam: ``async (messages, **kw) -> str``; defaults to ``ai_provider.ai_complete``.
    **ai_complete_kwargs  ``model``, ``num_ctx``, ``num_predict``, ``timeout_s``, ``user_id``,
                      ``tenant_id``, ``db``, ``task``, ``think``, ``seed``, ... — splat
                      ``**ai_provider.decoding("analysis")`` here.

    Returns ``AiResult``; never raises for model/format/transport problems (they come back as
    ``ok=False`` with ``kind`` in ``FAILURE_KINDS``). Transport/timeout/provider failures are
    returned immediately (component E owns transport retries); empty/cut-off replies are
    re-asked from the base prompt (``num_predict`` doubled from the largest value already tried,
    cap ``NUM_PREDICT_CAP``, only when the caller set one) — the calls component E already made
    for that reply (its own num_predict retry, a transport retry) count towards ``attempts`` and
    ``retries``, so ``retries=1`` never exceeds two model calls in total; malformed/invalid
    replies get one repair turn carrying the previous
    reply (first ``MAX_REPLAY_CHARS``) and the error lines. Raises ``TypeError``/``ValueError``
    only for a bad ``schema`` / ``messages`` (programming errors), before any call.
    """
    js = json_schema_of(schema)                                   # TypeError: programming error
    base = _prepare_messages(messages, js, schema_in_prompt)      # ValueError: programming error
    call = call_fn or ai_provider.ai_complete
    model_name = _model_name(ai_complete_kwargs)
    task = ai_complete_kwargs.get("task")
    root_kind = _root_kind(js)
    retries = max(0, int(retries or 0))
    kw = dict(ai_complete_kwargs)
    msgs = base
    attempts = 0
    raw: str | None = None
    kind: str | None = None
    errors = ""
    salvage: tuple[Any, str, str | None] | None = None            # (parsed, errors, raw) of the last parsed attempt

    while True:
        attempts += 1
        try:
            reply = await call(msgs, json_mode=json_mode, temperature=temperature, **kw)
        except Exception as exc:  # noqa: BLE001 — everything the transport/provider raised
            kind, msg = classify_exception(exc)
            if kind not in ("empty", "truncated"):
                logger.warning("ai_structured: %s on attempt %d (task=%s): %s", kind, attempts, task or "-", msg,
                               exc_info=not isinstance(exc, ai_provider.AIProviderError))
                return AiResult(ok=False, data=None, error=msg, raw=None, attempts=attempts,
                                model=model_name, kind=kind)  # type: ignore[arg-type]
            raw = getattr(exc, "raw", None)
            raw = str(raw) if raw else None
            errors = _line("<root>", msg)
            # The provider layer may already have re-sent the same request (its own num_predict
            # doubling on a cut-off JSON reply, a transport retry): those calls count here too, so
            # `attempts` stays "model calls actually made" and `retries` bounds the real volume.
            inner = int(getattr(exc, "attempts", 1) or 1)
            if inner > 1:
                attempts += inner - 1
            tried = getattr(exc, "num_predict", None)
            if tried:
                kw["num_predict"] = max(int(kw.get("num_predict") or 0), int(tried))
        else:
            raw = "" if reply is None else str(reply)
            if not raw.strip():
                kind, errors = "empty", _line("<root>", "the reply was empty")
            else:
                try:
                    parsed = _coerce_shape_js(extract_json(raw), js)
                except JsonExtractError as exc:
                    kind, errors = ("truncated" if exc.truncated else "malformed"), _line("<root>", str(exc))
                else:
                    ok, err, data = _validate_js(parsed, schema, js, normalize=True)
                    if ok and check is not None:
                        issues = _run_check(check, data)
                        if issues:
                            ok, err = False, _issues_text(issues)
                    if ok:
                        return AiResult(ok=True, data=data, error=None, raw=raw, attempts=attempts, model=model_name)
                    kind, errors = "validation", (err or _line("<root>", "invalid value"))
                    salvage = (parsed, errors, raw)
        _log_attempt(kind or "error", attempts, retries, task, errors, raw)
        if attempts > retries:
            break
        if kind in ("empty", "truncated"):
            msgs = base
            if kind == "truncated" and kw.get("num_predict"):
                kw["num_predict"] = min(int(kw["num_predict"]) * 2, NUM_PREDICT_CAP)
        else:
            msgs = base + [{"role": "assistant", "content": (raw or "")[:MAX_REPLAY_CHARS]},
                           {"role": "user", "content": REPAIR_PROMPT.format(errors=errors, kind=root_kind)}]

    if partial_items is not None and salvage is not None:
        parsed, s_errors, s_raw = salvage
        result = _salvage(parsed, schema, js, partial_items, s_raw, attempts, model_name, s_errors, check)
        if result is not None:
            logger.warning("ai_structured: partial salvage kept %d item(s), dropped %d (task=%s)",
                           _kept_count(result.data, partial_items), len(result.invalid_items), task or "-")
            return result

    return AiResult(ok=False, data=None, error=_final_error(kind, attempts), raw=raw, attempts=attempts,
                    model=model_name, kind=kind, validation_errors=errors.splitlines())  # type: ignore[arg-type]


def ai_structured_sync(messages: list[dict], schema: SchemaLike, **kwargs) -> AiResult:
    """Blocking twin of ``ai_structured`` for thread-pool / daemon-thread call sites (each thread
    runs its own event loop). Raises ``RuntimeError`` when called from inside a running loop —
    ``await ai_structured(...)`` there instead."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(ai_structured(messages, schema, **kwargs))
    raise RuntimeError("ai_structured_sync() called inside a running event loop; await ai_structured() instead")
