"""Security & Multi-Tenant Integration Tests."""

import pytest
from fastapi import HTTPException

from app.core.security import (
    create_access_token,
    decode_bearer_jwt,
    decrypt_secret,
    encrypt_secret,
    sign_oauth_state,
    verify_oauth_state,
)


def test_token_encryption_roundtrip():
    secret_token = "ya29.a0AfH6SMBx-fake-google-access-token"
    encrypted = encrypt_secret(secret_token)
    assert encrypted != secret_token
    assert secret_token not in encrypted
    assert decrypt_secret(encrypted) == secret_token


def test_oauth_state_csrf_protection():
    state = sign_oauth_state({"workspace_id": "ws-1", "user_id": "u-1", "scope_mode": "read"})
    verified = verify_oauth_state(state)
    assert verified["workspace_id"] == "ws-1"

    # Tampered signature must fail
    tampered = state[:-4] + "0000"
    with pytest.raises(HTTPException) as exc_info:
        verify_oauth_state(tampered)
    assert exc_info.value.status_code == 400


def test_jwt_issue_and_decode():
    token = create_access_token("user-123", "teacher@school.ac.th", "Kru Somchai", "teacher")
    payload = decode_bearer_jwt(token)
    assert payload["sub"] == "user-123"
    assert payload["email"] == "teacher@school.ac.th"
