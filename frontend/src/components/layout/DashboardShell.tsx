"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  CheckSquare,
  Cloud,
  FileCode2,
  Home,
  LogOut,
  Menu,
  Plus,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { apiFetch } from "@/lib/api";

const NAV_ITEMS = [
  { href: "/dashboard", label: "ภาพรวม (Dashboard)", shortLabel: "หน้าหลัก", icon: Home },
  { href: "/google-classroom", label: "ดึงงาน Classroom", shortLabel: "Classroom", icon: Cloud },
  { href: "/assignments", label: "ใบงาน & เกณฑ์ตรวจ", shortLabel: "ใบงาน", icon: FileCode2 },
  { href: "/grading", label: "ตรวจงาน & คะแนน", shortLabel: "ตรวจงาน", icon: CheckSquare },
  { href: "/reports", label: "ส่งออก Excel", shortLabel: "สถิติ", icon: BarChart3 },
  { href: "/settings", label: "ตั้งค่าระบบ", shortLabel: "ตั้งค่าระบบ", icon: Settings },
];

function PythonBrandLogo({ className = "w-9 h-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="pyBlue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5BB8FF" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>
        <linearGradient id="pyGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FDE047" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
      </defs>
      <path
        d="M23.8 5C14.8 5 15.4 8.9 15.4 8.9V13H24V14.5H12.1C12.1 14.5 6 13.8 6 23.2C6 32.6 11.3 32.2 11.3 32.2H14.5V27.6C14.5 27.6 14.3 22.3 19.7 22.3H28.3C28.3 22.3 33.1 22.4 33.1 17.6V9.8C33.1 9.8 33.8 5 23.8 5ZM19.1 7.9C20 7.9 20.7 8.6 20.7 9.5C20.7 10.4 20 11.1 19.1 11.1C18.2 11.1 17.5 10.4 17.5 9.5C17.5 8.6 18.2 7.9 19.1 7.9Z"
        fill="url(#pyBlue)"
      />
      <path
        d="M24.2 43C33.2 43 32.6 39.1 32.6 39.1V35H24V33.5H35.9C35.9 33.5 42 34.2 42 24.8C42 15.4 36.7 15.8 36.7 15.8H33.5V20.4C33.5 20.4 33.7 25.7 28.3 25.7H19.7C19.7 25.7 14.9 25.6 14.9 30.4V38.2C14.9 38.2 14.2 43 24.2 43ZM28.9 40.1C28 40.1 27.3 39.4 27.3 38.5C27.3 37.6 28 36.9 28.9 36.9C29.8 36.9 30.5 37.6 30.5 38.5C30.5 39.4 29.8 40.1 28.9 40.1Z"
        fill="url(#pyGold)"
      />
    </svg>
  );
}

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
          <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-[#2B185A] border border-purple-400/30 flex items-center justify-center animate-float-slow">
            <PythonBrandLogo className="w-10 h-10" />
          </div>
          <p className="font-heading text-base font-medium text-white">กำลังเตรียมพื้นที่ทำงาน...</p>
          <p className="text-xs text-[#C4B5E6] mt-1">กำลังโหลดห้องเรียนและใบงาน Python</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card-soft max-w-md w-full p-8 text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-3xl bg-[#2B185A] border border-purple-400/40 flex items-center justify-center shadow-[0_0_28px_rgba(180,76,255,0.35)] animate-float-slow">
            <PythonBrandLogo className="w-12 h-12" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/20 border border-purple-400/30 text-purple-200 text-xs font-semibold mb-3">
            <Sparkles className="w-3.5 h-3.5 text-pink-400" /> Auto Grading Suite
          </div>
          <h1 className="font-heading text-2xl font-semibold text-white mb-2">Python Auto Grader</h1>
          <p className="text-sm text-[#C4B5E6] mb-6 leading-relaxed">
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
      {/* Cosmic Ambient Glows */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-[#9B51E0]/20 blur-3xl" />
        <div className="absolute top-1/3 -right-24 w-96 h-96 rounded-full bg-[#E857B5]/15 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 w-96 h-96 rounded-full bg-[#6366F1]/15 blur-3xl" />
      </div>

      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/55 backdrop-blur-xs z-30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Deep Cosmic Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-40 h-screen w-68 bg-gradient-to-b from-[#170D35]/98 via-[#1A0F3D]/98 to-[#140B2E]/98 border-r border-purple-400/20 shadow-[8px_0_32px_rgba(7,3,20,0.6)] flex flex-col transition-transform duration-300 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Brand Header */}
        <div className="px-5 py-5 flex items-center justify-between border-b border-purple-400/15">
          <Link href="/dashboard" className="flex items-center gap-3 group">
            <div className="w-11 h-11 rounded-2xl bg-[#271654] border border-purple-400/35 flex items-center justify-center shadow-[0_0_20px_rgba(155,81,224,0.35)] group-hover:scale-105 transition">
              <PythonBrandLogo className="w-7 h-7" />
            </div>
            <div>
              <div className="font-heading font-semibold text-white text-base leading-tight">Python Grader</div>
              <div className="text-[11px] text-purple-300 font-medium">&lt;/&gt; Auto Grading Suite</div>
            </div>
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            className="lg:hidden p-2 rounded-full bg-purple-500/20 text-purple-200 hover:bg-purple-500/30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Workspace Switcher */}
        <div className="px-4 py-3.5 border-b border-purple-400/15">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-purple-300/80">
              WORKSPACE
            </span>
            <button
              onClick={() => setShowNewWs((v) => !v)}
              className="text-[11px] text-white bg-gradient-to-r from-[#FF7597] to-[#FF9472] hover:brightness-110 px-2.5 py-0.5 rounded-full flex items-center gap-0.5 font-semibold shadow-sm transition"
            >
              <Plus className="w-3 h-3" /> สร้างใหม่
            </button>
          </div>
          {workspaces.length > 0 ? (
            <select
              value={activeWorkspace?.id || ""}
              onChange={(e) => setActiveWorkspaceId(e.target.value)}
              className="w-full rounded-xl bg-[#23144D] border border-purple-400/30 px-3 py-2 text-xs font-medium text-white"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-xs text-amber-200 bg-amber-500/15 border border-amber-400/30 rounded-xl px-3 py-2">
              ยังไม่มี Workspace กด &ldquo;สร้างใหม่&rdquo; ด้านบน
            </div>
          )}

          {showNewWs && (
            <form onSubmit={handleCreateWorkspace} className="mt-2.5 space-y-2 bg-[#23144D]/80 p-3 rounded-2xl border border-purple-400/25">
              <input
                type="text"
                required
                placeholder="ชื่อ Workspace เช่น แผนกคอมพิวเตอร์"
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                className="w-full rounded-xl px-3 py-1.5 text-xs"
              />
              {wsError && <p className="text-xs text-rose-300">{wsError}</p>}
              <button type="submit" className="btn-kawaii w-full py-2 text-xs">
                บันทึก Workspace
              </button>
            </form>
          )}
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`group flex items-center gap-3 px-3.5 py-2.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  active
                    ? "bg-gradient-to-r from-[#E857B5] via-[#B44CFF] to-[#7B5CFF] text-white shadow-[0_6px_22px_-3px_rgba(232,87,181,0.55)]"
                    : "text-purple-200/80 hover:bg-purple-500/15 hover:text-white"
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition ${
                    active ? "bg-white/20 text-white" : "bg-purple-500/15 text-purple-300 group-hover:text-white"
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
        <div className="p-4 border-t border-purple-400/15 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#E857B5] to-[#7B5CFF] border-2 border-purple-200/50 shadow-sm flex items-center justify-center text-sm font-bold text-white shrink-0">
              {userInitial}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate">{user.full_name || user.email}</div>
              <div className="text-[11px] text-purple-300/80 truncate">{user.email}</div>
            </div>
          </div>
          <button
            onClick={() => {
              logout();
              router.push("/login");
            }}
            title="ออกจากระบบ"
            className="p-2 rounded-full bg-purple-500/15 text-purple-200 hover:bg-rose-500/25 hover:text-rose-200 transition shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Glass Navigation Bar */}
        <header className="sticky top-0 z-20 px-4 lg:px-7 pt-3.5 pb-2">
          <div className="bg-[#1B103D]/90 backdrop-blur-md border border-purple-400/25 rounded-full shadow-[0_8px_28px_rgba(7,3,20,0.5)] px-3.5 lg:px-5 py-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 overflow-x-auto">
              <button
                onClick={() => setMobileOpen(true)}
                className="lg:hidden p-2 rounded-full bg-purple-500/20 text-purple-100 shrink-0"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="hidden md:flex items-center gap-1.5">
                {NAV_ITEMS.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition whitespace-nowrap ${
                        active
                          ? "bg-gradient-to-r from-[#B44CFF] to-[#7B5CFF] text-white shadow-[0_4px_14px_rgba(180,76,255,0.5)]"
                          : "text-purple-200/80 hover:text-white hover:bg-purple-500/15"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {item.shortLabel}
                    </Link>
                  );
                })}
              </div>

              <div className="md:hidden text-xs font-semibold text-white truncate">
                {activeWorkspace ? activeWorkspace.name : "Python Auto Grader"}
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0">
              <Link href="/assignments/new" className="btn-kawaii px-3.5 py-1.5 text-xs">
                <Plus className="w-3.5 h-3.5" /> สร้างใบงานใหม่
              </Link>
              <div className="hidden sm:flex items-center gap-2 pl-2 pr-3 py-1 rounded-full bg-[#271654] border border-purple-400/30">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#FF7597] to-[#9B51E0] flex items-center justify-center text-xs font-bold text-white">
                  {userInitial}
                </div>
                <div className="leading-tight">
                  <div className="text-xs font-semibold text-white max-w-28 truncate">{user.full_name || "ครูผู้สอน"}</div>
                  <div className="text-[10px] text-purple-300">ครูผู้สอน</div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 lg:px-7 py-5 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
