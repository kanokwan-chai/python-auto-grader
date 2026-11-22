"use client";

import React, { useEffect, useState, useCallback } from "react";
import { History, Shield, UserPlus, Users } from "lucide-react";
import { useApp } from "@/components/providers/AppProvider";
import { apiFetch } from "@/lib/api";
import type { WorkspaceMember } from "@/lib/types";

interface AuditLogEntry {
  id: string;
  actor_email?: string | null;
  action: string;
  resource_type: string;
  resource_id?: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export default function SettingsPage() {
  const { user, activeWorkspace } = useApp();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  // Add Member Form
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"teacher" | "member">("member");
  const [canEditGrades, setCanEditGrades] = useState(false);
  const [canApproveGrades, setCanApproveGrades] = useState(false);
  const [canSyncClassroom, setCanSyncClassroom] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      const [memList, logs] = await Promise.all([
        apiFetch<WorkspaceMember[]>(`/workspaces/${activeWorkspace.id}/members`).catch(() => []),
        apiFetch<AuditLogEntry[]>("/audit-logs?limit=30").catch(() => []),
      ]);
      setMembers(memList);
      setAuditLogs(logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดข้อมูลการตั้งค่าไม่สำเร็จ");
    }
  }, [activeWorkspace]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!activeWorkspace) return;
    setError("");
    setMessage("");
    try {
      await apiFetch(`/workspaces/${activeWorkspace.id}/members`, {
        method: "POST",
        body: JSON.stringify({
          email,
          full_name: fullName || null,
          role,
          can_edit_grades: role === "teacher" ? true : canEditGrades,
          can_approve_grades: role === "teacher" ? true : canApproveGrades,
          can_sync_classroom: role === "teacher" ? true : canSyncClassroom,
        }),
      });
      setEmail("");
      setFullName("");
      setCanEditGrades(false);
      setCanApproveGrades(false);
      setCanSyncClassroom(false);
      setMessage("เพิ่มสมาชิกเข้าสู่ Workspace เรียบร้อยแล้ว");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เพิ่มสมาชิกไม่สำเร็จ");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1F1B2E]">ตั้งค่าระบบและสิทธิ์ผู้ใช้งาน</h1>
        <p className="text-sm text-[#645D7B]">
          จัดการสมาชิกใน Workspace กำหนดสิทธิ์การแก้ไข/อนุมัติคะแนน และตรวจสอบประวัติความปลอดภัย (Audit Logs)
        </p>
      </div>

      {message && (
        <div className="rounded-2xl bg-[#ECFDF5] border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-[#FFF1F2] border border-rose-200 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {/* Workspace & Security Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card-soft p-5 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-[#645D7B]">ข้อมูล Workspace</div>
          <div className="text-lg font-bold text-[#1F1B2E]">{activeWorkspace?.name || "-"}</div>
          <div className="text-xs text-[#645D7B]">
            Slug: <code className="px-1.5 py-0.5 rounded bg-[#FAF8F5]">{activeWorkspace?.slug}</code> • แผน:{" "}
            <span className="font-semibold text-[#7C5CFC]">{activeWorkspace?.plan_tier || "standard"}</span>
          </div>
          <div className="text-xs text-[#645D7B]">
            ผู้ใช้งานปัจจุบัน: {user?.full_name} ({user?.email}) • สิทธิ์ระบบ: {user?.global_role}
          </div>
        </div>

        <div className="card-soft p-5 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#645D7B]">
            <Shield className="w-4 h-4 text-[#7C5CFC]" /> มาตรการความปลอดภัยของระบบ
          </div>
          <ul className="text-xs text-[#1F1B2E] space-y-1.5">
            <li>• แยกข้อมูลทุก Workspace ด้วย PostgreSQL Row Level Security (RLS)</li>
            <li>• รันโค้ดนักเรียนใน Docker / gVisor Isolated Sandbox ปิด Network ขาออก</li>
            <li>• เข้ารหัส Google OAuth Token ด้วย Fernet Encryption</li>
            <li>• บันทึก Audit Logs ทุกการปรับคะแนน อนุมัติคะแนน และส่งคะแนนกลับ Classroom</li>
          </ul>
        </div>
      </div>

      {/* Workspace Members Management */}
      <div className="card-soft p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-[#7C5CFC]" />
          <h2 className="font-bold text-[#1F1B2E]">สมาชิกและสิทธิ์ใน Workspace</h2>
        </div>

        <form onSubmit={handleAddMember} className="rounded-2xl bg-[#FAF8F5] border border-[#ECE7F6] p-4 space-y-3">
          <div className="text-xs font-semibold text-[#1F1B2E] flex items-center gap-1.5">
            <UserPlus className="w-4 h-4 text-[#7C5CFC]" /> เชิญสมาชิก / ครูร่วมสอน
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="email"
              required
              placeholder="อีเมลสมาชิก เช่น ta@school.ac.th"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-xl border border-[#DDD4FF] bg-white px-3 py-2 text-xs"
            />
            <input
              type="text"
              placeholder="ชื่อ-นามสกุล"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="rounded-xl border border-[#DDD4FF] bg-white px-3 py-2 text-xs"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "teacher" | "member")}
              className="rounded-xl border border-[#DDD4FF] bg-white px-3 py-2 text-xs"
            >
              <option value="member">Workspace Member (จำกัดสิทธิ์ตามที่กำหนด)</option>
              <option value="teacher">Teacher (สิทธิ์ครูผู้สอนครบถ้วน)</option>
            </select>
          </div>

          {role === "member" && (
            <div className="flex flex-wrap gap-4 pt-1 text-xs text-[#1F1B2E]">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={canEditGrades}
                  onChange={(e) => setCanEditGrades(e.target.checked)}
                  className="accent-[#7C5CFC]"
                />
                แก้ไขคะแนนได้
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={canApproveGrades}
                  onChange={(e) => setCanApproveGrades(e.target.checked)}
                  className="accent-[#7C5CFC]"
                />
                อนุมัติคะแนนได้
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={canSyncClassroom}
                  onChange={(e) => setCanSyncClassroom(e.target.checked)}
                  className="accent-[#7C5CFC]"
                />
                ส่งคะแนนกลับ Google Classroom ได้
              </label>
            </div>
          )}

          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-[#7C5CFC] hover:bg-[#6846F5] text-white text-xs font-semibold"
          >
            เพิ่มสมาชิกเข้า Workspace
          </button>
        </form>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F2EEFF]/70 text-[#645D7B] uppercase">
              <tr>
                <th className="px-4 py-2.5">สมาชิก</th>
                <th className="px-4 py-2.5">บทบาท</th>
                <th className="px-4 py-2.5">แก้ไขคะแนน</th>
                <th className="px-4 py-2.5">อนุมัติคะแนน</th>
                <th className="px-4 py-2.5">Sync Classroom</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F2EEFF]">
              {members.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[#645D7B]">
                    ไม่พบรายชื่อสมาชิก (หรือบัญชีของคุณไม่มีสิทธิ์ดูรายชื่อสมาชิก)
                  </td>
                </tr>
              ) : (
                members.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#1F1B2E]">{m.full_name || m.email}</div>
                      <div className="text-[#645D7B]">{m.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full bg-[#F2EEFF] text-[#7C5CFC] font-semibold">
                        {m.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">{m.can_edit_grades ? "✓" : "—"}</td>
                    <td className="px-4 py-3">{m.can_approve_grades ? "✓" : "—"}</td>
                    <td className="px-4 py-3">{m.can_sync_classroom ? "✓" : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Logs */}
      <div className="card-soft p-6 space-y-4">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-[#FF9F7F]" />
          <h2 className="font-bold text-[#1F1B2E]">ประวัติการใช้งานระบบ (Audit Logs)</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#FAF8F5] text-[#645D7B] uppercase border-b border-[#ECE7F6]">
              <tr>
                <th className="px-4 py-2.5">เวลา</th>
                <th className="px-4 py-2.5">ผู้ดำเนินการ</th>
                <th className="px-4 py-2.5">การกระทำ</th>
                <th className="px-4 py-2.5">ทรัพยากร</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F2EEFF]">
              {auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-[#645D7B]">
                    ยังไม่มีบันทึก Audit Logs ใน Workspace นี้
                  </td>
                </tr>
              ) : (
                auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-4 py-2.5 text-[#645D7B] whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString("th-TH")}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-[#1F1B2E]">{log.actor_email || "-"}</td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded-full bg-[#FFF1EB] text-[#E6744C] font-semibold">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[#645D7B]">
                      {log.resource_type} {log.resource_id ? `(${log.resource_id.slice(0, 8)}...)` : ""}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
