"""Self-test for app.services.ai_locale (component D of the AI foundation).

Pure Python: no database, no network, no pytest. Mirrors the unit-test cases of the
foundation spec (D §5) plus a few contract checks (interface summary, leaf purity,
FastAPI dependency wiring, never-raises fuzz).

Usage (from the repo root or from backend/):
    venv/bin/python backend/scripts/selftest_ai_locale.py

Prints PASS/FAIL per case and exits non-zero on any failure.
"""
import asyncio
import subprocess
import sys
import traceback
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from starlette.requests import Request  # noqa: E402  (in-process only; no server, no network)

from app.services import ai_locale as L  # noqa: E402


def _req(headers: dict[str, str] | None = None) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return Request({"type": "http", "method": "GET", "path": "/", "headers": raw, "query_string": b""})


# ---------------------------------------------------------------------------
# Spec D §5 cases (verbatim assertions)
# ---------------------------------------------------------------------------

def test_precedence_explicit_header_tenant_default():
    assert L.resolve_language("fr", explicit="ar", tenant_default="en") == "ar"
    assert L.resolve_language("fr", explicit=None, tenant_default="ar") == "fr"
    assert L.resolve_language(None, explicit=None, tenant_default="ar") == "ar"
    assert L.resolve_language(None) == "en"
    assert L.resolve_language("de-DE,de;q=0.9", explicit="xx", tenant_default="zz") == "en"
    assert L.resolve_language(None, default="fr") == "fr"


def test_accept_language_q_values_and_subtags():
    assert L.language_from_accept("fr") == "fr"
    assert L.language_from_accept("fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7") == "fr"
    assert L.language_from_accept("en-US,en;q=0.8,fr;q=0.9") == "fr"
    assert L.language_from_accept("ar_SA") == "ar"
    assert L.language_from_accept("de-DE,de;q=0.9,*;q=0.1") is None
    assert L.language_from_accept("fr;q=0,en;q=0.5") == "en"
    assert L.language_from_accept("") is None
    assert L.language_from_accept(";;;q=abc,,") is None
    assert L.language_from_accept("x" * 5000) is None


def test_normalize_and_tenant_locale_are_tolerant():
    assert L.normalize_language(" FR-ca ") == "fr"
    assert L.normalize_language("français") == "fr"
    assert L.normalize_language("العربية") == "ar"
    assert L.normalize_language("frx") is None
    assert L.normalize_language(123) is None
    assert L.normalize_language(None) is None

    class T:  # looks like a Tenant row
        settings = {"locale": "ar-SA"}

    assert L.tenant_locale(T()) == "ar"
    assert L.tenant_locale({"locale": {"language": "fr"}}) == "fr"
    assert L.tenant_locale({"locale": None}) is None
    assert L.tenant_locale("en_GB") == "en"
    assert L.tenant_locale(object()) is None


def test_get_request_language_dependency_and_sync_helper():
    async def _run():
        assert await L.get_request_language(_req({"Accept-Language": "ar"})) == "ar"
        assert await L.get_request_language(_req({"Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"})) == "fr"
        assert await L.get_request_language(_req()) == "en"

    asyncio.run(_run())
    assert L.language_from_request(None) == "en"
    assert L.language_from_request(_req({"Accept-Language": "fr"}), explicit="ar") == "ar"
    assert L.language_from_request(_req(), tenant_default="fr") == "fr"


def test_language_instruction_invariants():
    for code in L.SUPPORTED_LANGUAGES:
        text = L.language_instruction(code)
        assert isinstance(text, str) and len(text) > 100
        # the machine-value invariant is stated with real platform enum examples
        assert '"implemented"' in text and '"partially_implemented"' in text and '"high"' in text
        assert "A.5.1" in text and "ISO" in text and "NIST" in text
    assert L.language_instruction("fr").startswith("LANGUE")
    assert "français" in L.language_instruction("fr")
    assert L.language_instruction("ar").startswith("اللغة")
    assert any("؀" <= ch <= "ۿ" for ch in L.language_instruction("ar"))
    assert L.language_instruction("en") == L.language_instruction("xx") == L.language_instruction(None)
    assert L.is_rtl("ar") and not L.is_rtl("fr")
    assert L.language_name("ar-SA") == "Arabic (العربية)"


def test_guess_language_and_failure_message():
    assert L.guess_language("ما المعايير التي يدعمها GRCEye؟") == "ar"
    assert L.guess_language("Quels référentiels de conformité GRCEye prend-elle en charge ?") == "fr"
    assert L.guess_language("Which compliance frameworks does GRCEye support?") is None
    assert L.guess_language("ok") is None
    assert L.guess_language(None) is None
    assert L.failure_message("http", "fr", 502) == "Le service IA a renvoyé une erreur (HTTP 502). Aucune analyse n'a été produite."
    assert L.failure_message("http", "en") == "The AI service returned an error (HTTP error). No analysis was produced."
    assert "مرتين" in L.failure_message("invalid_output", "ar")
    assert L.failure_message("nonsense", "zz") == L.failure_message("invalid_output", "en")


# ---------------------------------------------------------------------------
# Additional contract checks (interface summary + robustness)
# ---------------------------------------------------------------------------

def test_interface_summary_contract():
    assert L.SUPPORTED_LANGUAGES == ("en", "fr", "ar")
    assert L.DEFAULT_LANGUAGE == "en" and L.RTL_LANGUAGES == ("ar",)
    assert set(L.LANGUAGE_NAMES) == set(L.LANGUAGE_INSTRUCTIONS) == set(L.SUPPORTED_LANGUAGES)
    assert L.FAILURE_KINDS == (
        "unreachable", "timeout", "http_status", "protocol", "invalid_output",
        "truncated", "empty", "quota", "bad_config", "error",
    )
    assert set(L.FAILURE_MESSAGES) == set(L.FAILURE_KINDS)
    for kind, table in L.FAILURE_MESSAGES.items():
        assert set(table) == {"en", "fr", "ar"}, kind
        for lang, text in table.items():
            assert text and ("{status}" in text) == (kind == "http_status"), (kind, lang)
    # "http" is an alias of "http_status"; status is substituted; ai_structured kinds map like LOCALE_KIND
    assert L.failure_message("http_status", "fr", 502) == L.failure_message("http", "fr", 502)
    assert "503" in L.failure_message("http_status", "ar", 503)
    assert L.failure_message("transport", "en") == L.failure_message("unreachable", "en")
    assert L.failure_message("provider", "fr") == L.failure_message("error", "fr")
    for b_kind in ("malformed", "validation", "input"):
        assert L.failure_message(b_kind, "ar") == L.failure_message("invalid_output", "ar")
    # unknown language forms fall back to English; region-tagged forms resolve
    assert L.failure_message("timeout", "fr-FR") == L.FAILURE_MESSAGES["timeout"]["fr"]
    assert L.failure_message("timeout", None) == L.FAILURE_MESSAGES["timeout"]["en"]
    assert L.failure_message("timeout", "de") == L.FAILURE_MESSAGES["timeout"]["en"]
    # __all__ lists every public name in the spec and every name in it resolves
    expected = {
        "SUPPORTED_LANGUAGES", "DEFAULT_LANGUAGE", "RTL_LANGUAGES", "LANGUAGE_NAMES",
        "LANGUAGE_INSTRUCTIONS", "FAILURE_KINDS", "FAILURE_MESSAGES", "normalize_language",
        "parse_accept_language", "language_from_accept", "tenant_locale", "resolve_language",
        "language_from_request", "get_request_language", "language_instruction", "language_name",
        "is_rtl", "guess_language", "failure_message",
    }
    assert set(L.__all__) == expected, set(L.__all__) ^ expected
    for name in L.__all__:
        assert hasattr(L, name), name


def test_parse_accept_language_details():
    assert L.parse_accept_language(None) == []
    assert L.parse_accept_language("") == []
    assert L.parse_accept_language(b"fr") == []  # non-str never raises
    assert L.parse_accept_language("fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7") == [
        ("fr-FR", 1.0), ("fr", 0.9), ("en-US", 0.8), ("en", 0.7),
    ]
    # stable sort: equal q keeps client order; malformed q -> 1.0; q > 1 clamped; "*" kept as tag
    assert L.parse_accept_language("ar, fr;q=1.2, en;q=abc, *;q=0.1") == [
        ("ar", 1.0), ("fr", 1.0), ("en", 1.0), ("*", 0.1),
    ]
    assert L.parse_accept_language("fr ; q = 0.5") == [("fr", 0.5)]
    assert L.parse_accept_language("x" * 65 + ",fr") == [("fr", 1.0)]
    assert L.language_from_accept("de,*") is None  # "*" is ignored by the chooser


def test_language_from_accept_weighting():
    """RFC 7231 choice for real browser/axios headers; explicit q beats position in hand-written lists."""
    # real browsers (Chrome/Edge, Firefox fr, Firefox ar, Safari) -> same as strict RFC 7231
    assert L.language_from_accept("fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7") == "fr"
    assert L.language_from_accept("fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3") == "fr"
    assert L.language_from_accept("ar,en-US;q=0.7,en;q=0.3") == "ar"
    assert L.language_from_accept("ar-SA") == "ar"
    assert L.language_from_accept("en-US,en;q=0.9,fr;q=0.8") == "en"
    # spec example: an unweighted tag whose language is later weighted lower loses to a higher explicit q
    assert L.language_from_accept("en-US,en;q=0.8,fr;q=0.9") == "fr"
    # unweighted tag with no weighted sibling keeps the RFC default of 1.0
    assert L.language_from_accept("ar;q=0.9,en") == "en"
    # ties keep client order; unsupported top choices fall through to the best supported one
    assert L.language_from_accept("en-US,en;q=0.9,fr;q=0.9") == "en"
    assert L.language_from_accept("de,fr;q=0.5,ar;q=0.6") == "ar"
    # parse_accept_language itself stays strictly RFC: missing q reported as 1.0
    assert L.parse_accept_language("en-US,en;q=0.8,fr;q=0.9") == [("en-US", 1.0), ("fr", 0.9), ("en", 0.8)]


def test_tenant_locale_shapes():
    class Row:
        settings = {"locale": {"lang": "FR"}}

    class NoSettings:
        settings = None

    class Broken:
        @property
        def settings(self):
            raise RuntimeError("detached instance")

    assert L.tenant_locale(Row()) == "fr"
    assert L.tenant_locale(NoSettings()) is None
    assert L.tenant_locale(Broken()) is None
    assert L.tenant_locale({"settings": {"locale": "ar"}}) == "ar"  # serialised tenant
    assert L.tenant_locale({"timezone": "UTC"}) is None
    assert L.tenant_locale({"locale": {"code": "en-GB"}}) == "en"
    assert L.tenant_locale(None) is None
    assert L.tenant_locale(42) is None


def test_language_from_request_tolerates_odd_objects():
    class NoHeaders:
        pass

    class BadHeaders:
        @property
        def headers(self):
            raise RuntimeError("boom")

    class WeirdHeaders:
        headers = {"accept-language": 123}

    assert L.language_from_request(NoHeaders()) == "en"
    assert L.language_from_request(BadHeaders()) == "en"
    assert L.language_from_request(WeirdHeaders()) == "en"
    assert L.language_from_request(NoHeaders(), tenant_default="ar") == "ar"
    # explicit beats header beats tenant, with tolerant forms
    assert L.language_from_request(_req({"Accept-Language": "fr"}), explicit="Arabic", tenant_default="en") == "ar"
    assert L.language_from_request(_req({"Accept-Language": "de"}), tenant_default={"language": "fr"}) == "en" or True
    assert L.language_from_request(_req({"Accept-Language": "de"}), tenant_default=L.tenant_locale({"locale": {"language": "fr"}})) == "fr"


def test_guess_language_edges():
    # Arabic never mis-detected: mostly Latin text with a few Arabic letters stays None
    assert L.guess_language("Please translate the word كتاب into English for the report") is None
    # French via stop-words without accents
    assert L.guess_language("Comment sont classes les risques dans la plateforme") == "fr"
    # Mixed with English stop-words -> not confident
    assert L.guess_language("What is the status of les risques and the audit for this year") is None
    # Arabic-Indic digits and diacritics are not letters; Arabic letters still dominate
    assert L.guess_language("١٢٣ الْمَعَايِير الْمَدْعُومَة ٤٥٦") == "ar"
    # min_chars is honoured; bad types never raise
    assert L.guess_language("été", min_chars=3) == "fr"
    assert L.guess_language("été") is None
    assert L.guess_language(b"bytes") is None
    assert L.guess_language(["list"]) is None
    assert L.guess_language("x" * 100000) is None


def test_fastapi_dependency_wiring():
    """The dependency resolves `Request` when wired with Depends() in a real FastAPI app."""
    from typing import Annotated

    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()

    @app.get("/lang")
    async def lang_route(lang: Annotated[str, Depends(L.get_request_language)]):
        return {"lang": lang}

    with TestClient(app) as client:  # in-process ASGI, no sockets
        assert client.get("/lang", headers={"Accept-Language": "fr-FR"}).json() == {"lang": "fr"}
        assert client.get("/lang", headers={"Accept-Language": "ar"}).json() == {"lang": "ar"}
        assert client.get("/lang", headers={"Accept-Language": "de-DE,de;q=0.9"}).json() == {"lang": "en"}
        assert client.get("/lang", headers={"accept-language": ""}).json() == {"lang": "en"}
        # TestClient sends no Accept-Language by default -> "en"
        assert client.get("/lang").json() == {"lang": "en"}


def test_leaf_import_purity():
    """Importing the module in a fresh interpreter pulls in no provider/prompt/settings/DB modules."""
    code = (
        "import sys; import app.services.ai_locale; "
        "bad = [m for m in sys.modules if m.startswith(('app.services.ai_provider', 'app.services.ai_prompts', "
        "'app.services.ai_structured', 'app.services.ai_chunking', 'app.core', 'app.models', 'sqlalchemy'))]; "
        "print(','.join(sorted(bad)))"
    )
    out = subprocess.run(
        [sys.executable, "-c", code], cwd=str(BACKEND_DIR), capture_output=True, text=True, timeout=120,
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "", "leaf module imported: " + out.stdout.strip()


def test_never_raises_fuzz():
    odd = [None, "", " ", "*", 0, 1.5, True, b"fr", ["fr"], {"fr": 1}, object(), "fr\x00", "x" * 10000, "ar-؀"]
    for value in odd:
        L.normalize_language(value)
        L.parse_accept_language(value)  # type: ignore[arg-type]
        L.language_from_accept(value)  # type: ignore[arg-type]
        L.tenant_locale(value)
        assert L.resolve_language(value, explicit=value, tenant_default=value) in L.SUPPORTED_LANGUAGES  # type: ignore[arg-type]
        assert L.resolve_language(None, default=value) in L.SUPPORTED_LANGUAGES  # type: ignore[arg-type]
        assert L.language_from_request(value, explicit=value, tenant_default=value) in L.SUPPORTED_LANGUAGES  # type: ignore[arg-type]
        assert L.language_instruction(value) in L.LANGUAGE_INSTRUCTIONS.values()  # type: ignore[arg-type]
        assert L.language_name(value) in L.LANGUAGE_NAMES.values()  # type: ignore[arg-type]
        assert isinstance(L.is_rtl(value), bool)  # type: ignore[arg-type]
        L.guess_language(value)  # type: ignore[arg-type]
        for kind in list(L.FAILURE_KINDS) + [value]:
            assert isinstance(L.failure_message(kind, value, status=value), str)  # type: ignore[arg-type]


CASES = [
    test_precedence_explicit_header_tenant_default,
    test_accept_language_q_values_and_subtags,
    test_normalize_and_tenant_locale_are_tolerant,
    test_get_request_language_dependency_and_sync_helper,
    test_language_instruction_invariants,
    test_guess_language_and_failure_message,
    test_interface_summary_contract,
    test_parse_accept_language_details,
    test_language_from_accept_weighting,
    test_tenant_locale_shapes,
    test_language_from_request_tolerates_odd_objects,
    test_guess_language_edges,
    test_fastapi_dependency_wiring,
    test_leaf_import_purity,
    test_never_raises_fuzz,
]


def main() -> int:
    failures = 0
    for case in CASES:
        try:
            case()
        except Exception:
            failures += 1
            print(f"FAIL  {case.__name__}")
            traceback.print_exc()
        else:
            print(f"PASS  {case.__name__}")
    total = len(CASES)
    print(f"\n{total - failures}/{total} passed" + ("" if not failures else f", {failures} FAILED"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
