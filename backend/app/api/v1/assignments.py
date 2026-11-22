"""Assignments, Cloning, Mixed Submission Settings, Rubric & Test Case Endpoints."""

from __future__ import annotations

from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ActorContext, get_workspace_actor, require_teacher_or_owner, write_audit_log
from app.core.database import get_db
from app.models.models import (
    Assignment,
    AssignmentSubmissionSetting,
    Classroom,
    RubricCriterion,
    TestCase,
)
from app.schemas.schemas import (
    AssignmentCloneIn,
    AssignmentCreate,
    AssignmentOut,
    RubricCriterionIn,
    RubricCriterionOut,
    SubmissionSettingsIn,
    SubmissionSettingsOut,
    TestCaseIn,
    TestCaseOut,
)

router = APIRouter(prefix="/assignments", tags=["Assignments"])


@router.get("", response_model=List[AssignmentOut])
async def list_assignments(
    classroom_id: Optional[str] = None,
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Assignment).where(Assignment.workspace_id == actor.workspace_id)
    if classroom_id:
        stmt = stmt.where(Assignment.classroom_id == classroom_id)
    stmt = stmt.order_by(Assignment.created_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return [AssignmentOut.model_validate(a) for a in rows]


@router.post("", response_model=AssignmentOut, status_code=status.HTTP_201_CREATED)
async def create_assignment(
    body: AssignmentCreate,
    request: Request,
    actor: ActorContext = Depends(require_teacher_or_owner),
    db: AsyncSession = Depends(get_db),
):
    cls = (
        await db.execute(
            select(Classroom).where(Classroom.id == body.classroom_id, Classroom.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="Target classroom not found in this workspace")

    asg = Assignment(
        workspace_id=actor.workspace_id,
        classroom_id=body.classroom_id,
        title=body.title,
        description=body.description,
        instructions=body.instructions,
        problem_statement=body.problem_statement,
        programming_requirements=body.programming_requirements,
        max_score=body.max_score,
        start_at=body.start_at,
        due_at=body.due_at,
        subject_name=body.subject_name or cls.subject_name,
        python_version=body.python_version,
        execution_mode=body.execution_mode,
        allow_resubmission=body.allow_resubmission,
        enable_ai_review=body.enable_ai_review,
        created_by=actor.user_id,
    )
    db.add(asg)
    await db.flush()

    db.add(
        AssignmentSubmissionSetting(
            workspace_id=actor.workspace_id,
            assignment_id=asg.id,
            **body.submission_settings.model_dump(),
        )
    )
    for idx, crit in enumerate(body.rubric_criteria):
        data = crit.model_dump()
        data["order_index"] = idx
        db.add(RubricCriterion(workspace_id=actor.workspace_id, assignment_id=asg.id, **data))

    for idx, tc in enumerate(body.test_cases):
        data = tc.model_dump()
        data["order_index"] = idx
        db.add(TestCase(workspace_id=actor.workspace_id, assignment_id=asg.id, **data))

    await write_audit_log(db, actor, "assignment.create", "assignment", asg.id, {"title": asg.title}, request)
    await db.commit()
    await db.refresh(asg)
    return AssignmentOut.model_validate(asg)


@router.get("/{assignment_id}")
async def get_assignment_detail(
    assignment_id: str,
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

    sub_settings = (
        await db.execute(
            select(AssignmentSubmissionSetting).where(AssignmentSubmissionSetting.assignment_id == asg.id)
        )
    ).scalar_one_or_none()
    criteria = (
        await db.execute(
            select(RubricCriterion)
            .where(RubricCriterion.assignment_id == asg.id)
            .order_by(RubricCriterion.order_index)
        )
    ).scalars().all()
    tests = (
        await db.execute(
            select(TestCase).where(TestCase.assignment_id == asg.id).order_by(TestCase.order_index)
        )
    ).scalars().all()

    return {
        "assignment": AssignmentOut.model_validate(asg),
        "submission_settings": SubmissionSettingsOut.model_validate(sub_settings) if sub_settings else None,
        "rubric_criteria": [RubricCriterionOut.model_validate(c) for c in criteria],
        "test_cases": [TestCaseOut.model_validate(t) for t in tests],
    }


@router.delete("/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_assignment(
    assignment_id: str,
    request: Request,
    actor: ActorContext = Depends(require_teacher_or_owner),
    db: AsyncSession = Depends(get_db),
):
    asg = (
        await db.execute(
            select(Assignment).where(Assignment.id == assignment_id, Assignment.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not asg:
        raise HTTPException(status_code=404, detail="Assignment not found")
    title = asg.title
    await db.delete(asg)
    await write_audit_log(db, actor, "assignment.delete", "assignment", assignment_id, {"title": title}, request)
    await db.commit()
    return None


@router.post("/{assignment_id}/clone", response_model=AssignmentOut, status_code=status.HTTP_201_CREATED)
async def clone_assignment(
    assignment_id: str,
    body: AssignmentCloneIn,
    actor: ActorContext = Depends(require_teacher_or_owner),
    db: AsyncSession = Depends(get_db),
):
    src = (
        await db.execute(
            select(Assignment).where(Assignment.id == assignment_id, Assignment.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not src:
        raise HTTPException(status_code=404, detail="Source assignment not found")

    target_cls = (
        await db.execute(
            select(Classroom).where(
                Classroom.id == body.target_classroom_id, Classroom.workspace_id == actor.workspace_id
            )
        )
    ).scalar_one_or_none()
    if not target_cls:
        raise HTTPException(status_code=404, detail="Target classroom not found")

    cloned = Assignment(
        workspace_id=actor.workspace_id,
        classroom_id=target_cls.id,
        title=body.new_title or f"{src.title} (คัดลอก)",
        description=src.description,
        instructions=src.instructions,
        problem_statement=src.problem_statement,
        programming_requirements=src.programming_requirements,
        max_score=src.max_score,
        start_at=src.start_at,
        due_at=src.due_at,
        subject_name=target_cls.subject_name,
        python_version=src.python_version,
        execution_mode=src.execution_mode,
        allow_resubmission=src.allow_resubmission,
        enable_ai_review=src.enable_ai_review,
        cloned_from_id=src.id,
        created_by=actor.user_id,
    )
    db.add(cloned)
    await db.flush()

    src_settings = (
        await db.execute(
            select(AssignmentSubmissionSetting).where(AssignmentSubmissionSetting.assignment_id == src.id)
        )
    ).scalar_one_or_none()
    if src_settings:
        db.add(
            AssignmentSubmissionSetting(
                workspace_id=actor.workspace_id,
                assignment_id=cloned.id,
                allow_colab_url=src_settings.allow_colab_url,
                allow_ipynb=src_settings.allow_ipynb,
                allow_py=src_settings.allow_py,
                allow_zip=src_settings.allow_zip,
                allow_multiple_files=src_settings.allow_multiple_files,
                max_file_size_mb=src_settings.max_file_size_mb,
                max_files_per_submission=src_settings.max_files_per_submission,
                max_zip_extracted_files=src_settings.max_zip_extracted_files,
                max_zip_uncompressed_mb=src_settings.max_zip_uncompressed_mb,
                allowed_zip_extensions=list(src_settings.allowed_zip_extensions),
                entry_file_name=src_settings.entry_file_name,
                portal_enabled=src_settings.portal_enabled,
            )
        )

    for c in (await db.execute(select(RubricCriterion).where(RubricCriterion.assignment_id == src.id))).scalars().all():
        db.add(
            RubricCriterion(
                workspace_id=actor.workspace_id,
                assignment_id=cloned.id,
                order_index=c.order_index,
                name=c.name,
                description=c.description,
                max_score=c.max_score,
                check_method=c.check_method,
                rule_config=dict(c.rule_config),
                pass_condition=c.pass_condition,
                allow_partial_credit=c.allow_partial_credit,
            )
        )

    for t in (await db.execute(select(TestCase).where(TestCase.assignment_id == src.id))).scalars().all():
        db.add(
            TestCase(
                workspace_id=actor.workspace_id,
                assignment_id=cloned.id,
                order_index=t.order_index,
                name=t.name,
                description=t.description,
                stdin_input=t.stdin_input,
                expected_output=t.expected_output,
                comparator=t.comparator,
                comparator_config=dict(t.comparator_config),
                score_weight=t.score_weight,
                timeout_seconds=t.timeout_seconds,
                is_hidden=t.is_hidden,
            )
        )

    await db.commit()
    await db.refresh(cloned)
    return AssignmentOut.model_validate(cloned)


@router.put("/{assignment_id}/submission-settings", response_model=SubmissionSettingsOut)
async def update_submission_settings(
    assignment_id: str,
    body: SubmissionSettingsIn,
    actor: ActorContext = Depends(require_teacher_or_owner),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            select(AssignmentSubmissionSetting).where(
                AssignmentSubmissionSetting.assignment_id == assignment_id,
                AssignmentSubmissionSetting.workspace_id == actor.workspace_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Submission settings not found")
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return SubmissionSettingsOut.model_validate(row)


@router.put("/{assignment_id}/rubric", response_model=List[RubricCriterionOut])
async def replace_rubric(
    assignment_id: str,
    criteria: List[RubricCriterionIn],
    actor: ActorContext = Depends(require_teacher_or_owner),
    db: AsyncSession = Depends(get_db),
):
    asg = (
        await db.execute(
            select(Assignment).where(Assignment.id == assignment_id, Assignment.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not asg:
        raise HTTPException(status_code=404, detail="Assignment not found")

    total = sum((c.max_score for c in criteria), Decimal("0"))
    if total > Decimal(str(asg.max_score)):
        raise HTTPException(
            status_code=400,
            detail=f"Sum of rubric criteria ({total}) cannot exceed assignment max_score ({asg.max_score})",
        )

    await db.execute(delete(RubricCriterion).where(RubricCriterion.assignment_id == assignment_id))
    new_rows = []
    for idx, crit in enumerate(criteria):
        data = crit.model_dump()
        data["order_index"] = idx
        row = RubricCriterion(workspace_id=actor.workspace_id, assignment_id=assignment_id, **data)
        db.add(row)
        new_rows.append(row)
    await db.commit()
    for r in new_rows:
        await db.refresh(r)
    return [RubricCriterionOut.model_validate(r) for r in new_rows]


@router.put("/{assignment_id}/test-cases", response_model=List[TestCaseOut])
async def replace_test_cases(
    assignment_id: str,
    tests: List[TestCaseIn],
    actor: ActorContext = Depends(require_teacher_or_owner),
    db: AsyncSession = Depends(get_db),
):
    asg = (
        await db.execute(
            select(Assignment).where(Assignment.id == assignment_id, Assignment.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not asg:
        raise HTTPException(status_code=404, detail="Assignment not found")

    await db.execute(delete(TestCase).where(TestCase.assignment_id == assignment_id))
    new_rows = []
    for idx, tc in enumerate(tests):
        data = tc.model_dump()
        data["order_index"] = idx
        row = TestCase(workspace_id=actor.workspace_id, assignment_id=assignment_id, **data)
        db.add(row)
        new_rows.append(row)
    await db.commit()
    for r in new_rows:
        await db.refresh(r)
    return [TestCaseOut.model_validate(r) for r in new_rows]
