"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { officialPnlAccounts, walletPnl, type OfficialPnlAccount } from "../lib/wallet-pnl-api";
import { buildWalletPnlChartGeometry, buildWalletPnlView, buildCustomWalletPnlView, chooseCustomWalletPnlQuery, chooseWalletPnlQuery, nearestWalletPnlPointIndex, type WalletPnlSelection, type WalletPnlCustomRange, type WalletPnlView, type WalletPnlChartGeometry } from "../lib/wallet-pnl";
import type { WalletPnlSeries } from "../lib/wallet-pnl";
import { OfficialPnlSummary, OfficialPnlState as PnlState } from "./official-pnl-summary";
import type { OfficialPnlTimeSelection } from "./official-pnl-controls";
export { LocalHourInput } from "./official-pnl-controls";

import "./wallet-pnl-chart.css";

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

export function clearWalletPnlCache() { cache.clear(); }

export function OfficialWalletPnlPanel({ active, account, allowedAccounts, embedded = false, selection, refreshToken = 0 }: { active: boolean; account: string; allowedAccounts?: readonly string[]; embedded?: boolean; selection: OfficialPnlTimeSelection; refreshToken?: number }) {
  const Heading = embedded ? "h3" : "h2";
  const [accounts, setAccounts] = useState<OfficialPnlAccount[]>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  const { period, customRange } = selection;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void officialPnlAccounts(controller.signal).then((items) => { if (!controller.signal.aborted) { setAccounts(items); setError(undefined); } }).catch(() => { if (!controller.signal.aborted) setError("无法读取支持官方盈亏的钱包，请稍后重试。"); });
    return () => controller.abort();
  }, [active, retry, refreshToken]);
  const selected = accounts?.filter(item => (!account || item.executionAccountId === account) && (allowedAccounts === undefined || allowedAccounts.includes(item.executionAccountId)));
  return <section className="section official-wallet-pnl-workspace" aria-label="Polymarket 官方账户盈亏">
    <div className="section-head official-wallet-pnl-head"><Heading className="section-title">Polymarket 官方账户盈亏</Heading></div>
    {error ? <PnlState title="官方盈亏暂时不可用" detail={error} retry={() => setRetry((value) => value + 1)} /> : !accounts ? <PnlState title="正在读取账户" detail="" /> : !selected?.length ? <PnlState title="所选账户暂无官方盈亏曲线" detail="" /> : <div className={account ? "official-wallet-pnl-single" : "official-wallet-pnl-grid"}>{selected.map((item) => <WalletPnlCard key={item.executionAccountId} active={active} executionAccountId={item.executionAccountId} period={period} customRange={customRange} refreshToken={refreshToken + retry} accountLabel={item.executionAccountId} />)}</div>}
  </section>;
}


type WalletPnlCardProps = { active: boolean; executionAccountId: string; refreshToken: number; period: WalletPnlSelection; customRange?: WalletPnlCustomRange; accountLabel: string };

function WalletPnlCard({ active, executionAccountId, period, customRange, refreshToken, accountLabel }: WalletPnlCardProps) {
  const [series, setSeries] = useState<WalletPnlSeries>();
  const [view, setView] = useState<WalletPnlView>();
  const [hoverState, setHoverState] = useState<{ key: string; index?: number }>({ key: "" });
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string>();
  const [retryToken, setRetryToken] = useState(0);
  const [readyIdentity, setReadyIdentity] = useState("");
  const requestKey = useRef(0);
  const componentId = useId();
  const fillId = `wallet-pnl-fill-${componentId.replaceAll(":", "")}`;
  const titleId = `wallet-pnl-title-${componentId.replaceAll(":", "")}`;
  const identity = `${executionAccountId}:${period}:${period === "CUSTOM" ? `${customRange?.startMs}/${customRange?.endMs}` : ""}:${refreshToken}:${retryToken}`;
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
          if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
          putWalletPnlCache(key, result);
          return result;
        };
        const all = await loadSeries(allCacheKey, allQuery.interval, allQuery.fidelity);
        const query = period === "CUSTOM" && customRange ? chooseCustomWalletPnlQuery(customRange, Date.parse(all.fetchedAt)) : chooseWalletPnlQuery(period === "CUSTOM" ? "ALL" : period, all.points[0]?.timestamp, Date.parse(all.fetchedAt));
        const cacheKey = `${executionAccountId}:${query.interval}:${query.fidelity}`;
        const current = cacheKey === allCacheKey
          ? all
          : await loadSeries(cacheKey, query.interval, query.fidelity);
        if (controller.signal.aborted || requestKey.current !== currentKey) return;
        setSeries(current);
        setView(period === "CUSTOM" && customRange ? buildCustomWalletPnlView(current.points, customRange, Date.parse(current.fetchedAt), current.fidelity === "1d" ? 86_400 : Number(current.fidelity.slice(0, -1)) * 3600) : buildWalletPnlView(current.points, period === "CUSTOM" ? "ALL" : period, Date.parse(current.fetchedAt), all.points[0]?.timestamp));
        setReadyIdentity(identity); setStatus("ready");
      } catch (reason) {
        if (controller.signal.aborted || requestKey.current !== currentKey) return;
        setSeries(undefined); setView(undefined); setReadyIdentity(identity); setStatus("error");
        setError(reason instanceof Error ? reason.message : "官方盈亏接口暂时不可用");
      }
    }
    void load();
    return () => controller.abort();
  }, [active, executionAccountId, period, customRange, refreshToken, retryToken, identity]);

  const selectedPoint = view && hoverIndex !== undefined ? view.points[hoverIndex] : undefined;
  const amount = selectedPoint?.value ?? view?.amount ?? null;
  const pointTime = selectedPoint?.timestamp ?? view?.endSampleAt ?? view?.endAt;
  const chart = useMemo(() => view ? buildWalletPnlChartGeometry(view) : undefined, [view]);

  return <section className="section wallet-pnl-card" aria-labelledby={titleId} data-wallet-pnl-account={executionAccountId}>
    <div className="wallet-pnl-panel">
      <div className="section-head wallet-pnl-head">
        <div><div className="pnl-title-line"><h3 className="section-title" id={titleId}>{accountLabel}</h3></div></div>
      </div>
      {!executionAccountId ? <PnlState title="等待账户身份" />
          : status === "loading" || readyIdentity !== identity ? <PnlState title="正在读取官方盈亏" />
            : status === "error" ? <PnlState title="官方盈亏暂时不可用" detail={error ?? "接口返回错误，请稍后重试。"} retry={() => setRetryToken((value) => value + 1)} />
              : !view?.points.length || view.amount === null || !series ? <PnlState title="暂无足够盈亏数据" detail={period === "CUSTOM" ? view?.error ?? "所选起止时间缺少对应的官方采样数据，请调整时间范围。" : "官方尚未提供足够的历史数据。"} />
              : <>
                  <OfficialPnlSummary platform="polymarket" amount={amount ?? view.amount} timestamp={pointTime} intervalMinutes={series.fidelity === "1d" ? 1440 : Number(series.fidelity.slice(0, -1)) * 60} approximate={view.approximate} partialHistory={view.partialHistory} baselineAt={view.baselineAt} endSampleAt={view.endSampleAt ?? view.endAt} />
                  <PnlSvg custom={period === "CUSTOM"} label={period === "CUSTOM" ? "官方钱包所选期间盈亏曲线" : "官方钱包累计盈亏曲线"} fillId={fillId} chart={chart} points={view.points} hoverIndex={hoverIndex} onHover={(index) => setHoverState({ key: identity, index })} />
                </>}
    </div>
  </section>;
}

export function PnlSvg({ custom, label, fillId, chart, points, hoverIndex, onHover }: { custom: boolean; label: string; fillId: string; chart?: WalletPnlChartGeometry; points: { timestamp: number; value: number }[]; hoverIndex?: number; onHover: (index: number | undefined) => void }) {
  if (!chart || !points.length) return null;
  const active = hoverIndex === undefined ? points.length - 1 : Math.max(0, Math.min(points.length - 1, hoverIndex));
  const point = chart.points[active];
  const showHover = hoverIndex !== undefined;
  const trackPointer = (event: React.PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    onHover(nearestWalletPnlPointIndex(points, ratio, { startAt: chart.domainStartAt, endAt: chart.domainEndAt }));
  };
  return <div className="wallet-pnl-svg-wrap"><svg className="wallet-pnl-svg" viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none" role="img" aria-label={label} data-domain-start={chart.domainStartAt} data-domain-end={chart.domainEndAt}>
    <defs><clipPath id={`${fillId}-clip`}><rect x={chart.left} y={chart.top - 12} width={chart.plotWidth} height={chart.plotHeight + 24} /></clipPath><linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#7779f4" stopOpacity=".22" /><stop offset="1" stopColor="#7779f4" stopOpacity=".03" /></linearGradient></defs>
    <g clipPath={`url(#${fillId}-clip)`}>{chart.areaPath && <path d={chart.areaPath} fill={`url(#${fillId})`} />}
    <path d={chart.linePath} fill="none" stroke="#6670ee" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    {points.length === 1 && <circle cx={point.x} cy={point.y} r="3" fill="#6670ee" />}
    {showHover && <line x1={point.x} x2={point.x} y1={chart.top} y2={chart.bottom} stroke="#9b9de5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
    {showHover && <circle cx={point.x} cy={point.y} r="4" fill="#6670ee" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
    </g><rect x={chart.left} y={chart.top - 12} width={chart.plotWidth} height={chart.plotHeight + 24} fill="transparent" onPointerDown={(event) => { event.currentTarget.setPointerCapture?.(event.pointerId); trackPointer(event); }} onPointerMove={trackPointer} onPointerUp={(event) => { event.currentTarget.releasePointerCapture?.(event.pointerId); }} onPointerLeave={() => onHover(undefined)} onKeyDown={(event) => {
      if (event.key === "ArrowLeft") onHover(Math.max(0, active - 1));
      if (event.key === "ArrowRight") onHover(Math.min(points.length - 1, active + 1));
    }} tabIndex={0} aria-label="使用左右方向键查看盈亏采样点" />
  </svg><div className="wallet-pnl-axis"><span>{custom ? formatHourAxis(chart.domainStartAt) : formatShortDate(points[0].timestamp)}</span><span>{custom ? formatHourAxis(chart.domainEndAt) : formatShortDate(points[points.length - 1].timestamp)}</span></div></div>;
}

function formatShortDate(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(timestamp * 1000));
}

function formatHourAxis(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp * 1000));
}
