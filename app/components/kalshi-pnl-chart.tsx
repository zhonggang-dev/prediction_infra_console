"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { buildKalshiPnlView, chooseKalshiPnlRange, kalshiPnl, kalshiPnlAccounts, type KalshiPnlAccount, type KalshiPnlSeries } from "../lib/kalshi-pnl";
import { buildWalletPnlChartGeometry, type WalletPnlCustomRange, type WalletPnlSelection } from "../lib/wallet-pnl";
import { PnlSvg } from "./wallet-pnl-chart";
import { OfficialPnlSummary, OfficialPnlState as PnlState } from "./official-pnl-summary";
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
    {directoryError ? <PnlState title="官方盈亏暂时不可用" detail="无法读取账户目录，请稍后重试。" retry={() => setRetry(n => n + 1)} /> : !directory ? <PnlState title="正在读取账户" /> : !selected?.length ? <PnlState title="所选账户暂无官方盈亏曲线" /> : <div className={account ? "official-wallet-pnl-single" : "official-wallet-pnl-grid"}>{selected.map(item => <KalshiPnlCard key={item.executionAccountId} active={active} account={item.executionAccountId} period={period} range={range} refreshToken={refreshToken + retry} />)}</div>}
  </section>;
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
    {result?.identity !== identity ? <PnlState title="正在读取官方盈亏" /> : result.error ? <PnlState title="官方盈亏暂时不可用" detail={result.error} retry={() => setRetry(n => n + 1)} /> : view?.error ? <PnlState title="暂无足够盈亏数据" detail={view.error} /> : view && series && amount !== undefined && amount !== null ? <>
      <OfficialPnlSummary platform="kalshi" amount={amount} timestamp={time} intervalMinutes={series.periodIntervalMinutes} approximate={view.approximate} partialHistory={view.partialHistory} baselineAt={view.baselineAt} endSampleAt={view.endSampleAt} />
      <PnlSvg custom={period === "CUSTOM"} label="Kalshi 官方账户盈亏曲线" fillId={`kalshi-pnl-${id}`} chart={chart} points={view.points} hoverIndex={hoverIndex} onHover={index => setHover({ identity, index })} />
    </> : <PnlState title="暂无足够盈亏数据" detail="官方尚未提供足够的历史数据。" />}
  </div></section>;
}
