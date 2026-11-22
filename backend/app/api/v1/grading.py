"""
Grading Execution, Immutable History, Score Adjustment, Teacher Feedback & Approval Endpoints.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    ActorContext,
    get_workspace_actor,
    require_grade_approve_permission,
    require_grade_edit_permission,
    write_audit_log,
)
from app.core.celery_app import celery_app
from app.core.database import get_db
from app.models.models import (
    Assignment,
    CriterionResult,
    GradeAdjustment,
    GradingRun,
    Submission,
    SubmissionVersion,
    TeacherFeedback,
    TestResult,
)
from app.schemas.schemas import (
    BatchGradeIn,
    CriterionResultOut,
    GradeAdjustIn,
    GradingRunOut,
    TeacherFeedbackIn,
    TestResultOut,
)
from app.services.grading_pipeline import execute_grading_run
from app.workers.tasks import run_grading_task

router = APIRouter(prefix="/grading", tags=["Grading"])


async def _create_grading_run_record(
    db: AsyncSession,
    actor: ActorContext,
    sub: Submission,
    assignment: Assignment,
) -> GradingRun:
    latest_version = (
        await db.execute(
            select(SubmissionVersion)
            .where(SubmissionVersion.submission_id == sub.id)
            .order_by(SubmissionVersion.version_number.desc())
        )
    ).scalars().first()
    if not latest_version:
        raise HTTPException(status_code=400, detail="Submission has no uploaded version to grade")

    max_run_num = (
        await db.execute(select(func.max(GradingRun.run_number)).where(GradingRun.submission_id == sub.id))
    ).scalar_one_or_none() or 0

    run = GradingRun(
        workspace_id=actor.workspace_id,
        submission_id=sub.id,
        version_id=latest_version.id,
        run_number=max_run_num + 1,
        status="queued",
        triggered_by=actor.user_id,
        max_score=assignment.max_score,
    )
    db.add(run)
    sub.status = "queued"
    await db.flush()
    return run


@router.post("/submissions/{submission_id}/run", response_model=GradingRunOut, status_code=status.HTTP_201_CREATED)
async def trigger_submission_grading(
    submission_id: str,
    run_inline: bool = Query(default=False, description="Execute synchronously instead of queuing to Celery"),
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    sub = (
        await db.execute(
            select(Submission).where(Submission.id == submission_id, Submission.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")

    asg = await db.get(Assignment, sub.assignment_id)
    run = await _create_grading_run_record(db, actor, sub, asg)
    await db.commit()

    if run_inline:
        run = await execute_grading_run(db, run.id)
    else:
        try:
            task = run_grading_task.delay(run.id)
            run.celery_task_id = task.id
            await db.commit()
        except Exception:
            # If Redis/Celery broker isn't running locally, fall back gracefully to inline execution
            run = await execute_grading_run(db, run.id)

    await db.refresh(run)
    return GradingRunOut.model_validate(run)


@router.post("/assignments/{assignment_id}/run-batch")
async def trigger_batch_grading(
    assignment_id: str,
    body: BatchGradeIn,
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    asg = (
        await db.execute(
            select(Assignment).where(Assignment.id == assignment_id, Assignment.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not asg:
        raise HTTPException(status_code=404, detail="Assignment not found")

    stmt = select(Submission).where(
        Submission.assignment_id == assignment_id,
        Submission.workspace_id == actor.workspace_id,
        Submission.status != "not_submitted",
    )
    if body.submission_ids:
        stmt = stmt.where(Submission.id.in_(body.submission_ids))
    submissions = (await db.execute(stmt)).scalars().all()

    queued_runs = []
    for sub in submissions:
        try:
            run = await _create_grading_run_record(db, actor, sub, asg)
            queued_runs.append(run)
        except HTTPException:
            continue
    await db.commit()

    for run in queued_runs:
        if body.run_sync_inline:
            await execute_grading_run(db, run.id, selected_artifact_ids=body.selected_artifact_ids)
        else:
            try:
                task = run_grading_task.delay(run.id)
                run.celery_task_id = task.id
            except Exception:
                await execute_grading_run(db, run.id, selected_artifact_ids=body.selected_artifact_ids)
    await db.commit()

    return {"queued_count": len(queued_runs), "run_ids": [r.id for r in queued_runs]}


@router.post("/runs/{run_id}/cancel", response_model=GradingRunOut)
async def cancel_queued_run(
    run_id: str,
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    run = (
        await db.execute(
            select(GradingRun).where(GradingRun.id == run_id, GradingRun.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Grading run not found")
    if run.status != "queued":
        raise HTTPException(status_code=400, detail=f"Only queued runs can be cancelled (current status: {run.status})")

    if run.celery_task_id:
        try:
            celery_app.control.revoke(run.celery_task_id, terminate=False)
        except Exception:
            pass
    run.status = "cancelled"
    run.completed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(run)
    return GradingRunOut.model_validate(run)


@router.get("/submissions/{submission_id}/runs", response_model=List[GradingRunOut])
async def list_submission_grading_runs(
    submission_id: str,
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(GradingRun)
            .where(GradingRun.submission_id == submission_id, GradingRun.workspace_id == actor.workspace_id)
            .order_by(GradingRun.run_number.desc())
        )
    ).scalars().all()
    return [GradingRunOut.model_validate(r) for r in rows]


@router.get("/runs/{run_id}")
async def get_grading_run_detail(
    run_id: str,
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    run = (
        await db.execute(
            select(GradingRun).where(GradingRun.id == run_id, GradingRun.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Grading run not found")

    criteria = (
        await db.execute(select(CriterionResult).where(CriterionResult.grading_run_id == run.id))
    ).scalars().all()
    tests = (
        await db.execute(select(TestResult).where(TestResult.grading_run_id == run.id))
    ).scalars().all()
    adjustments = (
        await db.execute(
            select(GradeAdjustment)
            .where(GradeAdjustment.grading_run_id == run.id)
            .order_by(GradeAdjustment.created_at.desc())
        )
    ).scalars().all()

    return {
        "run": GradingRunOut.model_validate(run),
        "criterion_results": [CriterionResultOut.model_validate(c) for c in criteria],
        "test_results": [TestResultOut.model_validate(t) for t in tests],
        "grade_adjustments": [
            {
                "id": a.id,
                "previous_score": float(a.previous_score),
                "new_score": float(a.new_score),
                "reason": a.reason,
                "adjusted_by": a.adjusted_by,
                "created_at": a.created_at,
            }
            for a in adjustments
        ],
    }


@router.post("/runs/{run_id}/adjust")
async def adjust_grade(
    run_id: str,
    body: GradeAdjustIn,
    request: Request,
    actor: ActorContext = Depends(require_grade_edit_permission),
    db: AsyncSession = Depends(get_db),
):
    run = (
        await db.execute(
            select(GradingRun).where(GradingRun.id == run_id, GradingRun.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Grading run not found")

    if body.new_score < Decimal("0") or body.new_score > Decimal(str(run.max_score)):
        raise HTTPException(
            status_code=400,
            detail=f"Score must be between 0 and {run.max_score}",
        )

    prev = Decimal(str(run.final_score or 0))
    db.add(
        GradeAdjustment(
            workspace_id=actor.workspace_id,
            submission_id=run.submission_id,
            grading_run_id=run.id,
            adjusted_by=actor.user_id,
            previous_score=prev,
            new_score=body.new_score,
            reason=body.reason,
        )
    )
    run.final_score = body.new_score
    sub = await db.get(Submission, run.submission_id)
    if sub:
        sub.final_score = body.new_score
    await write_audit_log(
        db,
        actor,
        "grade.adjust",
        "grading_run",
        run.id,
        {"previous_score": float(prev), "new_score": float(body.new_score), "reason": body.reason},
        request,
    )
    await db.commit()
    return {"status": "adjusted", "previous_score": float(prev), "new_score": float(body.new_score)}


@router.post("/runs/{run_id}/feedback", status_code=status.HTTP_201_CREATED)
async def add_teacher_feedback(
    run_id: str,
    body: TeacherFeedbackIn,
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    run = (
        await db.execute(
            select(GradingRun).where(GradingRun.id == run_id, GradingRun.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Grading run not found")

    fb = TeacherFeedback(
        workspace_id=actor.workspace_id,
        submission_id=run.submission_id,
        grading_run_id=run.id,
        author_user_id=actor.user_id,
        comment=body.comment,
        is_visible_to_student=body.is_visible_to_student,
    )
    db.add(fb)
    await db.commit()
    await db.refresh(fb)
    return {"id": fb.id, "comment": fb.comment, "created_at": fb.created_at}


@router.post("/runs/{run_id}/approve")
async def approve_grade(
    run_id: str,
    request: Request,
    actor: ActorContext = Depends(require_grade_approve_permission),
    db: AsyncSession = Depends(get_db),
):
    run = (
        await db.execute(
            select(GradingRun).where(GradingRun.id == run_id, GradingRun.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Grading run not found")
    if run.final_score is None:
        raise HTTPException(status_code=400, detail="Cannot approve a run with no score yet")

    sub = await db.get(Submission, run.submission_id)
    sub.final_score = run.final_score
    sub.latest_grading_run_id = run.id
    sub.is_approved = True
    sub.approved_by = actor.user_id
    sub.approved_at = datetime.now(timezone.utc)
    sub.status = "approved"

    await write_audit_log(
        db,
        actor,
        "grade.approve",
        "submission",
        sub.id,
        {"grading_run_id": run.id, "final_score": float(run.final_score)},
        request,
    )
    await db.commit()
    return {"status": "approved", "submission_id": sub.id, "final_score": float(sub.final_score)}
