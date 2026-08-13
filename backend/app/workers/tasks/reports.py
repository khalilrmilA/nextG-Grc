"""Celery task: deliver due scheduled reports (Elite Pack).

This only fires where Celery beat runs (docker / on-prem). In the pm2 production
topology there is no beat, so the in-process loop in app.services.report_scheduler
handles delivery instead. Running both is safe: run_due_schedules claims each
occurrence with an optimistic UPDATE, so an occurrence is delivered exactly once.
"""
import asyncio

from celery import shared_task
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.core.config import settings
from app.services.report_scheduler import run_due_schedules

_engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
_SessionLocal = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)


def _run(coro):
    """Run an async coroutine from a sync Celery task."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


@shared_task(name="app.workers.tasks.reports.generate_scheduled_reports")
def generate_scheduled_reports():
    async def _inner():
        async with _SessionLocal() as db:
            return await run_due_schedules(db)

    return _run(_inner())
