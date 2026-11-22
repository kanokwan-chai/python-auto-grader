"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Code2, ShieldCheck, Sparkles, Stars } from "lucide-react";
import { apiFetch } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiFetch<{ access_token: string }>("/auth/dev-session", {
        method: "POST",
        skipWorkspace: true,
        body: JSON.stringify({
          email,
          full_name: fullName || email.split("@")[0],
          role: "teacher",
        }),
      });
      localStorage.setItem("pygrader_token", res.access_token);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative Pastel Translucent Orbs */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-[#E8D9FA]/70 blur-3xl" />
        <div className="absolute top-1/4 -right-24 w-96 h-96 rounded-full bg-[#F8E1EE]/75 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 w-96 h-96 rounded-full bg-[#FFF1E4]/85 blur-3xl" />
      </div>

      <div className="max-w-5xl w-full grid md:grid-cols-12 gap-6 items-stretch">
        {/* Pastel Kawaii 3D Brand Showcase */}
        <div className="md:col-span-6 rounded-[2rem] bg-gradient-to-br from-[#E8D9FA] via-[#F8E1EE] to-[#FFF1E4] border-2 border-white p-8 flex flex-col justify-between shadow-[0_18px_40px_-10px_rgba(152,112,212,0.22)] relative overflow-hidden">
          <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-white/45 blur-xl" />

          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/80 border border-white text-[#684A96] text-xs font-semibold shadow-xs mb-5">
              <Code2 className="w-4 h-4 text-[#9870D4]" /> Python Auto Grader
            </div>
            <h1 className="font-heading text-3xl font-semibold text-[#684A96] leading-snug mb-2">
              ตรวจงาน Python อัตโนมัติ
              <br />
              อย่างน่ารักและแม่นยำ ✨
            </h1>
            <p className="text-[#7C6B99] text-sm leading-relaxed">
              รองรับ Google Classroom, Google Colab, Jupyter Notebook, Python File และ ZIP Project พร้อม Isolated Sandbox และ AI Feedback ภาษาไทย
            </p>
          </div>

          <div className="my-5 flex justify-center relative z-10">
            <img
              src="/illustrations/hero-mascot.jpg"
              alt="Python Auto Grader 3D Kawaii Mascot"
              className="w-56 h-56 object-contain rounded-[1.75rem] drop-shadow-[0_14px_24px_rgba(152,112,212,0.22)] animate-float-slow"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 relative z-10">
            <div className="flex items-center gap-2.5 text-xs font-medium bg-white/80 border border-white text-[#684A96] rounded-2xl px-3.5 py-2.5 shadow-xs">
              <span className="w-7 h-7 rounded-full bg-[#DDF1E7] text-[#2F7D5B] flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </span>
              <span>RLS + Docker Sandbox ปลอดภัย</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs font-medium bg-white/80 border border-white text-[#684A96] rounded-2xl px-3.5 py-2.5 shadow-xs">
              <span className="w-7 h-7 rounded-full bg-[#FFE5A9] text-[#9A6700] flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </span>
              <span>AST + Test Cases + AI Review</span>
            </div>
          </div>
        </div>

        {/* Rounded Kawaii Auth Form */}
        <div className="md:col-span-6 card-soft p-8 sm:p-10 flex flex-col justify-center">
          <div className="inline-flex items-center gap-1.5 self-start px-3 py-1 rounded-full bg-[#F4ECFE] text-[#9870D4] text-xs font-semibold mb-4">
            <Stars className="w-3.5 h-3.5" /> ยินดีต้อนรับครูผู้สอน
          </div>
          <h2 className="font-heading text-2xl font-semibold text-[#684A96] mb-1">เข้าสู่ระบบ / สมัครสมาชิก</h2>
          <p className="text-sm text-[#7C6B99] mb-7">
            เริ่มต้นใช้งานพื้นที่ทำงานของคุณ (Production ใช้ Supabase Auth JWT)
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#684A96] mb-1.5">ชื่อ-นามสกุล (ครูผู้สอน)</label>
              <input
                type="text"
                required
                placeholder="เช่น อ.สมชาย ใจดี"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-2xl border border-[#E8D9FA] bg-white px-4 py-3 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#684A96] mb-1.5">อีเมล</label>
              <input
                type="email"
                required
                placeholder="teacher@school.ac.th"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-2xl border border-[#E8D9FA] bg-white px-4 py-3 text-sm"
              />
            </div>

            {error && (
              <div className="rounded-2xl bg-[#F7DCE8]/70 border border-[#F8E1EE] px-4 py-3 text-xs font-medium text-[#9D2B5B]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-kawaii w-full py-3.5 px-6 text-sm mt-2"
            >
              {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่พื้นที่ทำงาน"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
