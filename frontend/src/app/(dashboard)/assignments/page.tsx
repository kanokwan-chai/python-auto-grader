"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Copy, FileCode2, Plus, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { apiFetch } from "@/lib/api";
import type { Assignment, Classroom, Student } from "@/lib/types";

export default function AssignmentsPage() {
  const { activeWorkspace } = useApp();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [cloneTarget, setCloneTarget] = useState<{ asg: Assignment; targetClassId: string } | null>(null);
  const [submitModal, setSubmitModal] = useState<Assignment | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState("");
  const [colabUrl, setColabUrl] = useState("");
  const [canvaUrl, setCanvaUrl] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const qs = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      const filterClassId = qs?.get("classroom_id") || "";
      const asgPath = filterClassId ? `/assignments?classroom_id=${encodeURIComponent(filterClassId)}` : "/assignments";
      const [asgs, clss] = await Promise.all([
        apiFetch<Assignment[]>(asgPath),
        apiFetch<Classroom[]>("/classrooms"),
      ]);
      setAssignments(asgs);
      setClassrooms(clss);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดใบงานไม่สำเร็จ");
    }
  }, [activeWorkspace]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleDeleteAssignment(asg: Assignment) {
    if (!window.confirm(`ยืนยันการลบใบงาน "${asg.title}" พร้อมผลตรวจทั้งหมดใช่หรือไม่?`)) return;
    setError("");
    setMessage("");
    try {
      await apiFetch(`/assignments/${asg.id}`, { method: "DELETE" });
      setMessage(`ลบใบงาน "${asg.title}" เรียบร้อยแล้ว`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ลบใบงานไม่สำเร็จ");
    }
  }

  async function handleClone() {
    if (!cloneTarget || !cloneTarget.targetClassId) return;
    setError("");
    try {
      await apiFetch(`/assignments/${cloneTarget.asg.id}/clone`, {
        method: "POST",
        body: JSON.stringify({ target_classroom_id: cloneTarget.targetClassId }),
      });
      setCloneTarget(null);
      setMessage("คัดลอกใบงานไปยังห้องเรียนปลายทางเรียบร้อยแล้ว");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "คัดลอกใบงานไม่สำเร็จ");
    }
  }

  async function openSubmitModal(asg: Assignment) {
    setSubmitModal(asg);
    setColabUrl("");
    setCanvaUrl("");
    setFiles(null);
    setError("");
    try {
      const stus = await apiFetch<Student[]>(`/classrooms/${asg.classroom_id}/students`);
      setStudents(stus);
      setStudentId(stus[0]?.id || "");
    } catch {
      setStudents([]);
    }
  }

  async function handleMixedSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!submitModal || !studentId) return;
    setError("");
    const fd = new FormData();
    fd.append("student_id", studentId);
    if (colabUrl.trim()) fd.append("colab_url", colabUrl.trim());
    if (canvaUrl.trim()) fd.append("canva_url", canvaUrl.trim());
    if (files) {
      Array.from(files).forEach((f) => fd.append("files", f));
    }
    try {
      await apiFetch(`/assignments/${submitModal.id}/submissions`, {
        method: "POST",
        body: fd,
      });
      setSubmitModal(null);
      setMessage("ส่งผลงานเรียบร้อยแล้ว สามารถไปที่เมนู ตรวจงาน เพื่อเริ่มตรวจอัตโนมัติได้ทันที");
    } catch (err) {
      setError(err instanceof Error ? err.message : "ส่งผลงานไม่สำเร็จ");
    }
  }

  const classMap = Object.fromEntries(classrooms.map((c) => [c.id, c]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1F1B2E]">จัดการใบงาน Python</h1>
          <p className="text-sm text-[#645D7B]">
            สร้างใบงาน กำหนดเกณฑ์ Rubric / Test Cases รองรับการส่งงานหลายรูปแบบพร้อมกัน และคัดลอกข้ามห้องเรียน
          </p>
        </div>
        <Link
          href="/assignments/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#7C5CFC] hover:bg-[#6846F5] text-white text-sm font-medium"
        >
          <Plus className="w-4 h-4" /> สร้างใบงานใหม่
        </Link>
      </div>

      {message && (
        <div className="rounded-2xl bg-[#ECFDF5] border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-[#FFF1F2] border border-rose-200 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {assignments.length === 0 ? (
          <div className="card-soft p-8 md:col-span-2 text-center text-sm text-[#645D7B]">
            ยังไม่มีใบงานใน Workspace นี้ กดปุ่ม &ldquo;สร้างใบงานใหม่&rdquo; เพื่อเริ่มต้น
          </div>
        ) : (
          assignments.map((asg) => (
            <div key={asg.id} className="card-soft p-5 flex flex-col justify-between gap-4">
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-[#F2EEFF] text-[#7C5CFC] flex items-center justify-center">
                      <FileCode2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-[#1F1B2E]">{asg.title}</h3>
                      <div className="text-xs text-[#645D7B]">
                        {classMap[asg.classroom_id]?.name || "ห้องเรียน"} • Python {asg.python_version}
                      </div>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-[#F2EEFF] text-[#7C5CFC]">
                    เต็ม {asg.max_score} คะแนน
                  </span>
                </div>
                <p className="text-xs text-[#645D7B] line-clamp-2 mt-2">{asg.problem_statement}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#F2EEFF]">
                <Link
                  href={`/assignments/${asg.id}/criteria`}
                  className="px-3 py-1.5 rounded-full bg-[#E8D9FA] text-[#684A96] text-xs font-semibold hover:bg-[#dcc6f7] inline-flex items-center gap-1"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" /> ตั้งเกณฑ์ตรวจ
                </Link>
                <Link
                  href={`/grading?assignment_id=${asg.id}`}
                  className="px-3 py-1.5 rounded-full bg-[#9870D4] text-white text-xs font-semibold hover:bg-[#684A96]"
                >
                  ไปหน้าตรวจงาน
                </Link>
                <button
                  onClick={() => openSubmitModal(asg)}
                  className="px-3 py-1.5 rounded-xl bg-[#FFF1EB] text-[#E6744C] text-xs font-medium hover:bg-[#FFE4D9] inline-flex items-center gap-1"
                >
                  <Upload className="w-3.5 h-3.5" /> ส่งงาน (Mixed)
                </button>
                <button
                  onClick={() => setCloneTarget({ asg, targetClassId: classrooms[0]?.id || "" })}
                  className="px-3 py-1.5 rounded-full bg-[#F2EEFF] text-[#7C5CFC] text-xs font-medium hover:bg-[#E6DFFC] inline-flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5" /> คัดลอกไปห้องอื่น
                </button>
                <button
                  onClick={() => handleDeleteAssignment(asg)}
                  className="px-3 py-1.5 rounded-full bg-[#F7DCE8]/70 text-[#9D2B5B] text-xs font-medium hover:bg-[#F7DCE8] inline-flex items-center gap-1 ml-auto"
                >
                  <Trash2 className="w-3.5 h-3.5" /> ลบงาน
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Clone Modal */}
      {cloneTarget && (
        <div className="fixed inset-0 z-50 bg-[#1F1B2E]/30 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="card-soft max-w-md w-full p-6 space-y-4">
            <h3 className="font-bold text-lg text-[#1F1B2E]">คัดลอกใบงาน: {cloneTarget.asg.title}</h3>
            <select
              value={cloneTarget.targetClassId}
              onChange={(e) => setCloneTarget({ ...cloneTarget, targetClassId: e.target.value })}
              className="w-full rounded-xl border border-[#DDD4FF] px-3 py-2 text-sm"
            >
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCloneTarget(null)}
                className="px-4 py-2 rounded-xl border border-[#DDD4FF] text-sm"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleClone}
                className="px-4 py-2 rounded-xl bg-[#7C5CFC] text-white text-sm font-medium"
              >
                ยืนยันคัดลอก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mixed Submission Upload Modal */}
      {submitModal && (
        <div className="fixed inset-0 z-50 bg-[#1F1B2E]/30 backdrop-blur-xs flex items-center justify-center p-4">
          <form onSubmit={handleMixedSubmit} className="card-soft max-w-lg w-full p-6 space-y-4">
            <h3 className="font-bold text-lg text-[#1F1B2E]">ส่งผลงานหลายรูปแบบ: {submitModal.title}</h3>
            <div>
              <label className="block text-xs font-medium text-[#645D7B] mb-1">เลือกนักเรียน</label>
              <select
                required
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="w-full rounded-xl border border-[#DDD4FF] px-3 py-2 text-sm"
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name} ({s.email})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#645D7B] mb-1">
                Google Colab URL (ไม่บังคับ — ส่งร่วมกับไฟล์ได้)
              </label>
              <input
                type="url"
                placeholder="https://colab.research.google.com/drive/..."
                value={colabUrl}
                onChange={(e) => setColabUrl(e.target.value)}
                className="w-full rounded-xl border border-[#DDD4FF] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#645D7B] mb-1">
                Canva URL (ไม่บังคับ — ส่งลิงก์งาน Canva ได้)
              </label>
              <input
                type="url"
                placeholder="https://www.canva.com/design/..."
                value={canvaUrl}
                onChange={(e) => setCanvaUrl(e.target.value)}
                className="w-full rounded-xl border border-[#DDD4FF] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#645D7B] mb-1">
                แนบไฟล์ (.ipynb, .py, .zip, .pdf — เลือกได้หลายไฟล์พร้อมกัน)
              </label>
              <input
                type="file"
                multiple
                accept=".py,.ipynb,.zip,.pdf"
                onChange={(e) => setFiles(e.target.files)}
                className="w-full rounded-xl border border-dashed border-[#9870D4] bg-[#F4ECFE]/50 p-3 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSubmitModal(null)}
                className="px-4 py-2 rounded-xl border border-[#DDD4FF] text-sm"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-[#7C5CFC] text-white text-sm font-medium hover:bg-[#6846F5]"
              >
                อัปโหลดผลงาน
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
