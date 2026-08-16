import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Insta Library · 本地相机素材库",
  description: "无需官方 App，直接通过相机 Wi‑Fi 浏览和下载 Insta360 素材。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
