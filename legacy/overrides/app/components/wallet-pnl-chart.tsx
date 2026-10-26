"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { consoleApi } from "../lib/console-api";
import { buildWalletPnlChartGeometry, buildWalletPnlView, chooseWalletPnlQuery, formatWalletPnlUsd, nearestWalletPnlPointIndex, OFFICIAL_WALLET_PNL_ACCOUNTS, type WalletPnlPeriod, type WalletPnlView, type WalletPnlChartGeometry } from "../lib/wallet-pnl";
import type { LiveWalletSummary, WalletPnlSeries } from "../lib/types";

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

export function WalletSelector({ wallets, selectedWalletId, onWallet, loading }: { wallets: LiveWalletSummary[]; selectedWalletId?: string; onWallet: (id: string) => void; loading: boolean }) {
  return <label className="wallet-selector"><span>选择钱包</span><select className="select" value={selectedWalletId ?? ""} onChange={(event) => onWallet(event.target.value)} disabled={!wallets.length} aria-label="选择实盘钱包">{wallets.length ? wallets.map((item) => <option value={item.executionAccountId} key={item.executionAccountId}>{item.executionAccountId}</option>) : <option value="">{loading ? "正在读取钱包" : "暂无真实钱包"}</option>}</select></label>;
}

export function OfficialWalletPnlPanel({ active = true, wallets, selectedWalletId, onWallet, walletLoading = false, executionAccountId, preview = false, autoRefresh = true, refreshToken }: { active?: boolean; wallets: LiveWalletSummary[]; selectedWalletId?: string; onWallet: (id: string) => void; walletLoading?: boolean; executionAccountId?: string; preview?: boolean; autoRefresh?: boolean; refreshToken?: string }) {
  const [scope, setScope] = useState<string>(selectedWalletId ?? "all");
  const [period, setPeriod] = useState<WalletPnlPeriod>("1W");
  const officialWallets = wallets.filter((wallet) => OFFICIAL_WALLET_PNL_ACCOUNTS.has(wallet.executionAccountId));
  const effectiveScope = scope === "all" ? "all" : selectedWalletId ?? scope;
  const selectScope = (next: string) => {
    setScope(next);
    if (next !== "all") onWallet(next);
  };
  const showAll = effectiveScope === "all";
  const scopedWallets = showAll ? officialWallets : officialWallets.filter((wallet) => wallet.executionAccountId === (effectiveScope || executionAccountId));
  const selectedWallet = scopedWallets[0];
  return <section className="section official-wallet-pnl-workspace" aria-labelledby="official-wallet-pnl-workspace-title">
    <div className="section-head official-wallet-pnl-head">
      <div><div className="pnl-title-line"><h2 className="section-title" id="official-wallet-pnl-workspace-title">官方钱包盈亏</h2><span className="wallet-pnl-source">官方口径 · 地址级</span></div><p className="section-caption">选择单个钱包或全部钱包；全部视图保留四张独立卡片，周期控件对四张卡片同时生效</p></div>
      <div className="official-wallet-pnl-controls"><label className="wallet-selector"><span>查看范围</span><select className="select" value={effectiveScope} onChange={(event) => selectScope(event.target.value)} aria-label="选择官方盈亏查看范围"><option value="all">All（全部钱包）</option>{officialWallets.map((wallet) => <option value={wallet.executionAccountId} key={wallet.executionAccountId}>{wallet.executionAccountId}</option>)}</select></label><div className="wallet-pnl-periods" role="tablist" aria-label="官方钱包盈亏周期">{PERIODS.map((item) => <button key={item.key} role="tab" aria-selected={period === item.key} className={period === item.key ? "active" : ""} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div></div>
    </div>
    <div className={showAll ? "official-wallet-pnl-grid" : "official-wallet-pnl-single"}>
      {preview ? <PnlState title="预览模式未加载官方地址数据" detail="返回真实数据后，选择范围即可查看四个实际钱包的官方盈亏曲线。" /> : (showAll ? officialWallets : [selectedWallet]).filter(Boolean).map((wallet) => <WalletPnlCard key={wallet!.executionAccountId} active={active} executionAccountId={wallet!.executionAccountId} autoRefresh={autoRefresh} refreshToken={refreshToken} period={period} accountLabel={wallet!.executionAccountId} />)}
      {!preview && !officialWallets.length && <PnlState title={walletLoading ? "正在读取钱包" : "暂无线上钱包"} detail="读取四个线上执行账户后，才能查看官方地址级盈亏。" />}
    </div>
  </section>;
}

type WalletPnlCardProps = { active: boolean; executionAccountId: string; autoRefresh: boolean; refreshToken?: string; period: WalletPnlPeriod; accountLabel: string };

function WalletPnlCard({ active, executionAccountId, autoRefresh, refreshToken, period, accountLabel }: WalletPnlCardProps) {
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
  const identity = `${executionAccountId}:${period}:live:${refreshToken ?? ""}:${retryToken}`;
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
          const result = await consoleApi.walletPnl(executionAccountId, interval, fidelity, controller.signal);
          putWalletPnlCache(key, result.data);
          return result.data;
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
  }, [active, executionAccountId, period, refreshToken, retryToken, autoRefresh]);

  const selectedPoint = view && hoverIndex !== undefined ? view.points[hoverIndex] : undefined;
  const amount = selectedPoint?.value ?? view?.amount ?? null;
  const amountLabel = amount === null ? "—" : formatWalletPnlUsd(amount);
  const amountTone = amount === null ? "" : amount > 0 ? "positive" : amount < 0 ? "negative" : "";
  const pointTime = selectedPoint ? formatPointTime(selectedPoint.timestamp) : view?.endAt ? formatPointTime(view.endAt) : "—";
  const chart = useMemo(() => view ? buildWalletPnlChartGeometry(view) : undefined, [view]);

  return <section className="section wallet-pnl-card" aria-labelledby={titleId}>
    <div className="wallet-pnl-panel">
      <div className="section-head wallet-pnl-head">
        <div><div className="pnl-title-line"><h2 className="section-title" id={titleId}>{accountLabel ? `${accountLabel} · 官方钱包盈亏` : "官方钱包盈亏"}</h2><span className="wallet-pnl-source">官方口径 · 地址级</span></div><p className="section-caption">Polymarket 累计盈亏序列 · 包含该地址全部交易和持仓变化 · 与系统账本已实现盈亏独立</p></div>
      </div>
      {!executionAccountId ? <PnlState title="等待钱包身份" detail="选择钱包后读取官方地址级数据。" />
          : status === "loading" ? <PnlState title="正在读取官方盈亏" detail="正在从只读数据接口获取当前钱包的官方累计盈亏序列。" />
            : status === "error" ? <PnlState title="官方盈亏暂时不可用" detail={error ?? "接口返回错误，请稍后重试。"} retry={() => setRetryToken((value) => value + 1)} />
              : !view?.points.length || view.amount === null ? <PnlState title="暂无足够盈亏数据" detail="接口没有返回至少两个有效采样点；不会把缺失数据显示成零。" />
              : <>
                  <div className="wallet-pnl-summary"><div><span>盈亏</span><strong className={amountTone}>{amountLabel}</strong><small>{pointTime}（本地时间）</small></div><div className="wallet-pnl-meta"><span>查询地址</span><code>{series?.walletAddress ?? "—"}</code><small>{series ? `刷新于 ${formatFetchedAt(series.fetchedAt)}（本地时间）` : "—"}</small></div></div>
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
