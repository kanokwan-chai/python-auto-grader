"""Authentication & Profile Endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ActorContext, get_current_user
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import create_access_token
from app.models.models import Workspace, WorkspaceMember
from app.schemas.schemas import UserProfile, WorkspaceOut

router = APIRouter(prefix="/auth", tags=["Auth"])


class DevTokenRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(default="Teacher", min_length=1, max_length=120)
    role: str = Field(default="teacher")


@router.get("/me")
async def get_me(
    actor: ActorContext = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    memberships = (
        await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.user_id == actor.user_id,
                WorkspaceMember.status == "active",
            )
        )
    ).scalars().all()
    ws_ids = [m.workspace_id for m in memberships]
    workspaces = []
    if ws_ids:
        ws_rows = (await db.execute(select(Workspace).where(Workspace.id.in_(ws_ids)))).scalars().all()
        workspaces = [WorkspaceOut.model_validate(w) for w in ws_rows]
    else:
        # Auto-provision a personal default Workspace on first login so users can connect Classroom immediately
        slug = f"ws-{actor.user_id[:8]}"
        default_ws = Workspace(
            name=f"Workspace ของ {actor.full_name or actor.email.split('@')[0]}",
            slug=slug,
            owner_user_id=actor.user_id,
        )
        db.add(default_ws)
        await db.flush()
        db.add(
            WorkspaceMember(
                workspace_id=default_ws.id,
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
        await db.commit()
        await db.refresh(default_ws)
        workspaces = [WorkspaceOut.model_validate(default_ws)]

    return {
        "user": UserProfile(
            user_id=actor.user_id,
            email=actor.email,
            full_name=actor.full_name,
            global_role=actor.global_role,
        ),
        "workspaces": workspaces,
    }


@router.post("/dev-session")
async def create_dev_session(
    body: DevTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Development-only session helper when Supabase Auth is not yet configured.
    Disabled automatically when APP_ENV == 'production'.
    """
    settings = get_settings()
    if settings.app_env == "production":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="dev-session is disabled in production; use Supabase Auth.",
        )

    # Reuse existing user_id if email already exists in a workspace_member
    existing = (
        await db.execute(select(WorkspaceMember).where(WorkspaceMember.email == str(body.email)))
    ).scalars().first()
    user_id = existing.user_id if existing else str(uuid.uuid5(uuid.NAMESPACE_DNS, str(body.email).lower()))
    token = create_access_token(
        user_id=user_id,
        email=str(body.email),
        full_name=body.full_name,
        global_role=body.role,
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "user_id": user_id,
            "email": str(body.email),
            "full_name": body.full_name,
            "global_role": body.role,
        },
    }
