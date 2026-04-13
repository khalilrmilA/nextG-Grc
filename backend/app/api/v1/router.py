"""API v1 router — aggregates all endpoint routers."""
from fastapi import APIRouter
from app.api.v1.endpoints import (
    auth,
    ai_access,
    tenants,
    users,
    frameworks,
    risks,
    compliance,
    audits,
    policies,
    vendors,
    assets,
    dashboard,
    subscriptions,
    ai,
    notifications,
    auditor_portal,
    admin,
    reports,
    data_io,
    activity_log,
)

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["Authentication"])
api_router.include_router(ai_access.router, tags=["AI Access"])
api_router.include_router(tenants.router, prefix="/tenants", tags=["Tenants"])
api_router.include_router(users.router, prefix="/users", tags=["Users"])
api_router.include_router(frameworks.router, prefix="/frameworks", tags=["Frameworks"])
api_router.include_router(risks.router, prefix="/risks", tags=["Risk Management"])
api_router.include_router(compliance.router, prefix="/compliance", tags=["Compliance"])
api_router.include_router(audits.router, prefix="/audits", tags=["Audit Management"])
api_router.include_router(policies.router, prefix="/policies", tags=["Policy Management"])
api_router.include_router(vendors.router, prefix="/vendors", tags=["Vendor Risk (TPRM)"])
api_router.include_router(assets.router, prefix="/assets", tags=["Asset Management"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["Dashboard"])
api_router.include_router(subscriptions.router, prefix="/subscriptions", tags=["Subscriptions"])
api_router.include_router(ai.router, prefix="/ai", tags=["AI Assistant"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["Notifications"])
api_router.include_router(auditor_portal.router, prefix="/auditor-portal", tags=["Auditor Portal"])
api_router.include_router(admin.router, prefix="/admin", tags=["Super Admin"])
api_router.include_router(reports.router, prefix="/reports", tags=["Reports"])
api_router.include_router(data_io.router, prefix="/data", tags=["Data Import/Export"])
api_router.include_router(activity_log.router, prefix="/activity-log", tags=["Activity Log"])
