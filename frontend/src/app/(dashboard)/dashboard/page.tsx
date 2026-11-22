"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Cloud,
  FileCode2,
  FileSpreadsheet,
  School,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { apiFetch } from "@/lib/api";
import type { DashboardStats } from "@/lib/types";

export default function DashboardPage() {
  const { activeWorkspace } = useApp();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!activeWorkspace) return;
    apiFetch<DashboardStats>("/reports/dashboard")
      .then(setStats)
      .catch((err) => setError(err.message));
  }, [activeWorkspace]);

  if (!activeWorkspace) {
    return (
      <div className="card-kawaii-tint p-10 text-center max-w-xl mx-auto my-6">
        <img
          src="/illustrations/cosmic-mascot.jpg"
          alt="Create Workspace Mascot"
          className="w-36 h-36 mx-auto mb-4 object-cover rounded-3xl border border-purple-300/35 animate-float-slow"
        />
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-purple-500/25 border border-purple-400/30 text-purple-200 text-xs font-semibold mb-3">
          <Sparkles className="w-3.5 h-3.5 text-pink-400" /> เริ่มต้นใช้งานใน 1 คลิก
        </div>
        <h2 className="font-heading text-2xl font-semibold text-white mb-2">เริ่มต้นสร้าง Workspace ของคุณ</h2>
        <p className="text-sm text-purple-200/80 leading-relaxed">
          กดปุ่ม &ldquo;+ สร้างใหม่&rdquo; ในแถบเมนูด้านซ้ายเพื่อสร้างพื้นที่ทำงานสำหรับห้องเรียนและใบงาน Python ของคุณ
        </p>
      </div>
    );
  }

  const kpiCards = [
    {
      label: "จำนวนห้องเรียน",
      value: stats?.total_classrooms ?? 0,
      icon: School,
      badgeBg: "from-[#A855F7] to-[#7C3AED]",
    },
    {
      label: "จำนวนใบงาน",
      value: stats?.total_assignments ?? 0,
      icon: FileCode2,
      badgeBg: "from-[#38BDF8] to-[#2563EB]",
    },
    {
      label: "จำนวนนักเรียน",
      value: stats?.total_students ?? 0,
      icon: Users,
      badgeBg: "from-[#34D399] to-[#059669]",
    },
    {
      label: "ส่งงานแล้ว",
      value: stats?.submitted_count ?? 0,
      icon: CheckCircle2,
      badgeBg: "from-[#FBBF24] to-[#EA580C]",
    },
    {
      label: "รอตรวจ",
      value: stats?.pending_grading_count ?? 0,
      icon: Clock,
      badgeBg: "from-[#F472B6] to-[#DB2777]",
    },
    {
      label: "อัตราการผ่านเกณฑ์",
      value: stats?.pass_rate_percent != null ? `${stats.pass_rate_percent}%` : "-",
      icon: TrendingUp,
      badgeBg: "from-[#C084FC] to-[#6366F1]",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Cosmic Neon-Purple Welcome Hero Banner */}
      <div className="rounded-[1.75rem] bg-gradient-to-r from-[#241354] via-[#341973] to-[#21124B] border border-purple-400/35 shadow-[0_18px_44px_rgba(7,3,20,0.65)] p-6 sm:p-7 flex flex-col lg:flex-row items-center justify-between gap-6 relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-center gap-5 relative z-10 text-center sm:text-left">
          <div className="w-16 h-16 rounded-2xl bg-[#1A0E3D] border border-purple-400/35 flex items-center justify-center shadow-[0_0_24px_rgba(168,85,247,0.4)] shrink-0">
            <svg viewBox="0 0 48 48" className="w-11 h-11" fill="none">
              <path
                d="M23.8 5C14.8 5 15.4 8.9 15.4 8.9V13H24V14.5H12.1C12.1 14.5 6 13.8 6 23.2C6 32.6 11.3 32.2 11.3 32.2H14.5V27.6C14.5 27.6 14.3 22.3 19.7 22.3H28.3C28.3 22.3 33.1 22.4 33.1 17.6V9.8C33.1 9.8 33.8 5 23.8 5Z"
                fill="#5BB8FF"
              />
              <path
                d="M24.2 43C33.2 43 32.6 39.1 32.6 39.1V35H24V33.5H35.9C35.9 33.5 42 34.2 42 24.8C42 15.4 36.7 15.8 36.7 15.8H33.5V20.4C33.5 20.4 33.7 25.7 28.3 25.7H19.7C19.7 25.7 14.9 25.6 14.9 30.4V38.2C14.9 38.2 14.2 43 24.2 43Z"
                fill="#FBBF24"
              />
            </svg>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-purple-200/90">ยินดีต้อนรับสู่</div>
            <h1 className="font-heading text-2xl sm:text-4xl font-semibold text-white">
              Python{" "}
              <span className="bg-gradient-to-r from-[#FF7597] via-[#E857B5] to-[#C084FC] bg-clip-text text-transparent">
                Grader
              </span>
            </h1>
            <p className="text-sm text-purple-200/85">
              ระบบตรวจงานและให้คะแนนโค้ด Python อัตโนมัติ ({activeWorkspace.name})
            </p>
            <div className="flex flex-wrap justify-center sm:justify-start gap-2.5 pt-2">
              <Link href="/google-classroom" className="btn-kawaii px-4 py-2 text-xs">
                <Cloud className="w-4 h-4" /> ดึงงาน Google Classroom
              </Link>
              <Link href="/reports" className="btn-kawaii-peach px-4 py-2 text-xs">
                <FileSpreadsheet className="w-4 h-4" /> ส่งออกรายงาน Excel
              </Link>
            </div>
          </div>
        </div>

        {/* Right: 3D Robot Mascot + Quick Feature Checklist */}
        <div className="flex items-center gap-4 relative z-10 shrink-0">
          <img
            src="/illustrations/cosmic-mascot.jpg"
            alt="Python Grader 3D Mascot"
            className="w-28 h-28 sm:w-32 sm:h-32 object-cover rounded-3xl border border-purple-300/40 shadow-[0_0_28px_rgba(180,76,255,0.45)] animate-float-slow"
          />
          <div className="hidden sm:block rounded-2xl bg-[#190D3B]/80 border border-purple-400/25 px-4 py-3 space-y-1.5 text-xs text-purple-100">
            {["สร้างใบงาน", "ตรวจโค้ดอัตโนมัติ", "ให้คะแนนตามเกณฑ์", "ส่งผลกลับ Classroom"].map((item) => (
              <div key={item} className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-500/20 border border-rose-400/35 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* 6 Glossy KPI Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpiCards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="card-soft p-4 flex items-center gap-3.5 hover:-translate-y-0.5">
              <div
                className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${c.badgeBg} text-white flex items-center justify-center shadow-lg shrink-0`}
              >
                <Icon className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-purple-200/80 truncate">{c.label}</div>
                <div className="font-heading text-2xl font-semibold text-white leading-tight">{c.value}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Score Summary Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card-soft p-6 border-purple-400/35">
          <div className="text-xs font-semibold uppercase tracking-wider text-purple-300 mb-1">คะแนนเฉลี่ย</div>
          <div className="font-heading text-3xl font-semibold text-white">
            {stats?.average_score != null ? stats.average_score : "-"}
          </div>
          <div className="text-xs text-purple-200/75 mt-1">คำนวณจากงานที่ตรวจเสร็จทั้งหมดใน Workspace</div>
        </div>
        <div className="card-soft p-6 border-emerald-400/30">
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-300 mb-1">คะแนนสูงสุด</div>
          <div className="font-heading text-3xl font-semibold text-emerald-300">
            {stats?.max_score_achieved != null ? stats.max_score_achieved : "-"}
          </div>
          <div className="text-xs text-purple-200/75 mt-1">คะแนนสูงสุดที่นักเรียนทำได้</div>
        </div>
        <div className="card-soft p-6 border-orange-400/30">
          <div className="text-xs font-semibold uppercase tracking-wider text-orange-300 mb-1">คะแนนต่ำสุด</div>
          <div className="font-heading text-3xl font-semibold text-orange-300">
            {stats?.min_score_achieved != null ? stats.min_score_achieved : "-"}
          </div>
          <div className="text-xs text-purple-200/75 mt-1">ใช้ติดตามนักเรียนที่ควรได้รับการช่วยเหลือ</div>
        </div>
      </div>
    </div>
  );
}
