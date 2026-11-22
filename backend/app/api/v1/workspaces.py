"""Workspace & Member Management Endpoints."""

from __future__ import annotations

import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ActorContext, get_current_user, require_teacher_or_owner, write_audit_log
from app.core.database import get_db
from app.models.models import Workspace, WorkspaceMember
from app.schemas.schemas import WorkspaceCreate, WorkspaceMemberCreate, WorkspaceMemberOut, WorkspaceOut

router = APIRouter(prefix="/workspaces", tags=["Workspaces"])


@router.get("", response_model=List[WorkspaceOut])
async def list_workspaces(
    actor: ActorContext = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if actor.is_super_admin:
        rows = (await db.execute(select(Workspace))).scalars().all()
        return [WorkspaceOut.model_validate(w) for w in rows]

    ws_ids = (
        await db.execute(
            select(WorkspaceMember.workspace_id).where(
                WorkspaceMember.user_id == actor.user_id,
                WorkspaceMember.status == "active",
            )
        )
    ).scalars().all()
    if not ws_ids:
        return []
    rows = (await db.execute(select(Workspace).where(Workspace.id.in_(ws_ids)))).scalars().all()
    return [WorkspaceOut.model_validate(w) for w in rows]


@router.post("", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    body: WorkspaceCreate,
    request: Request,
    actor: ActorContext = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = (await db.execute(select(Workspace).where(Workspace.slug == body.slug))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Workspace slug already exists")

    ws = Workspace(
        name=body.name,
        slug=body.slug,
        description=body.description,
        owner_user_id=actor.user_id,
    )
    db.add(ws)
    await db.flush()

    db.add(
        WorkspaceMember(
            workspace_id=ws.id,
            user_id=actor.user_id,
            email=actor.email or f"{actor.user_id}@local.invalid",
            full_name=actor.full_name,
            role="owner",
            can_edit_grades=True,
            can_approve_grades=True,
            can_sync_classroom=True,
            status="active",
        )
    )
    actor.workspace_id = ws.id
    await write_audit_log(db, actor, "workspace.create", "workspace", ws.id, {"slug": ws.slug}, request)
    await db.commit()
    await db.refresh(ws)
    return WorkspaceOut.model_validate(ws)


@router.get("/{workspace_id}/members", response_model=List[WorkspaceMemberOut])
async def list_workspace_members(
    workspace_id: str,
    actor: ActorContext = Depends(require_teacher_or_owner),
    db: AsyncSession = Depends(get_db),
):
    if actor.workspace_id != workspace_id and not actor.is_super_admin:
        raise HTTPException(status_code=403, detail="Workspace mismatch")
    rows = (
        await db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id))
    ).scalars().all()
    return [WorkspaceMemberOut.model_validate(m) for m in rows]


@router.post("/{workspace_id}/members", response_model=WorkspaceMemberOut, status_code=status.HTTP_201_CREATED)
async def add_workspace_member(
    workspace_id: str,
    body: WorkspaceMemberCreate,
    request: Request,
    actor: ActorContext = Depends(require_teacher_or_owner),
    db: AsyncSession = Depends(get_db),
):
    if actor.workspace_id != workspace_id and not actor.is_super_admin:
        raise HTTPException(status_code=403, detail="Workspace mismatch")

    member = WorkspaceMember(
        workspace_id=workspace_id,
        user_id=str(uuid.uuid5(uuid.NAMESPACE_DNS, str(body.email).lower())),
        email=str(body.email),
        full_name=body.full_name,
        role=body.role,
        can_edit_grades=body.can_edit_grades or body.role == "teacher",
        can_approve_grades=body.can_approve_grades or body.role == "teacher",
        can_sync_classroom=body.can_sync_classroom or body.role == "teacher",
        status="active",
    )
    db.add(member)
    await write_audit_log(
        db, actor, "workspace.member_add", "workspace_member", member.id, {"email": str(body.email), "role": body.role}, request
    )
    await db.commit()
    await db.refresh(member)
    return WorkspaceMemberOut.model_validate(member)
