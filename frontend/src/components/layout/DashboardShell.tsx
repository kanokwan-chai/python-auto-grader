"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Award,
  BarChart3,
  BookOpen,
  CheckSquare,
  Cloud,
  Code2,
  FileCode2,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  School,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { apiFetch } from "@/lib/api";

const NAV_ITEMS = [
  { href: "/dashboard", label: "ภาพรวม (Dashboard)", icon: LayoutDashboard },
  { href: "/google-classroom", label: "ดึงงาน Classroom", icon: Cloud },
  { href: "/assignments", label: "ใบงาน & เกณฑ์ตรวจ", icon: FileCode2 },
  { href: "/grading", label: "ตรวจงาน & คะแนน", icon: CheckSquare },
  { href: "/reports", label: "ส่งออก Excel", icon: BarChart3 },
  { href: "/settings", label: "ตั้งค่าระบบ", icon: Settings },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, workspaces, activeWorkspace, setActiveWorkspaceId, refreshSession, logout, loading } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showNewWs, setShowNewWs] = useState(false);
  const [wsName, setWsName] = useState("");
  const [wsError, setWsError] = useState("");

  async function handleCreateWorkspace(e: React.FormEvent) {
    e.preventDefault();
    setWsError("");
    const slug =
      wsName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || `ws-${Date.now()}`;
    try {
      const created = await apiFetch<{ id: string }>("/workspaces", {
        method: "POST",
        skipWorkspace: true,
        body: JSON.stringify({ name: wsName, slug }),
      });
      setActiveWorkspaceId(created.id);
      await refreshSession();
      setWsName("");
      setShowNewWs(false);
    } catch (err) {
      setWsError(err instanceof Error ? err.message : "สร้าง Workspace ไม่สำเร็จ");
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card-soft px-10 py-8 text-center max-w-sm w-full">
          <img
            src="/illustrations/empty-state.jpg"
            alt="Loading Mascot"
            className="w-28 h-28 mx-auto mb-3 object-contain rounded-3xl animate-float-slow"
          />
          <p className="font-heading text-base font-medium text-[#684A96]">กำลังเตรียมพื้นที่ทำงาน...</p>
          <p className="text-xs text-[#7C6B99] mt-1">รอสักครู่นะคะ กำลังโหลดห้องเรียนและใบงาน Python</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card-soft max-w-md w-full p-8 text-center">
          <img
            src="/illustrations/empty-state.jpg"
            alt="Python Auto Grader Mascot"
            className="w-36 h-36 mx-auto mb-4 object-contain rounded-3xl animate-float-slow"
          />
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E8D9FA]/70 text-[#684A96] text-xs font-semibold mb-3">
            <Sparkles className="w-3.5 h-3.5" /> Pastel Kawaii Education Suite
          </div>
          <h1 className="font-heading text-2xl font-semibold text-[#684A96] mb-2">Python Auto Grader</h1>
          <p className="text-sm text-[#7C6B99] mb-6 leading-relaxed">
            กรุณาเข้าสู่ระบบเพื่อจัดการห้องเรียน ใบงาน และตรวจโค้ด Python อัตโนมัติ
          </p>
          <Link href="/login" className="btn-kawaii w-full py-3.5 px-6 text-sm">
            ไปหน้าเข้าสู่ระบบ
          </Link>
        </div>
      </div>
    );
  }

  const userInitial = (user.full_name || user.email || "T").slice(0, 1).toUpperCase();

  return (
    <div className="min-h-screen flex relative overflow-x-clip">
      {/* Subtle Ambient Pastel Orbs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-24 -left-24 w-80 h-80 rounded-full bg-[#E8D9FA]/55 blur-3xl" />
        <div className="absolute top-1/3 -right-24 w-96 h-96 rounded-full bg-[#F8E1EE]/60 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 w-96 h-96 rounded-full bg-[#FFF1E4]/75 blur-3xl" />
      </div>

      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-[#684A96]/20 backdrop-blur-xs z-30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Rounded Soft Lavender Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 lg:top-4 left-0 lg:ml-4 z-40 h-screen lg:h-[calc(100vh-2rem)] w-72 bg-gradient-to-b from-[#F4ECFE]/95 via-[#F8F1FE]/95 to-[#FFF5FA]/95 backdrop-blur-md border border-white lg:rounded-[2rem] shadow-[0_14px_36px_-8px_rgba(152,112,212,0.18)] flex flex-col transition-transform duration-300 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Brand Header */}
        <div className="px-5 py-5 flex items-center justify-between border-b border-[#E8D9FA]/70">
          <Link href="/dashboard" className="flex items-center gap-3 group">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#B895E8] to-[#9870D4] flex items-center justify-center text-white shadow-[0_8px_18px_-4px_rgba(152,112,212,0.45)] group-hover:scale-105 transition">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <div className="font-heading font-semibold text-[#684A96] text-base leading-tight">Python Grader</div>
              <div className="text-[11px] text-[#9870D4] font-medium flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Auto Grading Suite
              </div>
            </div>
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-2 rounded-full bg-white text-[#684A96] hover:bg-[#E8D9FA]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Workspace Switcher */}
        <div className="px-4 py-3.5 border-b border-[#E8D9FA]/70">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#7C6B99]">
              Workspace
            </span>
            <button
              onClick={() => setShowNewWs((v) => !v)}
              className="text-xs text-[#9870D4] hover:text-[#684A96] bg-white/80 hover:bg-white px-2.5 py-0.5 rounded-full border border-[#E8D9FA] flex items-center gap-0.5 font-semibold transition"
            >
              <Plus className="w-3.5 h-3.5" /> สร้างใหม่
            </button>
          </div>
          {workspaces.length > 0 ? (
            <select
              value={activeWorkspace?.id || ""}
              onChange={(e) => setActiveWorkspaceId(e.target.value)}
              className="w-full rounded-2xl bg-white border border-[#E8D9FA] px-3.5 py-2 text-sm font-medium text-[#684A96] shadow-xs"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-xs text-[#684A96] bg-[#FFE5A9]/50 border border-[#FFE5A9] rounded-2xl px-3.5 py-2.5">
              ยังไม่มี Workspace กด &ldquo;สร้างใหม่&rdquo; ด้านบนได้เลย ✨
            </div>
          )}

          {showNewWs && (
            <form onSubmit={handleCreateWorkspace} className="mt-2.5 space-y-2 bg-white/80 p-3 rounded-2xl border border-[#E8D9FA]">
              <input
                type="text"
                required
                placeholder="ชื่อ Workspace เช่น แผนกคอมพิวเตอร์"
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                className="w-full rounded-xl border border-[#E8D9FA] px-3 py-1.5 text-xs bg-white"
              />
              {wsError && <p className="text-xs text-rose-500">{wsError}</p>}
              <button type="submit" className="btn-kawaii w-full py-2 text-xs">
                บันทึก Workspace
              </button>
            </form>
          )}
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 overflow-y-auto px-3.5 py-4 space-y-1.5">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`group flex items-center gap-3 px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  active
                    ? "bg-white text-[#684A96] shadow-[0_6px_16px_-4px_rgba(152,112,212,0.22)] border border-[#E8D9FA] translate-x-1"
                    : "text-[#7C6B99] hover:bg-white/65 hover:text-[#684A96] hover:translate-x-0.5"
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition ${
                    active
                      ? "bg-[#E8D9FA] text-[#684A96]"
                      : "bg-[#E8D9FA]/45 text-[#9870D4] group-hover:bg-[#E8D9FA]"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User Footer */}
        <div className="p-4 border-t border-[#E8D9FA]/70 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#F8E1EE] to-[#E8D9FA] border-2 border-white shadow-xs flex items-center justify-center text-sm font-bold text-[#684A96] shrink-0">
              {userInitial}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#4A3869] truncate">{user.full_name || user.email}</div>
              <div className="text-[11px] text-[#7C6B99] truncate">{user.email}</div>
            </div>
          </div>
          <button
            onClick={() => {
              logout();
              router.push("/login");
            }}
            title="ออกจากระบบ"
            className="p-2 rounded-full bg-white/80 text-[#7C6B99] hover:bg-[#F7DCE8] hover:text-[#684A96] transition shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 px-4 lg:px-8 pt-4 pb-2">
          <div className="bg-white/85 backdrop-blur-md border border-white rounded-full shadow-[0_8px_24px_-6px_rgba(152,112,212,0.12)] px-4 lg:px-6 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setMobileOpen(true)}
                className="lg:hidden p-2 rounded-full bg-[#F4ECFE] text-[#684A96]"
              >
                <Menu className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-[#9870D4]">พื้นที่ทำงานปัจจุบัน</div>
                <div className="font-heading text-sm font-semibold text-[#684A96] truncate">
                  {activeWorkspace ? activeWorkspace.name : "กรุณาสร้างหรือเลือก Workspace"}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <Link href="/assignments/new" className="btn-kawaii px-4 py-2 text-xs sm:text-sm">
                <Plus className="w-4 h-4" /> สร้างใบงานใหม่
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 lg:px-8 py-5 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
