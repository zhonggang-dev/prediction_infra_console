import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const image = new URL("/og-live-trading.png", `${protocol}://${host}`).toString();
  return {
    title: "Prediction Console · 实盘监控",
    description: "从信号、风控、订单、成交到交易账本的实盘运行控制台",
    icons: { icon: "/favicon.svg" },
    openGraph: {
      title: "Prediction Console",
      description: "Live Trading Command Center · 实盘监控",
      type: "website",
      images: [{ url: image, width: 1731, height: 909, alt: "Prediction Console 实盘交易全链路" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Prediction Console",
      description: "Live Trading Command Center · 实盘监控",
      images: [image],
    },
  };
}

/** 全站根布局，统一声明中文界面与基础样式。 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
