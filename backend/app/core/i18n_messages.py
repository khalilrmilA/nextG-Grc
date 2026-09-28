"""Localisation of the human-readable text the API returns (``detail`` / ``message``).

The backend historically answered in English only. The UI sends
``Accept-Language: <ui lang>`` on every request, so the text a user reads in an
error banner or a "Test connection" result must follow it. This module is the
single lookup table for that — generated once, committed as JSON, never
produced at runtime:

* ``app/core/locales/messages_source.json`` — every static message and every
  f-string *template* found in ``backend/app`` by ``scripts/extract_api_messages.py``;
* ``app/core/locales/messages_{fr,ar}.json`` — ``{"static": {en: tr},
  "templates": {en_tpl: tr_tpl}}`` produced by ``scripts/translate_api_messages.py``.

Lookup (``translate_text``) — never raises, unknown text passes through unchanged:
1. exact match of the English string;
2. template match: every ``{placeholder}`` template is compiled to an anchored
   regex; the captured values (ids, names, counts) are re-inserted verbatim into
   the translated template;
3. a ``"<prefix>: <rest>"`` / ``"<sentence>. <sentence>"`` split, each half looked
   up on its own (covers ``f"{label}: {reason}"`` compositions);
4. otherwise the input is returned as is.

``msg(template, lang, **values)`` renders a template for code that builds a
message itself (success payloads, joined sentences).

English is the identity: ``translate_text(x, "en") is x`` — English responses stay
byte-identical to what the API returned before localisation existed.
"""
from __future__ import annotations

import json
import logging
import re
import string
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

logger = logging.getLogger(__name__)

LOCALES_DIR = Path(__file__).resolve().parent / "locales"
SUPPORTED = ("fr", "ar")

# English messages the (already deployed) frontend matches on by substring — they must
# stay English or client logic silently changes. See the report / selftest.
#   RegisterPage.tsx  : detail.includes("slug")  -> retries with a random slug suffix
#   AuditsPage.tsx    : detail.includes("already") -> "already assigned" is not a failure
EXEMPT: frozenset[str] = frozenset({
    "Organization slug already taken",
    "That organization slug is reserved",
    "Auditor is already assigned to this assessment",
})

_FORMATTER = string.Formatter()


def _placeholders(tpl: str) -> list[str] | None:
    """Field names of a str.format template, or None if it is malformed."""
    try:
        return [f for _, f, _, _ in _FORMATTER.parse(tpl) if f is not None]
    except (ValueError, TypeError):
        return None


def _template_regex(tpl: str) -> re.Pattern[str] | None:
    try:
        parsed = list(_FORMATTER.parse(tpl))
    except ValueError:
        return None
    out: list[str] = []
    seen: set[str] = set()
    for literal, field, _, _ in parsed:
        out.append(re.escape(literal))
        if field is None:
            continue
        if not field or not field.isidentifier():
            return None
        if field in seen:
            out.append(f"(?P={field})")
        else:
            seen.add(field)
            out.append(f"(?P<{field}>.+?)")
    try:
        return re.compile(r"\A" + "".join(out) + r"\Z", re.DOTALL)
    except re.error:
        return None


class _Catalog:
    def __init__(self, lang: str, data: dict[str, Any]):
        self.lang = lang
        self.static: dict[str, str] = {}
        for k, v in (data.get("static") or {}).items():
            if isinstance(k, str) and isinstance(v, str) and v.strip():
                self.static[k] = v
        self.templates: list[tuple[re.Pattern[str], str, int, str]] = []
        self.template_map: dict[str, str] = {}
        for src, tr in (data.get("templates") or {}).items():
            if not (isinstance(src, str) and isinstance(tr, str) and tr.strip()):
                continue
            ps, pt = _placeholders(src), _placeholders(tr)
            if ps is None or pt is None or set(ps) != set(pt):
                continue
            rx = _template_regex(src)
            if rx is None:
                continue
            literal_len = sum(len(lit) for lit, _, _, _ in _FORMATTER.parse(src))
            self.templates.append((rx, tr, literal_len, src))
            self.template_map[src] = tr
        # Most specific (longest literal text) first, so "X not found: {id}" beats "{a}: {b}".
        self.templates.sort(key=lambda t: -t[2])


@lru_cache(maxsize=None)
def _catalog(lang: str) -> _Catalog | None:
    if lang not in SUPPORTED:
        return None
    path = LOCALES_DIR / f"messages_{lang}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except Exception:  # noqa: BLE001 — a broken catalog must never break a response
        logger.exception("i18n_messages: cannot load %s", path)
        return None
    return _Catalog(lang, data if isinstance(data, dict) else {})


def normalize_lang(lang: object) -> str:
    if isinstance(lang, str):
        code = lang.strip().lower()[:2]
        if code in SUPPORTED:
            return code
    return "en"


_SPLIT_COLON = re.compile(r"\A(.{3,120}?): (.+)\Z", re.DOTALL)


def _lookup(text: str, cat: _Catalog, depth: int = 0) -> str | None:
    hit = cat.static.get(text)
    if hit is not None:
        return hit
    stripped = text.strip()
    if stripped != text and stripped in cat.static:
        return text.replace(stripped, cat.static[stripped])
    for rx, tr, _, _ in cat.templates:
        m = rx.match(text)
        if m is None:
            continue
        values = m.groupdict()
        if depth < 2:  # a captured value may itself be a known message ("...: {reason}")
            values = {k: (_lookup(v, cat, depth + 1) or _lookup_list(v, cat, depth + 1) or v)
                      for k, v in values.items()}
        try:
            return tr.format(**values)
        except (KeyError, IndexError, ValueError):
            continue
    if depth < 2:
        m = _SPLIT_COLON.match(text)
        if m:
            head, tail = m.group(1), m.group(2)
            th, tt = _lookup(head, cat, depth + 1), _lookup(tail, cat, depth + 1)
            if th is not None or tt is not None:
                return f"{th or head}: {tt or tail}"
    return None


def _lookup_list(text: str, cat: _Catalog, depth: int) -> str | None:
    """A ", "-joined list of known phrases ("an uppercase letter, a digit") — translated
    only when every item is known, joined with the language's comma."""
    items = text.split(", ")
    if len(items) < 2:
        return None
    out = []
    for item in items:
        tr = _lookup(item, cat, depth)
        if tr is None:
            return None
        out.append(tr)
    return ("، " if cat.lang == "ar" else ", ").join(out)


def translate_text(text: Any, lang: str | None) -> Any:
    """Localise one English API message. Non-strings, English, unknown text and the
    EXEMPT set are returned unchanged (the very same object). Never raises."""
    if not isinstance(text, str) or not text:
        return text
    code = normalize_lang(lang)
    if code == "en" or text in EXEMPT:
        return text
    try:
        cat = _catalog(code)
        if cat is None:
            return text
        out = _lookup(text, cat)
        return text if out is None else out
    except Exception:  # noqa: BLE001
        logger.exception("i18n_messages: translate failed")
        return text


def translate_detail(detail: Any, lang: str | None) -> Any:
    """Localise an HTTPException ``detail``: a string, or the human fields
    (``message`` / ``detail`` / ``msg``) of a dict / list of dicts. Machine fields
    (``error``, ``feature``, codes, ids) are never touched. Returns a new object
    only when something changed."""
    code = normalize_lang(lang)
    if code == "en":
        return detail
    if isinstance(detail, str):
        return translate_text(detail, code)
    if isinstance(detail, dict):
        out = dict(detail)
        for key in ("message", "detail", "msg", "hint"):
            if isinstance(out.get(key), str):
                out[key] = translate_text(out[key], code)
        return out
    if isinstance(detail, list):
        return [translate_detail(item, code) if isinstance(item, (dict, str)) else item for item in detail]
    return detail


def msg(template: str, lang: str | None, /, **values: Any) -> str:
    """Render ``template`` (English, ``str.format`` syntax) in ``lang``.

    ``msg("Connected to Nessus — {n} scan(s) visible.", "fr", n=3)``. Falls back to the
    English template when the language or the template is not in the catalog."""
    code = normalize_lang(lang)
    tpl = template
    if code != "en":
        cat = _catalog(code)
        if cat is not None:
            tpl = cat.template_map.get(template) or cat.static.get(template) or template
    try:
        return tpl.format(**values) if values else tpl
    except (KeyError, IndexError, ValueError):
        try:
            return template.format(**values)
        except (KeyError, IndexError, ValueError):
            return template


def translate_many(texts: Iterable[str], lang: str | None) -> list[str]:
    return [translate_text(t, lang) for t in texts]


def request_language(request: Any) -> str:
    """UI language of a request (Accept-Language, q-values honoured) — en/fr/ar."""
    try:
        from app.services.ai_locale import language_from_request
        return language_from_request(request)
    except Exception:  # noqa: BLE001
        return "en"


# ---------------------------------------------------------------------------
# 422 request-validation errors (pydantic) — msg localised per error ``type``
# ---------------------------------------------------------------------------
# Templates use the pydantic ``ctx`` keys. ``loc``, ``type``, ``input``, ``ctx`` and
# ``url`` are never touched; an unknown type keeps pydantic's English ``msg``.
_VALIDATION_TEMPLATES: dict[str, dict[str, str]] = {
    "fr": {
        "missing": "Champ obligatoire",
        "string_too_short": "Doit contenir au moins {min_length} caractère(s)",
        "string_too_long": "Doit contenir au plus {max_length} caractère(s)",
        "too_short": "Doit contenir au moins {min_length} élément(s), pas {actual_length}",
        "too_long": "Doit contenir au plus {max_length} élément(s), pas {actual_length}",
        "string_type": "Doit être une chaîne de caractères valide",
        "string_pattern_mismatch": "Doit correspondre au motif '{pattern}'",
        "int_type": "Doit être un nombre entier valide",
        "int_parsing": "Doit être un nombre entier valide (impossible d'interpréter la valeur comme un entier)",
        "int_from_float": "Doit être un nombre entier valide (nombre décimal reçu)",
        "float_type": "Doit être un nombre valide",
        "float_parsing": "Doit être un nombre valide (impossible d'interpréter la valeur comme un nombre)",
        "decimal_type": "Doit être un nombre décimal valide",
        "decimal_parsing": "Doit être un nombre décimal valide",
        "bool_type": "Doit être un booléen valide",
        "bool_parsing": "Doit être un booléen valide (impossible d'interpréter la valeur comme un booléen)",
        "greater_than": "Doit être supérieur à {gt}",
        "greater_than_equal": "Doit être supérieur ou égal à {ge}",
        "less_than": "Doit être inférieur à {lt}",
        "less_than_equal": "Doit être inférieur ou égal à {le}",
        "multiple_of": "Doit être un multiple de {multiple_of}",
        "finite_number": "Doit être un nombre fini",
        "enum": "Doit être {expected}",
        "literal_error": "Doit être {expected}",
        "dict_type": "Doit être un objet (dictionnaire) valide",
        "model_type": "Doit être un objet valide",
        "model_attributes_type": "Doit être un objet valide",
        "list_type": "Doit être une liste valide",
        "set_type": "Doit être un ensemble valide",
        "tuple_type": "Doit être un tuple valide",
        "extra_forbidden": "Champ supplémentaire non autorisé",
        "json_invalid": "JSON invalide",
        "json_type": "Doit être un JSON valide",
        "uuid_type": "Doit être un UUID valide",
        "uuid_parsing": "Doit être un UUID valide",
        "date_type": "Doit être une date valide",
        "date_parsing": "Doit être une date valide (AAAA-MM-JJ)",
        "date_from_datetime_parsing": "Doit être une date valide (AAAA-MM-JJ)",
        "date_from_datetime_inexact": "Doit être une date sans composante horaire",
        "datetime_type": "Doit être une date et heure valides",
        "datetime_parsing": "Doit être une date et heure valides",
        "datetime_from_date_parsing": "Doit être une date et heure valides",
        "time_type": "Doit être une heure valide",
        "time_parsing": "Doit être une heure valide",
        "url_type": "Doit être une URL valide",
        "url_parsing": "Doit être une URL valide",
        "url_scheme": "Le schéma de l'URL doit être {expected_schemes}",
        "url_too_long": "L'URL doit contenir au plus {max_length} caractère(s)",
        "bytes_type": "Doit être des octets valides",
        "none_required": "Doit être nul (None)",
        "is_instance_of": "Type de valeur invalide",
        "union_tag_invalid": "Valeur de discriminant invalide",
        "union_tag_not_found": "Valeur de discriminant manquante",
    },
    "ar": {
        "missing": "الحقل مطلوب",
        "string_too_short": "يجب أن يحتوي على {min_length} حرف على الأقل",
        "string_too_long": "يجب ألا يتجاوز {max_length} حرفًا",
        "too_short": "يجب أن يحتوي على {min_length} عنصر على الأقل، وليس {actual_length}",
        "too_long": "يجب ألا يتجاوز {max_length} عنصرًا، وليس {actual_length}",
        "string_type": "يجب أن تكون سلسلة نصية صالحة",
        "string_pattern_mismatch": "يجب أن يطابق النمط '{pattern}'",
        "int_type": "يجب أن يكون عددًا صحيحًا صالحًا",
        "int_parsing": "يجب أن يكون عددًا صحيحًا صالحًا (تعذر تفسير القيمة كعدد صحيح)",
        "int_from_float": "يجب أن يكون عددًا صحيحًا صالحًا (تم استلام عدد عشري)",
        "float_type": "يجب أن يكون رقمًا صالحًا",
        "float_parsing": "يجب أن يكون رقمًا صالحًا (تعذر تفسير القيمة كرقم)",
        "decimal_type": "يجب أن يكون رقمًا عشريًا صالحًا",
        "decimal_parsing": "يجب أن يكون رقمًا عشريًا صالحًا",
        "bool_type": "يجب أن تكون قيمة منطقية صالحة",
        "bool_parsing": "يجب أن تكون قيمة منطقية صالحة (تعذر تفسير القيمة)",
        "greater_than": "يجب أن يكون أكبر من {gt}",
        "greater_than_equal": "يجب أن يكون أكبر من أو يساوي {ge}",
        "less_than": "يجب أن يكون أصغر من {lt}",
        "less_than_equal": "يجب أن يكون أصغر من أو يساوي {le}",
        "multiple_of": "يجب أن يكون من مضاعفات {multiple_of}",
        "finite_number": "يجب أن يكون رقمًا منتهيًا",
        "enum": "يجب أن تكون القيمة {expected}",
        "literal_error": "يجب أن تكون القيمة {expected}",
        "dict_type": "يجب أن يكون كائنًا (قاموسًا) صالحًا",
        "model_type": "يجب أن يكون كائنًا صالحًا",
        "model_attributes_type": "يجب أن يكون كائنًا صالحًا",
        "list_type": "يجب أن تكون قائمة صالحة",
        "set_type": "يجب أن تكون مجموعة صالحة",
        "tuple_type": "يجب أن تكون صفًا (tuple) صالحًا",
        "extra_forbidden": "حقل إضافي غير مسموح به",
        "json_invalid": "JSON غير صالح",
        "json_type": "يجب أن يكون JSON صالحًا",
        "uuid_type": "يجب أن يكون معرّف UUID صالحًا",
        "uuid_parsing": "يجب أن يكون معرّف UUID صالحًا",
        "date_type": "يجب أن يكون تاريخًا صالحًا",
        "date_parsing": "يجب أن يكون تاريخًا صالحًا (YYYY-MM-DD)",
        "date_from_datetime_parsing": "يجب أن يكون تاريخًا صالحًا (YYYY-MM-DD)",
        "date_from_datetime_inexact": "يجب أن يكون تاريخًا بدون وقت",
        "datetime_type": "يجب أن يكون تاريخًا ووقتًا صالحين",
        "datetime_parsing": "يجب أن يكون تاريخًا ووقتًا صالحين",
        "datetime_from_date_parsing": "يجب أن يكون تاريخًا ووقتًا صالحين",
        "time_type": "يجب أن يكون وقتًا صالحًا",
        "time_parsing": "يجب أن يكون وقتًا صالحًا",
        "url_type": "يجب أن يكون عنوان URL صالحًا",
        "url_parsing": "يجب أن يكون عنوان URL صالحًا",
        "url_scheme": "يجب أن يكون مخطط عنوان URL {expected_schemes}",
        "url_too_long": "يجب ألا يتجاوز عنوان URL {max_length} حرفًا",
        "bytes_type": "يجب أن تكون بايتات صالحة",
        "none_required": "يجب أن تكون القيمة فارغة (None)",
        "is_instance_of": "نوع القيمة غير صالح",
        "union_tag_invalid": "قيمة المميّز غير صالحة",
        "union_tag_not_found": "قيمة المميّز مفقودة",
    },
}
_OR_WORD = {"fr": " ou ", "ar": " أو "}
_VALUE_ERROR_PREFIX = "Value error, "
_ASSERTION_PREFIX = "Assertion failed, "
_EMAIL_PREFIX = "value is not a valid email address"
_INVALID_EMAIL = {"fr": "Adresse e-mail invalide", "ar": "عنوان البريد الإلكتروني غير صالح"}


def _validation_msg(err: dict, lang: str) -> str | None:
    etype = err.get("type")
    original = err.get("msg")
    if not isinstance(original, str):
        return None
    if etype in ("value_error", "assertion_error"):
        if original.startswith(_EMAIL_PREFIX):
            return _INVALID_EMAIL[lang]
        for prefix in (_VALUE_ERROR_PREFIX, _ASSERTION_PREFIX):
            if original.startswith(prefix):
                inner = original[len(prefix):]
                out = translate_text(inner, lang)
                return out if out is not inner else None
        out = translate_text(original, lang)
        return out if out is not original else None
    tpl = _VALIDATION_TEMPLATES.get(lang, {}).get(etype or "")
    if tpl is None:
        return None
    ctx = err.get("ctx") or {}
    values: dict[str, str] = {}
    for key, value in (ctx.items() if isinstance(ctx, dict) else ()):
        text = str(value)
        if key in ("expected", "expected_schemes"):
            text = text.replace(" or ", _OR_WORD[lang])
        values[key] = text
    try:
        return tpl.format(**values)
    except (KeyError, IndexError, ValueError):
        return None


def translate_validation_errors(errors: list, lang: str | None) -> list:
    """Copy of pydantic ``errors()`` with each ``msg`` localised. Key order and every
    other field (loc, type, input, ctx, url) are preserved. English -> same list."""
    code = normalize_lang(lang)
    if code == "en" or not isinstance(errors, list):
        return errors
    out = []
    for err in errors:
        if not isinstance(err, dict):
            out.append(err)
            continue
        try:
            new_msg = _validation_msg(err, code)
        except Exception:  # noqa: BLE001
            new_msg = None
        if new_msg is None:
            out.append(err)
        else:
            out.append({k: (new_msg if k == "msg" else v) for k, v in err.items()})
    return out


__all__ = ["translate_text", "translate_detail", "msg", "translate_many", "request_language",
           "normalize_lang", "translate_validation_errors", "EXEMPT"]
