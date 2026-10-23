"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { consoleApi, ConsoleApiError } from "../lib/console-api";
import type { ApiMode, DailyPnLReport, LedgerActivity, LedgerActivityPage, LedgerActivityParams, LedgerActivityType } from "../lib/types";
import { ConsoleShell } from "./console-shell";
import { DailyPnLDashboard } from "./daily-pnl-dashboard";
import { WORKSPACE_FILTER_CHANGE_EVENT } from "./console-v2-resource";
import { Icon } from "./icons";

type RangeKey = "24h" | "7d" | "30d" | "all" | "custom";
type Filters = { range: RangeKey; from: string; to: string; activityType: "" | LedgerActivityType; modelId: string; strategyId: string; executionAccountId: string; query: string };

const defaultFilters: Filters = { range: "24h", from: "", to: "", activityType: "", modelId: "", strategyId: "", executionAccountId: "", query: "" };
const rangeLabels: Record<RangeKey, string> = { "24h": "最近 24 小时", "7d": "最近 7 天", "30d": "最近 30 天", all: "全部时间", custom: "自定义日期" };
const activityLabels: Record<LedgerActivityType, string> = { BUY: "买入成交", SELL: "卖出成交", EXTERNAL_SELL: "外部卖出", REDEEM: "赎回结算" };

/** 交易与结算记录：成交（BUY / SELL）与链上赎回结算（REDEEM）使用统一账本活动接口，避免与预测记录口径混淆。 */
export function TradeRecordsPage({ embedded = false, sharedAccountOnly = false, showPnL = false }: { embedded?: boolean; sharedAccountOnly?: boolean; showPnL?: boolean } = {}) {
  const searchParams = useSearchParams();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const initialLimit = normalizeLedgerLimit(searchParams.get("limit"));
  const initialFilters = ledgerFiltersFromUrl(searchParams);
  const [draft, setDraft] = useState<Filters>(initialFilters);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [data, setData] = useState<LedgerActivityPage>();
  const [limit, setLimit] = useState(initialLimit);
  const [offset, setOffset] = useState(normalizeLedgerOffset(searchParams.get("offset"), initialLimit));
  const [refreshKey, setRefreshKey] = useState(0);
  const [mode, setMode] = useState<ApiMode>("live");
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [pnlReport, setPnlReport] = useState<DailyPnLReport>();
  const [pnlDays, setPnlDays] = useState(14);
  const [pnlLoading, setPnlLoading] = useState(false);
  const [pnlError, setPnlError] = useState<string>();

  useEffect(() => {
    const syncFromUrl = () => {
      if (rootRef.current?.closest<HTMLElement>("[role=\"tabpanel\"]")?.hidden) return;
      const url = new URL(window.location.href);
      const nextLimit = normalizeLedgerLimit(url.searchParams.get("limit"));
      const nextFilters = ledgerFiltersFromUrl(url.searchParams);
      setLimit(nextLimit);
      setOffset(normalizeLedgerOffset(url.searchParams.get("offset"), nextLimit));
      setFilters(nextFilters);
      setDraft(nextFilters);
    };
    window.addEventListener("popstate", syncFromUrl);
    window.addEventListener("v2-workspace-url-change", syncFromUrl);
    window.addEventListener(WORKSPACE_FILTER_CHANGE_EVENT, syncFromUrl);
    return () => { window.removeEventListener("popstate", syncFromUrl); window.removeEventListener("v2-workspace-url-change", syncFromUrl); window.removeEventListener(WORKSPACE_FILTER_CHANGE_EVENT, syncFromUrl); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setData(undefined);
      setError(undefined);
      const params = toRequest(filters, limit, offset);
      try {
        const result = demoEnabled ? consoleApi.demoLedgerActivities(params) : await consoleApi.ledgerActivities(params);
        if (!cancelled) {
          setData(result.data);
          setMode(result.mode);
          if (result.data.total === 0 && offset !== 0) {
            setOffset(0);
            syncLedgerUrl(filters, limit, 0);
          } else if (result.data.total > 0 && offset >= result.data.total) {
            const lastOffset = Math.floor((result.data.total - 1) / result.data.limit) * result.data.limit;
            if (lastOffset !== offset) {
              setOffset(lastOffset);
              syncLedgerUrl(filters, limit, lastOffset);
            }
          }
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "交易与结算记录请求失败");
          setMode(requestError instanceof ConsoleApiError ? requestError.mode : "unavailable");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [demoEnabled, filters, limit, offset, refreshKey]);

  useEffect(() => {
    if (!showPnL) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setPnlLoading(true);
      setPnlError(undefined);
      void consoleApi.dailyPnL(pnlDays).then((result) => { if (!cancelled) setPnlReport(result.data); }).catch((requestError) => { if (!cancelled) { setPnlReport(undefined); setPnlError(requestError instanceof Error ? requestError.message : "每日盈亏数据暂不可用"); } }).finally(() => { if (!cancelled) setPnlLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [pnlDays, refreshKey, showPnL]);

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    setOffset(0);
    const next = { ...draft, modelId: draft.modelId.trim(), strategyId: draft.strategyId.trim(), executionAccountId: draft.executionAccountId.trim(), query: draft.query.trim() };
    setFilters(next);
    syncLedgerUrl(next, limit, 0);
  };
  const reset = () => {
    const next = sharedAccountOnly
      ? { ...defaultFilters, executionAccountId: filters.executionAccountId }
      : embedded
        ? { ...defaultFilters, range: filters.from || filters.to ? "custom" as const : defaultFilters.range, from: filters.from, to: filters.to, modelId: filters.modelId, strategyId: filters.strategyId, executionAccountId: filters.executionAccountId }
      : defaultFilters;
    setDraft(next); setFilters(next); setOffset(0); syncLedgerUrl(next, limit, 0);
  };

  const changeLimit = (next: number) => { setLimit(next); setOffset(0); syncLedgerUrl(filters, next, 0); };
  const appliedListParams = ledgerAppliedListParams(filters);

  const content = <div ref={rootRef} className="trade-records-content" data-v2-list-state data-v2-list-query={filters.query} data-v2-list-limit={limit} data-v2-list-offset={offset} data-v2-list-params={JSON.stringify(appliedListParams)}>
    {embedded ? <div className="trading-embedded-toolbar">
      <div><span className="eyebrow">Trading / Ledger</span><strong>资金账本与结算</strong><small>交易与结算记录：已确认并入账的成交与结算按 BUY、SELL、EXTERNAL_SELL 与 REDEEM 分开保留；日期按账本活动发生时间。</small></div>
      <button className="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}><Icon name="refresh" /> {loading ? "刷新中" : "刷新数据"}</button>
    </div> : <header className="page-head">
      <div><p className="eyebrow">Trading Execution / Ledger</p><h1>交易与结算记录</h1><p className="description">来自已确认并入账的成交与结算：BUY / SELL 为 Polymarket CLOB 真实成交，EXTERNAL_SELL 为外部卖出记账，REDEEM 为链上赎回结算。订单已接受不等于成交；REDEEM 不是卖出成交。日期按账本活动发生时间。</p></div>
      <button className="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}><Icon name="refresh" /> 刷新数据</button>
    </header>}
    {mode === "demo" && <Notice title="当前为演示数据" description="数据仅用于预览页面，不代表任何钱包的真实成交或赎回。" action="返回真实数据" onAction={() => setDemoEnabled(false)} />}
    {error && <Notice error title="无法读取交易执行账本" description={error} action={mode === "unavailable" ? "手动查看演示数据" : undefined} onAction={() => setDemoEnabled(true)} />}
    {showPnL && pnlError && <Notice error title="无法读取钱包 PnL" description={pnlError} />}
    {showPnL && <DailyPnLDashboard report={pnlReport} loading={pnlLoading && !pnlReport} days={pnlDays} onDays={setPnlDays} accountId={filters.executionAccountId || undefined} />}
    <LedgerMetrics data={data} loading={loading && !data} range={rangeLabels[filters.range]} />
    <section className="section panel trade-panel">
      <LedgerFilters draft={draft} setDraft={setDraft} apply={apply} reset={reset} loading={loading} sharedAccountOnly={sharedAccountOnly} />
      <LedgerTable data={data} loading={loading} onPage={(nextOffset) => { setOffset(nextOffset); syncLedgerUrl(filters, limit, nextOffset); }} onLimit={changeLimit} />
    </section>
  </div>;
  return embedded ? content : <ConsoleShell>{content}</ConsoleShell>;
}

function LedgerMetrics({ data, loading, range }: { data?: LedgerActivityPage; loading: boolean; range: string }) {
  if (loading) return <div className="trade-metrics">{Array.from({ length: 6 }, (_, index) => <div className="trade-metric" key={index}><div className="skeleton" /><div className="skeleton" /></div>)}</div>;
  if (!data) return <div className="trade-metrics"><Metric label="活动笔数" value="—" meta={`${range} · 汇总不可用`} /><Metric label="买入金额" value="—" meta="未取得账本快照" tone="buy" /><Metric label="卖出金额" value="—" meta="未取得账本快照" tone="sell" /><Metric label="赎回到账" value="—" meta="未取得账本快照" tone="redeem" /><Metric label="已实现盈亏" value="—" meta="未取得账本快照" /><Metric label="手续费" value="—" meta="未取得账本快照" /></div>;
  const summary = data?.summary;
  return <div className="trade-metrics">
    <Metric label="活动笔数" value={String(summary?.activityCount ?? 0)} meta={`${range} · ${summary?.tradeCount ?? 0} 笔成交 · ${summary?.redemptionCount ?? 0} 笔赎回`} />
    <Metric label="买入金额" value={money(summary?.buyNotional)} meta="CLOB 真实成交名义金额" tone="buy" />
    <Metric label="卖出金额" value={money(summary?.sellNotional)} meta="含 SELL 与外部卖出，不含赎回到账" tone="sell" />
    <Metric label="赎回到账" value={money(summary?.redeemPayout)} meta={`${summary?.redemptionCount ?? 0} 笔 REDEEM 结算入账`} tone="redeem" />
    <Metric label="已实现盈亏" value={signedMoney(summary?.realizedPnl)} meta={`平仓 ${signedMoney(summary?.sellRealizedPnl)} · 赎回 ${signedMoney(summary?.redeemRealizedPnl)}`} tone={sign(summary?.realizedPnl) < 0 ? "loss" : "profit"} />
    <Metric label="手续费" value={money(summary?.totalFee)} meta={`平台费与 Builder Fee · 净现金流 ${signedMoney(summary?.netCashFlow)}`} />
  </div>;
}

function Metric({ label, value, meta, tone = "neutral" }: { label: string; value: string; meta: string; tone?: string }) {
  return <div className={`trade-metric ${tone}`}><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-meta">{meta}</span></div>;
}

function LedgerFilters({ draft, setDraft, apply, reset, loading, sharedAccountOnly }: { draft: Filters; setDraft: React.Dispatch<React.SetStateAction<Filters>>; apply: (event: React.FormEvent) => void; reset: () => void; loading: boolean; sharedAccountOnly: boolean }) {
  const update = (key: keyof Filters, value: string) => setDraft((current) => ({ ...current, [key]: value } as Filters));
  return <form className="trade-filters" onSubmit={apply}>
    <label><span>时间范围</span><select className="select" value={draft.range} onChange={(event) => setDraft((current) => ({ ...current, range: event.target.value as RangeKey, from: "", to: "" }))}><option value="24h">最近 24 小时</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option><option value="all">全部时间</option><option value="custom">自定义日期</option></select></label>
    <label><span>开始日期</span><input className="input" type="date" value={draft.from} onChange={(event) => update("from", event.target.value)} /></label>
    <label><span>结束日期</span><input className="input" type="date" value={draft.to} onChange={(event) => update("to", event.target.value)} /></label>
    <label><span>活动类型</span><select className="select" value={draft.activityType} onChange={(event) => update("activityType", event.target.value)}><option value="">全部类型</option><option value="BUY">BUY · 买入</option><option value="SELL">SELL · 卖出</option><option value="EXTERNAL_SELL">EXTERNAL_SELL · 外部卖出</option><option value="REDEEM">REDEEM · 赎回结算</option></select></label>
    <><label><span>模型</span><input className="input" value={draft.modelId} onChange={(event) => update("modelId", event.target.value)} placeholder="例如 forecast-v2" /></label><label><span>策略</span><input className="input" value={draft.strategyId} onChange={(event) => update("strategyId", event.target.value)} placeholder="例如 multfactor_v2" /></label><label className="account-filter"><span>{sharedAccountOnly ? "执行账户（共享范围）" : "执行账户"}</span><input className="input" value={draft.executionAccountId} readOnly={sharedAccountOnly} disabled={sharedAccountOnly} onChange={(event) => update("executionAccountId", event.target.value)} placeholder="例如 wallet-6" /></label></>
    <label className="search-filter"><span>搜索</span><input className="input" value={draft.query} onChange={(event) => update("query", event.target.value)} placeholder="市场、订单、Trade ID、Lot、token 或链上哈希" /></label>
    <div className="trade-filter-actions"><button type="button" className="button" onClick={reset}>重置</button><button className="button primary" disabled={loading}>应用筛选</button></div>
  </form>;
}

function LedgerTable({ data, loading, onPage, onLimit }: { data?: LedgerActivityPage; loading: boolean; onPage: (offset: number) => void; onLimit: (limit: number) => void }) {
  const [selected, setSelected] = useState<string>();
  if (!data && loading) return <div className="panel-pad"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>;
  if (!data) return <div className="empty"><strong>没有符合条件的成交或赎回结算</strong><p>可以扩大时间范围或清除类型、模型、策略与账户筛选条件。</p></div>;
  if (!data.items.length) return <><div className="empty"><strong>没有符合条件的成交或赎回结算</strong><p>可以扩大时间范围或清除类型、模型、策略与账户筛选条件。</p></div><LedgerPagination data={data} onPage={onPage} onLimit={onLimit} /></>;
  return <>
    <div className={`table-scroll ${loading ? "is-loading" : ""}`}>
      <table className="trade-table"><thead><tr><th>市场 / Outcome</th><th>类型</th><th>模型与策略</th><th>数量</th><th>金额</th><th>手续费</th><th>已实现盈亏</th><th>时间（UTC）</th><th><span className="sr-only">详情</span></th></tr></thead>
        <tbody>{data.items.map((item) => {
          const open = selected === item.activityKey;
          const detailId = `activity-${safeID(item.activityKey)}`;
          const redeem = item.activityType === "REDEEM";
          return <Fragment key={item.activityKey}>
            <tr className={open ? "selected-row" : ""}>
              <td><div className="trade-market"><strong title={item.marketLabel}>{item.marketLabel || `Market ${shortID(item.marketId)}`}</strong><span><i className="outcome-chip">{item.outcomeName || "Outcome"}</i><span className="mono muted">{shortID(item.conditionId || item.marketId)}</span></span></div></td>
              <td><ActivityBadge type={item.activityType} /></td>
              <td><div className="trade-identity"><strong>{item.strategyId}</strong><span>{item.modelId}</span><small className="mono" title={item.executionAccountId}>{shortID(item.executionAccountId, 12)}</small></div></td>
              <td><strong className="mono">{quantity(item.shares)}</strong><span className="trade-at"> @ {redeem ? "—" : price(item.price)}</span>{redeem && <span className="trade-kind-note">赎回份额</span>}</td>
              <td className="amount-cell">{redeem ? money(item.settlementPayout) : money(item.grossNotional)}{redeem && <span className="trade-kind-note">结算到账</span>}</td>
              <td className="mono muted">{redeem ? "—" : money(item.totalFee)}</td>
              <td><Pnl item={item} /></td>
              <td className="mono muted">{utc(item.occurredAt)}{redeem && <span className="trade-kind-note">入账时间</span>}</td>
              <td><button className="trade-expand" aria-expanded={open} aria-controls={detailId} onClick={() => setSelected(open ? undefined : item.activityKey)}>{open ? "收起" : "详情"}</button></td>
            </tr>
            {open && <tr className="trade-detail-row"><td colSpan={9}>{redeem ? <RedeemDetail id={detailId} item={item} /> : <TradeDetail id={detailId} item={item} />}</td></tr>}
          </Fragment>;
        })}</tbody>
      </table>
    </div>
    <LedgerPagination data={data} onPage={onPage} onLimit={onLimit} />
  </>;
}

function ActivityBadge({ type }: { type: LedgerActivityType }) {
  return <span className={`side-badge ${type.toLowerCase()}`} title={`${type} · ${activityLabels[type]}`}>{activityLabels[type]}</span>;
}

/** 成交详情：沿用 Fill 的订单、撮合与确认字段。 */
function TradeDetail({ id, item }: { id: string; item: LedgerActivity }) {
  const confirmationSeconds = Math.max(0, (new Date(item.confirmedAt).getTime() - new Date(item.occurredAt).getTime()) / 1000);
  return <div className="trade-detail" id={id}>
    <div className="trade-detail-head"><div><ActivityBadge type={item.activityType} /><strong>{item.activityType === "EXTERNAL_SELL" ? "外部卖出" : "成交"} {quantity(item.shares)} shares · {item.outcomeName || "Outcome"}</strong></div><span className="status confirmed">已确认并入账</span></div>
    {item.activityType === "EXTERNAL_SELL" && <p className="v2-inline-note">这是外部卖出记账，可能没有本地订单或 CLOB Trade ID；金额与已实现 PnL 采用账本返回值。</p>}
    <div className="trade-detail-grid">
      <Detail label="内部订单 ID" value={item.orderId || "—"} mono /><Detail label="Polymarket Trade ID" value={item.venueTradeId || "—"} mono /><Detail label="Venue Order ID" value={item.venueOrderId || "—"} mono />
      <Detail label="持仓批次 Lot ID" value={item.lotId || "—"} mono /><Detail label="Token ID" value={item.tokenId} mono /><Detail label="Condition ID" value={item.conditionId || "—"} mono />
      <Detail label="成交价" value={price(item.price)} mono /><Detail label="账本现金变化" value={signedMoney(item.netCashDelta)} tone={sign(item.netCashDelta) >= 0 ? "positive" : "negative"} /><Detail label="平仓成本" value={item.activityType === "SELL" || item.activityType === "EXTERNAL_SELL" ? money(item.costBasis) : "—"} />
      <Detail label="流动性角色" value={item.liquidityRole || "—"} /><Detail label="订单最终状态" value={item.orderStatus || "—"} /><Detail label="确认耗时" value={`${confirmationSeconds.toFixed(0)} 秒`} />
      <Detail label="撮合时间（UTC）" value={utc(item.occurredAt)} mono /><Detail label="确认时间（UTC）" value={utc(item.confirmedAt)} mono /><Detail label="入账时间（UTC）" value={utc(item.appliedAt)} mono />
      <Detail label="链上交易哈希" value={item.transactionHash || "—"} mono wide />
    </div>
  </div>;
}

/** 赎回详情：REDEEM 不是 CLOB 成交，成交价、订单 ID 与流动性角色明确显示为 —。 */
function RedeemDetail({ id, item }: { id: string; item: LedgerActivity }) {
  return <div className="trade-detail" id={id}>
    <div className="trade-detail-head"><div><ActivityBadge type="REDEEM" /><strong>赎回 {quantity(item.shares)} shares · {item.outcomeName || "Outcome"}</strong></div><span className="status confirmed">链上已确认并入账</span></div>
    <div className="trade-detail-grid">
      <Detail label="赎回份额" value={`${quantity(item.shares)} shares`} mono /><Detail label="原始成本" value={money(item.costBasis)} /><Detail label="结算到账" value={money(item.settlementPayout)} tone="positive" />
      <Detail label="实现 PnL" value={signedMoney(item.realizedPnl)} tone={sign(item.realizedPnl) >= 0 ? "positive" : "negative"} /><Detail label="账本现金变化" value={signedMoney(item.netCashDelta)} tone={sign(item.netCashDelta) >= 0 ? "positive" : "negative"} /><Detail label="执行账户" value={item.executionAccountId} mono />
      <Detail label="持仓批次 Lot ID" value={item.lotId || "—"} mono /><Detail label="Token ID" value={item.tokenId} mono /><Detail label="Condition ID" value={item.conditionId || "—"} mono />
      <Detail label="成交价" value="—" /><Detail label="订单 ID" value="—" /><Detail label="流动性角色" value="—" />
      <Detail label="链上确认时间（UTC）" value={utc(item.confirmedAt)} mono /><Detail label="入账时间（UTC）" value={utc(item.appliedAt)} mono /><Detail label="结算来源" value="Polymarket 赎回（auto redeem）" />
      <Detail label="链上交易哈希" value={item.transactionHash || "—"} mono wide />
    </div>
  </div>;
}

function Detail({ label, value, mono = false, wide = false, tone = "" }: { label: string; value: string; mono?: boolean; wide?: boolean; tone?: string }) {
  return <div className={wide ? "wide" : ""}><span>{label}</span><strong className={`${mono ? "mono" : ""} ${tone}`}>{value}</strong></div>;
}

function Pnl({ item }: { item: LedgerActivity }) {
  if (item.activityType === "BUY") return <span className="muted">—</span>;
  const value = sign(item.realizedPnl);
  return <strong className={value < 0 ? "negative" : value > 0 ? "positive" : "muted"}>{signedMoney(item.realizedPnl)}</strong>;
}

function LedgerPagination({ data, onPage, onLimit }: { data: LedgerActivityPage; onPage: (offset: number) => void; onLimit: (limit: number) => void }) {
  const previous = Math.max(0, data.offset - data.limit);
  const next = data.offset + data.limit;
  const totalPages = Math.ceil(data.total / data.limit);
  const currentPage = data.total === 0 ? 0 : Math.floor(data.offset / data.limit) + 1;
  const start = data.items.length ? data.offset + 1 : 0;
  const end = data.items.length ? Math.min(data.offset + data.items.length, data.total) : 0;
  return <div className="trade-pagination"><div className="trade-pagination-summary"><span>第 {start}–{end} 条，共 {data.total} 条</span><span>第 {currentPage} / {totalPages} 页</span></div><div className="trade-pagination-controls"><label className="v2-page-size"><span>每页</span><select className="select" aria-label="账本每页条数" value={data.limit} onChange={(event) => onLimit(normalizeLedgerLimit(event.target.value))}><option value={20}>20</option><option value={50}>50</option><option value={100}>100</option></select></label><label className="v2-page-jump"><span>跳至</span><input className="input" aria-label="账本跳转页码" inputMode="numeric" min={1} max={totalPages || undefined} placeholder="页码" disabled={!totalPages} onKeyDown={(event) => { if (event.key !== "Enter") return; const value = Number(event.currentTarget.value); if (!Number.isSafeInteger(value) || value < 1 || value > totalPages) return; onPage((value - 1) * data.limit); event.currentTarget.value = ""; }} /><span>页</span></label><button className="button" disabled={data.offset === 0} onClick={() => onPage(previous)}>上一页</button><button className="button" disabled={next >= data.total} onClick={() => onPage(next)}>下一页</button></div></div>;
}

function Notice({ title, description, action, onAction, error = false }: { title: string; description: string; action?: string; onAction?: () => void; error?: boolean }) {
  return <div className={`notice ${error ? "error" : ""}`}><div><strong>{title}</strong><p>{description}</p></div>{action && <button className="button" onClick={onAction}>{action}</button>}</div>;
}

function toRequest(filters: Filters, limit: number, offset: number): LedgerActivityParams {
  const durations: Partial<Record<RangeKey, number>> = { "24h": 24 * 60 * 60_000, "7d": 7 * 24 * 60 * 60_000, "30d": 30 * 24 * 60 * 60_000 };
  const duration = durations[filters.range];
  return { limit, offset, from: filters.from ? `${filters.from}T00:00:00Z` : duration ? new Date(Date.now() - duration).toISOString() : undefined, to: filters.to ? nextDayStart(filters.to) : undefined, activityType: filters.activityType, modelId: filters.modelId || undefined, strategyId: filters.strategyId || undefined, executionAccountId: filters.executionAccountId || undefined, query: filters.query || undefined };
}

function nextDayStart(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function ledgerFiltersFromUrl(params: URLSearchParams): Filters {
  const range = params.get("ledger_range");
  const activityType = params.get("activity_type");
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  return { range: from || to ? "custom" : range === "7d" || range === "30d" || range === "all" ? range : "24h", from, to, activityType: activityType === "BUY" || activityType === "SELL" || activityType === "EXTERNAL_SELL" || activityType === "REDEEM" ? activityType : "", modelId: params.get("model_id") ?? "", strategyId: params.get("strategy_id") ?? "", executionAccountId: params.get("execution_account_id") ?? "", query: params.get("q") ?? "" };
}

function ledgerAppliedListParams(filters: Filters) {
  return {
    activity_type: filters.activityType || undefined,
    ledger_range: filters.range === "24h" || filters.range === "custom" ? undefined : filters.range,
    from: filters.from || undefined,
    to: filters.to || undefined,
    model_id: filters.modelId || undefined,
    strategy_id: filters.strategyId || undefined,
    execution_account_id: filters.executionAccountId || undefined,
  };
}

function syncLedgerUrl(filters: Filters, limit: number, offset: number) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const values: Record<string, string> = { ledger_range: filters.range === "24h" || filters.range === "custom" ? "" : filters.range, from: filters.from, to: filters.to, activity_type: filters.activityType, model_id: filters.modelId, strategy_id: filters.strategyId, execution_account_id: filters.executionAccountId, q: filters.query };
  for (const [key, value] of Object.entries(values)) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); }
  if (limit === 20) url.searchParams.delete("limit"); else url.searchParams.set("limit", String(limit));
  if (offset > 0) url.searchParams.set("offset", String(offset)); else url.searchParams.delete("offset");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function normalizeLedgerLimit(value: string | number | null | undefined) { const numeric = Number(value); return numeric === 50 || numeric === 100 ? numeric : 20; }
function normalizeLedgerOffset(value: string | number | null | undefined, limit: number) { const numeric = Number(value); return Number.isSafeInteger(numeric) && numeric >= 0 ? Math.floor(numeric / limit) * limit : 0; }

const moneyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const quantityFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
const sign = (value?: string) => Number(value ?? 0) || 0;
const money = (value?: string) => moneyFormatter.format(sign(value));
const signedMoney = (value?: string) => `${sign(value) > 0 ? "+" : ""}${money(value)}`;
const quantity = (value: string) => quantityFormatter.format(sign(value));
const price = (value?: string) => value === undefined || value === "" ? "—" : sign(value).toFixed(4);
const utc = (value: string) => value ? new Date(value).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "—";
const shortID = (value: string, edge = 8) => value.length > edge * 2 + 1 ? `${value.slice(0, edge)}…${value.slice(-edge)}` : value;
const safeID = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "-");
