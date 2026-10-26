import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const image = new URL("/og-observability.png", `${protocol}://${host}`).toString();
  return {
    title: "Prediction Console · 服务监控与实盘运维",
    description: "Prediction Infra 与 Trading Execution 的服务指标、实盘链路和交易账本控制台",
    icons: { icon: "/favicon.svg" },
    openGraph: {
      title: "Prediction Console",
      description: "Service Observability · QPS、CPU 与内存基础监控",
      type: "website",
      images: [{ url: image, width: 1731, height: 909, alt: "Prediction Console 双服务基础监控" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Prediction Console",
      description: "Service Observability · QPS、CPU 与内存基础监控",
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
