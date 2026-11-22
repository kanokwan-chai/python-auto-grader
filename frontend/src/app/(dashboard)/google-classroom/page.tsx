"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Cloud,
  Download,
  ExternalLink,
  FolderDown,
  Link2,
  Play,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { apiFetch } from "@/lib/api";
import type { GoogleConnection } from "@/lib/types";

interface GoogleCourse {
  id: string;
  name: string;
  section?: string;
  enrollmentCode?: string;
  courseState?: string;
}

interface GoogleCoursework {
  id: string;
  title: string;
  description?: string;
  maxPoints?: number;
  state?: string;
}

export default function GoogleClassroomPage() {
  const { activeWorkspace } = useApp();
  const [connections, setConnections] = useState<GoogleConnection[]>([]);
  const [selectedConnId, setSelectedConnId] = useState<string>("");
  const [courses, setCourses] = useState<GoogleCourse[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [coursework, setCoursework] = useState<GoogleCoursework[]>([]);
  const [importedAssignmentId, setImportedAssignmentId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("connected") === "1") {
      const email = qs.get("email") || "";
      setMessage(`เชื่อมต่อบัญชี Google Classroom ${email ? `(${email})` : ""} สำเร็จแล้ว! กด "ดึงรายวิชา" ด้านล่างได้เลย`);
    }
  }, []);

  const loadConnections = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const list = await apiFetch<GoogleConnection[]>("/google/connections");
      setConnections(list);
      const active = list.find((c) => c.status === "connected");
      if (active && !selectedConnId) {
        setSelectedConnId(active.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดรายการบัญชี Google ไม่สำเร็จ");
    }
  }, [activeWorkspace, selectedConnId]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  async function handleConnectOAuth(scopeMode: "read" | "write") {
    setError("");
    setMessage("");
    try {
      const res = await apiFetch<{ authorization_url: string }>(
        `/google/oauth/authorize?scope_mode=${scopeMode}`
      );
      window.location.href = res.authorization_url;
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} — ตรวจสอบการตั้งค่า GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET ใน .env ตามเอกสาร docs/SETUP_GOOGLE_AND_SUPABASE.md`
          : "ไม่สามารถเริ่มต้น Google OAuth ได้"
      );
    }
  }

  async function handleDisconnect(connId: string) {
    setError("");
    try {
      await apiFetch(`/google/connections/${connId}`, { method: "DELETE" });
      setMessage("ยกเลิกการเชื่อมต่อบัญชี Google เรียบร้อยแล้ว");
      if (selectedConnId === connId) {
        setSelectedConnId("");
        setCourses([]);
        setCoursework([]);
      }
      await loadConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ยกเลิกการเชื่อมต่อไม่สำเร็จ");
    }
  }

  async function handleLoadCourses(connId: string) {
    setSelectedConnId(connId);
    setBusy(true);
    setError("");
    setCourses([]);
    setCoursework([]);
    try {
      const res = await apiFetch<{ courses: GoogleCourse[] }>(`/google/connections/${connId}/courses`);
      setCourses(res.courses || []);
      if (!res.courses || res.courses.length === 0) {
        setMessage("ไม่พบรายวิชาที่คุณเป็นครูผู้สอนในบัญชี Google นี้");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "ดึงรายวิชาจาก Google Classroom ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportCourse(courseId: string) {
    if (!selectedConnId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const cls = await apiFetch<{ name: string }>(
        `/google/connections/${selectedConnId}/courses/${courseId}/import`,
        { method: "POST" }
      );
      setMessage(`นำเข้าห้องเรียน "${cls.name}" และรายชื่อนักเรียนเรียบร้อยแล้ว`);
      setSelectedCourseId(courseId);
      const cwRes = await apiFetch<{ coursework: GoogleCoursework[] }>(
        `/google/connections/${selectedConnId}/courses/${courseId}/coursework`
      );
      setCoursework(cwRes.coursework || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "นำเข้าห้องเรียนไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadCoursework(courseId: string) {
    if (!selectedConnId) return;
    setSelectedCourseId(courseId);
    setBusy(true);
    setError("");
    try {
      const cwRes = await apiFetch<{ coursework: GoogleCoursework[] }>(
        `/google/connections/${selectedConnId}/courses/${courseId}/coursework`
      );
      setCoursework(cwRes.coursework || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ดึงงานที่มอบหมายไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function handleImportSubmissions(courseworkId: string) {
    if (!selectedConnId || !selectedCourseId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch<{ assignment_id: string; imported_submissions: number }>(
        `/google/connections/${selectedConnId}/courses/${selectedCourseId}/coursework/${courseworkId}/import-submissions`,
        { method: "POST" }
      );
      setImportedAssignmentId(res.assignment_id);
      setMessage(
        `นำเข้าใบงานและผลงานนักเรียนเรียบร้อยแล้ว (${res.imported_submissions} รายการ — รองรับทั้ง Python, Colab, PDF และ Canva) กรุณากดตั้งเกณฑ์แล้วเริ่มตรวจงานได้เลย`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "นำเข้าผลงานนักเรียนไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1F1B2E]">เชื่อมต่อ Google Classroom (Official API)</h1>
          <p className="text-sm text-[#645D7B]">
            เชื่อมต่อด้วย OAuth 2.0 แยกสิทธิ์อ่านข้อมูลและสิทธิ์ส่งคะแนน ดึงรายวิชา นักเรียน ไฟล์แนบ และ Google Colab
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => handleConnectOAuth("read")}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#7C5CFC] hover:bg-[#6846F5] text-white text-sm font-medium transition"
          >
            <Link2 className="w-4 h-4" /> เชื่อมบัญชี Google (สิทธิ์อ่าน)
          </button>
          <button
            onClick={() => handleConnectOAuth("write")}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-[#DDD4FF] text-[#7C5CFC] hover:bg-[#F2EEFF] text-sm font-medium transition"
          >
            <ShieldCheck className="w-4 h-4" /> เพิ่มสิทธิ์ส่งคะแนนกลับ (Write Scope)
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-2xl bg-[#DDF1E7] border border-[#b7e2cd] px-4 py-3.5 text-sm text-[#246348] space-y-2.5">
          <div>{message}</div>
          {importedAssignmentId && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Link
                href={`/assignments/${importedAssignmentId}/criteria`}
                className="btn-kawaii px-4 py-2 text-xs"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" /> 1. ตั้งเกณฑ์การตรวจ (Rubric / PDF / Canva)
              </Link>
              <Link
                href={`/grading?assignment_id=${importedAssignmentId}`}
                className="btn-kawaii-peach px-4 py-2 text-xs"
              >
                <Play className="w-3.5 h-3.5" /> 2. ไปหน้าตรวจงานตามเกณฑ์
              </Link>
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-[#FFF1F2] border border-rose-200 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {/* Connected Google Accounts */}
      <div className="card-soft p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-[#1F1B2E] flex items-center gap-2">
            <Cloud className="w-5 h-5 text-[#7C5CFC]" /> บัญชี Google ที่เชื่อมต่อใน Workspace นี้
          </h2>
          <span className="text-xs text-[#645D7B]">Token ถูกเข้ารหัสด้วย Fernet (AES-128-CBC + HMAC)</span>
        </div>

        {connections.length === 0 ? (
          <div className="rounded-2xl bg-[#FAF8F5] border border-[#ECE7F6] p-6 text-center space-y-2">
            <p className="text-sm font-medium text-[#1F1B2E]">ยังไม่มีบัญชี Google Classroom ที่เชื่อมต่อ</p>
            <p className="text-xs text-[#645D7B]">
              กดปุ่ม &ldquo;เชื่อมบัญชี Google (สิทธิ์อ่าน)&rdquo; ด้านบนเพื่อเริ่มต้น หรือดูขั้นตอนตั้งค่า OAuth Credentials ใน{" "}
              <code className="px-1.5 py-0.5 rounded bg-white border border-[#ECE7F6]">docs/SETUP_GOOGLE_AND_SUPABASE.md</code>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {connections.map((conn) => (
              <div
                key={conn.id}
                className={`rounded-2xl border p-4 flex items-center justify-between gap-3 ${
                  selectedConnId === conn.id
                    ? "border-[#7C5CFC] bg-[#F2EEFF]/50"
                    : "border-[#ECE7F6] bg-[#FAF8F5]"
                }`}
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-[#1F1B2E] truncate">{conn.google_account_email}</div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        conn.status === "connected"
                          ? "bg-[#ECFDF5] text-emerald-700"
                          : "bg-[#FFF1F2] text-rose-700"
                      }`}
                    >
                      {conn.status}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-white border border-[#DDD4FF] text-[#645D7B]">
                      {conn.has_write_scope ? "Read + Grade Write" : "Read-Only"}
                    </span>
                  </div>
                  {conn.last_error && <p className="text-[11px] text-rose-600 mt-1">{conn.last_error}</p>}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {conn.status === "connected" && (
                    <button
                      onClick={() => handleLoadCourses(conn.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#7C5CFC] hover:bg-[#6846F5] text-white text-xs font-semibold"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busy && selectedConnId === conn.id ? "animate-spin" : ""}`} />
                      ดึงรายวิชา
                    </button>
                  )}
                  <button
                    onClick={() => handleDisconnect(conn.id)}
                    title="ยกเลิกการเชื่อมต่อ"
                    className="p-2 rounded-xl text-rose-500 hover:bg-rose-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Courses & Coursework Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Courses */}
        <div className="card-soft p-6 space-y-4">
          <h2 className="font-bold text-[#1F1B2E] flex items-center gap-2">
            <FolderDown className="w-5 h-5 text-[#7C5CFC]" /> 1. เลือกรายวิชาจาก Google Classroom
          </h2>
          {courses.length === 0 ? (
            <p className="text-xs text-[#645D7B]">เลือกบัญชี Google แล้วกด &ldquo;ดึงรายวิชา&rdquo; เพื่อแสดงห้องเรียน</p>
          ) : (
            <div className="space-y-2.5">
              {courses.map((c) => (
                <div
                  key={c.id}
                  className={`rounded-xl border p-3.5 flex items-center justify-between gap-3 ${
                    selectedCourseId === c.id ? "border-[#7C5CFC] bg-[#F2EEFF]/40" : "border-[#ECE7F6] bg-[#FAF8F5]"
                  }`}
                >
                  <div>
                    <div className="font-semibold text-sm text-[#1F1B2E]">{c.name}</div>
                    <div className="text-xs text-[#645D7B]">
                      {c.section || "ไม่มี Section"} • รหัส {c.enrollmentCode || c.id}
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => handleImportCourse(c.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#7C5CFC] hover:bg-[#6846F5] text-white text-xs font-semibold"
                    >
                      <Download className="w-3.5 h-3.5" /> Import ห้อง + นักเรียน
                    </button>
                    <button
                      onClick={() => handleLoadCoursework(c.id)}
                      disabled={busy}
                      className="px-2.5 py-1.5 rounded-xl bg-white border border-[#DDD4FF] text-[#7C5CFC] text-xs font-semibold hover:bg-[#F2EEFF]"
                    >
                      ดูงาน
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Coursework */}
        <div className="card-soft p-6 space-y-4">
          <h2 className="font-bold text-[#1F1B2E] flex items-center gap-2">
            <ExternalLink className="w-5 h-5 text-[#FF9F7F]" /> 2. นำเข้างานที่มอบหมายและไฟล์ที่นักเรียนส่ง
          </h2>
          {coursework.length === 0 ? (
            <p className="text-xs text-[#645D7B]">
              เลือกห้องเรียนด้านซ้ายเพื่อดูรายการงานที่มอบหมาย (Coursework) และดึงผลงานนักเรียนเข้าสู่ระบบตรวจ
            </p>
          ) : (
            <div className="space-y-2.5">
              {coursework.map((cw) => (
                <div
                  key={cw.id}
                  className="rounded-xl border border-[#ECE7F6] bg-[#FAF8F5] p-3.5 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-semibold text-sm text-[#1F1B2E]">{cw.title}</div>
                    <div className="text-xs text-[#645D7B]">
                      คะแนนเต็ม {cw.maxPoints ?? 10} • สถานะ {cw.state || "PUBLISHED"}
                    </div>
                  </div>
                  <button
                    onClick={() => handleImportSubmissions(cw.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#FF9F7F] hover:bg-[#F58C69] text-white text-xs font-semibold shrink-0"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Import ผลงานนักเรียน
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
