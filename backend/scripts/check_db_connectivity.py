"""Validate the configured DATABASE_URL by opening a connection and running SELECT 1.

Use this after pointing DATABASE_URL at an Oracle 19c or SQL Server 2019 instance
to confirm the async driver, network, and credentials all work before starting the
app. Prints the resolved backend and the server version banner.

Usage:
    cd backend && venv/bin/python -m scripts.check_db_connectivity
"""
import asyncio
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.engine.url import make_url

from app.core.config import settings

# Per-backend "server version" probe.
_VERSION_SQL = {
    "sqlite": "select sqlite_version()",
    "postgresql": "select version()",
    "oracle": "select banner from v$version where rownum = 1",
    "mssql": "select @@version",
}


async def main() -> int:
    url = make_url(settings.DATABASE_URL)
    backend = url.get_backend_name()
    # Redact the password in the printed URL.
    safe = url.set(password="***") if url.password else url
    print(f"backend : {backend}")
    print(f"url     : {safe}")

    engine = create_async_engine(settings.DATABASE_URL)
    try:
        async with engine.connect() as conn:
            one = (await conn.execute(text("select 1" if backend != "oracle" else "select 1 from dual"))).scalar()
            print(f"select 1: {one}")
            version_sql = _VERSION_SQL.get(backend)
            if version_sql:
                try:
                    banner = (await conn.execute(text(version_sql))).scalar()
                    print(f"version : {str(banner).strip()[:120]}")
                except Exception as exc:  # version probe is best-effort
                    print(f"version : (probe failed: {exc})")
        print("RESULT  : OK — database reachable")
        return 0
    except Exception as exc:
        print(f"RESULT  : FAILED — {type(exc).__name__}: {exc}")
        return 1
    finally:
        await engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
