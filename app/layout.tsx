import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prediction Console",
  description: "Prediction Infra 内部运维控制台",
  icons: { icon: "/favicon.svg" },
};

/** 全站根布局，统一声明中文界面与基础样式。 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
