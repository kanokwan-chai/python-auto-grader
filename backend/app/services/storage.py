"""Private Object Storage Service (Supabase Storage & Local Fallback)."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Tuple

import httpx

from app.core.config import get_settings


class StorageService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def _local_path(self, key: str) -> Path:
        base = Path(self.settings.local_storage_dir).resolve()
        target = (base / key).resolve()
        if not str(target).startswith(str(base)):
            raise ValueError("Invalid storage key path")
        target.parent.mkdir(parents=True, exist_ok=True)
        return target

    async def upload_bytes(
        self,
        workspace_id: str,
        submission_id: str,
        filename: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> Tuple[str, str, str]:
        """Store file bytes in private bucket. Returns (bucket, storage_path, sha256_hex)."""
        sha256_hex = hashlib.sha256(data).hexdigest()
        safe_name = os.path.basename(filename).replace("..", "_")
        storage_path = f"{workspace_id}/{submission_id}/{sha256_hex[:12]}_{safe_name}"
        bucket = self.settings.storage_bucket_name

        if self.settings.storage_backend == "supabase" and self.settings.supabase_url:
            url = f"{self.settings.supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{storage_path}"
            headers = {
                "Authorization": f"Bearer {self.settings.supabase_service_role_key}",
                "Content-Type": content_type,
                "x-upsert": "true",
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, content=data, headers=headers)
                resp.raise_for_status()
            return bucket, storage_path, sha256_hex

        # Local private filesystem storage
        target = self._local_path(f"{bucket}/{storage_path}")
        target.write_bytes(data)
        return bucket, storage_path, sha256_hex

    async def download_bytes(self, bucket: str, storage_path: str) -> bytes:
        if self.settings.storage_backend == "supabase" and self.settings.supabase_url:
            url = f"{self.settings.supabase_url.rstrip('/')}/storage/v1/object/{bucket}/{storage_path}"
            headers = {"Authorization": f"Bearer {self.settings.supabase_service_role_key}"}
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                return resp.content

        target = self._local_path(f"{bucket}/{storage_path}")
        if not target.exists():
            raise FileNotFoundError(f"Artifact not found in storage: {storage_path}")
        return target.read_bytes()
