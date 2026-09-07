import uuid
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any
from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import HTTPException, status
from app.core import shared_state
from app.core.config import settings

# Use Argon2 for password hashing (more reliable than bcrypt)
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# Revoked token jtis live in shared state (Redis when reachable) so a token
# revoked on one uvicorn worker is rejected by every other worker too — the
# previous process-local set left a revoked refresh token usable on whichever
# worker hadn't seen the logout. Entries expire after the longest token
# lifetime: past that the token fails on `exp` anyway, so keeping the jti
# would only leak memory.
_REVOCATION_TTL_SECONDS = settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60


async def revoke_jti(jti: str) -> None:
    """Mark a token's jti as revoked. Subsequent decodes will reject it."""
    if jti:
        await shared_state.mark(f"revoked_jti:{jti}", _REVOCATION_TTL_SECONDS)


async def is_jti_revoked(jti: str | None) -> bool:
    return bool(jti) and await shared_state.is_marked(f"revoked_jti:{jti}")


def hash_password(password: str) -> str:
    """Hash password using Argon2."""
    return pwd_context.hash(password)


async def hash_password_async(password: str) -> str:
    """Hash off the event loop.

    Argon2 is deliberately expensive — that is the point of it — and it runs on
    the request thread. At the specified volumetry a 09:00 sign-in wave from 300
    staff would queue behind each other's key derivation, and every other
    request on that worker with them. A worker thread costs nothing here and
    keeps the loop free.
    """
    return await asyncio.to_thread(hash_password, password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash. Supports both Argon2 and bcrypt for legacy compatibility."""
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        # Fallback: try manual bcrypt verification for legacy passwords
        try:
            import bcrypt
            plain_bytes = plain_password[:72].encode('utf-8')
            hashed_bytes = hashed_password.encode('utf-8') if isinstance(hashed_password, str) else hashed_password
            return bcrypt.checkpw(plain_bytes, hashed_bytes)
        except Exception:
            return False


async def verify_password_async(plain_password: str, hashed_password: str) -> bool:
    """Verify off the event loop — see :func:`hash_password_async`."""
    return await asyncio.to_thread(verify_password, plain_password, hashed_password)


def create_access_token(data: dict[str, Any]) -> str:
    payload = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload.update({"exp": expire, "type": "access", "jti": uuid.uuid4().hex})
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(data: dict[str, Any]) -> str:
    payload = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )
    payload.update({"exp": expire, "type": "refresh", "jti": uuid.uuid4().hex})
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_mfa_challenge_token(data: dict[str, Any]) -> str:
    """Short-lived token proving 'password already verified, MFA still owed'.

    Deliberately NOT usable as an access token: get_current_user rejects any
    token whose type isn't 'access', so this can only be redeemed at
    POST /auth/mfa-login.
    """
    payload = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=5)
    payload.update({"exp": expire, "type": "mfa_challenge", "jti": uuid.uuid4().hex})
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


async def decode_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        if await is_jti_revoked(payload.get("jti")):
            raise JWTError("Token has been revoked")
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
