"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Award,
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
  const { user, activeWorkspace } = useApp();
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
          src="/illustrations/empty-state.jpg"
          alt="Create Workspace Mascot"
          className="w-40 h-40 mx-auto mb-4 object-contain rounded-3xl animate-float-slow"
        />
        <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-[#E8D9FA]/70 text-[#684A96] text-xs font-semibold mb-3">
          <Sparkles className="w-3.5 h-3.5" /> เริ่มต้นใช้งานใน 1 คลิก
        </div>
        <h2 className="font-heading text-2xl font-semibold text-[#684A96] mb-2">เริ่มต้นสร้าง Workspace ของคุณ</h2>
        <p className="text-sm text-[#7C6B99] leading-relaxed">
          กดปุ่ม &ldquo;+ สร้างใหม่&rdquo; ในแถบเมนูด้านซ้ายเพื่อสร้างพื้นที่ทำงานสำหรับห้องเรียน รายวิชา และใบงาน Python ของคุณได้เลยค่ะ
        </p>
      </div>
    );
  }

  const cards = [
    { label: "จำนวนห้องเรียน", value: stats?.total_classrooms ?? 0, icon: School, bg: "bg-[#E8D9FA]", color: "text-[#684A96]" },
    { label: "จำนวนใบงาน", value: stats?.total_assignments ?? 0, icon: FileCode2, bg: "bg-[#FFF1E4]", color: "text-[#D97745]" },
    { label: "จำนวนนักเรียน", value: stats?.total_students ?? 0, icon: Users, bg: "bg-[#DDF1E7]", color: "text-[#2E7D5B]" },
    { label: "ส่งงานแล้ว", value: stats?.submitted_count ?? 0, icon: CheckCircle2, bg: "bg-[#DCEBFA]", color: "text-[#3B6EA5]" },
    { label: "ยังไม่ส่งงาน", value: stats?.not_submitted_count ?? 0, icon: AlertCircle, bg: "bg-[#F7DCE8]", color: "text-[#A8386B]" },
    { label: "รอตรวจ", value: stats?.pending_grading_count ?? 0, icon: Clock, bg: "bg-[#FFE5A9]", color: "text-[#9A6700]" },
    { label: "ตรวจเสร็จแล้ว", value: stats?.graded_count ?? 0, icon: Award, bg: "bg-[#DDF1E7]", color: "text-[#2E7D5B]" },
    {
      label: "อัตราการผ่านเกณฑ์",
      value: stats?.pass_rate_percent != null ? `${stats.pass_rate_percent}%` : "-",
      icon: TrendingUp,
      bg: "bg-[#F8E1EE]",
      color: "text-[#9870D4]",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Pastel Kawaii 3D Welcome Hero Banner */}
      <div className="rounded-[2rem] bg-gradient-to-r from-[#E8D9FA]/85 via-[#F8E1EE]/80 to-[#FFF1E4]/90 border-2 border-white shadow-[0_16px_36px_-8px_rgba(152,112,212,0.18)] p-6 sm:p-7 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
        <div className="space-y-3 relative z-10 text-center md:text-left">
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-white/85 text-[#684A96] text-xs font-semibold shadow-xs">
            <Sparkles className="w-3.5 h-3.5 text-[#9870D4]" /> ยินดีต้อนรับกลับมา, {user?.full_name || "ครูผู้สอน"}
          </div>
          <h1 className="font-heading text-2xl sm:text-3xl font-semibold text-[#684A96]">
            ภาพรวมระบบตรวจงาน Python
          </h1>
          <p className="text-sm text-[#7C6B99] max-w-xl">
            ติดตามห้องเรียน ใบงาน การส่งงานแบบผสม และผลคะแนนอัตโนมัติใน Workspace &ldquo;{activeWorkspace.name}&rdquo;
          </p>
          <div className="flex flex-wrap justify-center md:justify-start gap-2.5 pt-1">
            <Link href="/google-classroom" className="btn-kawaii-soft px-4 py-2 text-xs sm:text-sm bg-white/90">
              <Cloud className="w-4 h-4 text-[#9870D4]" /> เชื่อม Google Classroom
            </Link>
            <Link href="/reports" className="btn-kawaii-peach px-4 py-2 text-xs sm:text-sm">
              <FileSpreadsheet className="w-4 h-4" /> ส่งออกรายงาน Excel
            </Link>
          </div>
        </div>

        <div className="shrink-0 relative z-10">
          <img
            src="/illustrations/hero-mascot.jpg"
            alt="Python Auto Grader Mascot"
            className="w-36 h-36 sm:w-40 sm:h-40 object-contain rounded-3xl drop-shadow-[0_10px_20px_rgba(152,112,212,0.2)] animate-float-slow"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-2xl bg-[#F7DCE8]/70 border border-[#F8E1EE] px-4 py-3 text-sm text-[#9D2B5B]">
          {error}
        </div>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="card-soft p-5 flex items-center justify-between hover:-translate-y-0.5">
              <div>
                <div className="text-xs font-medium text-[#7C6B99] mb-1">{c.label}</div>
                <div className="font-heading text-2xl font-semibold text-[#4A3869]">{c.value}</div>
              </div>
              <div className={`w-12 h-12 rounded-2xl ${c.bg} ${c.color} flex items-center justify-center shadow-xs`}>
                <Icon className="w-6 h-6" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Pastel Score Summary Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-[1.75rem] bg-gradient-to-br from-white to-[#F4ECFE] border border-[#E8D9FA] p-6 shadow-[0_12px_28px_-8px_rgba(152,112,212,0.14)]">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#9870D4] mb-1">คะแนนเฉลี่ย</div>
          <div className="font-heading text-3xl font-semibold text-[#684A96]">
            {stats?.average_score != null ? stats.average_score : "-"}
          </div>
          <div className="text-xs text-[#7C6B99] mt-1">คำนวณจากงานที่ตรวจเสร็จทั้งหมดใน Workspace</div>
        </div>
        <div className="rounded-[1.75rem] bg-gradient-to-br from-white to-[#DDF1E7]/70 border border-[#DDF1E7] p-6 shadow-[0_12px_28px_-8px_rgba(46,125,91,0.10)]">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#2E7D5B] mb-1">คะแนนสูงสุด</div>
          <div className="font-heading text-3xl font-semibold text-[#2E7D5B]">
            {stats?.max_score_achieved != null ? stats.max_score_achieved : "-"}
          </div>
          <div className="text-xs text-[#7C6B99] mt-1">คะแนนสูงสุดที่นักเรียนทำได้</div>
        </div>
        <div className="rounded-[1.75rem] bg-gradient-to-br from-white to-[#FFF1E4] border border-[#FFE5A9]/70 p-6 shadow-[0_12px_28px_-8px_rgba(217,119,69,0.10)]">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#D97745] mb-1">คะแนนต่ำสุด</div>
          <div className="font-heading text-3xl font-semibold text-[#D97745]">
            {stats?.min_score_achieved != null ? stats.min_score_achieved : "-"}
          </div>
          <div className="text-xs text-[#7C6B99] mt-1">ใช้ติดตามนักเรียนที่ควรได้รับการช่วยเหลือ</div>
        </div>
      </div>
    </div>
  );
}
