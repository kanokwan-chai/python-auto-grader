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
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-[#E8D9FA]/70 blur-3xl" />
        <div className="absolute top-1/4 -right-24 w-96 h-96 rounded-full bg-[#F8E1EE]/75 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 w-96 h-96 rounded-full bg-[#FFF1E4]/85 blur-3xl" />
      </div>

      <div className="max-w-5xl w-full grid md:grid-cols-12 gap-6 items-stretch">
        {/* Bright Pastel Kawaii Showcase */}
        <div className="md:col-span-6 rounded-[2rem] bg-gradient-to-br from-[#F1E6FF] via-[#FDEAF4] to-[#FFF2E6] border-2 border-white p-8 flex flex-col justify-between shadow-[0_18px_40px_-10px_rgba(124,58,237,0.16)] relative overflow-hidden">
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/90 border border-[#E8D9FA] text-[#4C1D95] text-xs font-semibold shadow-xs mb-5">
              <Sparkles className="w-3.5 h-3.5 text-[#E857B5]" /> Python Auto Grader
            </div>
            <h1 className="font-heading text-3xl font-semibold text-[#241642] leading-snug mb-2">
              ยินดีต้อนรับสู่
              <br />
              Python{" "}
              <span className="bg-gradient-to-r from-[#E857B5] via-[#9B51E0] to-[#7B5CFF] bg-clip-text text-transparent">
                Grader
              </span>
            </h1>
            <p className="text-[#5B4B7A] text-sm leading-relaxed">
              ระบบตรวจงานและให้คะแนนโค้ด Python, Google Classroom, Colab, PDF และ Canva อัตโนมัติ พร้อมประเมิน % การใช้ AI
            </p>
          </div>

          <div className="my-5 flex justify-center relative z-10">
            <img
              src="/illustrations/hero-mascot.jpg"
              alt="Python Grader 3D Mascot"
              className="w-52 h-52 object-cover rounded-[1.75rem] border-2 border-white shadow-[0_14px_28px_rgba(155,81,224,0.2)] animate-float-slow"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 relative z-10">
            <div className="flex items-center gap-2.5 text-xs font-semibold bg-white/90 border border-white text-[#241642] rounded-2xl px-3.5 py-2.5 shadow-xs">
              <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#34D399] to-[#10B981] text-white flex items-center justify-center shrink-0">
                <ShieldCheck className="w-4 h-4" />
              </span>
              <span>รันโค้ด & ตรวจอัตโนมัติ</span>
            </div>
            <div className="flex items-center gap-2.5 text-xs font-semibold bg-white/90 border border-white text-[#241642] rounded-2xl px-3.5 py-2.5 shadow-xs">
              <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#FBBF24] to-[#F97316] text-white flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </span>
              <span>Google Classroom + Excel</span>
            </div>
          </div>
        </div>

        {/* High-Contrast White Auth Form */}
        <div className="md:col-span-6 card-soft p-8 sm:p-10 flex flex-col justify-center">
          <div className="inline-flex items-center gap-1.5 self-start px-3 py-1 rounded-full bg-[#F3EBFF] text-[#6D28D9] text-xs font-semibold mb-4">
            <Stars className="w-3.5 h-3.5 text-[#E857B5]" /> ยินดีต้อนรับครูผู้สอน
          </div>
          <h2 className="font-heading text-2xl font-semibold text-[#241642] mb-1">เข้าสู่ระบบ / สมัครสมาชิก</h2>
          <p className="text-sm text-[#5B4B7A] mb-7">
            กรอกชื่อและอีเมลของคุณเพื่อเริ่มต้นจัดการห้องเรียนและใบงาน
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[#241642] mb-1.5">ชื่อ-นามสกุล (ครูผู้สอน)</label>
              <input
                type="text"
                required
                placeholder="เช่น อ.กนกวรรณ"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-2xl border border-[#DDD0F9] bg-white px-4 py-3 text-sm text-[#241642]"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#241642] mb-1.5">อีเมล</label>
              <input
                type="email"
                required
                placeholder="teacher@school.ac.th"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-2xl border border-[#DDD0F9] bg-white px-4 py-3 text-sm text-[#241642]"
              />
            </div>

            {error && (
              <div className="rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs font-medium text-rose-700">
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
