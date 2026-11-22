"""HTTP Client for the Isolated Python Sandbox Runner Microservice."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

import httpx

from app.core.config import get_settings


@dataclass
class SandboxExecutionResult:
    execution_id: str
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool
    execution_time_ms: int
    memory_usage_kb: Optional[int]
    runtime_used: str


class SandboxClient:
    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.sandbox_service_url).rstrip("/")
        self.api_key = api_key or settings.sandbox_api_key

    async def execute(
        self,
        code: str,
        stdin: str = "",
        timeout_seconds: int = 5,
        extra_files: Optional[Dict[str, str]] = None,
        entry_file: str = "main.py",
    ) -> SandboxExecutionResult:
        payload = {
            "code": code,
            "stdin": stdin,
            "timeout_seconds": timeout_seconds,
            "extra_files": extra_files or {},
            "entry_file": entry_file,
        }
        headers = {"X-Sandbox-Key": self.api_key}
        async with httpx.AsyncClient(timeout=timeout_seconds + 15.0) as client:
            resp = await client.post(f"{self.base_url}/execute", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        return SandboxExecutionResult(
            execution_id=data["execution_id"],
            stdout=data["stdout"],
            stderr=data["stderr"],
            exit_code=data["exit_code"],
            timed_out=data["timed_out"],
            execution_time_ms=data["execution_time_ms"],
            memory_usage_kb=data.get("memory_usage_kb"),
            runtime_used=data.get("runtime_used", "unknown"),
        )
