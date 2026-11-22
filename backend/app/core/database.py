from __future__ import annotations

from typing import AsyncGenerator, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

settings = get_settings()


def _normalize_asyncpg_url(raw_url: str) -> tuple[str, dict]:
    """
    Normalize Neon/Supabase PostgreSQL URLs for asyncpg:
    - Converts postgresql:// or postgres:// -> postgresql+asyncpg://
    - Moves sslmode=require / channel_binding into asyncpg connect_args={'ssl': 'require'}
    """
    url = raw_url.strip()
    if url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://") :]

    connect_args: dict = {}
    if url.startswith("postgresql+asyncpg://"):
        parts = urlsplit(url)
        query_items = parse_qsl(parts.query, keep_blank_values=True)
        filtered = []
        needs_ssl = "neon.tech" in (parts.hostname or "") or "supabase.co" in (parts.hostname or "")
        for k, v in query_items:
            if k == "sslmode":
                if v.lower() in ("require", "verify-ca", "verify-full"):
                    needs_ssl = True
            elif k == "channel_binding":
                continue
            else:
                filtered.append((k, v))
        if needs_ssl:
            connect_args["ssl"] = "require"
        url = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(filtered), parts.fragment))

    return url, connect_args


_db_url, _connect_args = _normalize_asyncpg_url(settings.database_url)

engine = create_async_engine(
    _db_url,
    echo=False,
    pool_pre_ping=True,
    connect_args=_connect_args,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def apply_rls_context(
    session: AsyncSession,
    user_id: Optional[str],
    is_super_admin: bool = False,
) -> None:
    """
    Propagate authenticated actor context into PostgreSQL session variables
    so Row Level Security (RLS) policies enforce multi-tenant isolation.
    Skipped cleanly on SQLite (used only in lightweight unit tests).
    """
    bind = session.bind or engine
    if bind.dialect.name != "postgresql":
        return
    if user_id:
        await session.execute(
            text("SELECT set_config('app.current_user_id', :uid, true)"),
            {"uid": str(user_id)},
        )
    await session.execute(
        text("SELECT set_config('app.is_super_admin', :sa, true)"),
        {"sa": "true" if is_super_admin else "false"},
    )
