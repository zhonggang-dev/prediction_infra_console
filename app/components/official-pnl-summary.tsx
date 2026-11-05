"use client";

import { formatWalletPnlUsd } from "../lib/wallet-pnl";

function formatLocalTime(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(timestamp * 1000);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

export function OfficialPnlSummary({ platform, amount, timestamp, intervalMinutes, approximate = false, partialHistory = false, baselineAt, endSampleAt }: {
  platform: "polymarket" | "kalshi";
  amount: number;
  timestamp?: number | null;
  intervalMinutes: number;
  approximate?: boolean;
  partialHistory?: boolean;
  baselineAt?: number | null;
  endSampleAt?: number | null;
}) {
  const interval = intervalMinutes >= 1440 ? `${intervalMinutes / 1440}天` : intervalMinutes >= 60 ? `${intervalMinutes / 60}小时` : `${intervalMinutes}分钟`;
  const sampleRange = baselineAt && endSampleAt ? `计算采样：${formatLocalTime(baselineAt)} 至 ${formatLocalTime(endSampleAt)}（本地时间）。` : undefined;
  return <>
    <div className="wallet-pnl-summary"><div><span>盈亏</span><strong className={amount > 0 ? "positive" : amount < 0 ? "negative" : ""} data-wallet-pnl-amount={platform === "polymarket" ? "" : undefined} data-kalshi-pnl-amount={platform === "kalshi" ? "" : undefined}>{formatWalletPnlUsd(amount)}</strong><small>数据时间：{timestamp ? formatLocalTime(timestamp) : "—"}（本地时间）</small></div></div>
    <p className="wallet-pnl-sampling" title={sampleRange}>采样间隔：{interval}{approximate ? " · 区间近似（采用此前采样点）" : ""}{partialHistory ? " · 仅有部分历史" : ""}</p>
  </>;
}

export function OfficialPnlState({ title, detail, retry }: { title: string; detail?: string; retry?: () => void }) {
  return <div className="wallet-pnl-state" role="status"><strong>{title}</strong>{detail && <p>{detail}</p>}{retry && <button type="button" className="button" onClick={retry}>重试</button>}</div>;
}
