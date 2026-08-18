import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Prediction Console",
  description: "Prediction Infra 与 Trading Execution 内部运维控制台",
  icons: { icon: "/favicon.svg" },
  openGraph: {
    title: "Prediction Console",
    description: "预测、交易执行与真实成交账本的内部运维控制台",
    type: "website",
    images: [{ url: "/trade-ledger-social.png", width: 1746, height: 909, alt: "交易账本确认与执行流程抽象图" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Prediction Console",
    description: "预测、交易执行与真实成交账本的内部运维控制台",
    images: ["/trade-ledger-social.png"],
  },
};

/** 全站根布局，统一声明中文界面与基础样式。 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
