const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/api/v1";

export function getStoredToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("pygrader_token") || "";
}

export function getStoredWorkspaceId(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("pygrader_workspace_id") || "";
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { skipWorkspace?: boolean } = {}
): Promise<T> {
  const token = getStoredToken();
  const workspaceId = getStoredWorkspaceId();

  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!options.skipWorkspace && workspaceId) headers.set("X-Workspace-Id", workspaceId);
  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      detail = errJson.detail || JSON.stringify(errJson);
    } catch {
      detail = await res.text();
    }
    throw new Error(detail);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function downloadExcelReport(reportType: string, params: Record<string, string> = {}) {
  const token = getStoredToken();
  const workspaceId = getStoredWorkspaceId();
  const qs = new URLSearchParams({ report_type: reportType, ...params }).toString();
  const res = await fetch(`${API_BASE}/reports/export/excel?${qs}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Workspace-Id": workspaceId,
    },
  });
  if (!res.ok) {
    throw new Error(`Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pyautograder_${reportType}_report.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function fetchArtifactPreviewBlobUrl(submissionId: string, artifactId: string): Promise<string> {
  const token = getStoredToken();
  const workspaceId = getStoredWorkspaceId();
  const res = await fetch(`${API_BASE}/submissions/${submissionId}/artifacts/${artifactId}/preview`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Workspace-Id": workspaceId,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = `โหลดพรีวิวเอกสารไม่สำเร็จ (${res.status})`;
    try {
      const errJson = await res.json();
      detail = errJson.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
