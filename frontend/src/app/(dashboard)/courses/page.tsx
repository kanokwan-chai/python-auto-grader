"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { apiFetch } from "@/lib/api";
import type { Classroom } from "@/lib/types";

export default function CoursesPage() {
  const { activeWorkspace } = useApp();
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);

  useEffect(() => {
    if (!activeWorkspace) return;
    apiFetch<Classroom[]>("/classrooms").then(setClassrooms).catch(() => {});
  }, [activeWorkspace]);

  const grouped = classrooms.reduce<Record<string, Classroom[]>>((acc, cls) => {
    const key = cls.subject_name || "ไม่ระบุรายวิชา";
    acc[key] = acc[key] || [];
    acc[key].push(cls);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1B2E]">รายวิชา</h1>
        <p className="text-sm text-[#645D7B]">จัดกลุ่มห้องเรียนตามรายวิชาที่สอนใน Workspace ปัจจุบัน</p>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="card-soft p-8 text-center text-sm text-[#645D7B]">
          ยังไม่มีรายวิชา กรุณาสร้างห้องเรียนในเมนู &ldquo;ห้องเรียนของฉัน&rdquo;
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(grouped).map(([subject, list]) => (
            <div key={subject} className="card-soft p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-[#F2EEFF] text-[#7C5CFC] flex items-center justify-center">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-bold text-[#1F1B2E]">{subject}</h2>
                  <p className="text-xs text-[#645D7B]">{list.length} ห้องเรียน</p>
                </div>
              </div>
              <div className="space-y-2">
                {list.map((cls) => (
                  <div key={cls.id} className="rounded-xl bg-[#FAF8F5] px-3.5 py-2.5 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-[#1F1B2E]">{cls.name}</div>
                      <div className="text-xs text-[#645D7B]">รหัส {cls.code}</div>
                    </div>
                    <Link
                      href={`/assignments?classroom_id=${cls.id}`}
                      className="text-xs font-semibold text-[#7C5CFC] hover:underline"
                    >
                      ดูใบงาน →
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
