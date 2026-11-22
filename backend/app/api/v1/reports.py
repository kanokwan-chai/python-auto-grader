"""Dashboard Analytics, Excel Export & Audit Log Endpoints."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ActorContext, get_workspace_actor
from app.core.database import get_db
from app.models.models import (
    Assignment,
    AuditLog,
    Classroom,
    CriterionResult,
    Student,
    Submission,
)
from app.schemas.schemas import DashboardStatsOut
from app.services.excel_exporter import build_excel_report

router = APIRouter(tags=["Reports & Audit"])


@router.get("/reports/dashboard", response_model=DashboardStatsOut)
async def get_dashboard_stats(
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    ws = actor.workspace_id
    total_assignments = (await db.execute(select(func.count(Assignment.id)).where(Assignment.workspace_id == ws))).scalar() or 0
    total_classrooms = (await db.execute(select(func.count(Classroom.id)).where(Classroom.workspace_id == ws))).scalar() or 0
    total_students = (await db.execute(select(func.count(Student.id)).where(Student.workspace_id == ws))).scalar() or 0

    subs = (await db.execute(select(Submission).where(Submission.workspace_id == ws))).scalars().all()
    submitted_count = sum(1 for s in subs if s.status != "not_submitted")
    not_submitted_count = sum(1 for s in subs if s.status == "not_submitted")
    pending_grading_count = sum(1 for s in subs if s.status in ("submitted", "queued", "grading", "needs_review"))
    graded_subs = [s for s in subs if s.final_score is not None]
    graded_count = len(graded_subs)

    scores = [float(s.final_score) for s in graded_subs]
    avg_score = round(sum(scores) / len(scores), 2) if scores else None
    max_score_achieved = max(scores) if scores else None
    min_score_achieved = min(scores) if scores else None

    # Pass rate (>= 50% of assignment max_score)
    pass_count = 0
    if graded_subs:
        asg_ids = {s.assignment_id for s in graded_subs}
        asg_rows = (await db.execute(select(Assignment).where(Assignment.id.in_(asg_ids)))).scalars().all()
        max_map = {a.id: float(a.max_score) for a in asg_rows}
        for s in graded_subs:
            m = max_map.get(s.assignment_id, 10.0)
            if m > 0 and (float(s.final_score) / m) >= 0.5:
                pass_count += 1
        pass_rate = round((pass_count / len(graded_subs)) * 100.0, 2)
    else:
        pass_rate = None

    return DashboardStatsOut(
        total_assignments=total_assignments,
        total_classrooms=total_classrooms,
        total_students=total_students,
        submitted_count=submitted_count,
        not_submitted_count=not_submitted_count,
        pending_grading_count=pending_grading_count,
        graded_count=graded_count,
        average_score=avg_score,
        max_score_achieved=max_score_achieved,
        min_score_achieved=min_score_achieved,
        pass_rate_percent=pass_rate,
    )


@router.get("/reports/export/excel")
async def export_excel_report(
    report_type: str = Query(
        default="assignment",
        pattern="^(classroom|course|assignment|student|submission_status|rubric_breakdown)$",
    ),
    classroom_id: Optional[str] = None,
    assignment_id: Optional[str] = None,
    student_id: Optional[str] = None,
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(Submission, Student, Assignment, Classroom)
        .join(Student, Student.id == Submission.student_id)
        .join(Assignment, Assignment.id == Submission.assignment_id)
        .join(Classroom, Classroom.id == Assignment.classroom_id)
        .where(Submission.workspace_id == actor.workspace_id)
    )
    if classroom_id:
        stmt = stmt.where(Classroom.id == classroom_id)
    if assignment_id:
        stmt = stmt.where(Assignment.id == assignment_id)
    if student_id:
        stmt = stmt.where(Student.id == student_id)

    records = (await db.execute(stmt.order_by(Classroom.name, Assignment.title, Student.full_name))).all()

    headers = [
        "Classroom",
        "Subject",
        "Assignment",
        "Student Code",
        "Student Name",
        "Email",
        "Status",
        "Score",
        "Max Score",
        "Approved",
        "Submitted At",
    ]
    rows = []
    rubric_rows = []
    for sub, stu, asg, cls in records:
        rows.append(
            [
                cls.name,
                cls.subject_name,
                asg.title,
                stu.student_code or "-",
                stu.full_name,
                stu.email,
                sub.status,
                float(sub.final_score) if sub.final_score is not None else "",
                float(asg.max_score),
                "Yes" if sub.is_approved else "No",
                sub.submitted_at.isoformat() if sub.submitted_at else "-",
            ]
        )
        if sub.latest_grading_run_id:
            crit_rows = (
                await db.execute(
                    select(CriterionResult).where(CriterionResult.grading_run_id == sub.latest_grading_run_id)
                )
            ).scalars().all()
            for cr in crit_rows:
                rubric_rows.append(
                    [
                        stu.full_name,
                        asg.title,
                        cr.criterion_name,
                        cr.check_method,
                        float(cr.awarded_score),
                        float(cr.max_score),
                        cr.status,
                        cr.reason or "",
                    ]
                )

    xlsx_bytes = build_excel_report(
        report_title=f"Python Auto Grader Report — {report_type.upper()}",
        headers=headers,
        rows=rows,
        rubric_breakdown_rows=rubric_rows,
    )
    return StreamingResponse(
        iter([xlsx_bytes]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="pyautograder_{report_type}_report.xlsx"'},
    )


@router.get("/audit-logs")
async def list_audit_logs(
    limit: int = Query(default=50, ge=1, le=200),
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    if not actor.is_super_admin:
        stmt = stmt.where(AuditLog.workspace_id == actor.workspace_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [
        {
            "id": r.id,
            "workspace_id": r.workspace_id,
            "actor_email": r.actor_email,
            "action": r.action,
            "resource_type": r.resource_type,
            "resource_id": r.resource_id,
            "metadata": r.metadata_json,
            "created_at": r.created_at,
        }
        for r in rows
    ]
