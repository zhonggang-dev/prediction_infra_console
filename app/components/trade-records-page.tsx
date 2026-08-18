"use client";

import { Fragment, useEffect, useState } from "react";
import { consoleApi, ConsoleApiError } from "../lib/console-api";
import type { ApiMode, TradeHistoryPage, TradeHistoryParams, TradeRecord } from "../lib/types";
import { ConsoleShell } from "./console-shell";
import { Icon } from "./icons";

type RangeKey = "24h" | "7d" | "30d" | "all";
type Filters = { range: RangeKey; side: "" | "BUY" | "SELL"; modelId: string; strategyId: string; executionAccountId: string; query: string };

const defaultFilters: Filters = { range: "7d", side: "", modelId: "", strategyId: "", executionAccountId: "", query: "" };
const rangeLabels: Record<RangeKey, string> = { "24h": "最近 24 小时", "7d": "最近 7 天", "30d": "最近 30 天", all: "全部时间" };

/** 真实成交查询、筛选和账本明细集中在独立页面，避免与预测记录口径混淆。 */
export function TradeRecordsPage() {
  const [draft, setDraft] = useState<Filters>(defaultFilters);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [data, setData] = useState<TradeHistoryPage>();
  const [offset, setOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mode, setMode] = useState<ApiMode>("live");
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(undefined);
      const params = toRequest(filters, offset);
      try {
        const result = demoEnabled ? consoleApi.demoTradeHistory(params) : await consoleApi.tradeHistory(params);
        if (!cancelled) { setData(result.data); setMode(result.mode); }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "交易记录请求失败");
          setMode(requestError instanceof ConsoleApiError ? requestError.mode : "unavailable");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [demoEnabled, filters, offset, refreshKey]);

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    setOffset(0);
    setFilters({ ...draft, modelId: draft.modelId.trim(), strategyId: draft.strategyId.trim(), executionAccountId: draft.executionAccountId.trim(), query: draft.query.trim() });
  };
  const reset = () => { setDraft(defaultFilters); setFilters(defaultFilters); setOffset(0); };

  return <ConsoleShell>
    <header className="page-head">
      <div><p className="eyebrow">Trading Execution / Ledger</p><h1>交易记录</h1><p className="description">仅展示 Polymarket 已确认并写入资金与仓位账本的真实成交；订单已接受不等于成交。</p></div>
      <button className="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}><Icon name="refresh" /> 刷新数据</button>
    </header>
    {mode === "demo" && <Notice title="当前为演示数据" description="数据仅用于预览页面，不代表任何钱包的真实成交。" action="返回真实数据" onAction={() => setDemoEnabled(false)} />}
    {error && <Notice error title="无法读取交易执行账本" description={error} action={mode === "unavailable" ? "手动查看演示数据" : undefined} onAction={() => setDemoEnabled(true)} />}
    <TradeMetrics data={data} loading={loading && !data} range={rangeLabels[filters.range]} />
    <section className="section panel trade-panel">
      <TradeFilters draft={draft} setDraft={setDraft} apply={apply} reset={reset} loading={loading} />
      <TradeTable data={data} loading={loading} onPage={setOffset} />
    </section>
  </ConsoleShell>;
}

function TradeMetrics({ data, loading, range }: { data?: TradeHistoryPage; loading: boolean; range: string }) {
  if (loading) return <div className="trade-metrics">{Array.from({ length: 5 }, (_, index) => <div className="trade-metric" key={index}><div className="skeleton" /><div className="skeleton" /></div>)}</div>;
  const summary = data?.summary;
  return <div className="trade-metrics">
    <Metric label="成交笔数" value={String(summary?.tradeCount ?? 0)} meta={range} />
    <Metric label="买入金额" value={money(summary?.buyNotional)} meta="真实成交名义金额" tone="buy" />
    <Metric label="卖出金额" value={money(summary?.sellNotional)} meta={`净现金流 ${signedMoney(summary?.netCashFlow)}`} tone="sell" />
    <Metric label="已实现盈亏" value={signedMoney(summary?.realizedPnl)} meta="仅来自已关闭仓位批次" tone={sign(summary?.realizedPnl) < 0 ? "loss" : "profit"} />
    <Metric label="手续费" value={money(summary?.totalFee)} meta="平台费与 Builder Fee" />
  </div>;
}

function Metric({ label, value, meta, tone = "neutral" }: { label: string; value: string; meta: string; tone?: string }) {
  return <div className={`trade-metric ${tone}`}><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-meta">{meta}</span></div>;
}

function TradeFilters({ draft, setDraft, apply, reset, loading }: { draft: Filters; setDraft: React.Dispatch<React.SetStateAction<Filters>>; apply: (event: React.FormEvent) => void; reset: () => void; loading: boolean }) {
  const update = (key: keyof Filters, value: string) => setDraft((current) => ({ ...current, [key]: value } as Filters));
  return <form className="trade-filters" onSubmit={apply}>
    <label><span>时间范围</span><select className="select" value={draft.range} onChange={(event) => update("range", event.target.value)}><option value="24h">最近 24 小时</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option><option value="all">全部时间</option></select></label>
    <label><span>方向</span><select className="select" value={draft.side} onChange={(event) => update("side", event.target.value)}><option value="">全部方向</option><option value="BUY">BUY · 买入</option><option value="SELL">SELL · 卖出</option></select></label>
    <label><span>模型</span><input className="input" value={draft.modelId} onChange={(event) => update("modelId", event.target.value)} placeholder="例如 forecast-v2" /></label>
    <label><span>策略</span><input className="input" value={draft.strategyId} onChange={(event) => update("strategyId", event.target.value)} placeholder="例如 multfactor_v2" /></label>
    <label className="account-filter"><span>执行账户</span><input className="input" value={draft.executionAccountId} onChange={(event) => update("executionAccountId", event.target.value)} placeholder="model × strategy 对应账户" /></label>
    <label className="search-filter"><span>搜索</span><input className="input" value={draft.query} onChange={(event) => update("query", event.target.value)} placeholder="市场、订单、Trade ID 或 token" /></label>
    <div className="trade-filter-actions"><button type="button" className="button" onClick={reset}>重置</button><button className="button primary" disabled={loading}>应用筛选</button></div>
  </form>;
}

function TradeTable({ data, loading, onPage }: { data?: TradeHistoryPage; loading: boolean; onPage: (offset: number) => void }) {
  const [selected, setSelected] = useState<string>();
  if (!data && loading) return <div className="panel-pad"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>;
  if (!data?.items.length) return <div className="empty"><strong>没有符合条件的真实成交</strong><p>可以扩大时间范围或清除模型、策略与账户筛选条件。</p></div>;
  return <>
    <div className={`table-scroll ${loading ? "is-loading" : ""}`}>
      <table className="trade-table"><thead><tr><th>市场 / Outcome</th><th>方向</th><th>模型与策略</th><th>成交</th><th>成交金额</th><th>手续费</th><th>已实现盈亏</th><th>成交时间</th><th><span className="sr-only">详情</span></th></tr></thead>
        <tbody>{data.items.map((item) => {
          const open = selected === item.fillKey;
          const detailId = `trade-${safeID(item.fillKey)}`;
          return <Fragment key={item.fillKey}>
            <tr className={open ? "selected-row" : ""}>
              <td><div className="trade-market"><strong title={item.marketLabel}>{item.marketLabel || `Market ${shortID(item.marketId)}`}</strong><span><i className="outcome-chip">{item.outcomeName || "Outcome"}</i><span className="mono muted">{shortID(item.conditionId || item.marketId)}</span></span></div></td>
              <td><span className={`side-badge ${item.side.toLowerCase()}`}>{item.side}</span></td>
              <td><div className="trade-identity"><strong>{item.strategyId}</strong><span>{item.modelId}</span><small className="mono" title={item.executionAccountId}>{shortID(item.executionAccountId, 12)}</small></div></td>
              <td><strong className="mono">{quantity(item.shares)}</strong><span className="trade-at"> @ {price(item.price)}</span></td>
              <td className="amount-cell">{money(item.grossNotional)}</td>
              <td className="mono muted">{money(item.totalFee)}</td>
              <td><Pnl item={item} /></td>
              <td className="mono muted">{utc(item.matchedAt)}</td>
              <td><button className="trade-expand" aria-expanded={open} aria-controls={detailId} onClick={() => setSelected(open ? undefined : item.fillKey)}>{open ? "收起" : "详情"}</button></td>
            </tr>
            {open && <tr className="trade-detail-row"><td colSpan={9}><TradeDetail id={detailId} item={item} /></td></tr>}
          </Fragment>;
        })}</tbody>
      </table>
    </div>
    <TradePagination data={data} onPage={onPage} />
  </>;
}

function TradeDetail({ id, item }: { id: string; item: TradeRecord }) {
  const confirmationSeconds = Math.max(0, (new Date(item.confirmedAt).getTime() - new Date(item.matchedAt).getTime()) / 1000);
  return <div className="trade-detail" id={id}>
    <div className="trade-detail-head"><div><span className={`side-badge ${item.side.toLowerCase()}`}>{item.side}</span><strong>{quantity(item.shares)} shares · {item.outcomeName || "Outcome"}</strong></div><span className="status confirmed">已确认并入账</span></div>
    <div className="trade-detail-grid">
      <Detail label="内部订单 ID" value={item.orderId} mono /><Detail label="Polymarket Trade ID" value={item.venueTradeId} mono /><Detail label="Venue Order ID" value={item.venueOrderId} mono />
      <Detail label="持仓批次 Lot ID" value={item.lotId || "—"} mono /><Detail label="Token ID" value={item.tokenId} mono /><Detail label="Condition ID" value={item.conditionId || "—"} mono />
      <Detail label="账本现金变化" value={signedMoney(item.netCashDelta)} tone={sign(item.netCashDelta) >= 0 ? "positive" : "negative"} /><Detail label="流动性角色" value={item.liquidityRole} /><Detail label="订单最终状态" value={item.orderStatus} />
      <Detail label="撮合时间（UTC）" value={utc(item.matchedAt)} mono /><Detail label="确认时间（UTC）" value={utc(item.confirmedAt)} mono /><Detail label="确认耗时" value={`${confirmationSeconds.toFixed(0)} 秒`} />
      <Detail label="链上交易哈希" value={item.transactionHash || "—"} mono wide />
    </div>
  </div>;
}

function Detail({ label, value, mono = false, wide = false, tone = "" }: { label: string; value: string; mono?: boolean; wide?: boolean; tone?: string }) {
  return <div className={wide ? "wide" : ""}><span>{label}</span><strong className={`${mono ? "mono" : ""} ${tone}`}>{value}</strong></div>;
}

function Pnl({ item }: { item: TradeRecord }) {
  if (item.side !== "SELL") return <span className="muted">—</span>;
  const value = sign(item.realizedPnl);
  return <strong className={value < 0 ? "negative" : value > 0 ? "positive" : "muted"}>{signedMoney(item.realizedPnl)}</strong>;
}

function TradePagination({ data, onPage }: { data: TradeHistoryPage; onPage: (offset: number) => void }) {
  const previous = Math.max(0, data.offset - data.limit);
  const next = data.offset + data.limit;
  return <div className="trade-pagination"><span>共 {data.total} 笔 · {data.offset + 1}–{Math.min(data.offset + data.items.length, data.total)}</span><div><button className="button" disabled={data.offset === 0} onClick={() => onPage(previous)}>上一页</button><button className="button" disabled={next >= data.total} onClick={() => onPage(next)}>下一页</button></div></div>;
}

function Notice({ title, description, action, onAction, error = false }: { title: string; description: string; action?: string; onAction?: () => void; error?: boolean }) {
  return <div className={`notice ${error ? "error" : ""}`}><div><strong>{title}</strong><p>{description}</p></div>{action && <button className="button" onClick={onAction}>{action}</button>}</div>;
}

function toRequest(filters: Filters, offset: number): TradeHistoryParams {
  const durations: Partial<Record<RangeKey, number>> = { "24h": 24 * 60 * 60_000, "7d": 7 * 24 * 60 * 60_000, "30d": 30 * 24 * 60 * 60_000 };
  const duration = durations[filters.range];
  return { limit: 20, offset, from: duration ? new Date(Date.now() - duration).toISOString() : undefined, side: filters.side, modelId: filters.modelId || undefined, strategyId: filters.strategyId || undefined, executionAccountId: filters.executionAccountId || undefined, query: filters.query || undefined };
}

const moneyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const quantityFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
const sign = (value?: string) => Number(value ?? 0) || 0;
const money = (value?: string) => moneyFormatter.format(sign(value));
const signedMoney = (value?: string) => `${sign(value) > 0 ? "+" : ""}${money(value)}`;
const quantity = (value: string) => quantityFormatter.format(sign(value));
const price = (value: string) => sign(value).toFixed(4);
const utc = (value: string) => value ? new Date(value).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "—";
const shortID = (value: string, edge = 8) => value.length > edge * 2 + 1 ? `${value.slice(0, edge)}…${value.slice(-edge)}` : value;
const safeID = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "-");
