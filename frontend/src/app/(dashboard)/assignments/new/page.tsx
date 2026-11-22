"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { apiFetch } from "@/lib/api";
import type { Classroom } from "@/lib/types";

interface RubricDraft {
  name: string;
  max_score: number;
  check_method: "ast" | "runtime" | "test_case" | "ai_qualitative" | "manual";
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

export default function NewAssignmentPage() {
  const router = useRouter();
  const { activeWorkspace } = useApp();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [classroomId, setClassroomId] = useState("");
  const [title, setTitle] = useState("");
  const [problemStatement, setProblemStatement] = useState("");
  const [instructions, setInstructions] = useState("");
  const [maxScore, setMaxScore] = useState(10);
  const [executionMode, setExecutionMode] = useState<"auto" | "script" | "notebook">("auto");
  const [enableAiReview, setEnableAiReview] = useState(true);

  // Mixed Submission Settings
  const [allowColab, setAllowColab] = useState(true);
  const [allowIpynb, setAllowIpynb] = useState(true);
  const [allowPy, setAllowPy] = useState(true);
  const [allowZip, setAllowZip] = useState(true);
  const [allowMulti, setAllowMulti] = useState(true);
  const [maxFileMb, setMaxFileMb] = useState(10);
  const [maxFiles, setMaxFiles] = useState(5);

  const [rubrics, setRubrics] = useState<RubricDraft[]>([
    {
      name: "สร้างคิวว่างด้วย List",
      max_score: 2,
      check_method: "ast",
      rule_config_json: '{"require_empty_list": true}',
      allow_partial_credit: true,
    },
    {
      name: "ใช้เมธอด append()",
      max_score: 2,
      check_method: "ast",
      rule_config_json: '{"require_method_calls": ["append"]}',
      allow_partial_credit: true,
    },
    {
      name: "ใช้เมธอด pop(0)",
      max_score: 2,
      check_method: "ast",
      rule_config_json: '{"require_method_calls": [{"method": "pop", "first_arg": "0"}]}',
      allow_partial_credit: true,
    },
    {
      name: "ทดสอบผลลัพธ์ Test Cases",
      max_score: 4,
      check_method: "test_case",
      rule_config_json: "{}",
      allow_partial_credit: true,
    },
  ]);

  const [testCases, setTestCases] = useState<TestCaseDraft[]>([
    {
      name: "Basic Queue Output",
      stdin_input: "",
      expected_output: "['A', 'B']",
      comparator: "normalized",
      score_weight: 2,
      timeout_seconds: 5,
      is_hidden: false,
    },
  ]);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!activeWorkspace) return;
    apiFetch<Classroom[]>("/classrooms").then((list) => {
      setClassrooms(list);
      if (list[0]) setClassroomId(list[0].id);
    });
  }, [activeWorkspace]);

  const rubricSum = rubrics.reduce((sum, r) => sum + Number(r.max_score || 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (rubricSum > maxScore) {
      setError(`คะแนนรวมของเกณฑ์ Rubric (${rubricSum}) เกินคะแนนเต็มของใบงาน (${maxScore})`);
      return;
    }

    let parsedRubrics;
    try {
      parsedRubrics = rubrics.map((r, idx) => ({
        order_index: idx,
        name: r.name,
        max_score: Number(r.max_score),
        check_method: r.check_method,
        rule_config: JSON.parse(r.rule_config_json || "{}"),
        allow_partial_credit: r.allow_partial_credit,
      }));
    } catch {
      setError("JSON ของ rule_config ใน Rubric ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง");
      return;
    }

    setSaving(true);
    try {
      await apiFetch("/assignments", {
        method: "POST",
        body: JSON.stringify({
          classroom_id: classroomId,
          title,
          instructions: instructions || null,
          problem_statement: problemStatement,
          max_score: Number(maxScore),
          execution_mode: executionMode,
          enable_ai_review: enableAiReview,
          submission_settings: {
            allow_colab_url: allowColab,
            allow_ipynb: allowIpynb,
            allow_py: allowPy,
            allow_zip: allowZip,
            allow_multiple_files: allowMulti,
            max_file_size_mb: Number(maxFileMb),
            max_files_per_submission: Number(maxFiles),
          },
          rubric_criteria: parsedRubrics,
          test_cases: testCases.map((t, idx) => ({ ...t, order_index: idx })),
        }),
      });
      router.push("/assignments");
    } catch (err) {
      setError(err instanceof Error ? err.message : "สร้างใบงานไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1B2E]">สร้างใบงาน Python ใหม่</h1>
        <p className="text-sm text-[#645D7B]">
          กำหนดโจทย์ รูปแบบการส่งงานแบบผสม (Mixed Submission) เกณฑ์ Rubric และ Test Cases
        </p>
      </div>

      {error && (
        <div className="rounded-2xl bg-[#FFF1F2] border border-rose-200 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {/* Basic Info */}
      <div className="card-soft p-6 space-y-4">
        <h2 className="font-bold text-[#1F1B2E]">1. ข้อมูลใบงาน</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#645D7B] mb-1">ห้องเรียน</label>
            <select
              required
              value={classroomId}
              onChange={(e) => setClassroomId(e.target.value)}
              className="w-full rounded-xl border border-[#DDD4FF] px-3.5 py-2 text-sm"
            >
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#645D7B] mb-1">ชื่อใบงาน</label>
            <input
              required
              placeholder="เช่น ใบงานที่ 1: โครงสร้างข้อมูล Queue"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-[#DDD4FF] px-3.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#645D7B] mb-1">คะแนนเต็ม</label>
            <input
              type="number"
              min={1}
              step="0.5"
              value={maxScore}
              onChange={(e) => setMaxScore(Number(e.target.value))}
              className="w-full rounded-xl border border-[#DDD4FF] px-3.5 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#645D7B] mb-1">รูปแบบการรัน</label>
            <select
              value={executionMode}
              onChange={(e) => setExecutionMode(e.target.value as "auto" | "script" | "notebook")}
              className="w-full rounded-xl border border-[#DDD4FF] px-3.5 py-2 text-sm"
            >
              <option value="auto">Auto (รองรับทั้ง Script และ Notebook)</option>
              <option value="script">Python Script (.py)</option>
              <option value="notebook">Jupyter Notebook (.ipynb / Colab)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#645D7B] mb-1">โจทย์และข้อกำหนดการเขียนโปรแกรม</label>
          <textarea
            required
            rows={4}
            placeholder="อธิบายโจทย์ Input/Output และเงื่อนไขที่นักเรียนต้องเขียน..."
            value={problemStatement}
            onChange={(e) => setProblemStatement(e.target.value)}
            className="w-full rounded-xl border border-[#DDD4FF] px-3.5 py-2.5 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#645D7B] mb-1">คำชี้แจงเพิ่มเติม</label>
          <input
            placeholder="คำแนะนำการส่งงานสำหรับนักเรียน"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            className="w-full rounded-xl border border-[#DDD4FF] px-3.5 py-2 text-sm"
          />
        </div>

        <label className="inline-flex items-center gap-2 text-sm text-[#1F1B2E]">
          <input
            type="checkbox"
            checked={enableAiReview}
            onChange={(e) => setEnableAiReview(e.target.checked)}
            className="rounded accent-[#7C5CFC]"
          />
          เปิดใช้ AI Code Review วิเคราะห์ข้อผิดพลาดและให้ข้อเสนอแนะภาษาไทย (ไม่เปลี่ยนผล Test Case)
        </label>
      </div>

      {/* Mixed Submission Settings */}
      <div className="card-soft p-6 space-y-4">
        <h2 className="font-bold text-[#1F1B2E]">2. รูปแบบการรับงานแบบผสม (Mixed Submission)</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Google Colab URL", val: allowColab, set: setAllowColab },
            { label: "Jupyter (.ipynb)", val: allowIpynb, set: setAllowIpynb },
            { label: "Python File (.py)", val: allowPy, set: setAllowPy },
            { label: "ZIP Project (.zip)", val: allowZip, set: setAllowZip },
          ].map((item) => (
            <label
              key={item.label}
              className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer text-sm font-medium transition ${
                item.val ? "bg-[#F2EEFF] border-[#7C5CFC] text-[#7C5CFC]" : "bg-[#FAF8F5] border-[#ECE7F6] text-[#645D7B]"
              }`}
            >
              <input
                type="checkbox"
                checked={item.val}
                onChange={(e) => item.set(e.target.checked)}
                className="accent-[#7C5CFC]"
              />
              {item.label}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <label className="flex items-center gap-2 text-sm text-[#1F1B2E]">
            <input
              type="checkbox"
              checked={allowMulti}
              onChange={(e) => setAllowMulti(e.target.checked)}
              className="accent-[#7C5CFC]"
            />
            อนุญาตให้แนบหลายไฟล์ใน Submission เดียว
          </label>
          <div>
            <label className="block text-xs text-[#645D7B] mb-1">ขนาดไฟล์สูงสุด (MB)</label>
            <input
              type="number"
              min={1}
              max={100}
              value={maxFileMb}
              onChange={(e) => setMaxFileMb(Number(e.target.value))}
              className="w-full rounded-xl border border-[#DDD4FF] px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-[#645D7B] mb-1">จำนวนไฟล์สูงสุดต่อ Submission</label>
            <input
              type="number"
              min={1}
              max={50}
              value={maxFiles}
              onChange={(e) => setMaxFiles(Number(e.target.value))}
              className="w-full rounded-xl border border-[#DDD4FF] px-3 py-1.5 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Rubric Builder */}
      <div className="card-soft p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-bold text-[#1F1B2E]">3. เกณฑ์การให้คะแนน (Rubric Engine)</h2>
            <p className="text-xs text-[#645D7B]">
              คะแนนรวมปัจจุบัน:{" "}
              <span className={rubricSum > maxScore ? "text-rose-600 font-bold" : "text-[#7C5CFC] font-bold"}>
                {rubricSum} / {maxScore}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setRubrics([
                ...rubrics,
                { name: "", max_score: 2, check_method: "ast", rule_config_json: "{}", allow_partial_credit: true },
              ])
            }
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#F2EEFF] text-[#7C5CFC] text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" /> เพิ่มเกณฑ์
          </button>
        </div>

        <div className="space-y-3">
          {rubrics.map((r, i) => (
            <div key={i} className="rounded-xl bg-[#FAF8F5] border border-[#ECE7F6] p-3.5 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
              <input
                required
                placeholder="ชื่อเกณฑ์"
                value={r.name}
                onChange={(e) => {
                  const next = [...rubrics];
                  next[i].name = e.target.value;
                  setRubrics(next);
                }}
                className="md:col-span-3 rounded-lg border border-[#DDD4FF] bg-white px-2.5 py-1.5 text-xs"
              />
              <select
                value={r.check_method}
                onChange={(e) => {
                  const next = [...rubrics];
                  next[i].check_method = e.target.value as RubricDraft["check_method"];
                  setRubrics(next);
                }}
                className="md:col-span-2 rounded-lg border border-[#DDD4FF] bg-white px-2 py-1.5 text-xs"
              >
                <option value="ast">AST Static</option>
                <option value="runtime">Runtime</option>
                <option value="test_case">Test Case</option>
                <option value="ai_qualitative">AI Qualitative</option>
                <option value="manual">Manual</option>
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
                className="md:col-span-2 rounded-lg border border-[#DDD4FF] bg-white px-2.5 py-1.5 text-xs"
              />
              <input
                placeholder='Rule JSON เช่น {"require_empty_list": true}'
                value={r.rule_config_json}
                onChange={(e) => {
                  const next = [...rubrics];
                  next[i].rule_config_json = e.target.value;
                  setRubrics(next);
                }}
                className="md:col-span-4 rounded-lg border border-[#DDD4FF] bg-white px-2.5 py-1.5 text-xs code-font"
              />
              <button
                type="button"
                onClick={() => setRubrics(rubrics.filter((_, idx) => idx !== i))}
                className="md:col-span-1 text-rose-500 hover:bg-rose-50 p-1.5 rounded-lg justify-self-end"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Test Cases Builder */}
      <div className="card-soft p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-[#1F1B2E]">4. ชุดทดสอบ (Test Cases)</h2>
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
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#FFF1EB] text-[#E6744C] text-xs font-semibold"
          >
            <Plus className="w-3.5 h-3.5" /> เพิ่ม Test Case
          </button>
        </div>

        <div className="space-y-3">
          {testCases.map((tc, i) => (
            <div key={i} className="rounded-xl bg-[#FAF8F5] border border-[#ECE7F6] p-4 space-y-3">
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
                  className="rounded-lg border border-[#DDD4FF] bg-white px-2.5 py-1.5 text-xs"
                />
                <select
                  value={tc.comparator}
                  onChange={(e) => {
                    const next = [...testCases];
                    next[i].comparator = e.target.value as TestCaseDraft["comparator"];
                    setTestCases(next);
                  }}
                  className="rounded-lg border border-[#DDD4FF] bg-white px-2 py-1.5 text-xs"
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
                  className="rounded-lg border border-[#DDD4FF] bg-white px-2.5 py-1.5 text-xs"
                  placeholder="Timeout (วินาที)"
                />
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-xs text-[#645D7B]">
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
                    className="text-rose-500 p-1 rounded-lg hover:bg-rose-50"
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
                  className="rounded-lg border border-[#DDD4FF] bg-white px-2.5 py-1.5 text-xs code-font"
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
                  className="rounded-lg border border-[#DDD4FF] bg-white px-2.5 py-1.5 text-xs code-font"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-5 py-2.5 rounded-xl border border-[#DDD4FF] bg-white text-sm text-[#645D7B]"
        >
          ยกเลิก
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2.5 rounded-xl bg-[#7C5CFC] hover:bg-[#6846F5] disabled:opacity-60 text-white text-sm font-semibold shadow-sm"
        >
          {saving ? "กำลังบันทึกใบงาน..." : "บันทึกและเปิดรับงาน"}
        </button>
      </div>
    </form>
  );
}
