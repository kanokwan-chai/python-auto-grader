from __future__ import annotations

from typing import AsyncGenerator, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
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
