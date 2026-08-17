"""Pre-flight check before flipping ENVIRONMENT=production.

Read-only. Reports whether the current config would pass the production guards in
config.get_settings() (which otherwise crash startup), plus recommended hardening.
Never prints secret VALUES — only lengths / booleans.

Run:  cd backend && venv/bin/python -m scripts.check_prod_readiness
"""
from app.core.config import settings, _INSECURE_SECRETS

_BLOCK = "BLOCK"   # startup will crash until fixed
_WARN = "WARN"     # recommended before a bank goes live
_OK = "OK"


def main() -> int:
    rows: list[tuple[str, str, str]] = []

    sk = settings.SECRET_KEY or ""
    strong = sk not in _INSECURE_SECRETS and len(sk) >= 32
    rows.append((_OK if strong else _BLOCK,
                 f"SECRET_KEY strong (len={len(sk)}, non-default)",
                 'Generate: python -c "import secrets; print(secrets.token_urlsafe(64))"'))

    rows.append((_OK if settings.DEBUG is False else _BLOCK,
                 f"DEBUG is False (currently {settings.DEBUG})",
                 "Set DEBUG=false in backend/.env.local"))

    origins = settings.ALLOWED_ORIGINS or []
    clean = origins and all("localhost" not in o and "127.0.0.1" not in o for o in origins) and "*" not in origins
    rows.append((_OK if clean else _WARN,
                 f"ALLOWED_ORIGINS prod-only ({len(origins)} entries)",
                 "Drop localhost/dev origins; keep only https://grceye.com"))

    smtp_ok = bool(settings.SMTP_HOST) and (settings.SMTP_HOST != "smtp.ses.amazonaws.com" or (settings.SMTP_USER and settings.SMTP_PASSWORD))
    rows.append((_OK if smtp_ok else _WARN,
                 f"SMTP configured (host set: {bool(settings.SMTP_HOST)})",
                 "Set SMTP_* so notifications + scheduled reports send"))

    email_ok = "grcplatform.com" not in (settings.EMAIL_FROM or "")
    rows.append((_OK if email_ok else _WARN,
                 f"EMAIL_FROM is not the placeholder ({settings.EMAIL_FROM})",
                 "Set EMAIL_FROM to your SPF-aligned sender (e.g. @next-step.tn)"))

    print(f"Current ENVIRONMENT: {settings.ENVIRONMENT}\n")
    blocks = warns = 0
    for status, label, hint in rows:
        print(f"  [{status:^5}] {label}")
        if status != _OK:
            print(f"          -> {hint}")
            if status == _BLOCK:
                blocks += 1
            else:
                warns += 1

    print()
    if blocks:
        print(f"NOT READY: {blocks} blocking issue(s) — startup would crash. Fix them before ENVIRONMENT=production.")
        return 1
    if warns:
        print(f"READY to flip (startup will boot), with {warns} recommended fix(es) above.")
    else:
        print("READY: safe to set ENVIRONMENT=production.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
