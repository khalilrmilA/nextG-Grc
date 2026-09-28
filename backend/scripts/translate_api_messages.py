"""One-off: translate the extracted API messages into French and Arabic.

Reads ``app/core/locales/messages_source.json`` (from ``extract_api_messages``) plus
the hand-maintained extras below, asks the platform's model (``ai_provider.ai_complete``,
Ollama) for the strings still missing from ``messages_{fr,ar}.json``, validates every
answer (placeholders preserved, non-empty, right script for Arabic) and merges it in.
Existing (possibly hand-corrected) entries are never overwritten — re-running only fills
gaps, so the committed catalogs are the reviewed source of truth.

    cd backend && DATABASE_URL=sqlite+aiosqlite:///<snapshot copy> \\
        venv/bin/python -m scripts.translate_api_messages [--lang fr ar] [--batch 25]

Not used at runtime.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import string
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
LOCALES = BACKEND / "app" / "core" / "locales"
SOURCE = LOCALES / "messages_source.json"

# Messages that do not come from an AST-visible literal (Starlette defaults, handlers).
EXTRA_STATIC = [
    "Not Found", "Method Not Allowed", "Internal Server Error", "Unauthorized", "Forbidden",
    "Not authenticated", "Too many requests. Please slow down and try again.",
    "Could not validate credentials", "Request Entity Too Large",
    # app/core/password_policy.py — the items of "Password must contain {join_problems}."
    "an uppercase letter", "a lowercase letter", "a digit", "a symbol",
    # threats.py feed summary kinds (i18n_msg)
    "malicious package", "advisory", "news",
    "connection refused",  # scanner_connectors._describe() default reason
]
EXTRA_TEMPLATES = [
    "at least {min_length} characters",  # password_policy.py problems.append(f"...")
    # scanner_connectors._describe() — returned, not raised, so invisible to the extractor
    "ConnectError: could not connect to the scanner ({reason}).",
    "{exc_type}: the scanner did not answer in time (check the URL, port and firewall).",
]

GLOSSARY = {
    "fr": """assessment=évaluation; finding=constatation; framework=référentiel; control=contrôle;
applied control=contrôle appliqué; evidence=preuve; vendor/third party=tiers; risk register=registre des risques;
policy=politique; audit=audit; auditor=auditeur; incident=incident; vulnerability=vulnérabilité; asset=actif;
tenant/organization=organisation; subscription=abonnement; plan=offre; security exception/waiver=exception/dérogation;
connector=connecteur; scanner=scanner; feed=flux; tenant administrator=administrateur de l'organisation;
super admin=super administrateur; MFA=MFA (authentification multifacteur); two-factor=double authentification.""",
    "ar": """assessment=تقييم; finding=نتيجة (ملاحظة تدقيق); framework=إطار; control=ضابط (الضوابط); applied control=ضابط مطبق;
evidence=دليل (أدلة); vendor/third party=طرف ثالث; risk register=سجل المخاطر; policy=سياسة; audit=تدقيق; auditor=مدقق;
incident=حادث; vulnerability=ثغرة أمنية; asset=أصل; tenant/organization=المنظمة; subscription=اشتراك; plan=الخطة;
security exception/waiver=استثناء/تنازل; connector=موصل; scanner=الماسح; feed=موجز; tenant administrator=مسؤول المنظمة;
super admin=المسؤول الأعلى; MFA=المصادقة متعددة العوامل (MFA); two-factor=المصادقة الثنائية.""",
}

LANG_NAME = {"fr": "French (France)", "ar": "Modern Standard Arabic"}

KEEP_VERBATIM = ("Elite Pack", "GRCeye", "CVE", "CVSS", "MITRE", "ATT&CK", "TOTP", "SSO", "SAML",
                 "OIDC", "LDAP", "API", "JSON", "CSV", "PDF", "XML", "URL", "SMTP", "EASM", "KEV",
                 "OpenVAS", "Greenbone", "Nessus", "Tenable", "Qualys", "Ollama", "GMP")

_FMT = string.Formatter()


def _fields(s: str) -> list[str] | None:
    try:
        return sorted(f for _, f, _, _ in _FMT.parse(s) if f is not None)
    except ValueError:
        return None


def _system_prompt(lang: str) -> str:
    return f"""You translate user-facing messages of a GRC (governance, risk & compliance) SaaS web
application from English into {LANG_NAME[lang]}. These are error and status messages shown in the UI.

Rules:
- Output ONLY a JSON object mapping each input id to its translation: {{"1": "...", "2": "..."}}.
- Translate faithfully, concise, professional UI tone (for French use the "vous" form; for Arabic use formal MSA).
- Keep every {{placeholder}} EXACTLY as written (same name, same braces), and keep doubled braces {{{{ }}}} as is.
- Keep unchanged: product names, acronyms, HTTP paths (/api/...), field/parameter names written in snake_case or
  in quotes ('x', "x"), enum values, code identifiers, e-mail addresses, numbers, file extensions, and: {", ".join(KEEP_VERBATIM)}.
- Keep the same trailing punctuation (a message ending with "." ends with "."; none if none).
- Use this vocabulary consistently: {GLOSSARY[lang]}
"""


async def _translate_batch(items: dict[str, str], lang: str) -> dict[str, str]:
    from app.services.ai_provider import ai_complete

    user = "Translate these messages. Input JSON:\n" + json.dumps(items, ensure_ascii=False, indent=0)
    text = await ai_complete(
        [{"role": "system", "content": _system_prompt(lang)}, {"role": "user", "content": user}],
        json_mode=True, temperature=0.1, timeout_s=300.0, num_predict=8192,
    )
    text = (text or "").strip()
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        return {}
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return {}
    return {str(k): v for k, v in data.items() if isinstance(v, str)}


def _fix_punctuation(src: str, tr: str) -> str:
    """The model likes to add a final period; keep the source's terminal punctuation."""
    tr = tr.strip()
    if not src.rstrip().endswith((".", "…", "!", "?", ")", ":")) and tr.endswith(".") and not tr.endswith(".."):
        tr = tr[:-1].rstrip()
    return tr


def _valid(src: str, tr: str, lang: str, is_template: bool) -> bool:
    tr = tr.strip()
    if not tr:
        return False
    if is_template:
        if _fields(src) != _fields(tr):
            return False
    elif ("{" in src) != ("{" in tr) and "{" not in src:
        return False
    if lang == "ar" and not re.search(r"[؀-ۿ]", tr):
        return False
    return True


async def run(langs: list[str], batch: int, limit: int | None) -> None:
    src = json.loads(SOURCE.read_text(encoding="utf-8"))
    statics = list(dict.fromkeys(list(src["static"]) + EXTRA_STATIC))
    templates = list(dict.fromkeys(list(src["templates"]) + EXTRA_TEMPLATES))
    for lang in langs:
        path = LOCALES / f"messages_{lang}.json"
        cat = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        cat.setdefault("static", {})
        cat.setdefault("templates", {})
        for kind, pool in (("static", statics), ("templates", templates)):
            todo = [s for s in pool if s not in cat[kind]]
            if limit:
                todo = todo[:limit]
            print(f"[{lang}] {kind}: {len(todo)} to translate", flush=True)
            for i in range(0, len(todo), batch):
                chunk = todo[i:i + batch]
                ids = {str(n + 1): s for n, s in enumerate(chunk)}
                for attempt in range(3):
                    try:
                        out = await _translate_batch(ids, lang)
                    except Exception as exc:  # noqa: BLE001
                        print(f"  batch {i}: {exc!r}", file=sys.stderr)
                        out = {}
                    ok = 0
                    for k, s in list(ids.items()):
                        tr = out.get(k)
                        if isinstance(tr, str) and _valid(s, tr, lang, kind == "templates"):
                            cat[kind][s] = _fix_punctuation(s, tr)
                            ok += 1
                            ids.pop(k)
                    if not ids:
                        break
                print(f"  {lang} {kind} {i + len(chunk)}/{len(todo)} (missing after retries: {len(ids)})", flush=True)
                path.write_text(json.dumps({"static": dict(sorted(cat["static"].items())),
                                            "templates": dict(sorted(cat["templates"].items()))},
                                           ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", nargs="+", default=["fr", "ar"])
    ap.add_argument("--batch", type=int, default=25)
    ap.add_argument("--limit", type=int, default=None)
    a = ap.parse_args()
    asyncio.run(run(a.lang, a.batch, a.limit))


if __name__ == "__main__":
    main()
