"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { buildKalshiPnlView, chooseKalshiPnlRange, kalshiPnl, kalshiPnlAccounts, type KalshiPnlAccount, type KalshiPnlSeries } from "../lib/kalshi-pnl";
import { buildWalletPnlChartGeometry, formatWalletPnlOffset, formatWalletPnlUsd, validateWalletPnlRange, walletPnlHourCandidates, walletPnlLocalHour, type WalletPnlCustomRange, type WalletPnlSelection } from "../lib/wallet-pnl";
import { LocalHourInput, PnlSvg } from "./wallet-pnl-chart";

const PERIODS: { key: WalletPnlSelection; label: string }[] = [
  { key: "1D", label: "1天" }, { key: "1W", label: "1周" }, { key: "1M", label: "1个月" },
  { key: "1Y", label: "1年" }, { key: "YTD", label: "年初至今" }, { key: "ALL", label: "全部" },
];
const cache = new Map<string, KalshiPnlSeries>();

export function KalshiPnlPanel({ active, account, allowedAccounts, embedded = false }: { active: boolean; account: string; allowedAccounts: readonly string[]; embedded?: boolean }) {
  const Heading = embedded ? "h3" : "h2";
  const [directory, setDirectory] = useState<KalshiPnlAccount[]>();
  const [directoryError, setDirectoryError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [period, setPeriod] = useState<WalletPnlSelection>("1W");
  const [customOpen, setCustomOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [startInstant, setStartInstant] = useState("");
  const [endInstant, setEndInstant] = useState("");
  const [max, setMax] = useState("");
  const [range, setRange] = useState<WalletPnlCustomRange>();
  const [rangeError, setRangeError] = useState<string>();
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void kalshiPnlAccounts(controller.signal).then(items => { if (!controller.signal.aborted) { setDirectory(items); setDirectoryError(false); } }).catch(() => { if (!controller.signal.aborted) { setDirectory(undefined); setDirectoryError(true); } });
    return () => controller.abort();
  }, [active, retry]);
  const selected = directory?.filter(item => (!account || item.executionAccountId === account) && allowedAccounts.includes(item.executionAccountId));
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    const result = validateWalletPnlRange(start, end, Date.now(), { startMs: startInstant ? Number(startInstant) : undefined, endMs: endInstant ? Number(endInstant) : undefined });
    if (result.error) { setRangeError(result.error); return; }
    setRange(result.range); setPeriod("CUSTOM"); setRangeError(undefined);
  };
  return <section className="section official-wallet-pnl-workspace" aria-label="Kalshi 官方账户盈亏">
    <div className="section-head official-wallet-pnl-head"><Heading className="section-title">Kalshi 官方账户盈亏</Heading><div className="wallet-pnl-periods" role="group" aria-label="Kalshi 官方盈亏周期">{PERIODS.map(item => <button type="button" key={item.key} aria-pressed={period === item.key} className={period === item.key ? "active" : ""} onClick={() => { setPeriod(item.key); setCustomOpen(false); setRangeError(undefined); }}>{item.label}</button>)}<button type="button" aria-pressed={period === "CUSTOM"} aria-expanded={customOpen} className={period === "CUSTOM" ? "active" : ""} onClick={() => { setCustomOpen(true); setMax(walletPnlLocalHour()); }}>自定义</button></div></div>
    <p className="section-caption">曲线采用 Kalshi 官方账户整体盈亏，与上方区间开仓指标的统计范围不同。</p>
    {customOpen && <form className="wallet-pnl-custom-range" aria-label="Kalshi 官方盈亏自定义时间" onSubmit={apply} noValidate>
      <LocalHourInput label="开始" ariaPrefix="Kalshi 官方盈亏" value={start} max={max} onChange={value => { setStart(value); setStartInstant(""); setRangeError(undefined); }} />
      <RepeatedHour label="开始" value={start} selected={startInstant} onChange={setStartInstant} />
      <LocalHourInput label="结束" ariaPrefix="Kalshi 官方盈亏" value={end} max={max} onChange={value => { setEnd(value); setEndInstant(""); setRangeError(undefined); }} />
      <RepeatedHour label="结束" value={end} selected={endInstant} onChange={setEndInstant} />
      <button className="button primary" type="submit">应用时间</button>{rangeError && <p role="alert">{rangeError}</p>}
    </form>}
    {period === "CUSTOM" && range && <p className="wallet-pnl-range-note">已应用 {range.startDate.replace("T", " ")} 至 {range.endDate.replace("T", " ")}（{range.timeZone}，{range.startOffset}{range.endOffset !== range.startOffset ? ` → ${range.endOffset}` : ""}）。</p>}
    {directoryError ? <PnlState error="Kalshi 官方盈亏账户目录暂不可用。" retry={() => setRetry(n => n + 1)} /> : !directory ? <PnlState error="正在读取 Kalshi 账户…" /> : !selected?.length ? <PnlState error="所选账户暂未提供 Kalshi 官方盈亏曲线。" /> : <div className="official-wallet-pnl-single">{selected.map(item => <KalshiPnlCard key={item.executionAccountId} active={active} account={item.executionAccountId} period={period} range={range} />)}</div>}
  </section>;
}
function RepeatedHour({ label, value, selected, onChange }: { label: string; value: string; selected: string; onChange: (value: string) => void }) {
  const candidates = walletPnlHourCandidates(value);
  return candidates.length > 1 ? <label>{label}时区偏移<select className="select" aria-label={`Kalshi ${label}小时偏移`} value={selected} onChange={event => onChange(event.target.value)}><option value="">请选择重复小时</option>{candidates.map(time => <option value={time} key={time}>{formatWalletPnlOffset(time)}</option>)}</select></label> : null;
}
function PnlState({ error, retry }: { error: string; retry?: () => void }) {
  return <div className="wallet-pnl-state" role="status"><p>{error}</p>{retry && <button type="button" className="button" onClick={retry}>重试</button>}</div>;
}
function KalshiPnlCard({ active, account, period, range }: { active: boolean; account: string; period: WalletPnlSelection; range?: WalletPnlCustomRange }) {
  const [result, setResult] = useState<{ identity: string; series?: KalshiPnlSeries; error?: string }>();
  const [retry, setRetry] = useState(0);
  const [hover, setHover] = useState<{ identity: string; index?: number }>();
  const id = useId().replaceAll(":", "");
  const identity = `${account}:${period}:${period === "CUSTOM" ? `${range?.startMs}/${range?.endMs}` : ""}:${retry}`;
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
      <div className="wallet-pnl-summary"><div><span>{period === "ALL" ? "累计盈亏" : `所选期间盈亏${view.approximate ? "（日级近似）" : ""}`}</span><strong className={amount > 0 ? "positive" : amount < 0 ? "negative" : ""} data-kalshi-pnl-amount="">{formatWalletPnlUsd(amount)}</strong><small>{time ? formatTime(time * 1000) : "—"}（本地时间）</small></div><details className="wallet-pnl-meta"><summary>数据信息</summary><small>读取时间：{formatTime(Date.parse(series.fetchedAt))}</small><small>历史处理至：{formatTime(Date.parse(series.processedThrough))}</small></details></div>
      <p className="wallet-pnl-sampling">{series.periodIntervalMinutes === 10 ? "官方每10分钟采样" : series.periodIntervalMinutes === 60 ? "官方每小时采样" : "官方每日采样"}；末点可能为最新账户值，历史数据可能延后更新。{view.notice}</p>
      <PnlSvg custom={period === "CUSTOM"} label="Kalshi 官方账户盈亏曲线" fillId={`kalshi-pnl-${id}`} chart={chart} points={view.points} hoverIndex={hoverIndex} onHover={index => setHover({ identity, index })} />
    </> : <PnlState error="官方尚未提供足够的历史数据。" />}
  </div></section>;
}
function formatTime(ms: number): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
}
