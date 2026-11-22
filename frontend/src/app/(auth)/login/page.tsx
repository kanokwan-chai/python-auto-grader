"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ShieldCheck, Sparkles, Stars } from "lucide-react";
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
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-[#9B51E0]/25 blur-3xl" />
        <div className="absolute top-1/4 -right-24 w-96 h-96 rounded-full bg-[#E857B5]/20 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 w-96 h-96 rounded-full bg-[#6366F1]/20 blur-3xl" />
      </div>

      <div className="max-w-5xl w-full grid md:grid-cols-12 gap-6 items-stretch">
        {/* Cosmic Kawaii 3D Brand Showcase */}
        <div className="md:col-span-6 rounded-[2rem] bg-gradient-to-br from-[#2B1564] via-[#3A1C7E] to-[#21114C] border border-purple-400/35 p-8 flex flex-col justify-between shadow-[0_20px_50px_rgba(7,3,20,0.75)] relative overflow-hidden">
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-purple-500/25 border border-purple-300/30 text-purple-100 text-xs font-semibold mb-5">
              <Sparkles className="w-3.5 h-3.5 text-pink-400" /> Python Auto Grader
            </div>
            <h1 className="font-heading text-3xl font-semibold text-white leading-snug mb-2">
              ยินดีต้อนรับสู่
              <br />
              Python{" "}
              <span className="bg-gradient-to-r from-[#FF7597] via-[#E857B5] to-[#C084FC] bg-clip-text text-transparent">
                Grader
              </span>
            </h1>
            <p className="text-purple-200/85 text-sm leading-relaxed">
              ระบบตรวจงานและให้คะแนนโค้ด Python, Google Classroom, Colab, PDF และ Canva อัตโนมัติ พร้อมประเมิน % การใช้ AI
            </p>
          </div>

          <div className="my-5 flex justify-center relative z-10">
            <img
              src="/illustrations/cosmic-mascot.jpg"
              alt="Python Grader 3D Robot Mascot"
              className="w-52 h-52 object-cover rounded-[1.75rem] border border-purple-300/35 shadow-[0_0_32px_rgba(180,76,255,0.4)] animate-float-slow"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 relative z-10">
            <div className="flex items-center gap-2.5 text-xs font-medium bg-[#180E38]/75 border border-purple-400/25 text-purple-100 rounded-2xl px-3.5 py-2.5">
              <span className="w-7 h-7 rounded-full bg-emerald-500/25 text-emerald-300 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </span>
              <span>รันโค้ด & ตรวจอัตโนมัติ</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs font-medium bg-[#180E38]/75 border border-purple-400/25 text-purple-100 rounded-2xl px-3.5 py-2.5">
              <span className="w-7 h-7 rounded-full bg-amber-500/25 text-amber-300 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </span>
              <span>Google Classroom + Excel</span>
            </div>
          </div>
        </div>

        {/* Auth Form */}
        <div className="md:col-span-6 card-soft p-8 sm:p-10 flex flex-col justify-center">
          <div className="inline-flex items-center gap-1.5 self-start px-3 py-1 rounded-full bg-purple-500/20 border border-purple-400/30 text-purple-200 text-xs font-semibold mb-4">
            <Stars className="w-3.5 h-3.5 text-pink-400" /> ยินดีต้อนรับครูผู้สอน
          </div>
          <h2 className="font-heading text-2xl font-semibold text-white mb-1">เข้าสู่ระบบ / สมัครสมาชิก</h2>
          <p className="text-sm text-purple-200/80 mb-7">
            กรอกชื่อและอีเมลของคุณเพื่อเริ่มต้นจัดการห้องเรียนและใบงาน
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-purple-100 mb-1.5">ชื่อ-นามสกุล (ครูผู้สอน)</label>
              <input
                type="text"
                required
                placeholder="เช่น อ.กนกวรรณ"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-2xl px-4 py-3 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-purple-100 mb-1.5">อีเมล</label>
              <input
                type="email"
                required
                placeholder="teacher@school.ac.th"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-2xl px-4 py-3 text-sm"
              />
            </div>

            {error && (
              <div className="rounded-2xl bg-rose-500/20 border border-rose-400/40 px-4 py-3 text-xs font-medium text-rose-200">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-kawaii w-full py-3.5 px-6 text-sm mt-2">
              {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่พื้นที่ทำงาน"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
