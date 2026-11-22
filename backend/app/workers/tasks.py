"""Celery Background Worker Tasks for Asynchronous Grading."""

from __future__ import annotations

import asyncio

from app.core.celery_app import celery_app
from app.core.database import AsyncSessionLocal
from app.services.grading_pipeline import execute_grading_run


@celery_app.task(name="grading.run_submission", bind=True)
def run_grading_task(self, grading_run_id: str) -> dict:
    async def _runner():
        async with AsyncSessionLocal() as db:
            run = await execute_grading_run(db, grading_run_id)
            return {"grading_run_id": run.id, "status": run.status, "final_score": str(run.final_score)}

    return asyncio.run(_runner())
