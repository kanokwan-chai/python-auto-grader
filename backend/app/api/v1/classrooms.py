"""Classroom & Student Roster Endpoints."""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ActorContext, get_workspace_actor, require_teacher_or_owner, write_audit_log
from app.core.database import get_db
from app.models.models import Classroom, Enrollment, Student
from app.schemas.schemas import ClassroomCreate, ClassroomOut, ClassroomUpdate, StudentCreate, StudentOut

router = APIRouter(prefix="/classrooms", tags=["Classrooms"])


@router.get("", response_model=List[ClassroomOut])
async def list_classrooms(
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            select(Classroom)
            .where(Classroom.workspace_id == actor.workspace_id)
            .order_by(Classroom.created_at.desc())
        )
    ).scalars().all()
    return [ClassroomOut.model_validate(c) for c in rows]


@router.post("", response_model=ClassroomOut, status_code=status.HTTP_201_CREATED)
async def create_classroom(
    body: ClassroomCreate,
    request: Request,
    actor: ActorContext = Depends(require_teacher_or_owner),
    db: AsyncSession = Depends(get_db),
):
    dup = (
        await db.execute(
            select(Classroom).where(
                Classroom.workspace_id == actor.workspace_id,
                Classroom.code == body.code,
            )
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(status_code=409, detail=f"Classroom code '{body.code}' already exists in this workspace")

    cls = Classroom(
        workspace_id=actor.workspace_id,
        name=body.name,
        code=body.code,
        grade_level=body.grade_level,
        major=body.major,
        academic_year=body.academic_year,
        semester=body.semester,
        subject_name=body.subject_name,
        source="manual",
        created_by=actor.user_id,
    )
    db.add(cls)
    await db.flush()
    await write_audit_log(db, actor, "classroom.create", "classroom", cls.id, {"code": cls.code}, request)
    await db.commit()
    await db.refresh(cls)
    return ClassroomOut.model_validate(cls)


@router.get("/{classroom_id}", response_model=ClassroomOut)
async def get_classroom(
    classroom_id: str,
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    cls = (
        await db.execute(
            select(Classroom).where(Classroom.id == classroom_id, Classroom.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="Classroom not found")
    return ClassroomOut.model_validate(cls)


@router.patch("/{classroom_id}", response_model=ClassroomOut)
async def update_classroom(
    classroom_id: str,
    body: ClassroomUpdate,
    actor: ActorContext = Depends(require_teacher_or_owner),
    db: AsyncSession = Depends(get_db),
):
    cls = (
        await db.execute(
            select(Classroom).where(Classroom.id == classroom_id, Classroom.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="Classroom not found")

    for field_name, value in body.model_dump(exclude_unset=True).items():
        setattr(cls, field_name, value)
    await db.commit()
    await db.refresh(cls)
    return ClassroomOut.model_validate(cls)


@router.get("/{classroom_id}/students", response_model=List[StudentOut])
async def list_classroom_students(
    classroom_id: str,
    actor: ActorContext = Depends(get_workspace_actor),
    db: AsyncSession = Depends(get_db),
):
    cls = (
        await db.execute(
            select(Classroom).where(Classroom.id == classroom_id, Classroom.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="Classroom not found")

    rows = (
        await db.execute(
            select(Student)
            .join(Enrollment, Enrollment.student_id == Student.id)
            .where(
                Enrollment.classroom_id == classroom_id,
                Enrollment.workspace_id == actor.workspace_id,
                Enrollment.status == "active",
            )
            .order_by(Student.full_name)
        )
    ).scalars().all()
    return [StudentOut.model_validate(s) for s in rows]


@router.post("/{classroom_id}/students", response_model=StudentOut, status_code=status.HTTP_201_CREATED)
async def enroll_student(
    classroom_id: str,
    body: StudentCreate,
    actor: ActorContext = Depends(require_teacher_or_owner),
    db: AsyncSession = Depends(get_db),
):
    cls = (
        await db.execute(
            select(Classroom).where(Classroom.id == classroom_id, Classroom.workspace_id == actor.workspace_id)
        )
    ).scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="Classroom not found")

    student = (
        await db.execute(
            select(Student).where(Student.workspace_id == actor.workspace_id, Student.email == str(body.email))
        )
    ).scalar_one_or_none()
    if not student:
        student = Student(
            workspace_id=actor.workspace_id,
            student_code=body.student_code,
            full_name=body.full_name,
            email=str(body.email),
        )
        db.add(student)
        await db.flush()

    existing_enr = (
        await db.execute(
            select(Enrollment).where(Enrollment.classroom_id == classroom_id, Enrollment.student_id == student.id)
        )
    ).scalar_one_or_none()
    if not existing_enr:
        db.add(
            Enrollment(
                workspace_id=actor.workspace_id,
                classroom_id=classroom_id,
                student_id=student.id,
            )
        )
    await db.commit()
    await db.refresh(student)
    return StudentOut.model_validate(student)
