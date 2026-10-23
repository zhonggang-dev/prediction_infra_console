import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const image = new URL("/og-observability.png", `${protocol}://${host}`).toString();
  return {
    title: "Prediction Console · 运维控制台",
    description: "Prediction Infra 运维控制台，按市场、预测、数据集和交易链路查看真实状态",
    icons: { icon: "/favicon.svg" },
    openGraph: {
      title: "Prediction Console · 运维控制台",
      description: "Prediction Infra 运维控制台，按市场、预测、数据集和交易链路查看真实状态",
      type: "website",
      images: [{ url: image, width: 1731, height: 909, alt: "Prediction Infra 运维控制台" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Prediction Console · 运维控制台",
      description: "Prediction Infra 运维控制台，按市场、预测、数据集和交易链路查看真实状态",
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
