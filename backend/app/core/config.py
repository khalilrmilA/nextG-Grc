from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from typing import Literal
from pathlib import Path

# Resolve the DB path relative to this file so it always points to
# backend/grc_dev.db regardless of which directory uvicorn is launched from.
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent  # backend/


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Order matters: pydantic-settings gives LATER files higher priority.
        # .env.local should win for local dev (overrides docker-compose .env.dev).
        env_file=(".env", ".env.dev", ".env.local"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    APP_NAME: str = "GRC Platform"
    APP_VERSION: str = "0.1.0"
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"
    DEBUG: bool = False
    SECRET_KEY: str = "change-me-in-production"
    API_V1_PREFIX: str = "/api/v1"
    ALLOWED_ORIGINS: list[str] = ["http://localhost:3000", "http://localhost:3001", "http://localhost:4000", "http://localhost:4001", "http://localhost:5173"]

    # Database — absolute path so it resolves correctly regardless of CWD
    DATABASE_URL: str = f"sqlite+aiosqlite:///{_BACKEND_DIR / 'grc_dev.db'}"
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 40

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/2"

    # Auth / JWT
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Keycloak (SSO)
    KEYCLOAK_URL: str = "http://localhost:8080"
    KEYCLOAK_REALM: str = "grc"
    KEYCLOAK_CLIENT_ID: str = "grc-backend"
    KEYCLOAK_CLIENT_SECRET: str = ""

    # Active Directory / LDAP SSO (Elite Pack). Deployment-wide defaults; a tenant
    # may override any of these via its settings["ldap"] JSON block.
    LDAP_ENABLED: bool = False
    LDAP_SERVER_URI: str = ""              # e.g. ldap://ad.stb.com.tn:389 (AD 2012)
    LDAP_USE_SSL: bool = False
    LDAP_BIND_DN: str = ""                 # service account DN (empty = anonymous bind)
    LDAP_BIND_PASSWORD: str = ""
    LDAP_USER_SEARCH_BASE: str = ""        # e.g. OU=Users,DC=stb,DC=com,DC=tn
    LDAP_USER_FILTER: str = "(sAMAccountName={username})"
    LDAP_ATTR_EMAIL: str = "mail"
    LDAP_ATTR_FIRSTNAME: str = "givenName"
    LDAP_ATTR_LASTNAME: str = "sn"
    LDAP_DEFAULT_EMAIL_DOMAIN: str = ""    # fallback if the directory has no mail attr
    LDAP_DEFAULT_TENANT_SLUG: str = ""     # tenant SSO logins map to when unspecified
    LDAP_DEFAULT_ROLE: str = "viewer"      # role for auto-provisioned directory users
    LDAP_AUTO_CREATE: bool = True          # create a local account on first SSO login

    # AWS S3
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_REGION: str = "us-east-1"
    S3_BUCKET_EVIDENCE: str = "grc-evidence"
    S3_BUCKET_DOCUMENTS: str = "grc-documents"

    # AI
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-sonnet-4-6"

    # Stripe
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""

    # Email
    SMTP_HOST: str = "smtp.ses.amazonaws.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    EMAIL_FROM: str = "noreply@grcplatform.com"
    FRONTEND_URL: str = "http://localhost:3000"

    # Sentry
    SENTRY_DSN: str = ""

    # File uploads
    UPLOADS_DIR: str = "uploads"
    MAX_UPLOAD_SIZE_MB: int = 2
    OCR_MAX_UPLOAD_SIZE_MB: int = 20   # scanned PDFs need far more headroom than the global cap
    FRONTEND_BASE_URL: str = "http://localhost:4000"

    # Ollama (local AI)
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_CHAT_MODEL: str = "gpt-oss:120b-cloud"
    OLLAMA_ANALYSIS_BATCH_SIZE: int = 25

    # Threat Intelligence
    OPENSOURCEMALWARE: str = ""   # opensourcemalware.com API key

    # Feature Flags
    ENABLE_AI_COPILOT: bool = False
    ENABLE_CONTINUOUS_MONITORING: bool = False

    # Licensing
    LICENSE_PRIVATE_KEY: str = ""   # base64 of the 32-byte Ed25519 private seed — vendor SaaS server ONLY
    LICENSE_PUBLIC_KEY: str = ""    # base64 of the 32-byte raw public key — client installs
    LICENSE_ENFORCEMENT: bool = False


_INSECURE_SECRETS = {
    "change-me-in-production",
    "dev-local-secret-key-abc123xyz789",
    "dev-secret-key-do-not-use-in-production-abc123",
    "REPLACE_ME_WITH_64_RANDOM_URLSAFE_CHARS",  # .env.onprem.example placeholder
    "",
}


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.ENVIRONMENT == "production":
        if s.SECRET_KEY in _INSECURE_SECRETS or len(s.SECRET_KEY) < 32:
            raise RuntimeError(
                "SECRET_KEY is unset, default, or too short for production. "
                "Generate a strong secret: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
            )
        if s.DEBUG:
            raise RuntimeError("DEBUG must be False in production")
    return s


settings = get_settings()


def is_production() -> bool:
    return settings.ENVIRONMENT == "production"
