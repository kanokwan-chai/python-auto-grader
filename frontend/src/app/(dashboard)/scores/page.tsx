"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Award, CheckCircle2, CloudUpload, Download, Eye, Filter } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { apiFetch, downloadExcelReport } from "@/lib/api";
import type { Assignment, Classroom, SubmissionSummary } from "@/lib/types";

export default function ScoresPage() {
  const { activeWorkspace } = useApp();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [selectedAsgId, setSelectedAsgId] = useState<string>("");
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!activeWorkspace) return;
    Promise.all([
      apiFetch<Classroom[]>("/classrooms"),
      apiFetch<Assignment[]>("/assignments"),
    ])
      .then(([clss, asgs]) => {
        setClassrooms(clss);
        setAssignments(asgs);
        if (asgs[0]) setSelectedAsgId(asgs[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดข้อมูลผลคะแนนไม่สำเร็จ"));
  }, [activeWorkspace]);

  const filteredAssignments = selectedClassId
    ? assignments.filter((a) => a.classroom_id === selectedClassId)
    : assignments;

  useEffect(() => {
    if (filteredAssignments.length > 0 && !filteredAssignments.some((a) => a.id === selectedAsgId)) {
      setSelectedAsgId(filteredAssignments[0].id);
    } else if (filteredAssignments.length === 0) {
      setSelectedAsgId("");
      setSubmissions([]);
    }
  }, [selectedClassId, filteredAssignments, selectedAsgId]);

  const loadSubmissions = useCallback(async () => {
    if (!selectedAsgId) return;
    setError("");
    try {
      const data = await apiFetch<SubmissionSummary[]>(`/assignments/${selectedAsgId}/submissions`);
      setSubmissions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดคะแนนนักเรียนไม่สำเร็จ");
    }
  }, [selectedAsgId]);

  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  const currentAsg = assignments.find((a) => a.id === selectedAsgId) || null;
  const gradedScores = submissions
    .map((s) => s.submission.final_score)
    .filter((v): v is number => v !== null && v !== undefined);
  const approvedCount = submissions.filter((s) => s.submission.is_approved).length;
  const avgScore =
    gradedScores.length > 0
      ? (gradedScores.reduce((a, b) => a + Number(b), 0) / gradedScores.length).toFixed(2)
      : "-";

  async function handleSyncToGoogle() {
    if (!selectedAsgId) return;
    setSyncing(true);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch<{ synced: number; failed: number }>(`/google/grade-sync/${selectedAsgId}`, {
        method: "POST",
      });
      setMessage(`ส่งคะแนนกลับ Google Classroom เสร็จสิ้น: สำเร็จ ${res.synced} รายการ, ไม่สำเร็จ ${res.failed} รายการ`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ส่งคะแนนกลับ Google Classroom ไม่สำเร็จ");
    } finally {
      setSyncing(false);
    }
  }

  async function handleExportExcel() {
    if (!selectedAsgId) return;
    setExporting(true);
    setError("");
    try {
      await downloadExcelReport("assignment", { assignment_id: selectedAsgId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "ส่งออก Excel ไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1F1B2E]">ผลคะแนนนักเรียน (Gradebook)</h1>
          <p className="text-sm text-[#645D7B]">
            ตรวจสอบคะแนนที่ผ่านการตรวจและอนุมัติแล้ว ส่งคะแนนกลับ Google Classroom หรือส่งออก Excel
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSyncToGoogle}
            disabled={syncing || !currentAsg?.google_coursework_id}
            title={
              currentAsg?.google_coursework_id
                ? "ส่งเฉพาะคะแนนที่ครูอนุมัติแล้วกลับ Google Classroom"
                : "ใบงานนี้ยังไม่ได้เชื่อมกับ Google Classroom Coursework"
            }
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-[#DDD4FF] text-[#7C5CFC] hover:bg-[#F2EEFF] disabled:opacity-50 text-sm font-medium transition"
          >
            <CloudUpload className="w-4 h-4" />
            {syncing ? "กำลังส่งคะแนน..." : "ส่งคะแนนกลับ Classroom"}
          </button>
          <button
            onClick={handleExportExcel}
            disabled={exporting || !selectedAsgId}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FF9F7F] hover:bg-[#F58C69] disabled:opacity-50 text-white text-sm font-medium transition"
          >
            <Download className="w-4 h-4" />
            {exporting ? "กำลังสร้างไฟล์..." : "Export Excel"}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card-soft p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#645D7B]">
          <Filter className="w-4 h-4 text-[#7C5CFC]" /> ตัวกรอง:
        </div>
        <select
          value={selectedClassId}
          onChange={(e) => setSelectedClassId(e.target.value)}
          className="rounded-xl border border-[#DDD4FF] bg-[#FAF8F5] px-3 py-2 text-sm"
        >
          <option value="">ทุกห้องเรียน</option>
          {classrooms.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>

        <select
          value={selectedAsgId}
          onChange={(e) => setSelectedAsgId(e.target.value)}
          className="rounded-xl border border-[#DDD4FF] bg-[#FAF8F5] px-3 py-2 text-sm min-w-60"
        >
          {filteredAssignments.length === 0 ? (
            <option value="">ไม่มีใบงาน</option>
          ) : (
            filteredAssignments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title} (เต็ม {a.max_score})
              </option>
            ))
          )}
        </select>
      </div>

      {message && (
        <div className="rounded-2xl bg-[#ECFDF5] border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-[#FFF1F2] border border-rose-200 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card-soft p-5 flex items-center justify-between">
          <div>
            <div className="text-xs text-[#645D7B]">จำนวนผู้ส่งงาน</div>
            <div className="text-2xl font-bold text-[#1F1B2E]">{submissions.length}</div>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-[#F2EEFF] text-[#7C5CFC] flex items-center justify-center">
            <Award className="w-5 h-5" />
          </div>
        </div>
        <div className="card-soft p-5 flex items-center justify-between">
          <div>
            <div className="text-xs text-[#645D7B]">อนุมัติคะแนนแล้ว</div>
            <div className="text-2xl font-bold text-[#16A34A]">{approvedCount}</div>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-[#ECFDF5] text-[#16A34A] flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>
        <div className="card-soft p-5 flex items-center justify-between">
          <div>
            <div className="text-xs text-[#645D7B]">คะแนนเฉลี่ยใบงานนี้</div>
            <div className="text-2xl font-bold text-[#7C5CFC]">
              {avgScore} {currentAsg ? `/ ${currentAsg.max_score}` : ""}
            </div>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-[#FFF1EB] text-[#E6744C] flex items-center justify-center">
            <Award className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Scores Table */}
      <div className="card-soft overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F2EEFF]/70 text-[#645D7B] text-xs uppercase">
              <tr>
                <th className="px-5 py-3.5">รหัส / ชื่อนักเรียน</th>
                <th className="px-5 py-3.5">รูปแบบที่ส่ง</th>
                <th className="px-5 py-3.5">สถานะ</th>
                <th className="px-5 py-3.5">คะแนนที่ได้</th>
                <th className="px-5 py-3.5">การอนุมัติ</th>
                <th className="px-5 py-3.5 text-right">รายละเอียด</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F2EEFF]">
              {submissions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-[#645D7B]">
                    ยังไม่มีข้อมูลผลคะแนนสำหรับใบงานนี้
                  </td>
                </tr>
              ) : (
                submissions.map((item) => (
                  <tr key={item.submission.id} className="hover:bg-[#FAF8F5]">
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-[#1F1B2E]">{item.student.full_name}</div>
                      <div className="text-xs text-[#645D7B]">
                        {item.student.student_code ? `${item.student.student_code} • ` : ""}
                        {item.student.email}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {item.artifact_types.length > 0 ? (
                          item.artifact_types.map((t) => (
                            <span
                              key={t}
                              className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F2EEFF] text-[#7C5CFC]"
                            >
                              {t}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-[#645D7B]">-</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[#FAF8F5] border border-[#ECE7F6] text-[#1F1B2E]">
                        {item.submission.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 font-bold text-[#1F1B2E]">
                      {item.submission.final_score != null
                        ? `${item.submission.final_score} / ${currentAsg?.max_score ?? 10}`
                        : "-"}
                    </td>
                    <td className="px-5 py-3.5">
                      {item.submission.is_approved ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#ECFDF5] text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" /> อนุมัติแล้ว
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[#FFFBEB] text-amber-700">
                          รอครูอนุมัติ
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link
                        href={`/grading/${item.submission.id}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#F2EEFF] hover:bg-[#E6DFFC] text-[#7C5CFC] text-xs font-semibold"
                      >
                        <Eye className="w-3.5 h-3.5" /> ตรวจสอบ / ปรับคะแนน
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
