from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Python Auto Grader API"
    app_env: str = "development"
    app_secret_key: str = "dev-insecure-change-in-production-0000000000000000000000000000"
    cors_origins: str = "http://localhost:3000"

    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/pyautograder"

    # Supabase Auth & Storage
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = "dev-supabase-jwt-secret-change-me"
    storage_bucket_name: str = "submissions"
    storage_backend: str = "local"  # "supabase" | "local"
    local_storage_dir: str = "/tmp/pyautograder_storage"

    # Redis & Celery
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # Google OAuth 2.0 / Classroom / Drive
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/api/v1/google/oauth/callback"
    token_encryption_key: str = ""

    # Isolated Sandbox Service
    sandbox_service_url: str = "http://localhost:8080"
    sandbox_api_key: str = "dev-sandbox-key"

    # AI Code Review (OpenAI-compatible LLM API)
    llm_api_key: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    llm_model: str = "gpt-4o-mini"

    # Rate Limiting
    rate_limit_requests_per_minute: int = 120

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
