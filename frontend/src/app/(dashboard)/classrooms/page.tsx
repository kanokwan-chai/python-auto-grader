"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Plus, School, UserPlus, Users } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { apiFetch } from "@/lib/api";
import type { Classroom, Student } from "@/lib/types";

export default function ClassroomsPage() {
  const { activeWorkspace } = useApp();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedClassroom, setSelectedClassroom] = useState<Classroom | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  // Create Classroom Form
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [major, setMajor] = useState("");
  const [academicYear, setAcademicYear] = useState("2569");
  const [semester, setSemester] = useState("1");

  // Add Student Form
  const [stuName, setStuName] = useState("");
  const [stuEmail, setStuEmail] = useState("");
  const [stuCode, setStuCode] = useState("");

  const loadClassrooms = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const data = await apiFetch<Classroom[]>("/classrooms");
      setClassrooms(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลห้องเรียนไม่สำเร็จ");
    }
  }, [activeWorkspace]);

  useEffect(() => {
    loadClassrooms();
  }, [loadClassrooms]);

  async function loadStudents(cls: Classroom) {
    setSelectedClassroom(cls);
    try {
      const data = await apiFetch<Student[]>(`/classrooms/${cls.id}/students`);
      setStudents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดรายชื่อนักเรียนไม่สำเร็จ");
    }
  }

  async function handleCreateClassroom(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await apiFetch("/classrooms", {
        method: "POST",
        body: JSON.stringify({
          name,
          code,
          subject_name: subjectName,
          grade_level: gradeLevel || null,
          major: major || null,
          academic_year: academicYear || null,
          semester: semester || null,
        }),
      });
      setName("");
      setCode("");
      setSubjectName("");
      setShowForm(false);
      await loadClassrooms();
    } catch (err) {
      setError(err instanceof Error ? err.message : "สร้างห้องเรียนไม่สำเร็จ");
    }
  }

  async function handleEnrollStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedClassroom) return;
    setError("");
    try {
      await apiFetch(`/classrooms/${selectedClassroom.id}/students`, {
        method: "POST",
        body: JSON.stringify({ full_name: stuName, email: stuEmail, student_code: stuCode || null }),
      });
      setStuName("");
      setStuEmail("");
      setStuCode("");
      await loadStudents(selectedClassroom);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เพิ่มนักเรียนไม่สำเร็จ");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1F1B2E]">ห้องเรียนของฉัน</h1>
          <p className="text-sm text-[#645D7B]">สร้างห้องเรียน จัดการรายชื่อนักเรียน หรือ Import จาก Google Classroom</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#7C5CFC] hover:bg-[#6846F5] text-white text-sm font-medium transition"
        >
          <Plus className="w-4 h-4" /> สร้างห้องเรียนใหม่
        </button>
      </div>

      {error && (
        <div className="rounded-2xl bg-[#FFF1F2] border border-rose-200 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {showForm && (
        <form onSubmit={handleCreateClassroom} className="card-soft p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            required
            placeholder="ชื่อห้องเรียน เช่น ม.4/1 Python"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-xl border border-[#DDD4FF] px-3.5 py-2 text-sm"
          />
          <input
            required
            placeholder="รหัสห้องเรียน เช่น PY-401"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="rounded-xl border border-[#DDD4FF] px-3.5 py-2 text-sm"
          />
          <input
            required
            placeholder="รายวิชาที่สอน เช่น วิทยาการคำนวณ"
            value={subjectName}
            onChange={(e) => setSubjectName(e.target.value)}
            className="rounded-xl border border-[#DDD4FF] px-3.5 py-2 text-sm"
          />
          <input
            placeholder="ระดับชั้น เช่น ม.4 / ปวช.1"
            value={gradeLevel}
            onChange={(e) => setGradeLevel(e.target.value)}
            className="rounded-xl border border-[#DDD4FF] px-3.5 py-2 text-sm"
          />
          <input
            placeholder="สาขาวิชา เช่น เทคโนโลยีสารสนเทศ"
            value={major}
            onChange={(e) => setMajor(e.target.value)}
            className="rounded-xl border border-[#DDD4FF] px-3.5 py-2 text-sm"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="ปีการศึกษา"
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              className="rounded-xl border border-[#DDD4FF] px-3 py-2 text-sm"
            />
            <input
              placeholder="ภาคเรียน"
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              className="rounded-xl border border-[#DDD4FF] px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-xl border border-[#DDD4FF] text-sm text-[#645D7B]"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-[#7C5CFC] text-white text-sm font-medium hover:bg-[#6846F5]"
            >
              บันทึกห้องเรียน
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          {classrooms.length === 0 ? (
            <div className="card-soft p-8 md:col-span-2 text-center text-sm text-[#645D7B]">
              ยังไม่มีห้องเรียนใน Workspace นี้ กรุณาสร้างห้องเรียนใหม่หรือ Import จาก Google Classroom
            </div>
          ) : (
            classrooms.map((cls) => (
              <div
                key={cls.id}
                onClick={() => loadStudents(cls)}
                className={`card-soft p-5 cursor-pointer transition hover:border-[#7C5CFC] ${
                  selectedClassroom?.id === cls.id ? "ring-2 ring-[#7C5CFC]/40" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="w-10 h-10 rounded-2xl bg-[#F2EEFF] text-[#7C5CFC] flex items-center justify-center">
                    <School className="w-5 h-5" />
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-[#FFF1EB] text-[#E6744C]">
                    {cls.code}
                  </span>
                </div>
                <h3 className="font-bold text-[#1F1B2E] text-base">{cls.name}</h3>
                <p className="text-xs text-[#645D7B] mt-0.5">{cls.subject_name}</p>
                <div className="mt-4 pt-3 border-t border-[#F2EEFF] flex items-center justify-between text-xs text-[#645D7B]">
                  <span>
                    {cls.grade_level || "-"} • ปี {cls.academic_year || "-"}/{cls.semester || "-"}
                  </span>
                  <span className="text-[#7C5CFC] font-medium">ดูรายชื่อ →</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Student Roster Panel */}
        <div className="card-soft p-5 flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-[#7C5CFC]" />
            <h2 className="font-bold text-[#1F1B2E]">
              {selectedClassroom ? `รายชื่อนักเรียน: ${selectedClassroom.name}` : "เลือกห้องเรียนเพื่อดูรายชื่อ"}
            </h2>
          </div>

          {selectedClassroom && (
            <>
              <form onSubmit={handleEnrollStudent} className="space-y-2 mb-4 pb-4 border-b border-[#F2EEFF]">
                <input
                  required
                  placeholder="ชื่อ-นามสกุลนักเรียน"
                  value={stuName}
                  onChange={(e) => setStuName(e.target.value)}
                  className="w-full rounded-xl border border-[#DDD4FF] px-3 py-2 text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    required
                    type="email"
                    placeholder="อีเมลนักเรียน"
                    value={stuEmail}
                    onChange={(e) => setStuEmail(e.target.value)}
                    className="rounded-xl border border-[#DDD4FF] px-3 py-2 text-xs"
                  />
                  <input
                    placeholder="รหัสนักเรียน"
                    value={stuCode}
                    onChange={(e) => setStuCode(e.target.value)}
                    className="rounded-xl border border-[#DDD4FF] px-3 py-2 text-xs"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2 rounded-xl bg-[#F2EEFF] hover:bg-[#E6DFFC] text-[#7C5CFC] text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <UserPlus className="w-3.5 h-3.5" /> เพิ่มนักเรียนเข้าห้องเรียน
                </button>
              </form>

              <div className="space-y-2 overflow-y-auto max-h-96">
                {students.length === 0 ? (
                  <p className="text-xs text-[#645D7B] text-center py-4">ยังไม่มีนักเรียนในห้องนี้</p>
                ) : (
                  students.map((s) => (
                    <div key={s.id} className="rounded-xl bg-[#FAF8F5] px-3 py-2.5 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-[#1F1B2E]">{s.full_name}</div>
                        <div className="text-xs text-[#645D7B]">{s.email}</div>
                      </div>
                      {s.student_code && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-[#ECE7F6] text-[#645D7B]">
                          {s.student_code}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
