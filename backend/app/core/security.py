"""
Security utilities:
- Supabase JWT verification & local dev token verification
- Fernet symmetric encryption for Google OAuth tokens at rest
- Cryptographically signed OAuth CSRF state tokens
- In-memory/Redis sliding-window rate limiter middleware
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import uuid
from collections import defaultdict, deque
from typing import Any, Deque, Dict, Optional

import jwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, Request, status
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_settings


def _get_fernet() -> Fernet:
    settings = get_settings()
    if settings.token_encryption_key:
        key_bytes = settings.token_encryption_key.encode("utf-8")
        return Fernet(key_bytes)
    # Deterministic dev-only fallback derived from app_secret_key so tests work out-of-the-box.
    digest = hashlib.sha256(settings.app_secret_key.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _get_fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    try:
        return _get_fernet().decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Failed to decrypt stored token; encryption key mismatch or corrupted data.") from exc


def sign_oauth_state(payload: Dict[str, Any], ttl_seconds: int = 600) -> str:
    """Create an HMAC-signed, time-limited CSRF state token for Google OAuth."""
    settings = get_settings()
    body = dict(payload)
    body["exp"] = int(time.time()) + ttl_seconds
    body["nonce"] = uuid.uuid4().hex
    raw = json.dumps(body, separators=(",", ":"), sort_keys=True).encode("utf-8")
    b64_body = base64.urlsafe_b64encode(raw).decode("ascii")
    sig = hmac.new(settings.app_secret_key.encode("utf-8"), b64_body.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{b64_body}.{sig}"


def verify_oauth_state(state: str) -> Dict[str, Any]:
    settings = get_settings()
    if "." not in state:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth state format")
    b64_body, provided_sig = state.rsplit(".", 1)
    expected_sig = hmac.new(
        settings.app_secret_key.encode("utf-8"), b64_body.encode("ascii"), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(provided_sig, expected_sig):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid OAuth state signature (CSRF check failed)")
    try:
        payload = json.loads(base64.urlsafe_b64decode(b64_body.encode("ascii")).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed OAuth state payload") from exc
    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OAuth state expired")
    return payload


def decode_bearer_jwt(token: str) -> Dict[str, Any]:
    """Verify Supabase JWT (HS256) or internal JWT."""
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            options={"verify_aud": False},
        )
        if not payload.get("sub"):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject")
        return payload
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Access token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token") from exc


def create_access_token(
    user_id: str,
    email: str,
    full_name: str = "",
    global_role: str = "teacher",
    expires_in_seconds: int = 86400,
) -> str:
    """Issue a signed JWT (used when running with built-in auth or integration tests)."""
    settings = get_settings()
    now = int(time.time())
    payload = {
        "sub": user_id,
        "email": email,
        "user_metadata": {"full_name": full_name, "global_role": global_role},
        "iat": now,
        "exp": now + expires_in_seconds,
    }
    return jwt.encode(payload, settings.supabase_jwt_secret, algorithm="HS256")


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple sliding-window rate limiter per client IP."""

    def __init__(self, app, max_requests_per_minute: int = 120):
        super().__init__(app)
        self.max_requests = max_requests_per_minute
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        client_ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        window_start = now - 60.0
        bucket = self._hits[client_ip]
        while bucket and bucket[0] < window_start:
            bucket.popleft()
        if len(bucket) >= self.max_requests:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Please try again shortly.",
            )
        bucket.append(now)
        return await call_next(request)
