"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileText, Plus, Play, Sparkles, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { Assignment } from "@/lib/types";

interface RubricDraft {
  name: string;
  description: string;
  max_score: number;
  check_method: "ast" | "runtime" | "test_case" | "document" | "ai_qualitative" | "manual";
  rule_config_json: string;
  allow_partial_credit: boolean;
}

interface TestCaseDraft {
  name: string;
  stdin_input: string;
  expected_output: string;
  comparator: "exact" | "normalized" | "numeric_tolerance" | "json" | "function";
  score_weight: number;
  timeout_seconds: number;
  is_hidden: boolean;
}

interface AssignmentDetailResponse {
  assignment: Assignment;
  rubric_criteria: Array<{
    id: string;
    name: string;
    description?: string | null;
    max_score: number;
    check_method: RubricDraft["check_method"];
    rule_config: Record<string, unknown>;
    allow_partial_credit: boolean;
  }>;
  test_cases: Array<{
    id: string;
    name: string;
    stdin_input: string;
    expected_output: string;
    comparator: TestCaseDraft["comparator"];
    score_weight: number;
    timeout_seconds: number;
    is_hidden: boolean;
  }>;
}

export default function AssignmentCriteriaPage() {
  const params = useParams<{ assignmentId: string }>();
  const assignmentId = params.assignmentId;

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [rubrics, setRubrics] = useState<RubricDraft[]>([]);
  const [testCases, setTestCases] = useState<TestCaseDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!assignmentId) return;
    apiFetch<AssignmentDetailResponse>(`/assignments/${assignmentId}`)
      .then((data) => {
        setAssignment(data.assignment);
        setRubrics(
          data.rubric_criteria.map((c) => ({
            name: c.name,
            description: c.description || "",
            max_score: Number(c.max_score),
            check_method: c.check_method,
            rule_config_json: JSON.stringify(c.rule_config || {}),
            allow_partial_credit: c.allow_partial_credit,
          }))
        );
        setTestCases(
          data.test_cases.map((t) => ({
            name: t.name,
            stdin_input: t.stdin_input || "",
            expected_output: t.expected_output || "",
            comparator: t.comparator,
            score_weight: Number(t.score_weight),
            timeout_seconds: t.timeout_seconds,
            is_hidden: t.is_hidden,
          }))
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : "โหลดข้อมูลใบงานไม่สำเร็จ"));
  }, [assignmentId]);

  const maxScore = Number(assignment?.max_score ?? 10);
  const rubricSum = rubrics.reduce((s, r) => s + Number(r.max_score || 0), 0);

  function applyPdfCanvaPreset() {
    const half = Math.max(1, Math.round((maxScore * 0.4) * 2) / 2);
    const rest = Math.max(1, Math.round((maxScore - half * 2) * 2) / 2);
    setRubrics([
      {
        name: "ส่งไฟล์ PDF / ลิงก์ Canva ครบถ้วนตามจำนวนหน้า",
        description: "ตรวจว่าเปิดอ่านได้และมีจำนวนหน้า/คำตามเกณฑ์",
        max_score: half,
        check_method: "document",
        rule_config_json: '{"min_pages": 1, "min_words": 20}',
        allow_partial_credit: true,
      },
      {
        name: "มีเนื้อหาและคำสำคัญครบตามโจทย์",
        description: "ตรวจสอบคำสำคัญในเอกสาร PDF/Canva",
        max_score: half,
        check_method: "document",
        rule_config_json: '{"required_keywords": ["บทนำ", "สรุป"]}',
        allow_partial_credit: true,
      },
      {
        name: "ความสวยงามและการเรียบเรียงเนื้อหา (AI / ครูประเมิน)",
        description: "ประเมินความชัดเจนและความคิดสร้างสรรค์",
        max_score: rest > 0 ? rest : 2,
        check_method: "ai_qualitative",
        rule_config_json: "{}",
        allow_partial_credit: true,
      },
    ]);
  }

  function applyPythonPreset() {
    const unit = Math.max(1, Math.round((maxScore / 4) * 2) / 2);
    setRubrics([
      {
        name: "โครงสร้างโค้ดและคำสั่งถูกต้อง (AST)",
        description: "ตรวจการใช้ตัวแปร ลูป หรือฟังก์ชันตามโจทย์",
        max_score: unit,
        check_method: "ast",
        rule_config_json: '{"require_loop": true}',
        allow_partial_credit: true,
      },
      {
        name: "โปรแกรมรันผ่านไม่มี Error (Runtime)",
        description: "รันโค้ดใน Sandbox สำเร็จโดยไม่ Timeout",
        max_score: unit,
        check_method: "runtime",
        rule_config_json: "{}",
        allow_partial_credit: false,
      },
      {
        name: "ผลลัพธ์ตรงตาม Test Cases",
        description: "ผ่านชุดทดสอบอัตโนมัติ",
        max_score: Math.max(1, maxScore - unit * 2),
        check_method: "test_case",
        rule_config_json: "{}",
        allow_partial_credit: true,
      },
    ]);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSavedBanner("");
    if (rubricSum > maxScore) {
      setError(`คะแนนรวมเกณฑ์ (${rubricSum}) เกินคะแนนเต็มของใบงาน (${maxScore})`);
      return;
    }

    let parsedRubrics;
    try {
      parsedRubrics = rubrics.map((r, idx) => ({
        order_index: idx,
        name: r.name,
        description: r.description || null,
        max_score: Number(r.max_score),
        check_method: r.check_method,
        rule_config: JSON.parse(r.rule_config_json || "{}"),
        allow_partial_credit: r.allow_partial_credit,
      }));
    } catch {
      setError("รูปแบบ JSON ในช่อง rule_config ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง");
      return;
    }

    setSaving(true);
    try {
      await Promise.all([
        apiFetch(`/assignments/${assignmentId}/rubric`, {
          method: "PUT",
          body: JSON.stringify(parsedRubrics),
        }),
        apiFetch(`/assignments/${assignmentId}/test-cases`, {
          method: "PUT",
          body: JSON.stringify(testCases.map((t, idx) => ({ ...t, order_index: idx }))),
        }),
      ]);
      setSavedBanner("บันทึกเกณฑ์การตรวจ (Rubric & Test Cases) เรียบร้อยแล้ว พร้อมเริ่มตรวจงานตามเกณฑ์ได้ทันที!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกเกณฑ์ไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/assignments" className="p-2.5 rounded-full bg-white border border-[#E8D9FA] text-[#684A96] hover:bg-[#F4ECFE]">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="font-heading text-2xl font-semibold text-[#684A96]">
              ตั้งเกณฑ์การตรวจ: {assignment?.title || "กำลังโหลด..."}
            </h1>
            <p className="text-sm text-[#7C6B99]">
              กำหนดเกณฑ์ Rubric สำหรับโค้ด Python, เอกสาร PDF / Canva และระบบตรวจ % การใช้ AI อัตโนมัติ (เต็ม {maxScore} คะแนน)
            </p>
          </div>
        </div>

        <Link href={`/grading?assignment_id=${assignmentId}`} className="btn-kawaii-peach px-4 py-2 text-xs sm:text-sm">
          <Play className="w-4 h-4" /> ไปหน้าตรวจงานตามเกณฑ์
        </Link>
      </div>

      {/* Quick Templates */}
      <div className="card-soft p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-semibold text-[#684A96] flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-[#9870D4]" /> เทมเพลตเกณฑ์สำเร็จรูป:
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={applyPythonPreset} className="btn-kawaii-soft px-3.5 py-1.5 text-xs">
            + เทมเพลตตรวจโค้ด Python
          </button>
          <button type="button" onClick={applyPdfCanvaPreset} className="btn-kawaii-soft px-3.5 py-1.5 text-xs">
            <FileText className="w-3.5 h-3.5" /> + เทมเพลตตรวจ PDF / Canva
          </button>
        </div>
      </div>

      {savedBanner && (
        <div className="rounded-2xl bg-[#DDF1E7] border border-[#b7e2cd] px-4 py-3 text-sm text-[#246348] flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> {savedBanner}
          </span>
          <Link href={`/grading?assignment_id=${assignmentId}`} className="font-semibold underline shrink-0">
            เริ่มตรวจงานเลย →
          </Link>
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-[#F7DCE8]/70 border border-[#F8E1EE] px-4 py-3 text-sm text-[#9D2B5B]">
          {error}
        </div>
      )}

      {/* Rubric Criteria */}
      <div className="card-soft p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-heading font-semibold text-[#684A96]">1. เกณฑ์การให้คะแนน (Rubric Criteria)</h2>
            <p className="text-xs text-[#7C6B99]">
              คะแนนรวมปัจจุบัน:{" "}
              <span className={rubricSum > maxScore ? "text-rose-600 font-bold" : "text-[#9870D4] font-bold"}>
                {rubricSum} / {maxScore}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setRubrics([
                ...rubrics,
                {
                  name: "",
                  description: "",
                  max_score: 2,
                  check_method: "document",
                  rule_config_json: '{"min_pages": 1}',
                  allow_partial_credit: true,
                },
              ])
            }
            className="btn-kawaii-soft px-3.5 py-1.5 text-xs"
          >
            <Plus className="w-3.5 h-3.5" /> เพิ่มเกณฑ์
          </button>
        </div>

        <div className="space-y-3">
          {rubrics.length === 0 ? (
            <p className="text-xs text-[#7C6B99] text-center py-4">
              ยังไม่มีเกณฑ์ กด &ldquo;+ เพิ่มเกณฑ์&rdquo; หรือเลือกเทมเพลตสำเร็จรูปด้านบนได้เลย
            </p>
          ) : (
            rubrics.map((r, i) => (
              <div
                key={i}
                className="rounded-2xl bg-[#FFFAF5] border border-[#E8D9FA] p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-center"
              >
                <input
                  required
                  placeholder="ชื่อเกณฑ์ เช่น มีหัวข้อครบ / ใช้ลูป for"
                  value={r.name}
                  onChange={(e) => {
                    const next = [...rubrics];
                    next[i].name = e.target.value;
                    setRubrics(next);
                  }}
                  className="md:col-span-3 rounded-xl border border-[#E8D9FA] bg-white px-3 py-2 text-xs"
                />
                <select
                  value={r.check_method}
                  onChange={(e) => {
                    const next = [...rubrics];
                    next[i].check_method = e.target.value as RubricDraft["check_method"];
                    setRubrics(next);
                  }}
                  className="md:col-span-2 rounded-xl border border-[#E8D9FA] bg-white px-2.5 py-2 text-xs"
                >
                  <option value="document">PDF / Canva</option>
                  <option value="ast">Python AST</option>
                  <option value="runtime">Python Runtime</option>
                  <option value="test_case">Test Case</option>
                  <option value="ai_qualitative">AI ประเมิน</option>
                  <option value="manual">ครูให้คะแนนเอง</option>
                </select>
                <input
                  type="number"
                  min={0.5}
                  step="0.5"
                  value={r.max_score}
                  onChange={(e) => {
                    const next = [...rubrics];
                    next[i].max_score = Number(e.target.value);
                    setRubrics(next);
                  }}
                  className="md:col-span-2 rounded-xl border border-[#E8D9FA] bg-white px-3 py-2 text-xs"
                />
                <input
                  placeholder='{"required_keywords": ["สรุป"], "min_pages": 1, "require_canva": true}'
                  value={r.rule_config_json}
                  onChange={(e) => {
                    const next = [...rubrics];
                    next[i].rule_config_json = e.target.value;
                    setRubrics(next);
                  }}
                  className="md:col-span-4 rounded-xl border border-[#E8D9FA] bg-white px-3 py-2 text-xs code-font"
                />
                <button
                  type="button"
                  onClick={() => setRubrics(rubrics.filter((_, idx) => idx !== i))}
                  className="md:col-span-1 text-rose-500 hover:bg-rose-50 p-2 rounded-full justify-self-end"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="text-[11px] text-[#7C6B99] bg-[#F4ECFE]/60 rounded-2xl p-3">
          <strong>ตัวอย่าง Rule JSON สำหรับ PDF/Canva:</strong>{" "}
          <code className="code-font">{'{"required_keywords": ["บทนำ", "สรุป"], "min_pages": 2, "min_words": 50, "require_canva": true}'}</code>
        </div>
      </div>

      {/* Test Cases (Optional for Python assignments) */}
      <div className="card-soft p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-semibold text-[#684A96]">2. ชุดทดสอบ Python (Test Cases — ไม่บังคับสำหรับงาน PDF/Canva)</h2>
          <button
            type="button"
            onClick={() =>
              setTestCases([
                ...testCases,
                {
                  name: `Test Case ${testCases.length + 1}`,
                  stdin_input: "",
                  expected_output: "",
                  comparator: "normalized",
                  score_weight: 2,
                  timeout_seconds: 5,
                  is_hidden: false,
                },
              ])
            }
            className="btn-kawaii-soft px-3.5 py-1.5 text-xs"
          >
            <Plus className="w-3.5 h-3.5" /> เพิ่ม Test Case
          </button>
        </div>

        {testCases.map((tc, i) => (
          <div key={i} className="rounded-2xl bg-[#FFFAF5] border border-[#E8D9FA] p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                required
                placeholder="ชื่อ Test Case"
                value={tc.name}
                onChange={(e) => {
                  const next = [...testCases];
                  next[i].name = e.target.value;
                  setTestCases(next);
                }}
                className="rounded-xl border border-[#E8D9FA] bg-white px-3 py-1.5 text-xs"
              />
              <select
                value={tc.comparator}
                onChange={(e) => {
                  const next = [...testCases];
                  next[i].comparator = e.target.value as TestCaseDraft["comparator"];
                  setTestCases(next);
                }}
                className="rounded-xl border border-[#E8D9FA] bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="normalized">Normalized Match</option>
                <option value="exact">Exact Match</option>
                <option value="numeric_tolerance">Numeric Tolerance</option>
                <option value="json">JSON Comparison</option>
                <option value="function">Function-based Test</option>
              </select>
              <input
                type="number"
                min={1}
                max={60}
                value={tc.timeout_seconds}
                onChange={(e) => {
                  const next = [...testCases];
                  next[i].timeout_seconds = Number(e.target.value);
                  setTestCases(next);
                }}
                className="rounded-xl border border-[#E8D9FA] bg-white px-3 py-1.5 text-xs"
              />
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-xs text-[#7C6B99]">
                  <input
                    type="checkbox"
                    checked={tc.is_hidden}
                    onChange={(e) => {
                      const next = [...testCases];
                      next[i].is_hidden = e.target.checked;
                      setTestCases(next);
                    }}
                  />
                  Hidden Test
                </label>
                <button
                  type="button"
                  onClick={() => setTestCases(testCases.filter((_, idx) => idx !== i))}
                  className="text-rose-500 p-1.5 rounded-full hover:bg-rose-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <textarea
                rows={2}
                placeholder="Standard Input (stdin)"
                value={tc.stdin_input}
                onChange={(e) => {
                  const next = [...testCases];
                  next[i].stdin_input = e.target.value;
                  setTestCases(next);
                }}
                className="rounded-xl border border-[#E8D9FA] bg-white px-3 py-1.5 text-xs code-font"
              />
              <textarea
                rows={2}
                placeholder="Expected Output (stdout)"
                value={tc.expected_output}
                onChange={(e) => {
                  const next = [...testCases];
                  next[i].expected_output = e.target.value;
                  setTestCases(next);
                }}
                className="rounded-xl border border-[#E8D9FA] bg-white px-3 py-1.5 text-xs code-font"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3">
        <button type="submit" disabled={saving} className="btn-kawaii px-6 py-3 text-sm">
          {saving ? "กำลังบันทึกเกณฑ์..." : "บันทึกเกณฑ์การตรวจทั้งหมด"}
        </button>
      </div>
    </form>
  );
}
