"use client";

import React, { useEffect, useState } from "react";
import { BarChart3, Download, FileSpreadsheet, Filter } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { apiFetch, downloadExcelReport } from "@/lib/api";
import type { Assignment, Classroom, DashboardStats, Student } from "@/lib/types";

const REPORT_TYPES = [
  {
    key: "classroom",
    title: "รายงานคะแนนรายห้องเรียน",
    desc: "สรุปผลคะแนนของนักเรียนทั้งหมดในห้องเรียนที่เลือก พร้อมสถานะการอนุมัติ",
    badge: "Classroom",
  },
  {
    key: "course",
    title: "รายงานคะแนนรายวิชา",
    desc: "รวบรวมคะแนนแยกตามรายวิชาและห้องเรียนทั้งหมดใน Workspace",
    badge: "Course",
  },
  {
    key: "assignment",
    title: "รายงานคะแนนรายใบงาน",
    desc: "แสดงคะแนนรายคนสำหรับใบงานที่เลือก พร้อมเวลาที่ส่งและผลการตรวจ",
    badge: "Assignment",
  },
  {
    key: "student",
    title: "รายงานคะแนนรายบุคคล",
    desc: "ติดตามประวัติคะแนนทุกใบงานของนักเรียนแต่ละคน",
    badge: "Student",
  },
  {
    key: "submission_status",
    title: "รายงานสถานะการส่งงาน",
    desc: "ตรวจสอบนักเรียนที่ส่งแล้ว ยังไม่ส่ง รอตรวจ และตรวจเสร็จแล้ว",
    badge: "Status",
  },
  {
    key: "rubric_breakdown",
    title: "รายงานรายละเอียดคะแนนแต่ละเกณฑ์",
    desc: "ส่งออกตารางคะแนนแยกตามเกณฑ์ Rubric (AST / Runtime / Test Case / AI) พร้อมเหตุผล",
    badge: "Rubric Detail",
  },
];

export default function ReportsPage() {
  const { activeWorkspace } = useApp();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  const [classroomId, setClassroomId] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!activeWorkspace) return;
    Promise.all([
      apiFetch<DashboardStats>("/reports/dashboard"),
      apiFetch<Classroom[]>("/classrooms"),
      apiFetch<Assignment[]>("/assignments"),
    ])
      .then(([st, clss, asgs]) => {
        setStats(st);
        setClassrooms(clss);
        setAssignments(asgs);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดข้อมูลรายงานไม่สำเร็จ"));
  }, [activeWorkspace]);

  useEffect(() => {
    if (!classroomId) {
      setStudents([]);
      setStudentId("");
      return;
    }
    apiFetch<Student[]>(`/classrooms/${classroomId}/students`)
      .then(setStudents)
      .catch(() => setStudents([]));
  }, [classroomId]);

  async function handleDownload(reportKey: string) {
    setDownloadingKey(reportKey);
    setError("");
    try {
      const params: Record<string, string> = {};
      if (classroomId) params.classroom_id = classroomId;
      if (assignmentId) params.assignment_id = assignmentId;
      if (studentId) params.student_id = studentId;
      await downloadExcelReport(reportKey, params);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ดาวน์โหลดไฟล์ Excel ไม่สำเร็จ");
    } finally {
      setDownloadingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1B2E]">รายงานและส่งออก Excel</h1>
        <p className="text-sm text-[#645D7B]">
          ดูสถิติภาพรวมการตรวจงาน และดาวน์โหลดรายงานไฟล์ Excel (.xlsx) ครบทั้ง 6 ประเภท
        </p>
      </div>

      {error && (
        <div className="rounded-2xl bg-[#FFF1F2] border border-rose-200 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {/* Analytics Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-soft p-5">
          <div className="text-xs text-[#645D7B] mb-1">คะแนนเฉลี่ยรวม</div>
          <div className="text-2xl font-bold text-[#7C5CFC]">{stats?.average_score ?? "-"}</div>
        </div>
        <div className="card-soft p-5">
          <div className="text-xs text-[#645D7B] mb-1">คะแนนสูงสุด / ต่ำสุด</div>
          <div className="text-2xl font-bold text-[#1F1B2E]">
            {stats?.max_score_achieved ?? "-"} / {stats?.min_score_achieved ?? "-"}
          </div>
        </div>
        <div className="card-soft p-5">
          <div className="text-xs text-[#645D7B] mb-1">อัตราการผ่านเกณฑ์ (≥50%)</div>
          <div className="text-2xl font-bold text-[#16A34A]">
            {stats?.pass_rate_percent != null ? `${stats.pass_rate_percent}%` : "-"}
          </div>
        </div>
        <div className="card-soft p-5">
          <div className="text-xs text-[#645D7B] mb-1">ตรวจเสร็จ / ส่งทั้งหมด</div>
          <div className="text-2xl font-bold text-[#E6744C]">
            {stats?.graded_count ?? 0} / {stats?.submitted_count ?? 0}
          </div>
        </div>
      </div>

      {/* Filters for Export */}
      <div className="card-soft p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-[#1F1B2E]">
          <Filter className="w-4 h-4 text-[#7C5CFC]" /> ตัวกรองข้อมูลก่อนส่งออก Excel (ไม่บังคับ)
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-[#645D7B] mb-1">ห้องเรียน</label>
            <select
              value={classroomId}
              onChange={(e) => setClassroomId(e.target.value)}
              className="w-full rounded-xl border border-[#DDD4FF] bg-[#FAF8F5] px-3 py-2 text-sm"
            >
              <option value="">ทุกห้องเรียน</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[#645D7B] mb-1">ใบงาน</label>
            <select
              value={assignmentId}
              onChange={(e) => setAssignmentId(e.target.value)}
              className="w-full rounded-xl border border-[#DDD4FF] bg-[#FAF8F5] px-3 py-2 text-sm"
            >
              <option value="">ทุกใบงาน</option>
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[#645D7B] mb-1">นักเรียน (เลือกห้องเรียนก่อน)</label>
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              disabled={!classroomId}
              className="w-full rounded-xl border border-[#DDD4FF] bg-[#FAF8F5] px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="">นักเรียนทุกคน</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name} ({s.student_code || s.email})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 6 Excel Export Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORT_TYPES.map((rep) => (
          <div key={rep.key} className="card-soft p-5 flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 rounded-2xl bg-[#F2EEFF] text-[#7C5CFC] flex items-center justify-center">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#FFF1EB] text-[#E6744C]">
                  {rep.badge}
                </span>
              </div>
              <h3 className="font-bold text-[#1F1B2E] text-base mb-1">{rep.title}</h3>
              <p className="text-xs text-[#645D7B] leading-relaxed">{rep.desc}</p>
            </div>
            <button
              onClick={() => handleDownload(rep.key)}
              disabled={downloadingKey === rep.key}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-[#7C5CFC] hover:bg-[#6846F5] disabled:opacity-60 text-white text-xs font-semibold transition"
            >
              <Download className="w-4 h-4" />
              {downloadingKey === rep.key ? "กำลังสร้างไฟล์ .xlsx..." : "ดาวน์โหลด Excel (.xlsx)"}
            </button>
          </div>
        ))}
      </div>

      <div className="card-soft p-4 flex items-center gap-3 text-xs text-[#645D7B]">
        <BarChart3 className="w-4 h-4 text-[#7C5CFC] shrink-0" />
        <span>
          ไฟล์ Excel ที่ส่งออกประกอบด้วยชีตสรุปคะแนนหลัก (Score Summary) และชีตรายละเอียดคะแนนแยกตามเกณฑ์ (Rubric Breakdown)
          โดยอัตโนมัติ
        </span>
      </div>
    </div>
  );
}
