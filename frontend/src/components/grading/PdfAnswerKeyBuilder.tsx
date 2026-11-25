"use client";

import React, { useRef, useState } from "react";
import { CheckSquare, FileUp, Plus, Sparkles, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";

export interface PdfAnswerKeyItem {
  question: string;
  prompt?: string;
  expected: string[];
  model_answer?: string;
  match_mode: "any" | "all" | "exact_choice" | "open_ended";
  points: number;
}

interface PdfAnswerKeyBuilderProps {
  items: PdfAnswerKeyItem[];
  onChange: (items: PdfAnswerKeyItem[]) => void;
}

const SINGLE_CHOICES = new Set(["ก", "ข", "ค", "ง", "จ", "a", "b", "c", "d", "e"]);

export function parseQuickPasteAnswerKey(rawText: string, defaultPoints = 1): PdfAnswerKeyItem[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const parsed: PdfAnswerKeyItem[] = [];
  lines.forEach((line, idx) => {
    const m = line.match(/^(?:ข้อที่|ข้อ|q)?\s*([0-9๐-๙]+)\s*[.):\-=]+\s*(.+)$/i);
    let qNum = String(idx + 1);
    let answerPart = line;
    if (m) {
      qNum = m[1].replace(/[๐-๙]/g, (ch) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(ch)));
      answerPart = m[2].trim();
    }
    if (!answerPart) return;

    const isChoice = SINGLE_CHOICES.has(answerPart.toLowerCase());
    if (isChoice) {
      parsed.push({
        question: qNum,
        expected: [answerPart],
        model_answer: "",
        match_mode: "exact_choice",
        points: defaultPoints,
      });
    } else if (answerPart.length >= 35 && !answerPart.includes(",")) {
      parsed.push({
        question: qNum,
        expected: [],
        model_answer: answerPart,
        match_mode: "open_ended",
        points: 2,
      });
    } else {
      const expected = answerPart
        .split(/[,;|/]/)
        .map((s) => s.trim())
        .filter(Boolean);
      parsed.push({
        question: qNum,
        expected,
        model_answer: "",
        match_mode: expected.every((e) => SINGLE_CHOICES.has(e.toLowerCase())) ? "exact_choice" : "any",
        points: defaultPoints,
      });
    }
  });

  return parsed;
}

export default function PdfAnswerKeyBuilder({ items, onChange }: PdfAnswerKeyBuilderProps) {
  const [quickText, setQuickText] = useState("");
  const [showQuickPaste, setShowQuickPaste] = useState(items.length === 0);
  const [uploading, setUploading] = useState(false);
  const [uploadInfo, setUploadInfo] = useState("");
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const totalPoints = items.reduce((sum, it) => sum + Number(it.points || 0), 0);

  function handleApplyQuickPaste() {
    const parsed = parseQuickPasteAnswerKey(quickText, 1);
    if (parsed.length > 0) {
      onChange(parsed);
      setShowQuickPaste(false);
    }
  }

  async function handleUploadAnswerKeyFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError("");
    setUploadInfo("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiFetch<{
        filename: string;
        page_count: number;
        answer_key: PdfAnswerKeyItem[];
      }>("/grading/parse-answer-key", {
        method: "POST",
        body: fd,
      });
      if (res.answer_key && res.answer_key.length > 0) {
        onChange(res.answer_key);
        setShowQuickPaste(false);
        setUploadInfo(
          `อ่านไฟล์เฉลย "${res.filename}" สำเร็จ ${res.answer_key.length} ข้อ! สามารถตรวจแก้คำตอบหรือปรับเป็นคำถามปลายเปิดด้านล่างได้ทันที`
        );
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "อ่านไฟล์เฉลยไม่สำเร็จ");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function addQuestion(mode: PdfAnswerKeyItem["match_mode"] = "any") {
    onChange([
      ...items,
      {
        question: String(items.length + 1),
        expected: mode === "open_ended" ? [] : [""],
        model_answer: "",
        match_mode: mode,
        points: mode === "open_ended" ? 2 : 1,
      },
    ]);
  }

  function updateItem(index: number, patch: Partial<PdfAnswerKeyItem>) {
    const next = items.map((it, i) => (i === index ? { ...it, ...patch } : it));
    onChange(next);
  }

  return (
    <div className="rounded-2xl border border-[#E8D9FA] bg-[#FFFAF5] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-[#9870D4]" />
          <span className="font-heading text-sm font-semibold text-[#241642]">
            เฉลยรายข้อ & คำถามปลายเปิด ({items.length} ข้อ • รวม {totalPoints} คะแนน)
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md"
            onChange={handleUploadAnswerKeyFile}
            className="hidden"
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="btn-kawaii px-3.5 py-1.5 text-xs"
          >
            <FileUp className="w-3.5 h-3.5" />
            {uploading ? "กำลังอ่านไฟล์เฉลย..." : "อัปโหลดไฟล์เฉลย (.pdf / .txt)"}
          </button>
          <button
            type="button"
            onClick={() => setShowQuickPaste((v) => !v)}
            className="btn-kawaii-soft px-3 py-1.5 text-xs"
          >
            <Sparkles className="w-3.5 h-3.5" /> {showQuickPaste ? "ซ่อนช่องวางเฉลยเร็ว" : "วางเฉลยแบบเร็ว"}
          </button>
          <button type="button" onClick={() => addQuestion("any")} className="btn-kawaii-soft px-3 py-1.5 text-xs">
            <Plus className="w-3.5 h-3.5" /> เพิ่มข้อ
          </button>
          <button
            type="button"
            onClick={() => addQuestion("open_ended")}
            className="btn-kawaii-peach px-3 py-1.5 text-xs"
          >
            <Plus className="w-3.5 h-3.5" /> เพิ่มข้อปลายเปิด
          </button>
        </div>
      </div>

      {uploadInfo && (
        <div className="rounded-xl bg-[#DDF1E7] border border-[#b7e2cd] px-3 py-2 text-xs text-[#246348]">
          {uploadInfo}
        </div>
      )}
      {uploadError && (
        <div className="rounded-xl bg-[#F7DCE8]/80 border border-[#F8E1EE] px-3 py-2 text-xs text-[#9D2B5B]">
          {uploadError}
        </div>
      )}

      {showQuickPaste && (
        <div className="rounded-xl bg-white border border-[#E8D9FA] p-3 space-y-2">
          <div className="text-xs text-[#6B5A8E]">
            อัปโหลดไฟล์เฉลยด้านบน หรือวางเฉลยทีละบรรทัด เช่น{" "}
            <code className="code-font text-[#5E3FA3]">1. ก</code>,{" "}
            <code className="code-font text-[#5E3FA3]">2. FIFO, เข้าก่อนออกก่อน</code> หรือเขียนแนวคำตอบยาวสำหรับข้อปลายเปิด
          </div>
          <textarea
            rows={4}
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            placeholder={
              "1. ก\n2. ข\n3. FIFO, เข้าก่อนออกก่อน\n4. คิวคือโครงสร้างข้อมูลแบบเข้าก่อนออกก่อน เพิ่มข้อมูลด้านท้ายและนำออกด้านหน้า เช่น การเข้าแถวรอซื้อของ"
            }
            className="w-full rounded-xl border border-[#E8D9FA] bg-[#FFFAF5] px-3 py-2 text-xs code-font text-[#241642]"
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleApplyQuickPaste}
              disabled={!quickText.trim()}
              className="btn-kawaii px-4 py-1.5 text-xs"
            >
              สร้างเฉลยจากข้อความนี้
            </button>
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-2.5">
          {items.map((item, idx) => {
            const isOpen = item.match_mode === "open_ended";
            return (
              <div
                key={idx}
                className={`rounded-xl border p-3 space-y-2 ${
                  isOpen ? "bg-[#FFF8F2] border-[#F8D0C0]" : "bg-white border-[#E8D9FA]"
                }`}
              >
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                  <div className="sm:col-span-2 flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-[#6B5A8E] shrink-0">ข้อ</span>
                    <input
                      type="text"
                      value={item.question}
                      onChange={(e) => updateItem(idx, { question: e.target.value })}
                      className="w-full rounded-lg border border-[#E8D9FA] bg-white px-2 py-1.5 text-xs font-semibold text-[#241642]"
                    />
                  </div>

                  {!isOpen ? (
                    <input
                      type="text"
                      placeholder="คำตอบที่ถูก เช่น ก หรือ FIFO, เข้าก่อนออกก่อน"
                      value={(item.expected || []).join(", ")}
                      onChange={(e) =>
                        updateItem(idx, {
                          expected: e.target.value.split(",").map((s) => s.trim()),
                        })
                      }
                      className="sm:col-span-5 rounded-lg border border-[#E8D9FA] bg-white px-2.5 py-1.5 text-xs text-[#241642]"
                    />
                  ) : (
                    <div className="sm:col-span-5 text-xs font-semibold text-[#A14B33]">
                      ✨ โหมดคำถามปลายเปิด — ระบบจะวิเคราะห์เทียบกับแนวคำตอบโดยรวมด้านล่าง
                    </div>
                  )}

                  <select
                    value={item.match_mode}
                    onChange={(e) =>
                      updateItem(idx, { match_mode: e.target.value as PdfAnswerKeyItem["match_mode"] })
                    }
                    className="sm:col-span-3 rounded-lg border border-[#E8D9FA] bg-white px-2 py-1.5 text-xs text-[#241642]"
                  >
                    <option value="any">ตรงคำตอบใดก็ได้ (Any)</option>
                    <option value="exact_choice">ตัวเลือก ก/ข/ค/ง หรือ A/B/C/D</option>
                    <option value="all">ต้องมีครบทุกคำ (All)</option>
                    <option value="open_ended">คำถามปลายเปิด (แนวคำตอบโดยรวม)</option>
                  </select>

                  <div className="sm:col-span-2 flex items-center justify-between gap-1">
                    <input
                      type="number"
                      min={0.5}
                      step="0.5"
                      value={item.points}
                      onChange={(e) => updateItem(idx, { points: Number(e.target.value) || 1 })}
                      title="คะแนนของข้อนี้"
                      className="w-16 rounded-lg border border-[#E8D9FA] bg-white px-2 py-1.5 text-xs text-[#241642]"
                    />
                    <button
                      type="button"
                      onClick={() => onChange(items.filter((_, i) => i !== idx))}
                      className="p-1.5 rounded-full text-rose-500 hover:bg-rose-50"
                      title="ลบข้อนี้"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <textarea
                    rows={2}
                    placeholder="ใส่แนวคำตอบโดยรวมของครู เช่น อธิบายหลักการทำงานของคิวว่าเข้าก่อนออกก่อน (FIFO) เพิ่มด้านท้าย นำออกด้านหน้า พร้อมยกตัวอย่าง..."
                    value={item.model_answer || ""}
                    onChange={(e) => updateItem(idx, { model_answer: e.target.value })}
                    className="w-full rounded-lg border border-[#F3C5B2] bg-white px-3 py-2 text-xs text-[#241642]"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
