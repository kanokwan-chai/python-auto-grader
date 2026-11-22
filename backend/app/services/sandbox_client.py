"""HTTP Client for the Isolated Python Sandbox Runner Microservice.

Uses the dedicated Docker/gVisor Sandbox HTTP service whenever available.
In stateless serverless environments (where Docker daemon is unavailable),
performs a strictly AST-guarded, zero-env, ephemeral /tmp subprocess check
blocking dangerous system/network modules so basic Python syntax & runtime
correctness can still be verified safely.
"""

from __future__ import annotations

import ast
import asyncio
import os
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from typing import Dict, Optional

import httpx

from app.core.config import get_settings

BLOCKED_MODULES = {
    "os",
    "sys",
    "subprocess",
    "socket",
    "shutil",
    "urllib",
    "http",
    "requests",
    "httpx",
    "ctypes",
    "multiprocessing",
    "threading",
    "signal",
    "pathlib",
    "importlib",
    "builtins",
    "pty",
    "fcntl",
}


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


def _ast_safety_check(code: str) -> Optional[str]:
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        return f"SyntaxError (line {exc.lineno}): {exc.msg}"
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root in BLOCKED_MODULES:
                    return f"Blocked import '{root}' in serverless restricted runner (configure Docker Sandbox for full isolation)."
        elif isinstance(node, ast.ImportFrom) and node.module:
            root = node.module.split(".")[0]
            if root in BLOCKED_MODULES:
                return f"Blocked import '{root}' in serverless restricted runner (configure Docker Sandbox for full isolation)."
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in ("__import__", "eval", "exec", "compile", "open"):
                return f"Blocked builtin '{node.func.id}()' in serverless restricted runner."
    return None


async def _run_restricted_serverless(
    code: str,
    stdin: str,
    timeout_seconds: int,
    extra_files: Optional[Dict[str, str]],
    entry_file: str,
) -> SandboxExecutionResult:
    exec_id = f"svl-{uuid.uuid4().hex[:10]}"
    violation = _ast_safety_check(code)
    if violation:
        return SandboxExecutionResult(
            execution_id=exec_id,
            stdout="",
            stderr=violation,
            exit_code=1,
            timed_out=False,
            execution_time_ms=0,
            memory_usage_kb=None,
            runtime_used="serverless-ast-guard",
        )

    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="pygrader_") as tmpdir:
        entry_path = os.path.join(tmpdir, os.path.basename(entry_file or "main.py"))
        with open(entry_path, "w", encoding="utf-8") as f:
            f.write(code)
        for rel, content in (extra_files or {}).items():
            safe_name = os.path.basename(rel)
            if safe_name and safe_name != os.path.basename(entry_path):
                with open(os.path.join(tmpdir, safe_name), "w", encoding="utf-8") as f:
                    f.write(content)

        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-I",
            entry_path,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=tmpdir,
            env={"PYTHONIOENCODING": "utf-8"},
        )
        timed_out = False
        try:
            out_b, err_b = await asyncio.wait_for(
                proc.communicate(input=(stdin or "").encode("utf-8")),
                timeout=min(max(timeout_seconds, 1), 5),
            )
            exit_code = proc.returncode if proc.returncode is not None else 0
        except asyncio.TimeoutError:
            timed_out = True
            proc.kill()
            out_b, err_b = await proc.communicate()
            exit_code = 124

    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return SandboxExecutionResult(
        execution_id=exec_id,
        stdout=out_b.decode("utf-8", errors="replace")[:10000],
        stderr=err_b.decode("utf-8", errors="replace")[:5000],
        exit_code=exit_code,
        timed_out=timed_out,
        execution_time_ms=elapsed_ms,
        memory_usage_kb=None,
        runtime_used="serverless-restricted",
    )


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
        try:
            async with httpx.AsyncClient(timeout=timeout_seconds + 10.0) as client:
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
                runtime_used=data.get("runtime_used", "docker"),
            )
        except Exception:
            return await _run_restricted_serverless(code, stdin, timeout_seconds, extra_files, entry_file)
