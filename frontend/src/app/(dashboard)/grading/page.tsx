"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Play, RefreshCw, Eye, SlidersHorizontal } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { apiFetch } from "@/lib/api";
import type { Assignment, SubmissionSummary } from "@/lib/types";

export default function GradingQueuePage() {
  const { activeWorkspace } = useApp();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedAsgId, setSelectedAsgId] = useState("");
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [runningBatch, setRunningBatch] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!activeWorkspace) return;
    const qs = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const initialAsgId = qs?.get("assignment_id") || "";
    apiFetch<Assignment[]>("/assignments").then((list) => {
      setAssignments(list);
      if (initialAsgId && list.some((a) => a.id === initialAsgId)) {
        setSelectedAsgId(initialAsgId);
      } else if (list[0]) {
        setSelectedAsgId(list[0].id);
      }
    });
  }, [activeWorkspace]);

  const loadSubmissions = useCallback(async () => {
    if (!selectedAsgId) return;
    try {
      const data = await apiFetch<SubmissionSummary[]>(`/assignments/${selectedAsgId}/submissions`);
      setSubmissions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดรายการส่งงานไม่สำเร็จ");
    }
  }, [selectedAsgId]);

  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  async function handleBatchGrade() {
    if (!selectedAsgId) return;
    setRunningBatch(true);
    setError("");
    setStatusMsg("");
    try {
      const res = await apiFetch<{ queued_count: number }>(`/grading/assignments/${selectedAsgId}/run-batch`, {
        method: "POST",
        body: JSON.stringify({ run_sync_inline: true }),
      });
      setStatusMsg(`ตรวจงานอัตโนมัติเรียบร้อยแล้ว ${res.queued_count} รายการ`);
      await loadSubmissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เริ่มตรวจงานกลุ่มไม่สำเร็จ");
    } finally {
      setRunningBatch(false);
    }
  }

  async function handleSingleGrade(submissionId: string) {
    setError("");
    try {
      await apiFetch(`/grading/submissions/${submissionId}/run?run_inline=true`, { method: "POST" });
      await loadSubmissions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ตรวจงานไม่สำเร็จ");
    }
  }

  const currentAsg = assignments.find((a) => a.id === selectedAsgId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1F1B2E]">ตรวจงานอัตโนมัติ (Grading Queue)</h1>
          <p className="text-sm text-[#645D7B]">ตรวจทีละคน ตรวจทั้งห้องพร้อมกัน หรือตรวจซ้ำโดยเก็บประวัติทุกครั้ง</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedAsgId}
            onChange={(e) => setSelectedAsgId(e.target.value)}
            className="rounded-xl border border-[#DDD4FF] bg-white px-3.5 py-2 text-sm font-medium"
          >
            {assignments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>

          {selectedAsgId && (
            <Link
              href={`/assignments/${selectedAsgId}/criteria`}
              className="btn-kawaii-soft px-3.5 py-2 text-xs font-semibold"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" /> ตั้งเกณฑ์ตรวจ
            </Link>
          )}

          <button
            onClick={handleBatchGrade}
            disabled={runningBatch || !selectedAsgId}
            className="btn-kawaii px-4 py-2 text-sm"
          >
            <Play className="w-4 h-4" /> {runningBatch ? "กำลังตรวจทั้งห้อง..." : "ตรวจทั้งหมดในใบงานนี้"}
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="rounded-2xl bg-[#ECFDF5] border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
          {statusMsg}
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-[#FFF1F2] border border-rose-200 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <div className="card-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F2EEFF]/70 text-[#645D7B] text-xs uppercase">
              <tr>
                <th className="px-5 py-3.5">นักเรียน</th>
                <th className="px-5 py-3.5">รูปแบบไฟล์ที่ส่ง</th>
                <th className="px-5 py-3.5">สถานะ</th>
                <th className="px-5 py-3.5">ตรวจ % AI</th>
                <th className="px-5 py-3.5">คะแนน</th>
                <th className="px-5 py-3.5 text-right">การดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F2EEFF]">
              {submissions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-[#645D7B]">
                    ยังไม่มีรายการส่งงานในใบงานนี้
                  </td>
                </tr>
              ) : (
                submissions.map((item) => (
                  <tr key={item.submission.id} className="hover:bg-[#FAF8F5]">
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-[#1F1B2E]">{item.student.full_name}</div>
                      <div className="text-xs text-[#645D7B]">{item.student.email}</div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        {item.artifact_types.map((t) => (
                          <span
                            key={t}
                            className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#F2EEFF] text-[#7C5CFC]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                          item.submission.status === "approved"
                            ? "bg-[#ECFDF5] text-emerald-700"
                            : item.submission.status === "graded"
                            ? "bg-[#F2EEFF] text-[#7C5CFC]"
                            : item.submission.status === "error" || item.submission.status === "needs_review"
                            ? "bg-[#FFF1F2] text-rose-700"
                            : "bg-[#FFFBEB] text-amber-700"
                        }`}
                      >
                        {item.submission.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      {item.ai_usage_percent != null ? (
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                            item.ai_usage_percent >= 65
                              ? "bg-[#F7DCE8] text-[#9D2B5B]"
                              : item.ai_usage_percent >= 35
                              ? "bg-[#FFE5A9] text-[#9A6700]"
                              : "bg-[#DDF1E7] text-[#2E7D5B]"
                          }`}
                        >
                          AI ~{item.ai_usage_percent}%
                        </span>
                      ) : (
                        <span className="text-xs text-[#7C6B99]">-</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 font-bold text-[#1F1B2E]">
                      {item.submission.final_score != null
                        ? `${item.submission.final_score} / ${currentAsg?.max_score ?? 10}`
                        : "-"}
                    </td>
                    <td className="px-5 py-3.5 text-right space-x-2">
                      <button
                        onClick={() => handleSingleGrade(item.submission.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#FFF1EB] text-[#E6744C] text-xs font-semibold hover:bg-[#FFE4D9]"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> ตรวจ / ตรวจซ้ำ
                      </button>
                      <Link
                        href={`/grading/${item.submission.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#7C5CFC] text-white text-xs font-semibold hover:bg-[#6846F5]"
                      >
                        <Eye className="w-3.5 h-3.5" /> ดูโค้ดและผลตรวจ
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
