from app.api.v1.dependencies.auth import (
    get_current_user, require_roles, require_roles_strict, get_tenant_id,
    get_current_user_optional, get_tenant_id_optional,
)
from app.api.v1.dependencies.pagination import PaginationParams

__all__ = [
    # require_roles_strict is re-exported next to require_roles on purpose: the
    # two are alternatives on the same decision, and a lane importing the strict
    # one from this package (the documented import path for every other auth
    # dependency) would otherwise raise ImportError at import time — which takes
    # down the whole of api/v1, not just its own module.
    "get_current_user", "require_roles", "require_roles_strict", "get_tenant_id",
    "get_current_user_optional", "get_tenant_id_optional",
    "PaginationParams",
]
