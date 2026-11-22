"""Authentication, Workspace Ownership, RBAC, and Audit Logging Dependencies."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import apply_rls_context, get_db
from app.core.security import decode_bearer_jwt
from app.models.models import AuditLog, WorkspaceMember

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class ActorContext:
    user_id: str
    email: str
    full_name: str
    global_role: str
    workspace_id: Optional[str] = None
    workspace_role: Optional[str] = None
    can_edit_grades: bool = False
    can_approve_grades: bool = False
    can_sync_classroom: bool = False

    @property
    def is_super_admin(self) -> bool:
        return self.global_role == "super_admin"


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> ActorContext:
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Bearer authentication token",
        )
    payload = decode_bearer_jwt(credentials.credentials)
    meta = payload.get("user_metadata") or {}
    actor = ActorContext(
        user_id=str(payload["sub"]),
        email=str(payload.get("email", "")),
        full_name=str(meta.get("full_name", "")),
        global_role=str(meta.get("global_role", "teacher")),
    )
    await apply_rls_context(db, actor.user_id, actor.is_super_admin)
    return actor


async def get_workspace_actor(
    actor: ActorContext = Depends(get_current_user),
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    db: AsyncSession = Depends(get_db),
) -> ActorContext:
    if not x_workspace_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="X-Workspace-Id header is required for workspace-scoped endpoints",
        )

    if actor.is_super_admin:
        actor.workspace_id = x_workspace_id
        actor.workspace_role = "super_admin"
        actor.can_edit_grades = True
        actor.can_approve_grades = True
        actor.can_sync_classroom = True
        return actor

    member = (
        await db.execute(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == x_workspace_id,
                WorkspaceMember.user_id == actor.user_id,
                WorkspaceMember.status == "active",
            )
        )
    ).scalar_one_or_none()

    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this workspace",
        )

    actor.workspace_id = x_workspace_id
    actor.workspace_role = member.role
    is_teacher_or_owner = member.role in ("owner", "teacher", "super_admin")
    actor.can_edit_grades = is_teacher_or_owner or member.can_edit_grades
    actor.can_approve_grades = is_teacher_or_owner or member.can_approve_grades
    actor.can_sync_classroom = is_teacher_or_owner or member.can_sync_classroom
    return actor


def require_teacher_or_owner(actor: ActorContext = Depends(get_workspace_actor)) -> ActorContext:
    if actor.workspace_role not in ("owner", "teacher", "super_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Teachers or Workspace Owners can perform this action",
        )
    return actor


def require_grade_edit_permission(actor: ActorContext = Depends(get_workspace_actor)) -> ActorContext:
    if not actor.can_edit_grades:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to adjust grades in this workspace",
        )
    return actor


def require_grade_approve_permission(actor: ActorContext = Depends(get_workspace_actor)) -> ActorContext:
    if not actor.can_approve_grades:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to approve grades in this workspace",
        )
    return actor


async def write_audit_log(
    db: AsyncSession,
    actor: ActorContext,
    action: str,
    resource_type: str,
    resource_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    request: Optional[Request] = None,
) -> None:
    db.add(
        AuditLog(
            workspace_id=actor.workspace_id,
            actor_user_id=actor.user_id,
            actor_email=actor.email,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            ip_address=request.client.host if request and request.client else None,
            user_agent=request.headers.get("user-agent") if request else None,
            metadata_json=metadata or {},
        )
    )
