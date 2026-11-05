"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { buildKalshiPnlView, chooseKalshiPnlRange, kalshiPnl, kalshiPnlAccounts, type KalshiPnlAccount, type KalshiPnlSeries } from "../lib/kalshi-pnl";
import { buildWalletPnlChartGeometry, formatWalletPnlUsd, type WalletPnlCustomRange, type WalletPnlSelection } from "../lib/wallet-pnl";
import { PnlSvg } from "./wallet-pnl-chart";
import type { OfficialPnlTimeSelection } from "./official-pnl-controls";

const cache = new Map<string, KalshiPnlSeries>();

export function clearKalshiPnlCache() { cache.clear(); }

export function KalshiPnlPanel({ active, account, allowedAccounts, embedded = false, selection, refreshToken = 0 }: { active: boolean; account: string; allowedAccounts: readonly string[]; embedded?: boolean; selection: OfficialPnlTimeSelection; refreshToken?: number }) {
  const Heading = embedded ? "h3" : "h2";
  const [directory, setDirectory] = useState<KalshiPnlAccount[]>();
  const [directoryError, setDirectoryError] = useState(false);
  const [retry, setRetry] = useState(0);
  const { period, customRange: range } = selection;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void kalshiPnlAccounts(controller.signal).then(items => { if (!controller.signal.aborted) { setDirectory(items); setDirectoryError(false); } }).catch(() => { if (!controller.signal.aborted) { setDirectory(undefined); setDirectoryError(true); } });
    return () => controller.abort();
  }, [active, retry, refreshToken]);
  const selected = directory?.filter(item => (!account || item.executionAccountId === account) && allowedAccounts.includes(item.executionAccountId));
  return <section className="section official-wallet-pnl-workspace" aria-label="Kalshi 官方账户盈亏">
    <div className="section-head official-wallet-pnl-head"><Heading className="section-title">Kalshi 官方账户盈亏</Heading></div>
    {directoryError ? <PnlState error="Kalshi 官方盈亏账户目录暂不可用。" retry={() => setRetry(n => n + 1)} /> : !directory ? <PnlState error="正在读取 Kalshi 账户…" /> : !selected?.length ? <PnlState error="所选账户暂未提供 Kalshi 官方盈亏曲线。" /> : <div className="official-wallet-pnl-single">{selected.map(item => <KalshiPnlCard key={item.executionAccountId} active={active} account={item.executionAccountId} period={period} range={range} refreshToken={refreshToken + retry} />)}</div>}
  </section>;
}
function PnlState({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="wallet-pnl-state" role="status"><p>{error}</p>{retry && <button type="button" className="button" onClick={retry}>重试</button>}</div>;
}
function KalshiPnlCard({ active, account, period, range, refreshToken }: { active: boolean; account: string; period: WalletPnlSelection; range?: WalletPnlCustomRange; refreshToken: number }) {
  const [result, setResult] = useState<{ identity: string; series?: KalshiPnlSeries; error?: string }>();
  const [retry, setRetry] = useState(0);
  const [hover, setHover] = useState<{ identity: string; index?: number }>();
  const id = useId().replaceAll(":", "");
  const identity = `${account}:${period}:${period === "CUSTOM" ? `${range?.startMs}/${range?.endMs}` : ""}:${refreshToken}:${retry}`;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const query = chooseKalshiPnlRange(period, range), key = `${account}:${query}`;
        const old = cache.get(key), now = Date.now();
        const series = old && Date.parse(old.fetchedAt) + 60_000 > now && (period !== "CUSTOM" || !range || range.endMs <= Date.parse(old.fetchedAt)) ? old : await kalshiPnl(account, query, controller.signal);
        if (controller.signal.aborted) return;
        for (const [k, v] of cache) if (Date.parse(v.fetchedAt) + 60_000 <= now) cache.delete(k);
        if (cache.size >= 64) cache.delete(cache.keys().next().value!);
        cache.set(key, series); setResult({ identity, series });
      } catch (error) { if (!controller.signal.aborted) setResult({ identity, error: error instanceof Error ? error.message : "Kalshi 官方盈亏暂不可用。" }); }
    };
    void load(); return () => controller.abort();
  }, [active, account, period, range, identity]);
  const series = result?.identity === identity ? result.series : undefined;
  const view = useMemo(() => series ? buildKalshiPnlView(series, period, range) : undefined, [series, period, range]);
  const chart = useMemo(() => view ? buildWalletPnlChartGeometry(view) : undefined, [view]);
  const hoverIndex = hover?.identity === identity ? hover.index : undefined;
  const point = hoverIndex !== undefined ? view?.points[hoverIndex] : undefined;
  const amount = point?.value ?? view?.amount;
  const time = point?.timestamp ?? view?.endSampleAt;
  return <section className="section wallet-pnl-card" aria-label={`${account} Kalshi 官方盈亏`} data-kalshi-pnl-account={account}><div className="wallet-pnl-panel">
    <div className="section-head wallet-pnl-head"><h3 className="section-title">{account}</h3></div>
    {result?.identity !== identity ? <PnlState error="正在读取 Kalshi 官方盈亏…" /> : result.error ? <PnlState error={result.error} retry={() => setRetry(n => n + 1)} /> : view?.error ? <PnlState error={view.error} /> : view && series && amount !== undefined && amount !== null ? <>
      <div className="wallet-pnl-summary"><div><span>{`盈亏${view.approximate ? "（日级近似）" : ""}`}</span><strong className={amount > 0 ? "positive" : amount < 0 ? "negative" : ""} data-kalshi-pnl-amount="">{formatWalletPnlUsd(amount)}</strong><small>{time ? formatTime(time * 1000) : "—"}（本地时间）</small></div></div>
      <p className="wallet-pnl-sampling">{series.periodIntervalMinutes === 10 ? "官方每10分钟采样" : series.periodIntervalMinutes === 60 ? "官方每小时采样" : "官方每日采样"}。{view.notice}</p>
      <PnlSvg custom={period === "CUSTOM"} label="Kalshi 官方账户盈亏曲线" fillId={`kalshi-pnl-${id}`} chart={chart} points={view.points} hoverIndex={hoverIndex} onHover={index => setHover({ identity, index })} />
    </> : <PnlState error="官方尚未提供足够的历史数据。" />}
  </div></section>;
}
function formatTime(ms: number): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
}
