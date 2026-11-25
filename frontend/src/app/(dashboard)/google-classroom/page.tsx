"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Cloud,
  Download,
  Eye,
  FileCode2,
  FileText,
  Link2,
  Play,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import PdfAnswerKeyBuilder, { type PdfAnswerKeyItem } from "@/components/grading/PdfAnswerKeyBuilder";
import { apiFetch, downloadExcelReport } from "@/lib/api";
import type { GoogleConnection, SubmissionSummary } from "@/lib/types";

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

const STEPS = [
  { num: 1, label: "1. บัญชี Google" },
  { num: 2, label: "2. เลือก Classroom" },
  { num: 3, label: "3. เลือกงาน" },
  { num: 4, label: "4. ตรวจไฟล์ส่ง (เลือกไฟล์)" },
  { num: 5, label: "5. เลือกเกณฑ์" },
  { num: 6, label: "6. เริ่มตรวจงาน" },
  { num: 7, label: "7. ผลการตรวจ" },
];

export default function GoogleClassroomWizardPage() {
  const { activeWorkspace } = useApp();
  const [step, setStep] = useState<number>(1);
  const [connections, setConnections] = useState<GoogleConnection[]>([]);
  const [selectedConnId, setSelectedConnId] = useState<string>("");
  const [courses, setCourses] = useState<GoogleCourse[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<GoogleCourse | null>(null);
  const [coursework, setCoursework] = useState<GoogleCoursework[]>([]);
  const [selectedCw, setSelectedCw] = useState<GoogleCoursework | null>(null);
  const [assignmentId, setAssignmentId] = useState<string>("");
  const [submissions, setSubmissions] = useState<SubmissionSummary[]>([]);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<Record<string, boolean>>({});
  const [presetMode, setPresetMode] = useState<"python_run" | "pdf_canva" | "pdf_answer_key" | "custom">("python_run");
  const [pdfAnswerKey, setPdfAnswerKey] = useState<PdfAnswerKeyItem[]>([
    { question: "1", expected: ["ก"], match_mode: "exact_choice", points: 1 },
    { question: "2", expected: ["ข"], match_mode: "exact_choice", points: 1 },
  ]);
  const [maxScore, setMaxScore] = useState<number>(10);

  const [busy, setBusy] = useState(false);
  const [gradeProgress, setGradeProgress] = useState<{ done: number; total: number } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const cacheKey = activeWorkspace ? `pygrader_wizard_${activeWorkspace.id}` : "";

  // Hydrate wizard state from localStorage immediately
  useEffect(() => {
    if (!cacheKey || typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.step) setStep(s.step);
        if (s.selectedConnId) setSelectedConnId(s.selectedConnId);
        if (Array.isArray(s.courses)) setCourses(s.courses);
        if (s.selectedCourse) setSelectedCourse(s.selectedCourse);
        if (Array.isArray(s.coursework)) setCoursework(s.coursework);
        if (s.selectedCw) setSelectedCw(s.selectedCw);
        if (s.assignmentId) setAssignmentId(s.assignmentId);
      }
    } catch {
      // ignore
    }
  }, [cacheKey]);

  // Save wizard state automatically
  useEffect(() => {
    if (!cacheKey || typeof window === "undefined") return;
    try {
      localStorage.setItem(
        cacheKey,
        JSON.stringify({ step, selectedConnId, courses, selectedCourse, coursework, selectedCw, assignmentId })
      );
    } catch {
      // ignore
    }
  }, [cacheKey, step, selectedConnId, courses, selectedCourse, coursework, selectedCw, assignmentId]);

  const loadConnections = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const list = await apiFetch<GoogleConnection[]>("/google/connections");
      setConnections(list);
      const active = list.find((c) => c.status === "connected");
      if (active && !selectedConnId) setSelectedConnId(active.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดรายการบัญชี Google ไม่สำเร็จ");
    }
  }, [activeWorkspace, selectedConnId]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("connected") === "1") {
      setMessage(`เชื่อมต่อบัญชี Google (${qs.get("email") || ""}) สำเร็จแล้ว!`);
      setStep(1);
    }
  }, []);

  const loadSubmissions = useCallback(async (asgId: string) => {
    if (!asgId) return;
    const list = await apiFetch<SubmissionSummary[]>(`/assignments/${asgId}/submissions`);
    setSubmissions(list);
    // Default: select all artifacts
    const nextSel: Record<string, boolean> = {};
    list.forEach((s) => {
      (s.artifacts || []).forEach((a) => {
        nextSel[a.id] = true;
      });
    });
    setSelectedArtifactIds(nextSel);
  }, []);

  useEffect(() => {
    if (assignmentId && (step === 4 || step === 6 || step === 7) && submissions.length === 0) {
      loadSubmissions(assignmentId).catch(() => {});
    }
  }, [assignmentId, step, submissions.length, loadSubmissions]);

  async function handleConnectOAuth(scopeMode: "read" | "write") {
    setError("");
    try {
      const res = await apiFetch<{ authorization_url: string }>(`/google/oauth/authorize?scope_mode=${scopeMode}`);
      window.location.href = res.authorization_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "ไม่สามารถเริ่ม Google OAuth ได้");
    }
  }

  async function handleDisconnect(connId: string) {
    setError("");
    await apiFetch(`/google/connections/${connId}`, { method: "DELETE" });
    setSelectedConnId("");
    setCourses([]);
    setCoursework([]);
    await loadConnections();
  }

  async function handleSelectAccount(connId: string) {
    setSelectedConnId(connId);
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch<{ courses: GoogleCourse[] }>(`/google/connections/${connId}/courses`);
      setCourses(res.courses || []);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ดึงรายวิชาไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectCourse(course: GoogleCourse) {
    setSelectedCourse(course);
    setSelectedCw(null);
    setAssignmentId("");
    setSubmissions([]);
    setSelectedArtifactIds({});
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiFetch(`/google/connections/${selectedConnId}/courses/${course.id}/import`, { method: "POST" });
      const cwRes = await apiFetch<{ coursework: GoogleCoursework[] }>(
        `/google/connections/${selectedConnId}/courses/${course.id}/coursework`
      );
      setCoursework(cwRes.coursework || []);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "นำเข้าห้องเรียนและดึงรายการงานไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function handleSelectCoursework(cw: GoogleCoursework) {
    if (!selectedCourse) return;
    setSelectedCw(cw);
    setMaxScore(Number(cw.maxPoints || 10));
    setSubmissions([]);
    setSelectedArtifactIds({});
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await apiFetch<{ assignment_id: string; imported_submissions: number }>(
        `/google/connections/${selectedConnId}/courses/${selectedCourse.id}/coursework/${cw.id}/import-submissions`,
        { method: "POST" }
      );
      setAssignmentId(res.assignment_id);
      await loadSubmissions(res.assignment_id);
      setMessage(`ดึงงาน "${cw.title}" สำเร็จทั้งหมด ${res.imported_submissions} คน! เลือกไฟล์ที่ต้องการตรวจด้านล่างได้เลย`);
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ดึงผลงานนักเรียนไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  function filterArtifactsByType(types: string[] | "all") {
    const nextSel: Record<string, boolean> = {};
    submissions.forEach((s) => {
      (s.artifacts || []).forEach((a) => {
        nextSel[a.id] = types === "all" ? true : types.includes(a.artifact_type);
      });
    });
    setSelectedArtifactIds(nextSel);
  }

  function selectNthArtifactPerStudent(index: number) {
    const nextSel: Record<string, boolean> = {};
    submissions.forEach((s) => {
      const arts = s.artifacts || [];
      arts.forEach((a, idx) => {
        nextSel[a.id] = idx === index;
      });
    });
    setSelectedArtifactIds(nextSel);
  }

  async function handleApplyPresetAndNext() {
    if (!assignmentId) return;
    setBusy(true);
    setError("");
    try {
      if (presetMode === "python_run") {
        const runPts = Math.round(maxScore * 0.6 * 2) / 2;
        const astPts = Math.max(1, Math.round((maxScore - runPts) * 2) / 2);
        await apiFetch(`/assignments/${assignmentId}/rubric`, {
          method: "PUT",
          body: JSON.stringify([
            {
              order_index: 0,
              name: "โครงสร้างโค้ด Python ถูกต้อง (ไม่มี Syntax Error)",
              max_score: astPts,
              check_method: "ast",
              rule_config: {},
              allow_partial_credit: true,
            },
            {
              order_index: 1,
              name: "โปรแกรมสามารถรันทำงานได้จริง ไม่มี Runtime Error",
              max_score: runPts,
              check_method: "runtime",
              rule_config: {},
              allow_partial_credit: false,
            },
          ]),
        });
      } else if (presetMode === "pdf_canva") {
        const half = Math.max(1, Math.round((maxScore / 2) * 2) / 2);
        await apiFetch(`/assignments/${assignmentId}/rubric`, {
          method: "PUT",
          body: JSON.stringify([
            {
              order_index: 0,
              name: "ส่งไฟล์ PDF / ลิงก์ Canva ครบถ้วนและเปิดอ่านได้",
              max_score: half,
              check_method: "document",
              rule_config: { min_pages: 1 },
              allow_partial_credit: true,
            },
            {
              order_index: 1,
              name: "เนื้อหาครบถ้วนตามจำนวนคำขั้นต่ำ",
              max_score: Math.max(1, maxScore - half),
              check_method: "document",
              rule_config: { min_words: 15 },
              allow_partial_credit: true,
            },
          ]),
        });
      } else if (presetMode === "pdf_answer_key") {
        const cleanedKey = pdfAnswerKey
          .map((item) => ({
            ...item,
            expected: (item.expected || []).map((s) => s.trim()).filter(Boolean),
            model_answer: (item.model_answer || "").trim(),
          }))
          .filter((item) => item.expected.length > 0 || (item.match_mode === "open_ended" && item.model_answer));
        if (cleanedKey.length === 0) {
          setError("กรุณากรอกเฉลยหรืออัปโหลดไฟล์เฉลยอย่างน้อย 1 ข้อก่อนไปขั้นต่อไป");
          setBusy(false);
          return;
        }
        await apiFetch(`/assignments/${assignmentId}/rubric`, {
          method: "PUT",
          body: JSON.stringify([
            {
              order_index: 0,
              name: `ตรวจเอกสาร PDF ตามเฉลย (${cleanedKey.length} ข้อ)`,
              description: "อ่านข้อความจากไฟล์ PDF ของนักเรียนและตรวจให้คะแนนตามข้อที่ตอบถูกต้อง",
              max_score: maxScore,
              check_method: "document",
              rule_config: { answer_key: cleanedKey },
              allow_partial_credit: true,
            },
          ]),
        });
      }
      setStep(6);
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกเกณฑ์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function handleStartBatchGrading() {
    if (!assignmentId) return;
    setBusy(true);
    setError("");
    setMessage("");
    const chosenIds = Object.entries(selectedArtifactIds)
      .filter(([, checked]) => checked)
      .map(([id]) => id);
    const chosenSet = new Set(chosenIds);
    const targets = submissions.filter((s) => {
      if (s.submission.status === "not_submitted") return false;
      if (chosenIds.length > 0 && s.artifacts && s.artifacts.length > 0) {
        return s.artifacts.some((a) => chosenSet.has(a.id));
      }
      return true;
    });

    if (targets.length === 0) {
      setError("ไม่พบนักเรียนที่ส่งงานตามไฟล์ที่เลือก");
      setBusy(false);
      return;
    }

    setGradeProgress({ done: 0, total: targets.length });
    let gradedOk = 0;
    let failedCnt = 0;

    try {
      for (let i = 0; i < targets.length; i += 1) {
        const stuSub = targets[i];
        const chunkArtIds = (stuSub.artifacts || [])
          .filter((a) => chosenSet.has(a.id))
          .map((a) => a.id);
        try {
          const res = await apiFetch<{ queued_count: number }>(`/grading/assignments/${assignmentId}/run-batch`, {
            method: "POST",
            body: JSON.stringify({
              submission_ids: [stuSub.submission.id],
              selected_artifact_ids: chunkArtIds.length > 0 ? chunkArtIds : null,
              run_sync_inline: true,
            }),
          });
          gradedOk += res.queued_count;
        } catch {
          failedCnt += 1;
        }
        setGradeProgress({ done: i + 1, total: targets.length });
      }
      await loadSubmissions(assignmentId);
      setMessage(
        `ตรวจงานเสร็จสิ้น ${gradedOk} คน${failedCnt > 0 ? ` (ข้าม/ผิดพลาด ${failedCnt} คน)` : ""} พร้อมผล % การใช้ AI เรียบร้อยแล้ว!`
      );
      setStep(7);
    } catch (err) {
      setError(err instanceof Error ? err.message : "เริ่มตรวจงานไม่สำเร็จ");
    } finally {
      setBusy(false);
      setGradeProgress(null);
    }
  }

  const chosenCount = Object.values(selectedArtifactIds).filter(Boolean).length;

  return (
    <div className="space-y-5">
      {/* Top 7-Step Wizard Pill Bar */}
      <div className="card-soft p-3 overflow-x-auto">
        <div className="flex items-center gap-2 min-w-max">
          {STEPS.map((st) => {
            const active = step === st.num;
            const done = step > st.num;
            return (
              <button
                key={st.num}
                type="button"
                onClick={() => setStep(st.num)}
                className={`px-4 py-2 rounded-full text-xs font-semibold transition ${active
                  ? "bg-gradient-to-r from-[#B895E8] to-[#9870D4] text-white shadow-sm"
                  : done
                    ? "bg-[#E8D9FA]/70 text-[#684A96]"
                    : "bg-[#FFFAF5] text-[#7C6B99] hover:bg-[#F4ECFE]"
                  }`}
              >
                {st.label}
              </button>
            );
          })}
        </div>
      </div>

      {message && (
        <div className="rounded-2xl bg-[#DDF1E7] border border-[#b7e2cd] px-4 py-3 text-sm text-[#246348]">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-[#F7DCE8]/75 border border-[#F8E1EE] px-4 py-3 text-sm text-[#9D2B5B]">
          {error}
        </div>
      )}

      {/* STEP 1: Google Account */}
      {step === 1 && (
        <div className="card-soft p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl font-semibold text-[#684A96]">ขั้นที่ 1: เลือกบัญชี Google</h2>
              <p className="text-xs text-[#7C6B99]">เชื่อมต่อบัญชีครูเพื่อดึงห้องเรียนและไฟล์งานทั้งหมดของนักเรียน</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => handleConnectOAuth("read")} className="btn-kawaii px-4 py-2 text-xs">
                <Link2 className="w-3.5 h-3.5" /> เชื่อมบัญชี Google (สิทธิ์อ่าน)
              </button>
              <button onClick={() => handleConnectOAuth("write")} className="btn-kawaii-soft px-4 py-2 text-xs">
                <ShieldCheck className="w-3.5 h-3.5" /> เพิ่มสิทธิ์ส่งคะแนนกลับ
              </button>
            </div>
          </div>

          {connections.filter((c) => c.status === "connected").length === 0 ? (
            <div className="rounded-3xl border-2 border-dashed border-[#E8D9FA] bg-[#FFFAF5] p-10 text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-[#E8D9FA] text-[#684A96] flex items-center justify-center">
                <Cloud className="w-6 h-6" />
              </div>
              <div className="font-semibold text-[#684A96]">ยังไม่มีบัญชี Google ที่เชื่อมต่อ</div>
              <p className="text-xs text-[#7C6B99]">กดปุ่มด้านล่างเพื่อล็อกอินเลือกบัญชี Google Classroom ของคุณ</p>
              <button onClick={() => handleConnectOAuth("read")} className="btn-kawaii px-5 py-2.5 text-xs">
                เชื่อมบัญชี Google Classroom
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {connections
                .filter((c) => c.status === "connected")
                .map((conn) => (
                  <div
                    key={conn.id}
                    className="rounded-2xl border border-[#E8D9FA] bg-[#FFFAF5] p-4 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-[#4A3869] truncate">{conn.google_account_email}</div>
                      <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#DDF1E7] text-[#2E7D5B]">
                        {conn.has_write_scope ? "Read + ส่งคะแนนกลับได้" : "Connected (Read-Only)"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleSelectAccount(conn.id)}
                        disabled={busy}
                        className="btn-kawaii px-4 py-2 text-xs"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> เลือกบัญชีนี้ →
                      </button>
                      <button
                        onClick={() => handleDisconnect(conn.id)}
                        className="p-2 rounded-full text-rose-500 hover:bg-rose-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* STEP 2: Choose Classroom */}
      {step === 2 && (
        <div className="card-soft p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-xl font-semibold text-[#684A96]">ขั้นที่ 2: เลือกห้องเรียน (Classroom)</h2>
            <button onClick={() => selectedConnId && handleSelectAccount(selectedConnId)} className="btn-kawaii-soft px-3 py-1.5 text-xs">
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> โหลดรายวิชาใหม่
            </button>
          </div>
          {courses.length === 0 ? (
            <p className="text-sm text-[#7C6B99]">ไม่พบรายวิชา กรุณากลับไปขั้นที่ 1 แล้วเลือกบัญชี Google</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {courses.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleSelectCourse(c)}
                  disabled={busy}
                  className="text-left rounded-2xl border border-[#E8D9FA] bg-[#FFFAF5] hover:bg-[#F4ECFE] hover:border-[#B895E8] p-4 transition flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-semibold text-sm text-[#4A3869]">{c.name}</div>
                    <div className="text-xs text-[#7C6B99]">{c.section || "ไม่มี Section"}</div>
                  </div>
                  <span className="text-xs font-semibold text-[#9870D4] shrink-0">
                    {busy && selectedCourse?.id === c.id ? "กำลังดึง..." : "เลือกห้อง →"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* STEP 3: Choose Assignment */}
      {step === 3 && (
        <div className="card-soft p-6 space-y-4">
          <h2 className="font-heading text-xl font-semibold text-[#684A96]">
            ขั้นที่ 3: เลือกงานที่ต้องการตรวจ ({selectedCourse?.name})
          </h2>
          {coursework.length === 0 ? (
            <p className="text-sm text-[#7C6B99]">ไม่พบรายการงานในห้องเรียนนี้</p>
          ) : (
            <div className="space-y-2.5">
              {coursework.map((cw) => (
                <div
                  key={cw.id}
                  className="rounded-2xl border border-[#E8D9FA] bg-[#FFFAF5] p-4 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-semibold text-sm text-[#4A3869]">{cw.title}</div>
                    <div className="text-xs text-[#7C6B99]">คะแนนเต็ม {cw.maxPoints ?? 10}</div>
                  </div>
                  <button
                    onClick={() => handleSelectCoursework(cw)}
                    disabled={busy}
                    className="btn-kawaii px-4 py-2 text-xs shrink-0"
                  >
                    {busy && selectedCw?.id === cw.id ? "กำลังดึงงานเด็กทั้งหมด..." : "ดึงงานนักเรียนทั้งหมด →"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* STEP 4: Inspect & Select Files (supports 2+ files in 1 assignment!) */}
      {step === 4 && (
        <div className="card-soft p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl font-semibold text-[#684A96]">
                ขั้นที่ 4: ตรวจไฟล์ส่ง & เลือกไฟล์ที่จะตรวจ ({submissions.length} คน)
              </h2>
              <p className="text-xs text-[#7C6B99]">
                กรณีนักเรียนส่งหลายไฟล์ในงานเดียว (เช่น ส่ง 2 งานในใบงานเดียว) สามารถติ๊กเลือกเฉพาะไฟล์ที่ต้องการตรวจได้ทันที!
              </p>
            </div>
            <button onClick={() => setStep(5)} className="btn-kawaii px-5 py-2.5 text-xs">
              ถัดไป: เลือกเกณฑ์ ({chosenCount} ไฟล์) →
            </button>
          </div>

          {/* Quick File Selection Pills */}
          <div className="flex flex-wrap gap-2 bg-[#FFFAF5] p-3 rounded-2xl border border-[#E8D9FA]">
            <span className="text-xs font-semibold text-[#684A96] self-center mr-1">เลือกด่วน:</span>
            <button onClick={() => filterArtifactsByType("all")} className="btn-kawaii-soft px-3 py-1 text-xs">
              เลือกทุกไฟล์
            </button>
            <button onClick={() => selectNthArtifactPerStudent(0)} className="btn-kawaii-soft px-3 py-1 text-xs">
              เฉพาะไฟล์ที่ 1 ของทุกคน
            </button>
            <button onClick={() => selectNthArtifactPerStudent(1)} className="btn-kawaii-soft px-3 py-1 text-xs">
              เฉพาะไฟล์ที่ 2 ของทุกคน
            </button>
            <button onClick={() => filterArtifactsByType(["py", "ipynb", "colab_url", "zip"])} className="btn-kawaii-soft px-3 py-1 text-xs">
              เฉพาะโค้ด Python / Colab
            </button>
            <button onClick={() => filterArtifactsByType(["pdf", "canva_url"])} className="btn-kawaii-soft px-3 py-1 text-xs">
              เฉพาะ PDF / Canva
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-[#E8D9FA]">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th className="px-4 py-3">นักเรียน</th>
                  <th className="px-4 py-3">สถานะ</th>
                  <th className="px-4 py-3">ไฟล์ที่แนบมา (ติ๊กเลือกไฟล์ที่จะตรวจ)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F4ECFE]">
                {submissions.map((item) => (
                  <tr key={item.submission.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#4A3869]">{item.student.full_name}</div>
                      <div className="text-[11px] text-[#7C6B99]">{item.student.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2.5 py-0.5 rounded-full font-semibold ${item.submission.status === "not_submitted"
                          ? "bg-[#F7DCE8] text-[#9D2B5B]"
                          : "bg-[#DDF1E7] text-[#2E7D5B]"
                          }`}
                      >
                        {item.submission.status === "not_submitted" ? "ยังไม่ส่ง" : "ส่งแล้ว"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {!item.artifacts || item.artifacts.length === 0 ? (
                        <span className="text-[#7C6B99]">ไม่มีไฟล์แนบ</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {item.artifacts.map((art, idx) => (
                            <label
                              key={art.id}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border cursor-pointer transition ${selectedArtifactIds[art.id]
                                ? "bg-[#E8D9FA]/70 border-[#9870D4] text-[#684A96] font-semibold"
                                : "bg-white border-[#E8D9FA] text-[#7C6B99]"
                                }`}
                            >
                              <input
                                type="checkbox"
                                checked={!!selectedArtifactIds[art.id]}
                                onChange={(e) =>
                                  setSelectedArtifactIds((prev) => ({ ...prev, [art.id]: e.target.checked }))
                                }
                                className="accent-[#9870D4]"
                              />
                              <span>
                                #{idx + 1} [{art.artifact_type}] {art.original_filename || "Link"}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* STEP 5: Choose Grading Criteria */}
      {step === 5 && (
        <div className="card-soft p-6 space-y-5">
          <h2 className="font-heading text-xl font-semibold text-[#684A96]">ขั้นที่ 5: เลือกเกณฑ์การตรวจ</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              type="button"
              onClick={() => setPresetMode("python_run")}
              className={`text-left rounded-3xl p-5 border-2 transition space-y-2 ${presetMode === "python_run" ? "border-[#9870D4] bg-[#F4ECFE]" : "border-[#E8D9FA] bg-[#FFFAF5]"
                }`}
            >
              <div className="w-10 h-10 rounded-2xl bg-[#E8D9FA] text-[#684A96] flex items-center justify-center">
                <FileCode2 className="w-5 h-5" />
              </div>
              <div className="font-heading font-semibold text-[#684A96]">ตรวจโค้ด Python รันได้ & ถูกต้อง</div>
              <p className="text-xs text-[#7C6B99]">
                ตรวจ Syntax (AST) + ทดลองรันโค้ดจริงว่าไม่มี Error + ประเมิน % การใช้ AI อัตโนมัติ
              </p>
            </button>

            <button
              type="button"
              onClick={() => setPresetMode("pdf_answer_key")}
              className={`text-left rounded-3xl p-5 border-2 transition space-y-2 ${presetMode === "pdf_answer_key" ? "border-[#9870D4] bg-[#F4ECFE]" : "border-[#E8D9FA] bg-[#FFFAF5]"
                }`}
            >
              <div className="w-10 h-10 rounded-2xl bg-[#DDF1E7] text-[#2E7D5B] flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="font-heading font-semibold text-[#684A96]">ตรวจเอกสาร PDF ตามเฉลยรายข้อ</div>
              <p className="text-xs text-[#7C6B99]">
                อ่านเอกสาร PDF ของนักเรียนแล้วตรวจให้คะแนนตามข้อที่ตอบถูก (รองรับ ก/ข/ค/ง, A/B/C/D และคำตอบข้อความ)
              </p>
            </button>

            <button
              type="button"
              onClick={() => setPresetMode("pdf_canva")}
              className={`text-left rounded-3xl p-5 border-2 transition space-y-2 ${presetMode === "pdf_canva" ? "border-[#9870D4] bg-[#F4ECFE]" : "border-[#E8D9FA] bg-[#FFFAF5]"
                }`}
            >
              <div className="w-10 h-10 rounded-2xl bg-[#DCEBFA] text-[#3B6EA5] flex items-center justify-center">
                <FileText className="w-5 h-5" />
              </div>
              <div className="font-heading font-semibold text-[#684A96]">ตรวจเอกสาร PDF / Canva ทั่วไป</div>
              <p className="text-xs text-[#7C6B99]">
                ตรวจไฟล์ PDF / ลิงก์ Canva, จำนวนหน้า, เนื้อหา + ประเมิน % การใช้ AI อัตโนมัติ
              </p>
            </button>

            <div className="rounded-3xl p-5 border-2 border-[#E8D9FA] bg-[#FFFAF5] space-y-2 flex flex-col justify-between">
              <div>
                <div className="w-10 h-10 rounded-2xl bg-[#FFE5A9] text-[#9A6700] flex items-center justify-center mb-2">
                  <SlidersHorizontal className="w-5 h-5" />
                </div>
                <div className="font-heading font-semibold text-[#684A96]">กำหนดเกณฑ์ละเอียดเอง</div>
                <p className="text-xs text-[#7C6B99] mt-1">
                  เพิ่มคำสำคัญ, ลูป, Test Cases หรือปรับคะแนนแต่ละข้อเองได้ละเอียด
                </p>
              </div>
              {assignmentId && (
                <Link href={`/assignments/${assignmentId}/criteria`} className="btn-kawaii-soft px-3 py-1.5 text-xs">
                  เปิดหน้าตั้งเกณฑ์ละเอียด →
                </Link>
              )}
            </div>
          </div>

          {presetMode === "pdf_answer_key" && (
            <PdfAnswerKeyBuilder items={pdfAnswerKey} onChange={setPdfAnswerKey} />
          )}

          <div className="flex justify-end">
            <button onClick={handleApplyPresetAndNext} disabled={busy} className="btn-kawaii px-6 py-3 text-sm">
              <Sparkles className="w-4 h-4" /> {busy ? "กำลังบันทึกเกณฑ์..." : "บันทึกเกณฑ์และไปขั้นเริ่มตรวจ →"}
            </button>
          </div>
        </div>
      )}

      {/* STEP 6: Start Grading */}
      {step === 6 && (
        <div className="card-soft p-8 text-center space-y-4 max-w-xl mx-auto">
          <div className="w-14 h-14 mx-auto rounded-3xl bg-[#E8D9FA] text-[#684A96] flex items-center justify-center">
            <Play className="w-7 h-7" />
          </div>
          <h2 className="font-heading text-2xl font-semibold text-[#684A96]">ขั้นที่ 6: พร้อมเริ่มตรวจงานแล้ว!</h2>
          <p className="text-sm text-[#7C6B99]">
            ใบงาน: <strong>{selectedCw?.title || "งานที่เลือก"}</strong> • ไฟล์ที่เลือกตรวจ: <strong>{chosenCount} ไฟล์</strong>
          </p>
          <button onClick={handleStartBatchGrading} disabled={busy} className="btn-kawaii px-8 py-3.5 text-sm">
            <Play className="w-4 h-4" /> {busy ? "กำลังตรวจโค้ดและคำนวณคะแนน..." : "เริ่มตรวจงานทั้งหมดเลย!"}
          </button>
        </div>
      )}

      {/* STEP 7: Results & Export Excel */}
      {step === 7 && (
        <div className="card-soft p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-heading text-xl font-semibold text-[#684A96]">ขั้นที่ 7: ผลการตรวจและส่งออกคะแนน</h2>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                {selectedCourse && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#F4ECFE] text-[#684A96] border border-[#E8D9FA]">
                    ห้องเรียน: {selectedCourse.name}
                  </span>
                )}
                {selectedCw && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#DCEBFA] text-[#285B8E]">
                    งานที่ตรวจ: {selectedCw.title}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#7C6B99] mt-1">คลิกดูโค้ด/ผลรัน/เหตุผล % AI รายคน หรือส่งออกไฟล์ Excel ได้ทันที</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  setSubmissions([]);
                  setSelectedArtifactIds({});
                  setStep(3);
                }}
                className="btn-kawaii-soft px-4 py-2 text-xs"
              >
                ← เลือกตรวจงานอื่นต่อ
              </button>
              <button
                onClick={() => assignmentId && downloadExcelReport("assignment", { assignment_id: assignmentId })}
                className="btn-kawaii-peach px-4 py-2 text-xs"
              >
                <Download className="w-4 h-4" /> Export Excel (.xlsx)
              </button>
              <Link href={`/grading?assignment_id=${assignmentId}`} className="btn-kawaii-soft px-4 py-2 text-xs">
                เปิดหน้าตรวจละเอียด
              </Link>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-[#E8D9FA]">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th className="px-4 py-3">นักเรียน</th>
                  <th className="px-4 py-3">งาน / ไฟล์ที่นำมาตรวจ</th>
                  <th className="px-4 py-3">สถานะ</th>
                  <th className="px-4 py-3">ตรวจ % AI</th>
                  <th className="px-4 py-3">คะแนน</th>
                  <th className="px-4 py-3 text-right">ดูรายละเอียด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F4ECFE]">
                {submissions.map((item) => {
                  const allArts = item.artifacts || [];
                  const gradedList =
                    item.graded_artifacts && item.graded_artifacts.length > 0
                      ? item.graded_artifacts
                      : allArts
                          .filter((a) => selectedArtifactIds[a.id] ?? true)
                          .map((a) => ({
                            id: a.id,
                            artifact_type: a.artifact_type,
                            filename: a.original_filename || a.colab_url || a.artifact_type,
                          }));
                  return (
                  <tr key={item.submission.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#4A3869]">{item.student.full_name}</div>
                      <div className="text-[11px] text-[#7C6B99]">{item.student.email}</div>
                    </td>
                    <td className="px-4 py-3 max-w-[260px]">
                      {gradedList.length === 0 ? (
                        <span className="text-[#7C6B99]">ไม่มีไฟล์แนบ</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <div className="flex flex-wrap gap-1">
                            {gradedList.map((ga) => (
                              <span
                                key={ga.id}
                                title={ga.filename}
                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#F4ECFE] border border-[#E8D9FA] text-[#4A3869] font-medium max-w-[240px] truncate"
                              >
                                <span className="text-[10px] font-bold uppercase text-[#7C5CFC]">[{ga.artifact_type}]</span>
                                <span className="truncate">{ga.filename}</span>
                              </span>
                            ))}
                          </div>
                          {allArts.length > gradedList.length && (
                            <span className="text-[10px] text-[#7C6B99]">
                              (เลือกตรวจ {gradedList.length} จาก {allArts.length} ไฟล์)
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#DDF1E7] text-[#2E7D5B] font-semibold">
                        <CheckCircle2 className="w-3 h-3" /> {item.submission.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {item.ai_usage_percent != null ? (
                        <span
                          className={`px-2.5 py-0.5 rounded-full font-semibold ${item.ai_usage_percent >= 65
                            ? "bg-[#F7DCE8] text-[#9D2B5B]"
                            : item.ai_usage_percent >= 35
                              ? "bg-[#FFE5A9] text-[#9A6700]"
                              : "bg-[#DDF1E7] text-[#2E7D5B]"
                            }`}
                        >
                          AI ~{item.ai_usage_percent}%
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-4 py-3 font-bold text-[#684A96]">
                      {item.submission.final_score != null ? `${item.submission.final_score} / ${maxScore}` : "-"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/grading/${item.submission.id}`} className="btn-kawaii-soft px-3 py-1 text-xs">
                        <Eye className="w-3.5 h-3.5" /> ดูโค้ด & ผลรัน
                      </Link>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
