"""Celery application for async task processing."""
from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "grc_platform",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "app.workers.tasks.evidence",
        "app.workers.tasks.notifications",
        "app.workers.tasks.compliance_scoring",
        "app.workers.tasks.vendor_assessments",
        "app.workers.tasks.reports",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    # Beat schedule for periodic tasks
    beat_schedule={
        "check-policy-review-due": {
            "task": "app.workers.tasks.notifications.send_policy_review_reminders",
            "schedule": 86400.0,  # daily
        },
        "send-weekly-digest": {
            "task": "app.workers.tasks.notifications.send_weekly_digest",
            "schedule": 604800.0,  # weekly (7 days)
        },
        "recompute-compliance-scores": {
            "task": "app.workers.tasks.compliance_scoring.recompute_all_scores",
            "schedule": 3600.0,  # hourly
        },
        "check-vendor-assessment-due": {
            "task": "app.workers.tasks.vendor_assessments.send_assessment_reminders",
            "schedule": 86400.0,  # daily
        },
        "deliver-scheduled-reports": {
            "task": "app.workers.tasks.reports.generate_scheduled_reports",
            "schedule": 1800.0,  # every 30 min (in-process loop covers pm2 prod)
        },
    },
)
