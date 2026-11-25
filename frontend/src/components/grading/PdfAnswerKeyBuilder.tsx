"use client";

import React, { useState } from "react";
import { CheckSquare, Plus, Sparkles, Trash2 } from "lucide-react";

export interface PdfAnswerKeyItem {
  question: string;
  prompt?: string;
  expected: string[];
  match_mode: "any" | "all" | "exact_choice";
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
    // Support formats like: "1. ก", "ข้อ 2: FIFO, เข้าก่อนออกก่อน", "3) B", or just "ก"
    const m = line.match(/^(?:ข้อที่|ข้อ|q)?\s*([0-9๐-๙]+)\s*[.):\-=]+\s*(.+)$/i);
    let qNum = String(idx + 1);
    let answerPart = line;
    if (m) {
      qNum = m[1].replace(/[๐-๙]/g, (ch) => String("๐๑๒๓๔๕๖๗๘๙".indexOf(ch)));
      answerPart = m[2].trim();
    }
    const expected = answerPart
      .split(/[,;|/]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (expected.length === 0) return;

    const isChoice = expected.every((e) => SINGLE_CHOICES.has(e.toLowerCase()));
    parsed.push({
      question: qNum,
      expected,
      match_mode: isChoice ? "exact_choice" : "any",
      points: defaultPoints,
    });
  });

  return parsed;
}

export default function PdfAnswerKeyBuilder({ items, onChange }: PdfAnswerKeyBuilderProps) {
  const [quickText, setQuickText] = useState("");
  const [showQuickPaste, setShowQuickPaste] = useState(items.length === 0);

  const totalPoints = items.reduce((sum, it) => sum + Number(it.points || 0), 0);

  function handleApplyQuickPaste() {
    const parsed = parseQuickPasteAnswerKey(quickText, 1);
    if (parsed.length > 0) {
      onChange(parsed);
      setShowQuickPaste(false);
    }
  }

  function addQuestion() {
    onChange([
      ...items,
      {
        question: String(items.length + 1),
        expected: [""],
        match_mode: "any",
        points: 1,
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
            เฉลยรายข้อสำหรับตรวจเอกสาร PDF ({items.length} ข้อ • รวม {totalPoints} คะแนน)
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowQuickPaste((v) => !v)}
            className="btn-kawaii-soft px-3 py-1.5 text-xs"
          >
            <Sparkles className="w-3.5 h-3.5" /> {showQuickPaste ? "ซ่อนช่องวางเฉลยเร็ว" : "วางเฉลยแบบเร็ว"}
          </button>
          <button type="button" onClick={addQuestion} className="btn-kawaii-soft px-3 py-1.5 text-xs">
            <Plus className="w-3.5 h-3.5" /> เพิ่มข้อ
          </button>
        </div>
      </div>

      {showQuickPaste && (
        <div className="rounded-xl bg-white border border-[#E8D9FA] p-3 space-y-2">
          <div className="text-xs text-[#6B5A8E]">
            พิมพ์หรือวางเฉลยทีละบรรทัด เช่น{" "}
            <code className="code-font text-[#5E3FA3]">1. ก</code> หรือ{" "}
            <code className="code-font text-[#5E3FA3]">2. FIFO, เข้าก่อนออกก่อน</code> (คั่นคำตอบที่ยอมรับได้หลายคำด้วยเครื่องหมายจุลภาค{" "}
            <code>,</code>)
          </div>
          <textarea
            rows={4}
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            placeholder={"1. ก\n2. ข\n3. FIFO, เข้าก่อนออกก่อน\n4. enqueue\n5. dequeue"}
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
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div
              key={idx}
              className="rounded-xl bg-white border border-[#E8D9FA] p-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
            >
              <div className="sm:col-span-2 flex items-center gap-1.5">
                <span className="text-xs font-semibold text-[#6B5A8E] shrink-0">ข้อ</span>
                <input
                  type="text"
                  value={item.question}
                  onChange={(e) => updateItem(idx, { question: e.target.value })}
                  className="w-full rounded-lg border border-[#E8D9FA] px-2 py-1.5 text-xs font-semibold text-[#241642]"
                />
              </div>

              <input
                type="text"
                placeholder="คำตอบที่ถูก เช่น ก หรือ FIFO, เข้าก่อนออกก่อน"
                value={item.expected.join(", ")}
                onChange={(e) =>
                  updateItem(idx, {
                    expected: e.target.value
                      .split(",")
                      .map((s) => s.trim()),
                  })
                }
                className="sm:col-span-5 rounded-lg border border-[#E8D9FA] px-2.5 py-1.5 text-xs text-[#241642]"
              />

              <select
                value={item.match_mode}
                onChange={(e) => updateItem(idx, { match_mode: e.target.value as PdfAnswerKeyItem["match_mode"] })}
                className="sm:col-span-3 rounded-lg border border-[#E8D9FA] px-2 py-1.5 text-xs text-[#241642]"
              >
                <option value="any">ตรงคำตอบใดก็ได้ (Any)</option>
                <option value="exact_choice">ตัวเลือก ก/ข/ค/ง หรือ A/B/C/D</option>
                <option value="all">ต้องมีครบทุกคำ (All)</option>
              </select>

              <div className="sm:col-span-2 flex items-center justify-between gap-1">
                <input
                  type="number"
                  min={0.5}
                  step="0.5"
                  value={item.points}
                  onChange={(e) => updateItem(idx, { points: Number(e.target.value) || 1 })}
                  title="คะแนนของข้อนี้"
                  className="w-16 rounded-lg border border-[#E8D9FA] px-2 py-1.5 text-xs text-[#241642]"
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
          ))}
        </div>
      )}
    </div>
  );
}
