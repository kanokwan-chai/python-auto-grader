"""Python Auto Grader — FastAPI Application Entry Point."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.database import Base, engine
from app.core.security import RateLimitMiddleware

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure ORM metadata tables exist when running in local dev/SQLite tests;
    # in production PostgreSQL, supabase/migrations/*.sql is the source of truth.
    if engine.dialect.name == "sqlite":
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="Multi-tenant Python Auto Grader with Google Classroom, AST, Isolated Sandbox & AI Review",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RateLimitMiddleware, max_requests_per_minute=settings.rate_limit_requests_per_minute)

app.include_router(api_router)


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "python-auto-grader-api", "env": settings.app_env}
