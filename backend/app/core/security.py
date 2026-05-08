import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import HTTPException, status
from app.core.config import settings

# Use Argon2 for password hashing (more reliable than bcrypt)
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# In-memory revocation set for refresh token JTIs. Process-local — for
# multi-worker / multi-host deployments swap with a Redis set keyed by jti.
_REVOKED_JTIS: set[str] = set()


def revoke_jti(jti: str) -> None:
    """Mark a token's jti as revoked. Subsequent decodes will reject it."""
    if jti:
        _REVOKED_JTIS.add(jti)


def is_jti_revoked(jti: str | None) -> bool:
    return bool(jti) and jti in _REVOKED_JTIS


def hash_password(password: str) -> str:
    """Hash password using Argon2."""
    return pwd_context.hash(password)


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


def decode_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        if is_jti_revoked(payload.get("jti")):
            raise JWTError("Token has been revoked")
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
