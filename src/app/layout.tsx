import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 悬浮框助手",
  description: "一个现代化的可嵌入式 AI 聊天助手，采用 Anthropic 风格设计",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
