"""Shared password strength policy — enforced on every set-password path.

Import ``validate_password`` and call it wherever a password is accepted
(registration, admin create, auditor create, change-password, reset-confirm).
Raises :class:`PasswordPolicyError` (a ``ValueError``) on a weak password.
"""
import re

MIN_LENGTH = 12


class PasswordPolicyError(ValueError):
    """Raised when a candidate password fails the strength policy."""


def validate_password(password: str) -> None:
    """Raise :class:`PasswordPolicyError` if ``password`` is too weak.

    Requires >= 12 chars and at least one uppercase, lowercase, digit, symbol.
    """
    password = password or ""
    problems: list[str] = []
    if len(password) < MIN_LENGTH:
        problems.append(f"at least {MIN_LENGTH} characters")
    if not re.search(r"[A-Z]", password):
        problems.append("an uppercase letter")
    if not re.search(r"[a-z]", password):
        problems.append("a lowercase letter")
    if not re.search(r"[0-9]", password):
        problems.append("a digit")
    if not re.search(r"[^A-Za-z0-9]", password):
        problems.append("a symbol")
    if problems:
        raise PasswordPolicyError("Password must contain " + ", ".join(problems) + ".")


def is_valid_password(password: str) -> bool:
    """Boolean convenience wrapper around :func:`validate_password`."""
    try:
        validate_password(password)
        return True
    except PasswordPolicyError:
        return False
