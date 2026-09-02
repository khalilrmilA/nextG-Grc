"""Language resolution for the AI foundation (component D) — a pure, dependency-free leaf.

Every AI call site needs to know ONE thing before it builds a prompt: which language the
model's free text must be written in (``"en"``, ``"fr"`` or ``"ar"``). This module answers
that question deterministically from the signals a request carries, supplies the verbatim
LANGUAGE block that ``ai_prompts.system_prompt`` appends to every system prompt, and holds
the single table of localised, honest failure sentences shown to users when nothing was
produced.

It is the leaf of the AI foundation import graph: it imports only the standard library and
``fastapi.Request`` (for the dependency's type annotation). It never touches the database,
settings, logging or the network, keeps no module-level state, and no function raises on
any input — bad values degrade to ``None`` / ``"en"`` / ``[]``.

Signals, in precedence order (first supported value wins)
---------------------------------------------------------
1. ``explicit``        — an optional ``language`` field in the request body (the user's
                          deliberate choice for this call; e.g. ``ChatRequest.language``).
2. ``Accept-Language`` — the axios client sends the UI language as a bare code (``fr``);
                          raw ``fetch`` streaming routes carry the browser's weighted list
                          (``fr-FR,fr;q=0.9,en-US;q=0.8``), so q-values and region subtags
                          are parsed properly.
3. ``tenant_default``  — ``Tenant.settings["locale"]`` (pass it through ``tenant_locale``),
                          an org-level default for background jobs and header-less callers.
4. ``default``         — ``"en"``.

How an endpoint uses it (the recipe)
------------------------------------
::

    from fastapi import Request
    from app.services.ai_locale import language_from_request, tenant_locale, get_request_language

    # a) one line in a route that has the Request and maybe a body field / a Tenant row:
    lang = language_from_request(request, explicit=getattr(body, "language", None),
                                 tenant_default=tenant_locale(tenant) if tenant else None)

    # b) or as a plain dependency when only the header matters:
    async def route(lang: Annotated[str, Depends(get_request_language)], ...): ...

    # c) chat turns without a UI language: let the message itself decide (never guesses "en")
    lang = language_from_request(request, explicit=body.language or guess_language(last_user_text))

    # then: ai_prompts.system_prompt(task, lang=lang)   # embeds language_instruction(lang)
    # and on failure: failure_message(kind, lang, status)  # or res.user_message(lang) / exc.user_message(lang)

Resolve the language ONCE in the request handler and pass the resulting string into any
thread or background task — never resolve from a Request object inside a worker thread.
"""

import re
from typing import Any

try:  # fastapi is a hard dependency of the app; the guard only keeps the module importable anywhere.
    from fastapi import Request
except ImportError:  # pragma: no cover - only outside the application environment
    Request = Any  # type: ignore[misc,assignment]


__all__ = [
    "SUPPORTED_LANGUAGES",
    "DEFAULT_LANGUAGE",
    "RTL_LANGUAGES",
    "LANGUAGE_NAMES",
    "LANGUAGE_INSTRUCTIONS",
    "FAILURE_KINDS",
    "FAILURE_MESSAGES",
    "normalize_language",
    "parse_accept_language",
    "language_from_accept",
    "tenant_locale",
    "resolve_language",
    "language_from_request",
    "get_request_language",
    "language_instruction",
    "language_name",
    "is_rtl",
    "guess_language",
    "failure_message",
]


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: Canonical language codes. Tuple order is the preference on ties.
SUPPORTED_LANGUAGES: tuple[str, ...] = ("en", "fr", "ar")

#: Language used when no signal resolves to a supported code.
DEFAULT_LANGUAGE: str = "en"

#: Languages rendered right-to-left (renderers may use ``is_rtl``).
RTL_LANGUAGES: tuple[str, ...] = ("ar",)

#: Human-readable names, keyed by canonical code (``language_name`` normalises first).
LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "fr": "French (français)",
    "ar": "Arabic (العربية)",
}

# Aliases accepted for `explicit` / tenant values (lower-cased, whitespace-stripped).
# Keys are compared after normalisation; anything not here and not a bcp47 tag falls through.
_LANGUAGE_ALIASES: dict[str, str] = {
    "english": "en", "anglais": "en", "eng": "en",
    "french": "fr", "français": "fr", "francais": "fr", "fra": "fr", "fre": "fr",
    "arabic": "ar", "arabe": "ar", "ara": "ar", "العربية": "ar", "عربي": "ar", "عربية": "ar",
}

#: The LANGUAGE block appended (by ``ai_prompts.system_prompt``) as the LAST block of every
#: system prompt. FR and AR are written in the target language — models follow same-language
#: instructions more reliably. All three state the same invariants: (1) all free text incl.
#: Markdown headings in the target language even when sources are in another language;
#: (2) JSON keys, enum values, control identifiers, framework names untouched; (3) numbers as
#: Western digits with a decimal point; (4) quotations verbatim in the source language + a
#: short gloss; (5) acronyms unchanged. Verbatim per the foundation spec — do not edit.
LANGUAGE_INSTRUCTIONS: dict[str, str] = {
    "en": (
        "LANGUAGE: Write every free-text field and all prose (explanations, justifications, "
        "findings, gap descriptions, recommendations, summaries, document sections and their "
        "headings) in professional English, even when the source material is written in "
        "another language. Machine-readable values stay exactly as specified, untranslated: "
        "JSON keys, enum values (for example \"implemented\", \"partially_implemented\", "
        "\"high\"), control identifiers (for example \"A.5.1\", \"CC6.1\"), framework names, "
        "and numbers (digits 0-9, decimal point). Quote source material verbatim in its "
        "original language inside quotation marks and add a short English gloss when the "
        "quotation is not in English. Technical acronyms (ISO, NIST, SOC 2, GDPR, PCI DSS, "
        "DORA, NIS2) stay as they are."
    ),
    "fr": (
        "LANGUE : Rédige tout le texte libre et toute la prose (explications, justifications, "
        "constats, descriptions d'écart, recommandations, résumés, sections de documents et "
        "leurs titres) en français professionnel, même si les documents sources sont rédigés "
        "dans une autre langue. Les valeurs lisibles par machine restent EXACTEMENT telles que "
        "spécifiées, sans traduction : clés JSON, valeurs d'énumération (par exemple "
        "\"implemented\", \"partially_implemented\", \"high\"), identifiants de contrôle (par "
        "exemple \"A.5.1\", \"CC6.1\"), noms de référentiels et nombres (chiffres 0-9, point "
        "décimal et non virgule). Cite les documents sources textuellement, dans leur langue "
        "d'origine, entre guillemets, et ajoute une courte glose en français si la citation "
        "n'est pas en français. Les acronymes techniques (ISO, NIST, SOC 2, RGPD/GDPR, PCI DSS, "
        "DORA, NIS2) restent tels quels."
    ),
    "ar": (
        "اللغة: اكتب كل النصوص الحرة وكل النثر (الشروحات، المبررات، النتائج، أوصاف الفجوات، "
        "التوصيات، الملخصات، أقسام الوثائق وعناوينها) بالعربية الفصحى المهنية، حتى لو كانت "
        "المستندات المصدرية مكتوبة بلغة أخرى. تبقى القيم الآلية كما هي محددة تمامًا دون ترجمة "
        "أو نقل حرفي: مفاتيح JSON، قيم التعداد (مثل \"implemented\" و\"partially_implemented\" "
        "و\"high\")، معرّفات الضوابط (مثل \"A.5.1\" و\"CC6.1\")، أسماء الأطر، والأرقام (بالأرقام "
        "الغربية 0-9 والفاصلة العشرية نقطة وليس فاصلة). اقتبس من المستندات المصدرية حرفيًا "
        "بلغتها الأصلية بين علامتي اقتباس، وأضف شرحًا موجزًا بالعربية إذا لم يكن الاقتباس "
        "بالعربية. تبقى الاختصارات التقنية (ISO, NIST, SOC 2, GDPR, PCI DSS, DORA, NIS2) كما هي."
    ),
}

#: Failure kinds with a localised user-facing sentence. These are the ``kind`` values of
#: ``ai_provider.AICallError`` subclasses plus the structured-output kinds (``invalid_output``,
#: ``quota``). ``"http"`` is accepted as an alias of ``"http_status"``; the ``ai_structured``
#: kinds (``transport``, ``provider``, ``malformed``, ``validation``, ``input``) are accepted
#: as aliases exactly as ``ai_structured.LOCALE_KIND`` maps them.
FAILURE_KINDS: tuple[str, ...] = (
    "unreachable",
    "timeout",
    "http_status",
    "protocol",
    "invalid_output",
    "truncated",
    "empty",
    "quota",
    "bad_config",
    "error",
)

_FAILURE_KIND_ALIASES: dict[str, str] = {
    "http": "http_status",
    # ai_structured.FailureKind -> ai_locale kind (mirror of ai_structured.LOCALE_KIND)
    "transport": "unreachable",
    "provider": "error",
    "malformed": "invalid_output",
    "validation": "invalid_output",
    "input": "invalid_output",
}

#: ``kind -> lang -> text``. Single source of localised AI failure text for D, E and B.
#: ``{status}`` (only meaningful for ``http_status``) is substituted with ``str.replace`` —
#: never ``str.format`` — so other braces are safe. Honest by design: each sentence says that
#: nothing was produced / recorded, never that a default was used.
FAILURE_MESSAGES: dict[str, dict[str, str]] = {
    "unreachable": {
        "en": "The AI service could not be reached. No analysis was produced.",
        "fr": "Le service IA est injoignable. Aucune analyse n'a été produite.",
        "ar": "تعذر الوصول إلى خدمة الذكاء الاصطناعي. لم يتم إنتاج أي تحليل.",
    },
    "timeout": {
        "en": "The AI service did not answer in time. No analysis was produced.",
        "fr": "Le service IA n'a pas répondu à temps. Aucune analyse n'a été produite.",
        "ar": "لم تستجب خدمة الذكاء الاصطناعي في الوقت المحدد. لم يتم إنتاج أي تحليل.",
    },
    "http_status": {
        "en": "The AI service returned an error (HTTP {status}). No analysis was produced.",
        "fr": "Le service IA a renvoyé une erreur (HTTP {status}). Aucune analyse n'a été produite.",
        "ar": "أعادت خدمة الذكاء الاصطناعي خطأ (HTTP {status}). لم يتم إنتاج أي تحليل.",
    },
    "protocol": {
        "en": "The AI service returned an unusable response.",
        "fr": "Le service IA a renvoyé une réponse inutilisable.",
        "ar": "أعادت خدمة الذكاء الاصطناعي استجابة غير صالحة.",
    },
    "invalid_output": {
        "en": "The AI returned an unusable answer twice. Nothing was recorded — please retry.",
        "fr": "L'IA a renvoyé deux fois une réponse inexploitable. Rien n'a été enregistré — veuillez réessayer.",
        "ar": "أعاد الذكاء الاصطناعي إجابة غير صالحة مرتين. لم يُسجَّل أي شيء — يرجى المحاولة مجددًا.",
    },
    "truncated": {
        "en": "The AI answer was cut off before completion. Retry or reduce the input.",
        "fr": "La réponse de l'IA a été tronquée avant la fin. Réessayez ou réduisez les données.",
        "ar": "انقطعت إجابة الذكاء الاصطناعي قبل اكتمالها. أعد المحاولة أو قلّل حجم المدخلات.",
    },
    "empty": {
        "en": "The AI returned an empty answer. No analysis was produced.",
        "fr": "L'IA a renvoyé une réponse vide. Aucune analyse n'a été produite.",
        "ar": "أعاد الذكاء الاصطناعي إجابة فارغة. لم يتم إنتاج أي تحليل.",
    },
    "quota": {
        "en": "Your daily AI quota is exhausted. Try again tomorrow or contact your administrator.",
        "fr": "Votre quota IA quotidien est épuisé. Réessayez demain ou contactez votre administrateur.",
        "ar": "استُنفد حد استخدام الذكاء الاصطناعي اليومي. حاول مجددًا غدًا أو تواصل مع مسؤول النظام.",
    },
    "bad_config": {
        "en": "The AI request was invalid.",
        "fr": "La requête IA est invalide.",
        "ar": "طلب الذكاء الاصطناعي غير صالح.",
    },
    "error": {
        "en": "The AI request failed.",
        "fr": "La requête IA a échoué.",
        "ar": "فشل طلب الذكاء الاصطناعي.",
    },
}

# Input-size bounds (nothing quadratic; oversized inputs are cut, never rejected with an error).
_MAX_HEADER_CHARS = 1024
_MAX_TAG_CHARS = 64
_MAX_GUESS_CHARS = 2000

_SUBTAG_SPLIT_RE = re.compile(r"[-_]")
_Q_VALUE_RE = re.compile(r"q\s*=\s*([0-9.]+)")
_WORD_RE = re.compile(r"[^\W\d_]+")  # runs of Unicode letters (accented letters included)

_ARABIC_RANGES: tuple[tuple[int, int], ...] = (
    (0x0600, 0x06FF),
    (0x0750, 0x077F),
    (0x08A0, 0x08FF),
    (0xFB50, 0xFDFF),
    (0xFE70, 0xFEFF),
)
_FRENCH_ACCENTS = frozenset("àâçéèêëîïôûùüÿœ")
_FRENCH_STOPWORDS = frozenset({
    "le", "la", "les", "des", "une", "est", "pour", "dans", "nous", "vous", "avec", "sur",
    "pas", "que", "qui", "quels", "quelles", "quel", "quelle", "cette", "sont", "être",
    "mais", "comment", "politique", "conformité", "risques",
})
_ENGLISH_STOPWORDS = frozenset({
    "the", "and", "with", "what", "which", "how", "is", "are", "this", "for", "of",
})
_LOCALE_DICT_KEYS = ("language", "lang", "locale", "code")


# ---------------------------------------------------------------------------
# Normalisation and header parsing
# ---------------------------------------------------------------------------

def normalize_language(value: object) -> str | None:
    """Coerce any user/tenant-supplied language value to a supported code, or None.

    Accepts: "fr", "FR", " fr ", "fr-FR", "fr_CA", "ar-SA", "en-US", "fra", "français",
    "Arabic", "العربية". Rejects (returns None): None, "", non-str, "de", "xx-YY", "*",
    "frx" (only exact primary subtag match: split on "-" / "_" then compare).
    Never raises.
    """
    if not isinstance(value, str):
        return None
    text = value.strip().lower()
    if not text:
        return None
    alias = _LANGUAGE_ALIASES.get(text)
    if alias:
        return alias
    primary = _SUBTAG_SPLIT_RE.split(text, maxsplit=1)[0].strip()
    return primary if primary in SUPPORTED_LANGUAGES else None


def parse_accept_language(header: str | None) -> list[tuple[str, float]]:
    """Parse an RFC 7231 Accept-Language header into [(tag, q), ...] sorted by q descending
    (stable, so the client's own order breaks ties). Malformed q → 1.0; q <= 0 entries dropped;
    entries longer than 64 chars dropped; header longer than 1024 chars truncated first.
    "*" is kept as a tag (callers ignore it). Never raises. Empty/None → [].

    >>> parse_accept_language("fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7")
    [('fr-FR', 1.0), ('fr', 0.9), ('en-US', 0.8), ('en', 0.7)]
    """
    return [(tag, q) for tag, q, _explicit in _parse_accept_language_entries(header)]


def _parse_accept_language_entries(header: object) -> list[tuple[str, float, bool]]:
    """RFC 7231 parse -> [(tag, q, q_was_explicit), ...] sorted by q descending (stable).

    Missing q -> 1.0 (RFC default, flagged as not explicit); malformed q -> 1.0 (also not
    explicit, since the client's intent is unknown); q clamped to [0, 1]; q <= 0 dropped.
    """
    if not isinstance(header, str) or not header:
        return []
    items: list[tuple[str, float, bool]] = []
    for part in header[:_MAX_HEADER_CHARS].split(","):
        tag, _, params = part.partition(";")
        tag = tag.strip()
        if not tag or len(tag) > _MAX_TAG_CHARS:
            continue
        q = 1.0
        explicit = False
        match = _Q_VALUE_RE.search(params)
        if match:
            try:
                q = float(match.group(1))
                explicit = True
            except ValueError:
                q = 1.0
        q = min(max(q, 0.0), 1.0)
        if q <= 0:
            continue
        items.append((tag, q, explicit))
    return sorted(items, key=lambda item: -item[1])


def _primary_subtag(tag: str) -> str:
    return _SUBTAG_SPLIT_RE.split(tag.strip().lower(), maxsplit=1)[0].strip()


def language_from_accept(header: str | None) -> str | None:
    """Best supported language in an Accept-Language header, honouring q-values, or None.

    "fr"                                      -> "fr"   (axios client)
    "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7"     -> "fr"   (browser)
    "en-US,en;q=0.8,fr;q=0.9"                 -> "fr"   (q wins over order)
    "ar,en-US;q=0.7,en;q=0.3"                 -> "ar"   (Firefox with an Arabic UI)
    "de-DE,de;q=0.9,*;q=0.1"                  -> None   (nothing supported; "*" ignored)
    "" / None / "garbage;;q=x"                -> None

    Weighting: an explicit q is used as given. A tag WITHOUT an explicit q counts as 1.0
    (the RFC 7231 default) unless the same primary language appears elsewhere in the list
    with an explicit q, in which case that explicit weight is used for it. Every real browser
    header repeats its first (unweighted) language with the next-highest explicit q, so this
    yields exactly the RFC 7231 choice for all browser and axios traffic; only in hand-written
    lists does an explicit weight beat mere position ("q wins over order", per the spec).
    Ties keep the client's order (the list is sorted by q descending, stable). Never raises.
    """
    entries = _parse_accept_language_entries(header)
    if not entries:
        return None
    explicit_by_primary: dict[str, float] = {}
    for tag, q, explicit in entries:
        if explicit:
            primary = _primary_subtag(tag)
            explicit_by_primary[primary] = max(explicit_by_primary.get(primary, 0.0), q)
    best: str | None = None
    best_weight = -1.0
    for tag, q, explicit in entries:
        code = normalize_language(tag)
        if not code:
            continue
        weight = q if explicit else explicit_by_primary.get(_primary_subtag(tag), 1.0)
        if weight > best_weight:
            best, best_weight = code, weight
    return best


def tenant_locale(tenant_or_settings: object) -> str | None:
    """Extract a language code from a Tenant ORM row, its `settings` dict, or a raw value.

    Looks at (in order): obj.settings["locale"] if obj has a `settings` attribute that is a dict;
    obj["locale"] if obj is a dict (or obj["settings"]["locale"] for a serialised tenant);
    else obj itself. The found value may be a str ("fr", "fr-FR") or a dict
    ({"language": "fr"} / {"lang": "fr"} / {"code": "fr"}). Anything else -> None.
    Never raises, never touches the database (a detached row whose `settings` access fails
    simply yields None).

    Typical use: ``resolve_language(header, explicit, tenant_default=tenant_locale(tenant))``.
    Note: the frontend does not write ``settings["locale"]`` today, so this tier is a real
    but currently-empty hook — callers must not rely on it being set.
    """
    try:
        value: object
        settings_attr = getattr(tenant_or_settings, "settings", None)
        if isinstance(settings_attr, dict):
            value = settings_attr.get("locale")
        elif isinstance(tenant_or_settings, dict):
            if "locale" in tenant_or_settings:
                value = tenant_or_settings.get("locale")
            elif isinstance(tenant_or_settings.get("settings"), dict):
                value = tenant_or_settings["settings"].get("locale")
            else:
                value = None
        else:
            value = tenant_or_settings
        if isinstance(value, dict):
            for key in _LOCALE_DICT_KEYS:
                code = normalize_language(value.get(key))
                if code:
                    return code
            return None
        return normalize_language(value)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Resolution
# ---------------------------------------------------------------------------

def resolve_language(
    accept_language: str | None,
    explicit: str | None = None,
    tenant_default: str | None = None,
    *,
    default: str = DEFAULT_LANGUAGE,
) -> str:
    """Resolve the language AI free text must be written in.

    Precedence (first supported value wins):
      1. `explicit`        — a request-body field (e.g. ChatRequest.language, PolicyContentRequest.language).
                             The user's deliberate choice for this call.
      2. `accept_language` — the raw Accept-Language header. The axios client sends the UI language
                             as a bare code; raw-fetch/streaming routes carry the browser's weighted list.
      3. `tenant_default`  — Tenant.settings["locale"] (pass through `tenant_locale(tenant)`), an
                             org-level default for background jobs and header-less callers.
      4. `default`         — "en" unless overridden.
    Every input is normalised with `normalize_language`; unsupported or malformed values fall
    through silently. Always returns one of SUPPORTED_LANGUAGES. Never raises.

    >>> resolve_language("fr", explicit="ar", tenant_default="en")
    'ar'
    >>> resolve_language("de-DE,de;q=0.9", explicit="xx", tenant_default="zz")
    'en'
    """
    for candidate in (
        normalize_language(explicit),
        language_from_accept(accept_language),
        normalize_language(tenant_default),
    ):
        if candidate:
            return candidate
    return normalize_language(default) or DEFAULT_LANGUAGE


def language_from_request(
    request: object | None,
    *,
    explicit: str | None = None,
    tenant_default: str | None = None,
) -> str:
    """`resolve_language` for a FastAPI/Starlette Request (or anything with `.headers.get`).

    Reads `request.headers.get("accept-language")` inside try/except (a None request, a
    WebSocket, or a background job with no request all yield ""), then delegates to
    resolve_language(header, explicit, tenant_default). Never raises.

    This is the one-liner for routes: add ``request: Request`` to the route signature
    (FastAPI injects it; no API contract change) and call::

        lang = language_from_request(request, explicit=getattr(body, "language", None),
                                     tenant_default=tenant_locale(tenant) if tenant else None)
    """
    header: object = ""
    try:
        headers = getattr(request, "headers", None)
        if headers is not None:
            header = headers.get("accept-language") or ""
    except Exception:
        header = ""
    return resolve_language(header if isinstance(header, str) else "", explicit, tenant_default)


async def get_request_language(request: Request) -> str:
    """FastAPI dependency: `lang: Annotated[str, Depends(get_request_language)]`.

    Returns resolve_language(request.headers.get("accept-language")). No body access, no DB,
    no tenant lookup (keep it cheap and side-effect free; a call site that has a body
    `language` field or a loaded Tenant should call `resolve_language(...)` /
    `language_from_request(...)` directly with `explicit=` / `tenant_default=` instead of
    stacking dependencies).
    Header names are case-insensitive in Starlette; "Accept-Language" and "accept-language"
    both resolve. Values like "fr", "fr-FR", "ar", "en" (what the SPA sends) and browser lists
    such as "fr-FR,fr;q=0.9,en;q=0.8" all work. Absent/unknown header -> "en". Never raises.
    """
    return language_from_request(request)


# ---------------------------------------------------------------------------
# Prompt text and small helpers
# ---------------------------------------------------------------------------

def language_instruction(lang: str) -> str:
    """The LANGUAGE block for a system prompt. Returns LANGUAGE_INSTRUCTIONS[normalize_language(lang) or "en"].

    Component A appends this as the LAST block of every system prompt (never the user turn).
    The FR and AR blocks are written in the target language (models follow same-language
    instructions more reliably). Each block states the same invariants: (1) all free text incl.
    Markdown headings in the target language even when sources are in another language;
    (2) JSON keys, enum values, control identifiers, framework names untouched; (3) numbers as
    Western digits with a decimal point; (4) quotations verbatim in the source language + short
    gloss; (5) acronyms unchanged.

    Any value is accepted ("fr-FR", "French", None, "xx" -> the English block for the last two).
    Must appear exactly once per composed system prompt.
    """
    return LANGUAGE_INSTRUCTIONS[normalize_language(lang) or DEFAULT_LANGUAGE]


def language_name(lang: str) -> str:
    """Human-readable name for a language code: LANGUAGE_NAMES[normalize_language(lang) or "en"].

    >>> language_name("ar-SA")
    'Arabic (العربية)'
    """
    return LANGUAGE_NAMES[normalize_language(lang) or DEFAULT_LANGUAGE]


def is_rtl(lang: str) -> bool:
    """True when the (normalised) language is written right-to-left: (normalize_language(lang) or "en") in RTL_LANGUAGES."""
    return (normalize_language(lang) or DEFAULT_LANGUAGE) in RTL_LANGUAGES


def _is_arabic_letter(ch: str) -> bool:
    code = ord(ch)
    for low, high in _ARABIC_RANGES:
        if low <= code <= high:
            return True
    return False


def guess_language(text: str | None, *, min_chars: int = 12) -> str | None:
    """Guess the language of a short user-written text WITHOUT a model call. Conservative:
    returns None unless confident. Intended for chat routes (in-app assistant, public support
    widget) as `explicit=guess_language(last_user_message)` so a French question typed in an
    English browser gets a French answer.

    Rules (evaluated in order on text[:2000]):
      - None / non-str / fewer than `min_chars` alphabetic characters -> None.
      - "ar" if Arabic-script letters (U+0600-U+06FF, U+0750-U+077F, U+08A0-U+08FF, U+FB50-U+FDFF,
        U+FE70-U+FEFF) are >= 30% of all alphabetic characters.
      - "fr" if (count of French-only accented letters àâçéèêëîïôûùüÿœ >= 2) OR
        (>= 2 distinct hits among the whole-word stop-words {"le","la","les","des","une","est",
        "pour","dans","nous","vous","avec","sur","pas","que","qui","quels","quelles","quel",
        "quelle","cette","sont","être","mais","comment","politique","conformité","risques"}
        AND no more than 1 hit among {"the","and","with","what","which","how","is","are","this",
        "for","of"}) — words compared lower-case, split on non-letters.
      - otherwise None (English is never *guessed*; the caller's header/default supplies it).
    Never raises. Treat the result as a tie-breaker, not authority: short unaccented French
    returns None and falls back to the header/default.
    """
    if not isinstance(text, str):
        return None
    try:
        sample = text[:_MAX_GUESS_CHARS]
        letters = [ch for ch in sample if ch.isalpha()]
        if not letters or len(letters) < min_chars:
            return None
        arabic = sum(1 for ch in letters if _is_arabic_letter(ch))
        if arabic / len(letters) >= 0.30:
            return "ar"
        lowered = sample.lower()
        accents = sum(1 for ch in lowered if ch in _FRENCH_ACCENTS)
        if accents >= 2:
            return "fr"
        words = set(_WORD_RE.findall(lowered))
        fr_hits = len(words & _FRENCH_STOPWORDS)
        en_hits = len(words & _ENGLISH_STOPWORDS)
        if fr_hits >= 2 and en_hits <= 1:
            return "fr"
        return None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Localised failure text
# ---------------------------------------------------------------------------

def failure_message(kind: str, lang: str = "en", status: int | None = None) -> str:
    """User-facing sentence for an AI failure, in the UI language. Unknown kind -> "invalid_output"
    text; unknown lang -> English. "{status}" is substituted only for kind == "http_status"
    (alias "http"; missing status -> "HTTP error"). Never raises. Components B/E and call sites
    map their error classes to these kinds so FR/AR users never see an English stack-trace string:

    - ``ai_provider.AICallError.user_message(lang)`` passes its ``kind`` and ``status_code``;
    - ``ai_structured.AiResult.user_message(lang)`` passes ``LOCALE_KIND[res.kind]`` (the same
      mapping is accepted here directly as aliases, so ``failure_message(res.kind, lang)`` also works);
    - quota gates use ``"quota"``.

    >>> failure_message("http", "fr", 502)
    "Le service IA a renvoyé une erreur (HTTP 502). Aucune analyse n'a été produite."
    """
    try:
        key = str(kind).strip().lower() if kind is not None else ""
    except Exception:
        key = ""
    key = _FAILURE_KIND_ALIASES.get(key, key)
    table = FAILURE_MESSAGES.get(key) or FAILURE_MESSAGES["invalid_output"]
    code = normalize_language(lang) or DEFAULT_LANGUAGE
    text = table.get(code) or table[DEFAULT_LANGUAGE]
    try:
        status_text = str(status) if status is not None else "error"
    except Exception:
        status_text = "error"
    return text.replace("{status}", status_text)
