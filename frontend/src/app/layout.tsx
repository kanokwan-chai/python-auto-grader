import type { Metadata } from "next";
import { Anuphan, JetBrains_Mono, Mitr } from "next/font/google";
import "./globals.css";

const anuphan = Anuphan({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-anuphan",
});

const mitr = Mitr({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mitr",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "Python Auto Grader — ระบบตรวจงาน Python อัตโนมัติ",
  description:
    "แพลตฟอร์มตรวจงานเขียนโปรแกรมภาษา Python อัตโนมัติ เชื่อมต่อ Google Classroom, Colab, PDF/Canva, Sandbox และ AI Feedback",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${anuphan.variable} ${mitr.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen kawaii-bg text-[#241642] antialiased selection:bg-[#E8D9FA] selection:text-[#4C1D95]">
        {children}
      </body>
    </html>
  );
}
