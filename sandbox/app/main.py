"""
Isolated Python Sandbox Runner Microservice.

Executes untrusted student Python code inside ephemeral, unprivileged,
network-isolated Docker/gVisor containers with strict CPU, RAM, PID,
file-size, and timeout limits.
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
import tarfile
import time
import uuid
from typing import Dict, Optional

import docker
from docker.errors import DockerException, NotFound
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s [SANDBOX] %(levelname)s %(message)s")
logger = logging.getLogger("sandbox")

SANDBOX_API_KEY = os.getenv("SANDBOX_API_KEY", "dev-sandbox-key")
SANDBOX_DOCKER_IMAGE = os.getenv("SANDBOX_DOCKER_IMAGE", "pyautograder-student-python:3.11")
SANDBOX_DOCKER_RUNTIME = os.getenv("SANDBOX_DOCKER_RUNTIME", "").strip() or None
SANDBOX_MAX_CONCURRENT_JOBS = int(os.getenv("SANDBOX_MAX_CONCURRENT_JOBS", "8"))
SANDBOX_CPU_LIMIT = float(os.getenv("SANDBOX_CPU_LIMIT", "0.5"))
SANDBOX_MEMORY_LIMIT = os.getenv("SANDBOX_MEMORY_LIMIT", "128m")
SANDBOX_PIDS_LIMIT = int(os.getenv("SANDBOX_PIDS_LIMIT", "64"))
MAX_OUTPUT_BYTES = 262_144  # 256 KB stdout/stderr cap

concurrency_semaphore = asyncio.Semaphore(SANDBOX_MAX_CONCURRENT_JOBS)

app = FastAPI(title="Python Auto Grader — Isolated Sandbox Runner", version="1.0.0")


class ExecuteRequest(BaseModel):
    code: str = Field(..., max_length=500_000, description="Primary Python source code to execute")
    stdin: str = Field(default="", max_length=100_000)
    timeout_seconds: int = Field(default=5, ge=1, le=30)
    extra_files: Dict[str, str] = Field(
        default_factory=dict,
        description="Optional additional relative files (filename -> content) for multi-file projects",
    )
    entry_file: str = Field(default="main.py", max_length=128)


class ExecuteResponse(BaseModel):
    execution_id: str
    stdout: str
    stderr: str
    exit_code: int
    timed_out: bool
    execution_time_ms: int
    memory_usage_kb: Optional[int] = None
    runtime_used: str


def _build_tar_archive(files: Dict[str, str]) -> bytes:
    """Create an in-memory tar archive of student files with safe relative paths."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for rel_path, content in files.items():
            clean_path = rel_path.replace("\\", "/").lstrip("/")
            if ".." in clean_path.split("/"):
                raise ValueError(f"Unsafe path rejected: {rel_path}")
            data = content.encode("utf-8")
            info = tarfile.TarInfo(name=clean_path)
            info.size = len(data)
            info.mode = 0o444
            tar.addfile(info, io.BytesIO(data))
    buf.seek(0)
    return buf.read()


def _run_in_docker(req: ExecuteRequest, execution_id: str) -> ExecuteResponse:
    client = docker.from_env()
    container = None
    start_ts = time.perf_counter()

    # Prepare files to inject into ephemeral /tmp/work inside container
    files_to_inject = dict(req.extra_files)
    entry_name = req.entry_file.replace("\\", "/").lstrip("/")
    files_to_inject[entry_name] = req.code
    files_to_inject["_stdin.txt"] = req.stdin
    tar_bytes = _build_tar_archive(files_to_inject)

    # Wrapper script enforces Python-level RLIMIT_FSIZE (2 MB) and feeds _stdin.txt
    b64_entry = base64.b64encode(entry_name.encode("utf-8")).decode("ascii")
    runner_cmd = [
        "python3",
        "-I",  # isolated mode: ignores user site-packages & PYTHON* env vars
        "-c",
        (
            "import base64, os, resource, subprocess, sys; "
            "resource.setrlimit(resource.RLIMIT_FSIZE, (2*1024*1024, 2*1024*1024)); "
            f"entry = base64.b64decode('{b64_entry}').decode('utf-8'); "
            "stdin_f = open('/tmp/work/_stdin.txt', 'rb'); "
            "proc = subprocess.run([sys.executable, '-I', os.path.join('/tmp/work', entry)], "
            "stdin=stdin_f, cwd='/tmp/work'); "
            "sys.exit(proc.returncode)"
        ),
    ]

    container_kwargs = {
        "image": SANDBOX_DOCKER_IMAGE,
        "command": runner_cmd,
        "name": f"pygrader-sbx-{execution_id[:12]}",
        "detach": True,
        "network_disabled": True,
        "read_only": True,
        "user": "10001:10001",
        "cap_drop": ["ALL"],
        "security_opt": ["no-new-privileges:true"],
        "pids_limit": SANDBOX_PIDS_LIMIT,
        "mem_limit": SANDBOX_MEMORY_LIMIT,
        "memswap_limit": SANDBOX_MEMORY_LIMIT,
        "nano_cpus": int(SANDBOX_CPU_LIMIT * 1_000_000_000),
        "tmpfs": {"/tmp": "rw,nosuid,size=16m"},
        "environment": {},  # Strictly zero secrets/env vars passed
    }
    if SANDBOX_DOCKER_RUNTIME:
        container_kwargs["runtime"] = SANDBOX_DOCKER_RUNTIME

    timed_out = False
    exit_code = -1
    stdout_str = ""
    stderr_str = ""
    memory_usage_kb: Optional[int] = None

    try:
        container = client.containers.create(**container_kwargs)
        # Put archive into /tmp/work before starting
        # First create /tmp/work directory in archive by prefixing paths
        prefixed_files = {f"work/{k}": v for k, v in files_to_inject.items()}
        container.put_archive("/tmp", _build_tar_archive(prefixed_files))
        container.start()

        try:
            result = container.wait(timeout=req.timeout_seconds)
            exit_code = int(result.get("StatusCode", -1))
        except Exception:
            timed_out = True
            exit_code = 124
            try:
                container.kill()
            except DockerException:
                pass

        # Collect memory stats if available
        try:
            stats = container.stats(stream=False)
            mem_bytes = stats.get("memory_stats", {}).get("max_usage") or stats.get(
                "memory_stats", {}
            ).get("usage")
            if isinstance(mem_bytes, (int, float)):
                memory_usage_kb = int(mem_bytes // 1024)
        except Exception:
            memory_usage_kb = None

        raw_stdout = container.logs(stdout=True, stderr=False)[:MAX_OUTPUT_BYTES]
        raw_stderr = container.logs(stdout=False, stderr=True)[:MAX_OUTPUT_BYTES]
        stdout_str = raw_stdout.decode("utf-8", errors="replace")
        stderr_str = raw_stderr.decode("utf-8", errors="replace")
        if timed_out:
            stderr_str = (stderr_str + f"\nExecution timed out after {req.timeout_seconds}s.").strip()

    finally:
        if container is not None:
            try:
                container.remove(force=True)
            except NotFound:
                pass
            except DockerException as exc:
                logger.warning("Failed to remove sandbox container %s: %s", execution_id, exc)

    elapsed_ms = int((time.perf_counter() - start_ts) * 1000)
    logger.info(
        "execution_id=%s exit_code=%s timed_out=%s elapsed_ms=%s mem_kb=%s runtime=%s",
        execution_id,
        exit_code,
        timed_out,
        elapsed_ms,
        memory_usage_kb,
        SANDBOX_DOCKER_RUNTIME or "runc",
    )

    return ExecuteResponse(
        execution_id=execution_id,
        stdout=stdout_str,
        stderr=stderr_str,
        exit_code=exit_code,
        timed_out=timed_out,
        execution_time_ms=elapsed_ms,
        memory_usage_kb=memory_usage_kb,
        runtime_used=SANDBOX_DOCKER_RUNTIME or "docker-default",
    )


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "image": SANDBOX_DOCKER_IMAGE,
        "runtime": SANDBOX_DOCKER_RUNTIME or "docker-default",
        "max_concurrent_jobs": SANDBOX_MAX_CONCURRENT_JOBS,
    }


@app.post("/execute", response_model=ExecuteResponse)
async def execute_code(
    req: ExecuteRequest,
    x_sandbox_key: str = Header(default="", alias="X-Sandbox-Key"),
):
    if x_sandbox_key != SANDBOX_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid sandbox API key")

    execution_id = str(uuid.uuid4())
    async with concurrency_semaphore:
        try:
            return await asyncio.to_thread(_run_in_docker, req, execution_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except DockerException as exc:
            logger.error("Sandbox Docker error for %s: %s", execution_id, exc)
            raise HTTPException(
                status_code=503,
                detail=f"Sandbox execution runtime unavailable: {exc}",
            ) from exc
