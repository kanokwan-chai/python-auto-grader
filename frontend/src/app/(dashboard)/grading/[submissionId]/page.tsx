"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  MessageSquare,
  Play,
  RefreshCw,
  Sparkles,
  Terminal,
  XCircle,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { CriterionResult, GradingRun, SubmissionSummary, TestResult } from "@/lib/types";

interface SubmissionDetailPayload {
  submission: {
    id: string;
    status: string;
    final_score: number | null;
    is_approved: boolean;
    submitted_at: string | null;
  };
  student: { id: string; full_name: string; email: string; student_code?: string | null } | null;
  assignment: { id: string; title: string; max_score: number } | null;
  artifacts: Array<{
    id: string;
    artifact_type: string;
    original_filename?: string | null;
    colab_url?: string | null;
    fetch_status: string;
    fetch_error?: string | null;
  }>;
  code_files: Array<{ artifact_id: string; filename: string; content: string }>;
  notebook_cells: Array<{
    id: string;
    cell_index: number;
    cell_type: string;
    source_code: string;
    saved_outputs: Array<Record<string, unknown>>;
  }>;
  teacher_feedback: Array<{ id: string; comment: string; created_at: string }>;
}

interface RunDetailPayload {
  run: GradingRun;
  criterion_results: CriterionResult[];
  test_results: TestResult[];
  grade_adjustments: Array<{
    id: string;
    previous_score: number;
    new_score: number;
    reason: string;
    created_at: string;
  }>;
}

export default function GradingDetailPage() {
  const params = useParams<{ submissionId: string }>();
  const router = useRouter();
  const submissionId = params.submissionId;

  const [detail, setDetail] = useState<SubmissionDetailPayload | null>(null);
  const [peerSubmissions, setPeerSubmissions] = useState<SubmissionSummary[]>([]);
  const [runs, setRuns] = useState<GradingRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [runDetail, setRunDetail] = useState<RunDetailPayload | null>(null);

  const [adjustScore, setAdjustScore] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState("");
  const [error, setError] = useState("");

  // Live Code Preview Runner State
  const [previewStdin, setPreviewStdin] = useState("");
  const [previewRunningKey, setPreviewRunningKey] = useState<string | null>(null);
  const [previewOutput, setPreviewOutput] = useState<{
    label: string;
    stdout: string;
    stderr: string;
    exit_code: number;
    timed_out: boolean;
    execution_time_ms: number;
    runtime_used: string;
  } | null>(null);

  const loadAll = useCallback(async () => {
    if (!submissionId) return;
    try {
      const [subData, runList] = await Promise.all([
        apiFetch<SubmissionDetailPayload>(`/submissions/${submissionId}`),
        apiFetch<GradingRun[]>(`/grading/submissions/${submissionId}/runs`),
      ]);
      setDetail(subData);
      setRuns(runList);
      if (subData.assignment?.id) {
        apiFetch<SubmissionSummary[]>(`/assignments/${subData.assignment.id}/submissions`)
          .then(setPeerSubmissions)
          .catch(() => {});
      }
      if (runList[0] && !selectedRunId) {
        setSelectedRunId(runList[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดรายละเอียดการตรวจไม่สำเร็จ");
    }
  }, [submissionId, selectedRunId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!selectedRunId) return;
    apiFetch<RunDetailPayload>(`/grading/runs/${selectedRunId}`)
      .then((data) => {
        setRunDetail(data);
        setAdjustScore(String(data.run.final_score ?? 0));
      })
      .catch(() => {});
  }, [selectedRunId]);

  async function handleRegrade() {
    setBusy(true);
    setError("");
    try {
      const newRun = await apiFetch<GradingRun>(`/grading/submissions/${submissionId}/run?run_inline=true`, {
        method: "POST",
      });
      setSelectedRunId(newRun.id);
      setBanner(`ตรวจงานซ้ำสำเร็จ (Grading Run #${newRun.run_number}) ประวัติเดิมยังคงถูกเก็บไว้ครบถ้วน`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ตรวจซ้ำไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdjustScore(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedRunId) return;
    setError("");
    try {
      await apiFetch(`/grading/runs/${selectedRunId}/adjust`, {
        method: "POST",
        body: JSON.stringify({ new_score: Number(adjustScore), reason: adjustReason }),
      });
      setAdjustReason("");
      setBanner("บันทึกการปรับคะแนนพร้อมประวัติก่อน-หลังเรียบร้อยแล้ว");
      const refreshed = await apiFetch<RunDetailPayload>(`/grading/runs/${selectedRunId}`);
      setRunDetail(refreshed);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ปรับคะแนนไม่สำเร็จ");
    }
  }

  async function handleSaveComment(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedRunId || !comment.trim()) return;
    try {
      await apiFetch(`/grading/runs/${selectedRunId}/feedback`, {
        method: "POST",
        body: JSON.stringify({ comment, is_visible_to_student: true }),
      });
      setComment("");
      setBanner("บันทึกความคิดเห็นครูเรียบร้อยแล้ว");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกความคิดเห็นไม่สำเร็จ");
    }
  }

  async function handleCancelQueuedRun() {
    if (!selectedRunId) return;
    setError("");
    try {
      await apiFetch(`/grading/runs/${selectedRunId}/cancel`, { method: "POST" });
      setBanner("ยกเลิกงานตรวจที่อยู่ในคิวเรียบร้อยแล้ว");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ยกเลิกงานตรวจไม่สำเร็จ");
    }
  }

  async function handlePreviewRun(runKey: string, label: string, code: string) {
    if (!code.trim()) return;
    setPreviewRunningKey(runKey);
    setError("");
    try {
      const res = await apiFetch<{
        stdout: string;
        stderr: string;
        exit_code: number;
        timed_out: boolean;
        execution_time_ms: number;
        runtime_used: string;
      }>("/grading/preview-run", {
        method: "POST",
        body: JSON.stringify({ code, stdin: previewStdin, timeout_seconds: 5 }),
      });
      setPreviewOutput({ label, ...res });
    } catch (err) {
      setError(err instanceof Error ? err.message : "รันโค้ดทดสอบไม่สำเร็จ");
    } finally {
      setPreviewRunningKey(null);
    }
  }

  async function handleApprove() {
    if (!selectedRunId) return;
    try {
      await apiFetch(`/grading/runs/${selectedRunId}/approve`, { method: "POST" });
      setBanner("อนุมัติคะแนนเรียบร้อยแล้ว พร้อมส่งคะแนนกลับ Google Classroom");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "อนุมัติคะแนนไม่สำเร็จ");
    }
  }

  return (
    <div className="space-y-5">
      {/* Top Bar */}
      <div className="card-soft p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/grading" className="p-2 rounded-xl bg-[#F2EEFF] text-[#7C5CFC] hover:bg-[#E6DFFC]">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg text-[#1F1B2E]">{detail?.student?.full_name || "นักเรียน"}</h1>
              {detail?.submission.is_approved && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#ECFDF5] text-emerald-700">
                  อนุมัติแล้ว
                </span>
              )}
            </div>
            <p className="text-xs text-[#645D7B]">
              {detail?.assignment?.title} • {detail?.student?.email}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {peerSubmissions.length > 1 && (
            <select
              value={submissionId}
              onChange={(e) => router.push(`/grading/${e.target.value}`)}
              aria-label="สลับนักเรียน"
              className="rounded-xl border border-[#DDD4FF] bg-white px-3 py-2 text-xs font-medium text-[#1F1B2E]"
            >
              {peerSubmissions.map((ps) => (
                <option key={ps.submission.id} value={ps.submission.id}>
                  {ps.student.full_name} ({ps.submission.final_score ?? "-"})
                </option>
              ))}
            </select>
          )}
          {runs.length > 0 && (
            <select
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
              className="rounded-xl border border-[#DDD4FF] bg-[#FAF8F5] px-3 py-2 text-xs font-medium"
            >
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  Run #{r.run_number} ({r.status}) — {r.final_score ?? "-"} คะแนน
                </option>
              ))}
            </select>
          )}
          {runDetail?.run.status === "queued" && (
            <button
              onClick={handleCancelQueuedRun}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#FFF1F2] text-rose-700 hover:bg-rose-100 text-xs font-semibold"
            >
              <Ban className="w-3.5 h-3.5" /> ยกเลิกคิว
            </button>
          )}
          <button
            onClick={handleRegrade}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FFF1EB] text-[#E6744C] hover:bg-[#FFE4D9] text-xs font-semibold"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> ตรวจซ้ำ (สร้าง Run ใหม่)
          </button>
          <button
            onClick={handleApprove}
            disabled={!selectedRunId}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#16A34A] hover:bg-emerald-700 text-white text-xs font-semibold"
          >
            <CheckCircle2 className="w-4 h-4" /> อนุมัติคะแนน (Approve Grade)
          </button>
        </div>
      </div>

      {banner && (
        <div className="rounded-2xl bg-[#ECFDF5] border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
          {banner}
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-[#FFF1F2] border border-rose-200 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Code Viewer + Notebook Cells + Error Details */}
        <div className="lg:col-span-7 space-y-5">
          <div className="card-soft p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#1F1B2E] flex items-center gap-2">
                <Terminal className="w-4 h-4 text-[#7C5CFC]" /> โค้ดของนักเรียน (Code Viewer)
              </h2>
              <div className="flex gap-1.5">
                {detail?.artifacts.map((a) => (
                  <span key={a.id} className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#F2EEFF] text-[#7C5CFC]">
                    {a.artifact_type}: {a.original_filename || "colab"}
                  </span>
                ))}
              </div>
            </div>

            {/* Optional stdin for live preview run */}
            {((detail?.code_files?.length ?? 0) > 0 || (detail?.notebook_cells?.length ?? 0) > 0) && (
              <div className="rounded-2xl bg-[#FFFAF5] border border-[#E8D9FA] p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <span className="text-[11px] font-semibold text-[#684A96] shrink-0">
                  Input (stdin) สำหรับรันทดสอบ:
                </span>
                <input
                  type="text"
                  value={previewStdin}
                  onChange={(e) => setPreviewStdin(e.target.value)}
                  placeholder="ใส่ค่า input ถ้าโค้ดมี input() เช่น 10 20 (เว้นว่างได้)"
                  className="flex-1 rounded-xl border border-[#E8D9FA] bg-white px-3 py-1.5 text-xs code-font"
                />
              </div>
            )}

            {detail?.code_files.map((cf) => (
              <div key={cf.artifact_id} className="rounded-2xl border border-[#ECE7F6] overflow-hidden">
                <div className="bg-[#F2EEFF]/60 px-4 py-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#1F1B2E]">{cf.filename}</span>
                  <button
                    type="button"
                    onClick={() => handlePreviewRun(cf.artifact_id, cf.filename, cf.content)}
                    disabled={previewRunningKey === cf.artifact_id}
                    className="btn-kawaii px-3 py-1 text-[11px]"
                  >
                    <Play className="w-3 h-3" />
                    {previewRunningKey === cf.artifact_id ? "กำลังรัน..." : "รันโค้ดนี้"}
                  </button>
                </div>
                <pre className="p-4 bg-[#FAF8F5] text-xs code-font overflow-x-auto leading-relaxed">
                  {cf.content.split("\n").map((line, idx) => (
                    <div key={idx} className="flex">
                      <span className="w-9 shrink-0 select-none text-[#A098B8] text-right pr-3">{idx + 1}</span>
                      <span className="whitespace-pre text-[#1F1B2E]">{line}</span>
                    </div>
                  ))}
                </pre>
              </div>
            ))}

            {detail && detail.notebook_cells.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-[#645D7B]">Jupyter / Colab Notebook Cells</div>
                  <button
                    type="button"
                    onClick={() => {
                      const allCode = detail.notebook_cells
                        .filter((c) => c.cell_type === "code")
                        .map((c) => c.source_code)
                        .join("\n\n");
                      handlePreviewRun("nb-all", "Notebook (ทุก Code Cell)", allCode);
                    }}
                    disabled={previewRunningKey === "nb-all"}
                    className="btn-kawaii px-3.5 py-1.5 text-[11px]"
                  >
                    <Play className="w-3 h-3" />
                    {previewRunningKey === "nb-all" ? "กำลังรันทุก Cell..." : "รันทุก Code Cell"}
                  </button>
                </div>
                {detail.notebook_cells.map((cell) => (
                  <div key={cell.id} className="rounded-2xl border border-[#ECE7F6] overflow-hidden">
                    <div className="bg-[#FAF8F5] px-3 py-1.5 flex items-center justify-between text-[11px] font-medium text-[#645D7B] border-b border-[#ECE7F6]">
                      <span>
                        Cell #{cell.cell_index} • {cell.cell_type.toUpperCase()}
                      </span>
                      {cell.cell_type === "code" && cell.source_code.trim() && (
                        <button
                          type="button"
                          onClick={() => handlePreviewRun(cell.id, `Cell #${cell.cell_index}`, cell.source_code)}
                          disabled={previewRunningKey === cell.id}
                          className="btn-kawaii-soft px-2.5 py-0.5 text-[11px]"
                        >
                          <Play className="w-3 h-3" /> {previewRunningKey === cell.id ? "กำลังรัน..." : "รัน Cell นี้"}
                        </button>
                      )}
                    </div>
                    <pre className="p-3.5 text-xs code-font overflow-x-auto bg-white">{cell.source_code}</pre>
                  </div>
                ))}
              </div>
            )}

            {/* Live Execution Output Console */}
            {previewOutput && (
              <div className="rounded-2xl border-2 border-[#E8D9FA] bg-[#FFFAF5] p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-heading text-xs font-semibold text-[#684A96] flex items-center gap-1.5">
                    <Terminal className="w-4 h-4 text-[#9870D4]" /> ผลลัพธ์การรันสด: {previewOutput.label}
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span
                      className={`px-2.5 py-0.5 rounded-full font-semibold ${
                        previewOutput.exit_code === 0 && !previewOutput.timed_out
                          ? "bg-[#DDF1E7] text-[#2E7D5B]"
                          : "bg-[#F7DCE8] text-[#9D2B5B]"
                      }`}
                    >
                      {previewOutput.timed_out
                        ? "Timeout"
                        : previewOutput.exit_code === 0
                        ? "รันผ่าน (Exit 0)"
                        : `Error (Exit ${previewOutput.exit_code})`}
                    </span>
                    <span className="text-[#7C6B99]">{previewOutput.execution_time_ms} ms</span>
                  </div>
                </div>
                <div className="rounded-xl bg-white border border-[#E8D9FA] p-3 text-xs code-font whitespace-pre-wrap max-h-64 overflow-y-auto text-[#4A3869]">
                  {previewOutput.stdout ? previewOutput.stdout : <span className="text-[#9E92B5]">(ไม่มีข้อความ stdout)</span>}
                </div>
                {previewOutput.stderr && (
                  <pre className="rounded-xl bg-[#F7DCE8]/60 border border-[#F8E1EE] p-3 text-xs code-font whitespace-pre-wrap text-[#9D2B5B] max-h-48 overflow-y-auto">
                    {previewOutput.stderr}
                  </pre>
                )}
              </div>
            )}

            {Boolean(runDetail?.run.ast_summary && (runDetail.run.ast_summary as Record<string, unknown>).document_analysis) && (() => {
              const doc = (runDetail!.run.ast_summary as Record<string, unknown>).document_analysis as {
                source_type?: string;
                title?: string;
                page_count?: number;
                word_count?: number;
                is_canva_export?: boolean;
                canva_url?: string;
                text_preview?: string;
                notes_th?: string[];
              };
              return (
                <div className="rounded-2xl border border-[#E8D9FA] bg-[#FFFAF5] p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold text-sm text-[#684A96]">
                      📄 ข้อมูลเอกสาร PDF / Canva: {doc.title || "Document"}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {doc.is_canva_export && (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#DCEBFA] text-[#3B6EA5]">
                          Canva
                        </span>
                      )}
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#E8D9FA] text-[#684A96]">
                        {doc.page_count ?? 0} หน้า • {doc.word_count ?? 0} คำ
                      </span>
                    </div>
                  </div>
                  {doc.canva_url && (
                    <a
                      href={doc.canva_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-xs font-semibold text-[#9870D4] underline break-all"
                    >
                      เปิดดูงานบน Canva →
                    </a>
                  )}
                  {doc.notes_th && doc.notes_th.length > 0 && (
                    <ul className="list-disc pl-5 text-xs text-[#7C6B99] space-y-0.5">
                      {doc.notes_th.map((n, idx) => (
                        <li key={idx}>{n}</li>
                      ))}
                    </ul>
                  )}
                  {doc.text_preview && (
                    <pre className="p-3 rounded-xl bg-white border border-[#E8D9FA] text-xs whitespace-pre-wrap max-h-60 overflow-y-auto text-[#4A3869]">
                      {doc.text_preview}
                    </pre>
                  )}
                </div>
              );
            })()}

            {runDetail?.run.error_message && (
              <div className="rounded-2xl bg-[#FFF1F2] border border-rose-200 p-4 text-xs text-rose-800 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold mb-1">ข้อผิดพลาดการตรวจ (Error Details)</div>
                  <div className="code-font whitespace-pre-wrap">{runDetail.run.error_message}</div>
                </div>
              </div>
            )}
          </div>

          {/* Test Case Results */}
          <div className="card-soft p-5 space-y-3">
            <h2 className="font-bold text-[#1F1B2E]">ผลการทดสอบ Test Cases</h2>
            {!runDetail || runDetail.test_results.length === 0 ? (
              <p className="text-xs text-[#645D7B]">ยังไม่มีผล Test Cases สำหรับ Run นี้</p>
            ) : (
              <div className="space-y-2.5">
                {runDetail.test_results.map((tr) => (
                  <div key={tr.id} className="rounded-xl border border-[#ECE7F6] p-3.5 bg-[#FAF8F5]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 font-semibold text-sm">
                        {tr.passed ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-600" />
                        )}
                        <span>{tr.test_name}</span>
                        {tr.is_hidden && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white border border-[#DDD4FF] text-[#645D7B]">
                            Hidden
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-[#645D7B]">
                        {tr.execution_time_ms ?? 0} ms • {tr.score_awarded}/{tr.max_score} คะแนน
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs code-font">
                      <div className="bg-white rounded-lg p-2 border border-[#ECE7F6]">
                        <div className="text-[10px] text-[#645D7B] mb-0.5">Expected</div>
                        <pre className="whitespace-pre-wrap">{tr.expected_output}</pre>
                      </div>
                      <div className="bg-white rounded-lg p-2 border border-[#ECE7F6]">
                        <div className="text-[10px] text-[#645D7B] mb-0.5">Actual</div>
                        <pre className="whitespace-pre-wrap">{tr.actual_output}</pre>
                      </div>
                    </div>
                    {tr.stderr && (
                      <pre className="mt-2 p-2 rounded-lg bg-[#FFF1F2] text-rose-700 text-[11px] code-font overflow-x-auto">
                        {tr.stderr}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Score Panel, Rubric, AI Feedback, Teacher Comment */}
        <div className="lg:col-span-5 space-y-5">
          {/* Score Panel */}
          <div className="card-soft p-5 space-y-4">
            <h2 className="font-bold text-[#1F1B2E]">สรุปคะแนนและปรับคะแนน (Score Panel)</h2>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-[#F2EEFF] p-3">
                <div className="text-[11px] text-[#645D7B]">อัตโนมัติ</div>
                <div className="text-lg font-bold text-[#7C5CFC]">{runDetail?.run.automated_score ?? "-"}</div>
              </div>
              <div className="rounded-xl bg-[#FFF1EB] p-3">
                <div className="text-[11px] text-[#645D7B]">AI แนะนำ</div>
                <div className="text-lg font-bold text-[#E6744C]">{runDetail?.run.ai_suggested_score ?? "-"}</div>
              </div>
              <div className="rounded-xl bg-[#ECFDF5] p-3">
                <div className="text-[11px] text-[#645D7B]">คะแนนสุทธิ</div>
                <div className="text-lg font-bold text-emerald-700">
                  {runDetail?.run.final_score ?? "-"} / {runDetail?.run.max_score ?? detail?.assignment?.max_score}
                </div>
              </div>
            </div>

            <form onSubmit={handleAdjustScore} className="space-y-2 pt-2 border-t border-[#F2EEFF]">
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  max={detail?.assignment?.max_score || 100}
                  required
                  value={adjustScore}
                  onChange={(e) => setAdjustScore(e.target.value)}
                  className="rounded-xl border border-[#DDD4FF] px-3 py-2 text-sm font-semibold"
                  placeholder="คะแนนใหม่"
                />
                <input
                  required
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="col-span-2 rounded-xl border border-[#DDD4FF] px-3 py-2 text-xs"
                  placeholder="เหตุผลการปรับคะแนน (บันทึกประวัติ)"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 rounded-xl bg-[#7C5CFC] hover:bg-[#6846F5] text-white text-xs font-semibold"
              >
                บันทึกการปรับคะแนน
              </button>
            </form>

            {runDetail && runDetail.grade_adjustments.length > 0 && (
              <div className="pt-3 border-t border-[#F2EEFF] space-y-1.5">
                <div className="text-[11px] font-semibold text-[#645D7B]">ประวัติการปรับคะแนน (ก่อน → หลัง)</div>
                {runDetail.grade_adjustments.map((adj) => (
                  <div key={adj.id} className="rounded-lg bg-[#FAF8F5] px-3 py-2 text-[11px] text-[#1F1B2E]">
                    <span className="font-bold text-[#7C5CFC]">
                      {adj.previous_score} → {adj.new_score}
                    </span>
                    <span className="text-[#645D7B]"> • {adj.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rubric Results */}
          <div className="card-soft p-5 space-y-3">
            <h2 className="font-bold text-[#1F1B2E]">ผลคะแนนแยกตามเกณฑ์ (Rubric Results)</h2>
            {!runDetail || runDetail.criterion_results.length === 0 ? (
              <p className="text-xs text-[#645D7B]">ยังไม่มีผลเกณฑ์ Rubric</p>
            ) : (
              <div className="space-y-2.5">
                {runDetail.criterion_results.map((cr) => (
                  <div key={cr.id} className="rounded-xl bg-[#FAF8F5] border border-[#ECE7F6] p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-[#1F1B2E]">{cr.criterion_name}</span>
                      <span className="text-xs font-bold text-[#7C5CFC]">
                        {cr.awarded_score} / {cr.max_score}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#645D7B] mt-1">
                      วิธีตรวจ: {cr.check_method} • สถานะ: {cr.status}
                    </div>
                    {cr.reason && <p className="text-xs text-[#1F1B2E] mt-1">{cr.reason}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AI Usage Percentage Estimator */}
          {Boolean(runDetail?.run.runtime_summary && (runDetail.run.runtime_summary as Record<string, unknown>).ai_usage) && (() => {
            const aiUsage = (runDetail!.run.runtime_summary as Record<string, unknown>).ai_usage as {
              estimated_ai_percent: number;
              risk_level: string;
              confidence: string;
              signals_th: string[];
              disclaimer_th?: string;
            };
            const pct = aiUsage.estimated_ai_percent ?? 0;
            const barColor =
              pct >= 65 ? "bg-[#E06C9F]" : pct >= 35 ? "bg-[#F4B942]" : "bg-[#5BB98C]";
            const badgeStyle =
              pct >= 65
                ? "bg-[#F7DCE8] text-[#9D2B5B]"
                : pct >= 35
                ? "bg-[#FFE5A9] text-[#9A6700]"
                : "bg-[#DDF1E7] text-[#2E7D5B]";
            const riskLabel = pct >= 65 ? "มีแนวโน้มใช้ AI สูง" : pct >= 35 ? "อาจมีการใช้ AI บางส่วน" : "แนวโน้มเขียนเองสูง";
            return (
              <div className="card-soft p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-heading font-semibold text-[#684A96]">🤖 ประเมิน % การใช้ AI ในการทำงาน</h2>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${badgeStyle}`}>
                    {riskLabel}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="font-heading text-3xl font-semibold text-[#684A96]">{pct}%</span>
                  <span className="text-[11px] text-[#7C6B99]">ระดับความมั่นใจ: {aiUsage.confidence}</span>
                </div>
                <div className="w-full h-3 rounded-full bg-[#F4ECFE] overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
                {aiUsage.signals_th && aiUsage.signals_th.length > 0 && (
                  <ul className="list-disc pl-5 text-xs text-[#4A3869] space-y-1">
                    {aiUsage.signals_th.map((sig, idx) => (
                      <li key={idx}>{sig}</li>
                    ))}
                  </ul>
                )}
                {aiUsage.disclaimer_th && (
                  <p className="text-[11px] text-[#7C6B99] bg-[#FFFAF5] rounded-xl p-2.5 border border-[#E8D9FA]">
                    {aiUsage.disclaimer_th}
                  </p>
                )}
              </div>
            );
          })()}

          {/* AI Feedback */}
          <div className="card-soft p-5 space-y-2.5">
            <h2 className="font-bold text-[#1F1B2E] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#FF9F7F]" /> AI Code Review (ภาษาไทย)
            </h2>
            {runDetail?.run.ai_feedback ? (
              <div className="space-y-2 text-xs text-[#1F1B2E]">
                <p className="leading-relaxed">{runDetail.run.ai_feedback.summary_th}</p>
                {runDetail.run.ai_feedback.error_explanation_th && (
                  <div className="rounded-xl bg-[#FFF1EB] p-3">
                    <div className="font-semibold text-[#E6744C] mb-1">คำอธิบายข้อผิดพลาด</div>
                    <p>{runDetail.run.ai_feedback.error_explanation_th}</p>
                  </div>
                )}
                {runDetail.run.ai_feedback.fix_suggestions_th &&
                  runDetail.run.ai_feedback.fix_suggestions_th.length > 0 && (
                    <ul className="list-disc pl-5 space-y-1 text-[#645D7B]">
                      {runDetail.run.ai_feedback.fix_suggestions_th.map((s, idx) => (
                        <li key={idx}>{s}</li>
                      ))}
                    </ul>
                  )}
              </div>
            ) : (
              <p className="text-xs text-[#645D7B]">ยังไม่มีผลการวิเคราะห์จาก AI</p>
            )}
          </div>

          {/* Teacher Comment */}
          <div className="card-soft p-5 space-y-3">
            <h2 className="font-bold text-[#1F1B2E] flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[#7C5CFC]" /> ความคิดเห็นครูผู้สอน
            </h2>
            <form onSubmit={handleSaveComment} className="space-y-2">
              <textarea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="พิมพ์ข้อเสนอแนะถึงนักเรียน..."
                className="w-full rounded-xl border border-[#DDD4FF] px-3 py-2 text-xs"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#F2EEFF] hover:bg-[#E6DFFC] text-[#7C5CFC] text-xs font-semibold"
              >
                บันทึกความคิดเห็น
              </button>
            </form>
            {detail?.teacher_feedback.map((fb) => (
              <div key={fb.id} className="rounded-xl bg-[#FAF8F5] p-3 text-xs text-[#1F1B2E]">
                {fb.comment}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
