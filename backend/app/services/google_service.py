"""
Official Google OAuth 2.0, Google Classroom API, and Google Drive API Service.

Rules enforced:
- Uses official Google REST APIs only (never scrapes web pages).
- Separates initial Read-Only scopes from Grade Write-Back scope.
- Encrypts Access & Refresh tokens at rest using Fernet.
- Explicitly handles expired tokens (auto-refresh), revoked tokens, 403 permission denied,
  404 deleted files, and Classroom submission states (NEW, CREATED, TURNED_IN, RETURNED, RECLAIMED_BY_STUDENT).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import decrypt_secret, encrypt_secret, sign_oauth_state
from app.models.models import GoogleConnection

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"
CLASSROOM_API_BASE = "https://classroom.googleapis.com/v1"
DRIVE_API_BASE = "https://www.googleapis.com/drive/v3"

READ_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/classroom.courses.readonly",
    "https://www.googleapis.com/auth/classroom.rosters.readonly",
    "https://www.googleapis.com/auth/classroom.coursework.students.readonly",
    "https://www.googleapis.com/auth/classroom.student-submissions.students.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]

WRITE_GRADE_SCOPE = "https://www.googleapis.com/auth/classroom.coursework.students"


class GoogleIntegrationError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


class GoogleClassroomService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _ensure_oauth_configured(self) -> None:
        if not self.settings.google_client_id or not self.settings.google_client_secret:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Google OAuth 2.0 is not configured on this server. "
                    "Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI "
                    "following docs/SETUP_GOOGLE_AND_SUPABASE.md."
                ),
            )

    def build_authorization_url(self, workspace_id: str, user_id: str, scope_mode: str = "read") -> str:
        self._ensure_oauth_configured()
        scopes = list(READ_SCOPES)
        if scope_mode == "write":
            scopes.append(WRITE_GRADE_SCOPE)

        state = sign_oauth_state(
            {"workspace_id": workspace_id, "user_id": user_id, "scope_mode": scope_mode}
        )
        params = {
            "client_id": self.settings.google_client_id,
            "redirect_uri": self.settings.google_redirect_uri,
            "response_type": "code",
            "scope": " ".join(scopes),
            "access_type": "offline",
            "include_granted_scopes": "true",
            "prompt": "consent select_account",
            "state": state,
        }
        return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"

    async def exchange_code_for_tokens(self, code: str) -> Dict[str, Any]:
        self._ensure_oauth_configured()
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": self.settings.google_client_id,
                    "client_secret": self.settings.google_client_secret,
                    "redirect_uri": self.settings.google_redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            if resp.status_code != 200:
                raise GoogleIntegrationError("oauth_exchange_failed", f"Google token exchange failed: {resp.text}", 400)
            token_data = resp.json()

            userinfo_resp = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {token_data['access_token']}"},
            )
            if userinfo_resp.status_code != 200:
                raise GoogleIntegrationError("userinfo_failed", "Failed to fetch Google user profile", 400)
            userinfo = userinfo_resp.json()

        scopes = token_data.get("scope", "").split()
        expires_in = int(token_data.get("expires_in", 3600))
        return {
            "email": userinfo.get("email", ""),
            "sub": userinfo.get("sub", ""),
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token"),
            "expires_at": datetime.now(timezone.utc) + timedelta(seconds=expires_in),
            "scopes": scopes,
            "has_write_scope": WRITE_GRADE_SCOPE in scopes,
        }

    async def get_valid_access_token(self, db: AsyncSession, conn: GoogleConnection) -> str:
        """Decrypt access token and auto-refresh via refresh_token if expired."""
        if conn.status == "revoked":
            raise GoogleIntegrationError("token_revoked", "Google account connection was revoked. Please reconnect.", 401)

        now = datetime.now(timezone.utc)
        if conn.token_expires_at and conn.token_expires_at > now + timedelta(seconds=60):
            return decrypt_secret(conn.encrypted_access_token)

        if not conn.encrypted_refresh_token:
            conn.status = "expired"
            conn.last_error = "Access token expired and no refresh token is available."
            await db.commit()
            raise GoogleIntegrationError("token_expired", conn.last_error, 401)

        refresh_token = decrypt_secret(conn.encrypted_refresh_token)
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": self.settings.google_client_id,
                    "client_secret": self.settings.google_client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
            )
        if resp.status_code != 200:
            conn.status = "revoked" if "invalid_grant" in resp.text else "expired"
            conn.last_error = f"Token refresh failed: {resp.text[:300]}"
            await db.commit()
            raise GoogleIntegrationError("token_refresh_failed", conn.last_error, 401)

        data = resp.json()
        new_access = data["access_token"]
        expires_in = int(data.get("expires_in", 3600))
        conn.encrypted_access_token = encrypt_secret(new_access)
        conn.token_expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
        conn.status = "connected"
        conn.last_error = None
        await db.commit()
        return new_access

    async def _google_request(
        self,
        db: AsyncSession,
        conn: GoogleConnection,
        method: str,
        url: str,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
    ) -> httpx.Response:
        token = await self.get_valid_access_token(db, conn)
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.request(method, url, headers=headers, params=params, json=json_body)

        if resp.status_code == 401:
            conn.status = "expired"
            conn.last_error = "Google API returned 401 Unauthorized."
            await db.commit()
            raise GoogleIntegrationError("unauthorized", "Google token is invalid or revoked.", 401)
        if resp.status_code == 403:
            raise GoogleIntegrationError(
                "permission_denied",
                "ไม่มีสิทธิ์เข้าถึงทรัพยากรนี้บน Google Classroom / Google Drive (403 Forbidden)",
                403,
            )
        if resp.status_code == 404:
            raise GoogleIntegrationError("not_found", "ไม่พบทรัพยากรหรือไฟล์อาจถูกลบไปแล้วบน Google Drive/Classroom (404)", 404)
        if resp.status_code >= 400:
            raise GoogleIntegrationError("google_api_error", f"Google API error ({resp.status_code}): {resp.text[:300]}", resp.status_code)
        return resp

    async def _google_paginated_get(
        self,
        db: AsyncSession,
        conn: GoogleConnection,
        url: str,
        list_key: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """Fetch ALL pages from a Google Classroom list endpoint using nextPageToken."""
        items: List[Dict[str, Any]] = []
        base_params = dict(params or {})
        base_params.setdefault("pageSize", 100)
        page_token: Optional[str] = None
        for _ in range(50):  # safety cap (up to 5,000 items)
            req_params = dict(base_params)
            if page_token:
                req_params["pageToken"] = page_token
            resp = await self._google_request(db, conn, "GET", url, params=req_params)
            payload = resp.json()
            items.extend(payload.get(list_key, []))
            page_token = payload.get("nextPageToken")
            if not page_token:
                break
        return items

    async def list_courses(self, db: AsyncSession, conn: GoogleConnection) -> List[Dict[str, Any]]:
        return await self._google_paginated_get(
            db, conn, f"{CLASSROOM_API_BASE}/courses", "courses", params={"teacherId": "me", "courseStates": "ACTIVE"}
        )

    async def list_students(self, db: AsyncSession, conn: GoogleConnection, course_id: str) -> List[Dict[str, Any]]:
        return await self._google_paginated_get(
            db, conn, f"{CLASSROOM_API_BASE}/courses/{course_id}/students", "students"
        )

    async def list_coursework(self, db: AsyncSession, conn: GoogleConnection, course_id: str) -> List[Dict[str, Any]]:
        return await self._google_paginated_get(
            db, conn, f"{CLASSROOM_API_BASE}/courses/{course_id}/courseWork", "courseWork"
        )

    async def list_student_submissions(
        self, db: AsyncSession, conn: GoogleConnection, course_id: str, coursework_id: str
    ) -> List[Dict[str, Any]]:
        return await self._google_paginated_get(
            db,
            conn,
            f"{CLASSROOM_API_BASE}/courses/{course_id}/courseWork/{coursework_id}/studentSubmissions",
            "studentSubmissions",
        )

    async def download_drive_file(self, db: AsyncSession, conn: GoogleConnection, file_id: str) -> Tuple[bytes, Dict[str, Any]]:
        meta_resp = await self._google_request(
            db, conn, "GET", f"{DRIVE_API_BASE}/files/{file_id}", params={"fields": "id,name,mimeType,size,trashed"}
        )
        meta = meta_resp.json()
        if meta.get("trashed"):
            raise GoogleIntegrationError("file_deleted", f"ไฟล์ Google Drive ({file_id}) ถูกลบอยู่ในถังขยะ", 404)

        mime = meta.get("mimeType") or ""
        if mime.startswith("application/vnd.google-apps.") and mime != "application/vnd.google.colaboratory":
            dl_resp = await self._google_request(
                db, conn, "GET", f"{DRIVE_API_BASE}/files/{file_id}/export", params={"mimeType": "application/pdf"}
            )
            return dl_resp.content, meta

        dl_resp = await self._google_request(
            db, conn, "GET", f"{DRIVE_API_BASE}/files/{file_id}", params={"alt": "media"}
        )
        return dl_resp.content, meta

    async def patch_student_grade(
        self,
        db: AsyncSession,
        conn: GoogleConnection,
        course_id: str,
        coursework_id: str,
        google_submission_id: str,
        assigned_grade: float,
    ) -> Dict[str, Any]:
        if not conn.has_write_scope:
            raise GoogleIntegrationError(
                "missing_write_scope",
                "บัญชี Google นี้ยังไม่ได้รับสิทธิ์เขียนคะแนน (Write Scope) กรุณาอนุญาตสิทธิ์ส่งคะแนนก่อน",
                403,
            )
        url = (
            f"{CLASSROOM_API_BASE}/courses/{course_id}/courseWork/{coursework_id}"
            f"/studentSubmissions/{google_submission_id}"
        )
        resp = await self._google_request(
            db,
            conn,
            "PATCH",
            url,
            params={"updateMask": "draftGrade,assignedGrade"},
            json_body={"draftGrade": assigned_grade, "assignedGrade": assigned_grade},
        )
        return resp.json()
