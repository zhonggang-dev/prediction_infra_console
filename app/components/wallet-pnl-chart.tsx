"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { officialPnlAccounts, walletPnl, type OfficialPnlAccount } from "../lib/wallet-pnl-api";
import { buildWalletPnlChartGeometry, buildWalletPnlView, chooseWalletPnlQuery, formatWalletPnlUsd, nearestWalletPnlPointIndex, type WalletPnlPeriod, type WalletPnlView, type WalletPnlChartGeometry } from "../lib/wallet-pnl";
import type { WalletPnlSeries } from "../lib/wallet-pnl";

import "./wallet-pnl-chart.css";

const PERIODS: { key: WalletPnlPeriod; label: string }[] = [
  { key: "1D", label: "1天" }, { key: "1W", label: "1周" }, { key: "1M", label: "1个月" },
  { key: "1Y", label: "1年" }, { key: "YTD", label: "年初至今" }, { key: "ALL", label: "全部" },
];
const cache = new Map<string, { expiresAt: number; data: WalletPnlSeries }>();
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 64;

function putWalletPnlCache(key: string, data: WalletPnlSeries) {
  const now = Date.now();
  for (const [cachedKey, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(cachedKey);
  }
  const fetchedAt = Date.parse(data.fetchedAt);
  const sourceExpiry = Number.isFinite(fetchedAt) ? fetchedAt + CACHE_TTL_MS : now + CACHE_TTL_MS;
  const expiresAt = Math.min(now + CACHE_TTL_MS, sourceExpiry);
  if (expiresAt <= now) return;
  while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { expiresAt, data });
}

export function OfficialWalletPnlPanel({ active, account }: { active: boolean; account: string }) {
  const [accounts, setAccounts] = useState<OfficialPnlAccount[]>();
  const [error, setError] = useState<string>();
  const [period, setPeriod] = useState<WalletPnlPeriod>("1W");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void officialPnlAccounts(controller.signal).then((items) => { if (!controller.signal.aborted) { setAccounts(items); setError(undefined); } }).catch(() => { if (!controller.signal.aborted) setError("无法读取支持官方盈亏的钱包，请稍后重试。"); });
    return () => controller.abort();
  }, [active, retry]);
  const selected = account ? accounts?.filter((item) => item.executionAccountId === account) : accounts;
  return <section className="section official-wallet-pnl-workspace" aria-label="官方钱包盈亏">
    <div className="section-head official-wallet-pnl-head"><h2 className="section-title">官方钱包盈亏</h2><button type="button" className="button" onClick={() => setRetry((value) => value + 1)}>刷新</button><div className="wallet-pnl-periods" role="group" aria-label="官方盈亏周期">{PERIODS.map((item) => <button key={item.key} type="button" aria-pressed={period === item.key} className={period === item.key ? "active" : ""} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div></div>
    <p className="section-caption">曲线为 Polymarket 官方钱包口径，明细为系统成交与结算账本。</p>
    {error ? <PnlState title="官方盈亏暂时不可用" detail={error} retry={() => setRetry((value) => value + 1)} /> : !accounts ? <PnlState title="正在读取钱包" detail="" /> : !selected?.length ? <PnlState title={account ? "该账户暂无 Polymarket 官方盈亏曲线" : "暂无支持官方盈亏的钱包"} detail="" /> : <div className={account ? "official-wallet-pnl-single" : "official-wallet-pnl-grid"}>{selected.map((item) => <WalletPnlCard key={item.executionAccountId} active={active} executionAccountId={item.executionAccountId} period={period} refreshToken={retry} accountLabel={item.executionAccountId} />)}</div>}
  </section>;
}

type WalletPnlCardProps = { active: boolean; executionAccountId: string; refreshToken: number; period: WalletPnlPeriod; accountLabel: string };

function WalletPnlCard({ active, executionAccountId, period, refreshToken, accountLabel }: WalletPnlCardProps) {
  const [series, setSeries] = useState<WalletPnlSeries>();
  const [view, setView] = useState<WalletPnlView>();
  const [hoverState, setHoverState] = useState<{ key: string; index?: number }>({ key: "" });
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string>();
  const [retryToken, setRetryToken] = useState(0);
  const requestKey = useRef(0);
  const componentId = useId();
  const fillId = `wallet-pnl-fill-${componentId.replaceAll(":", "")}`;
  const titleId = `wallet-pnl-title-${componentId.replaceAll(":", "")}`;
  const identity = `${executionAccountId}:${period}:${refreshToken}:${retryToken}`;
  const hoverIndex = hoverState.key === identity ? hoverState.index : undefined;

  useEffect(() => {
    const controller = new AbortController();
    const currentKey = ++requestKey.current;
    async function load() {
      if (!active) return;
      if (!executionAccountId) return;
      const allQuery = chooseWalletPnlQuery("ALL");
      const allCacheKey = `${executionAccountId}:${allQuery.interval}:${allQuery.fidelity}`;
      setStatus("loading"); setError(undefined);
      try {
        const loadSeries = async (key: string, interval: WalletPnlSeries["interval"], fidelity: WalletPnlSeries["fidelity"]) => {
          const existing = cache.get(key);
          if (existing && existing.expiresAt > Date.now()) return existing.data;
          const result = await walletPnl(executionAccountId, interval, fidelity, controller.signal);
          putWalletPnlCache(key, result);
          return result;
        };
        const all = await loadSeries(allCacheKey, allQuery.interval, allQuery.fidelity);
        const query = chooseWalletPnlQuery(period, all.points[0]?.timestamp, Date.parse(all.fetchedAt));
        const cacheKey = `${executionAccountId}:${query.interval}:${query.fidelity}`;
        const current = cacheKey === allCacheKey
          ? all
          : await loadSeries(cacheKey, query.interval, query.fidelity);
        if (controller.signal.aborted || requestKey.current !== currentKey) return;
        setSeries(current); setView(buildWalletPnlView(current.points, period, Date.parse(current.fetchedAt), all.points[0]?.timestamp)); setStatus("ready");
      } catch (reason) {
        if (controller.signal.aborted || requestKey.current !== currentKey) return;
        setSeries(undefined); setView(undefined); setStatus("error");
        setError(reason instanceof Error ? reason.message : "官方盈亏接口暂时不可用");
      }
    }
    void load();
    return () => controller.abort();
  }, [active, executionAccountId, period, refreshToken, retryToken]);

  const selectedPoint = view && hoverIndex !== undefined ? view.points[hoverIndex] : undefined;
  const amount = selectedPoint?.value ?? view?.amount ?? null;
  const amountLabel = amount === null ? "—" : formatWalletPnlUsd(amount);
  const amountTone = amount === null ? "" : amount > 0 ? "positive" : amount < 0 ? "negative" : "";
  const pointTime = selectedPoint ? formatPointTime(selectedPoint.timestamp) : view?.endAt ? formatPointTime(view.endAt) : "—";
  const chart = useMemo(() => view ? buildWalletPnlChartGeometry(view) : undefined, [view]);

  return <section className="section wallet-pnl-card" aria-labelledby={titleId}>
    <div className="wallet-pnl-panel">
      <div className="section-head wallet-pnl-head">
        <div><div className="pnl-title-line"><h3 className="section-title" id={titleId}>{accountLabel}</h3></div></div>
      </div>
      {!executionAccountId ? <PnlState title="等待钱包身份" detail="选择钱包后读取官方地址级数据。" />
          : status === "loading" ? <PnlState title="正在读取官方盈亏" detail="正在从只读数据接口获取当前钱包的官方累计盈亏序列。" />
            : status === "error" ? <PnlState title="官方盈亏暂时不可用" detail={error ?? "接口返回错误，请稍后重试。"} retry={() => setRetryToken((value) => value + 1)} />
              : !view?.points.length || view.amount === null ? <PnlState title="暂无足够盈亏数据" detail="接口没有返回至少两个有效采样点；不会把缺失数据显示成零。" />
              : <>
                  <div className="wallet-pnl-summary"><div><span>盈亏</span><strong className={amountTone}>{amountLabel}</strong><small>{pointTime}（本地时间）</small></div><details className="wallet-pnl-meta"><summary>钱包信息</summary><code>{series?.walletAddress ?? "—"}</code><small>{series ? `更新于 ${formatFetchedAt(series.fetchedAt)}（本地时间）` : "—"}</small></details></div>
                  <PnlSvg fillId={fillId} chart={chart} points={view.points} hoverIndex={hoverIndex} onHover={(index) => setHoverState({ key: identity, index })} />
                </>}
    </div>
  </section>;
}

function PnlState({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) {
  return <div className="wallet-pnl-state"><strong>{title}</strong><p>{detail}</p>{retry && <button className="button" onClick={retry}>重试</button>}</div>;
}

function PnlSvg({ fillId, chart, points, hoverIndex, onHover }: { fillId: string; chart?: WalletPnlChartGeometry; points: { timestamp: number; value: number }[]; hoverIndex?: number; onHover: (index: number | undefined) => void }) {
  if (!chart || points.length < 2) return null;
  const active = hoverIndex === undefined ? points.length - 1 : Math.max(0, Math.min(points.length - 1, hoverIndex));
  const point = chart.points[active];
  const showHover = hoverIndex !== undefined;
  const trackPointer = (event: React.PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    onHover(nearestWalletPnlPointIndex(points, ratio));
  };
  return <div className="wallet-pnl-svg-wrap"><svg className="wallet-pnl-svg" viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none" role="img" aria-label="官方钱包累计盈亏曲线">
    <defs><linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#7779f4" stopOpacity=".22" /><stop offset="1" stopColor="#7779f4" stopOpacity=".03" /></linearGradient></defs>
    <path d={chart.areaPath} fill={`url(#${fillId})`} />
    <path d={chart.linePath} fill="none" stroke="#6670ee" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    {showHover && <line x1={point.x} x2={point.x} y1={chart.top} y2={chart.bottom} stroke="#9b9de5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
    {showHover && <circle cx={point.x} cy={point.y} r="4" fill="#6670ee" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
    <rect x={chart.left} y={chart.top - 12} width={chart.plotWidth} height={chart.plotHeight + 24} fill="transparent" onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); trackPointer(event); }} onPointerMove={trackPointer} onPointerUp={(event) => { event.currentTarget.releasePointerCapture?.(event.pointerId); }} onPointerLeave={() => onHover(undefined)} onKeyDown={(event) => {
      if (event.key === "ArrowLeft") onHover(Math.max(0, active - 1));
      if (event.key === "ArrowRight") onHover(Math.min(points.length - 1, active + 1));
    }} tabIndex={0} aria-label="使用左右方向键查看盈亏采样点" />
  </svg><div className="wallet-pnl-axis"><span>{formatShortDate(points[0].timestamp)}</span><span>{formatShortDate(points[points.length - 1].timestamp)}</span></div></div>;
}

function formatPointTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(timestamp * 1000));
}

function formatFetchedAt(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatShortDate(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(timestamp * 1000));
}
