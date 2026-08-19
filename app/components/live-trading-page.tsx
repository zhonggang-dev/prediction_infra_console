"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { consoleApi } from "../lib/console-api";
import { demoLiveOperations } from "../lib/demo-live";
import type { ApiMode, LiveEvent, LiveHealth, LiveOperationsSnapshot, LiveOrder, LiveRiskMetric } from "../lib/types";
import { ConsoleShell } from "./console-shell";
import { Icon } from "./icons";

type EventFilter = "all" | "risk" | "trade";

/** 实盘值班主视图：把线程健康、交易漏斗、订单生命周期、风险与对账放在同一张屏幕。 */
export function LiveTradingPage({ previewObservedAt }: { previewObservedAt: string }) {
  const previewSnapshot = useMemo(() => demoLiveOperations(previewObservedAt), [previewObservedAt]);
  const [snapshot, setSnapshot] = useState<LiveOperationsSnapshot>();
  const [mode, setMode] = useState<ApiMode>("live");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshMs, setRefreshMs] = useState(15_000);
  const [selectedOrderId, setSelectedOrderId] = useState<string>();
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");

  const load = useCallback(async () => {
    try {
      const result = await consoleApi.liveOperations();
      setSnapshot(result.data);
      setMode(result.mode);
      setError(undefined);
    } catch (requestError) {
      setSnapshot(previewSnapshot);
      setMode("demo");
      setError(requestError instanceof Error ? requestError.message : "实盘聚合接口尚未接入");
    } finally {
      setLoading(false);
    }
  }, [previewSnapshot]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => { void load(); }, refreshMs);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load, refreshMs]);
  const activeSnapshot = snapshot ?? previewSnapshot;
  const effectiveOrderId = selectedOrderId ?? activeSnapshot.orders[0]?.orderId;
  const selectedOrder = activeSnapshot.orders.find((order) => order.orderId === effectiveOrderId) ?? activeSnapshot.orders[0];
  const filteredEvents = useMemo(() => filterEvents(activeSnapshot.events, eventFilter), [activeSnapshot.events, eventFilter]);

  return <ConsoleShell>
    <header className="page-head live-page-head">
      <div>
        <p className="eyebrow">Live Trading / Command Center</p>
        <div className="live-title-line"><h1>实盘监控</h1><HealthBadge health={activeSnapshot.engine.health} label={healthLabel(activeSnapshot.engine.health)} pulse /></div>
        <p className="description">从机会扫描到成交入账的全链路观测面；用于值班判断与追踪，不在此页面直接修改策略或发起交易。</p>
      </div>
      <div className="live-head-actions">
        <label className="refresh-select"><span>刷新</span><select value={refreshMs} onChange={(event) => setRefreshMs(Number(event.target.value))} aria-label="自动刷新间隔"><option value={15000}>15 秒</option><option value={30000}>30 秒</option><option value={60000}>60 秒</option></select></label>
        <button className={`button auto-refresh ${autoRefresh ? "active" : ""}`} aria-pressed={autoRefresh} onClick={() => setAutoRefresh((value) => !value)}><i /> 自动</button>
        <button className="button" onClick={() => void load()} disabled={loading}><Icon name="refresh" /> {loading ? "刷新中" : "立即刷新"}</button>
      </div>
    </header>

    {mode === "demo" && <div className="notice live-preview-notice"><div><strong>当前展示产品预览数据</strong><p>页面已按真实实盘引擎结构完成；后端提供 <span className="mono">live-operations</span> 聚合接口后会自动切换为实时数据。当前原因：{error}</p></div><button className="button" onClick={() => void load()}>重试真实数据</button></div>}

    <LiveStatusBar snapshot={activeSnapshot} mode={mode} />
    <CapitalMetrics snapshot={activeSnapshot} loading={loading && !snapshot} />
    <WorkerGrid snapshot={activeSnapshot} />
    <TradingFunnel snapshot={activeSnapshot} />

    <section className="section live-workbench">
      <div className="live-orders-column">
        <div className="section-head"><div><h2 className="section-title">活跃订单</h2><p className="section-caption">点击订单查看从预测到成交验真的完整生命周期</p></div><a className="link" href="/trades">查看成交账本 <Icon name="arrow" /></a></div>
        <div className="panel live-orders-panel">
          <OrderList orders={activeSnapshot.orders} selectedOrderId={selectedOrder?.orderId} onSelect={setSelectedOrderId} />
          {selectedOrder && <OrderLifecycle order={selectedOrder} />}
        </div>
      </div>
      <div>
        <div className="section-head"><div><h2 className="section-title">风险中枢</h2><p className="section-caption">所有值均为只读状态，红线动作仍由服务端执行</p></div></div>
        <div className="panel risk-panel">{activeSnapshot.risks.map((risk) => <RiskRow risk={risk} key={risk.id} />)}<div className="risk-footer"><span><i className="risk-shield">✓</i>交易权限</span><strong>策略服务端风控已启用</strong></div></div>
      </div>
    </section>

    <PositionsPanel snapshot={activeSnapshot} />

    <section className="section live-bottom-grid">
      <div>
        <div className="section-head"><div><h2 className="section-title">实时事件流</h2><p className="section-caption">按 run_id 串联 Cycle、Monitor 与 PredictionScheduler</p></div><EventTabs value={eventFilter} onChange={setEventFilter} /></div>
        <div className="panel event-stream">{filteredEvents.map((event) => <EventRow event={event} key={event.id} />)}</div>
      </div>
      <div>
        <div className="section-head"><div><h2 className="section-title">数据完整性</h2><p className="section-caption">区分“接口可用”和“事实已对账”</p></div></div>
        <div className="panel quality-panel">{activeSnapshot.dataQuality.map((item) => <div className="quality-row" key={item.id}><span className={`quality-icon ${item.status}`}>{item.status === "healthy" ? "✓" : item.status === "degraded" ? "!" : "×"}</span><div><strong>{item.name}</strong><small>{item.detail}</small></div><HealthBadge health={item.status} label={healthLabel(item.status)} /></div>)}</div>
        <div className="operator-note"><span>值班原则</span><p>订单状态不等于成交事实。只有 CLOB <span className="mono">/trades</span> 验真并写入 ledger 后，才计入资金与仓位。</p></div>
      </div>
    </section>
  </ConsoleShell>;
}

function LiveStatusBar({ snapshot, mode }: { snapshot: LiveOperationsSnapshot; mode: ApiMode }) {
  return <section className="live-status-bar">
    <div><span className="live-status-kicker"><i className={snapshot.engine.health === "healthy" ? "pulse-dot" : "pulse-dot warning"} />{mode === "live" ? "LIVE" : "PREVIEW"}</span><strong>{snapshot.engine.venueName}</strong><small>{snapshot.engine.presetName} preset</small></div>
    <div><span>RUN ID</span><strong className="mono">{snapshot.engine.runId}</strong><small>运行 {duration(snapshot.engine.startedAt, snapshot.observedAt)}</small></div>
    <div><span>数据时间</span><strong>{utcTime(snapshot.observedAt)}</strong><small>{snapshot.dataFreshnessSeconds} 秒前完成聚合</small></div>
    <div className="status-checks"><StatusCheck label="Venue" health={snapshot.engine.venueStatus} /><StatusCheck label="Ledger" health={snapshot.engine.ledgerStatus} /><StatusCheck label="Reconcile" health={snapshot.engine.reconciliationStatus} /></div>
  </section>;
}

function StatusCheck({ label, health }: { label: string; health: LiveHealth }) { return <span className={health}><i />{label}</span>; }

function CapitalMetrics({ snapshot, loading }: { snapshot: LiveOperationsSnapshot; loading: boolean }) {
  const exposurePct = snapshot.capital.exposureLimit ? snapshot.capital.grossExposure / snapshot.capital.exposureLimit * 100 : 0;
  const availablePct = snapshot.capital.equity ? snapshot.capital.availableCash / snapshot.capital.equity * 100 : 0;
  const metrics = [
    { label: "账户权益", value: usd(snapshot.capital.equity), meta: "现金 + 持仓盯市", tone: "" },
    { label: "可用现金", value: usd(snapshot.capital.availableCash), meta: `${availablePct.toFixed(1)}% 资金可用`, tone: "" },
    { label: "总敞口", value: usd(snapshot.capital.grossExposure), meta: `占限额 ${exposurePct.toFixed(1)}%`, tone: exposurePct > 80 ? "warning" : "" },
    { label: "今日已实现", value: signedUsd(snapshot.capital.realizedPnlToday), meta: `手续费 ${usd(snapshot.capital.feeToday)}`, tone: snapshot.capital.realizedPnlToday >= 0 ? "positive" : "negative" },
    { label: "未实现盈亏", value: signedUsd(snapshot.capital.unrealizedPnl), meta: `${snapshot.positions.length} 个开放持仓`, tone: snapshot.capital.unrealizedPnl >= 0 ? "positive" : "negative" },
    { label: "开放订单", value: String(snapshot.orders.length), meta: `${snapshot.orders.filter((order) => order.status === "PARTIAL").length} 个部分成交`, tone: "" },
  ];
  return <section className={`live-metrics ${loading ? "is-loading" : ""}`}>{metrics.map((metric) => <div className="live-metric" key={metric.label}><span>{metric.label}</span><strong className={metric.tone}>{metric.value}</strong><small>{metric.meta}</small></div>)}</section>;
}

function WorkerGrid({ snapshot }: { snapshot: LiveOperationsSnapshot }) {
  return <section className="section"><div className="section-head"><div><h2 className="section-title">运行线程</h2><p className="section-caption">三条节奏独立运行，共享 Trader、Portfolio、MarketState 与 Ledger</p></div></div><div className="worker-grid">{snapshot.workers.map((worker) => <article className={`worker-card ${worker.status}`} key={worker.id}><div className="worker-top"><span className="worker-icon">{worker.id === "cycle" ? "C" : worker.id === "monitor" ? "M" : "P"}</span><div><strong>{worker.name}</strong><small>{worker.cadence}</small></div><HealthBadge health={worker.status} label={healthLabel(worker.status)} /></div><p>{worker.purpose}</p><div className="worker-task"><span><i />{worker.currentTask}</span><strong>{worker.metricValue}</strong><small>{worker.metricLabel}</small></div><footer>Heartbeat · {worker.lastHeartbeatAt ? relative(worker.lastHeartbeatAt, snapshot.observedAt) : "尚未上报"}</footer></article>)}</div></section>;
}

function TradingFunnel({ snapshot }: { snapshot: LiveOperationsSnapshot }) {
  return <section className="section"><div className="section-head"><div><h2 className="section-title">本轮交易链路</h2><p className="section-caption">数量口径从左到右逐级收敛；橙色表示仍在处理或需要关注</p></div></div><div className="panel live-funnel">{snapshot.funnel.map((stage) => <div className={`funnel-stage ${stage.state}`} key={stage.id}><div className="funnel-index">{String(stage.index).padStart(2, "0")}</div><div className="funnel-value">{stage.count}</div><strong>{stage.name}</strong><span>{stage.throughputLabel}</span><small>{stage.description}</small></div>)}</div></section>;
}

function OrderList({ orders, selectedOrderId, onSelect }: { orders: LiveOrder[]; selectedOrderId?: string; onSelect: (id: string) => void }) {
  if (!orders.length) return <div className="empty"><strong>当前没有活跃订单</strong><p>新的开仓或退出订单会在这里出现。</p></div>;
  return <div className="live-order-list">{orders.map((order) => {
    const fillPct = order.shares ? order.filledShares / order.shares * 100 : 0;
    return <button className={`live-order-row ${selectedOrderId === order.orderId ? "selected" : ""}`} key={order.orderId} onClick={() => onSelect(order.orderId)}>
      <span className={`side-badge ${order.side.toLowerCase()}`}>{order.side}</span>
      <span className="order-market"><strong>{order.marketLabel}</strong><small><i className="outcome-chip">{order.outcomeName}</i>{order.strategyId} · {order.triggeredBy}</small></span>
      <span className="order-price"><small>限价 / 数量</small><strong>{order.price.toFixed(3)} / {order.shares.toFixed(2)}</strong></span>
      <span className="order-fill"><small>{order.filledShares.toFixed(2)} / {order.shares.toFixed(2)} 已成交</small><i><b style={{ width: `${Math.max(3, fillPct)}%` }} /></i></span>
      <span className={`order-status ${order.status.toLowerCase().replaceAll("_", "-")}`}>{order.status}</span>
      <span className="order-age">{orderAge(order.ageSeconds)}</span>
    </button>;
  })}</div>;
}

function OrderLifecycle({ order }: { order: LiveOrder }) {
  const probability = order.predictedProbability === undefined ? "—" : pct(order.predictedProbability);
  const edge = order.edge === undefined ? "—" : signedPct(order.edge);
  return <div className="order-lifecycle">
    <div className="lifecycle-head"><div><span className="mono">{order.orderId}</span><strong>{order.outcomeName} · {order.side} {order.shares.toFixed(2)} @ {order.price.toFixed(3)}</strong></div><div className="decision-facts"><span>预测 <strong>{probability}</strong></span><span>Edge <strong className={order.edge === undefined ? "" : order.edge >= 0 ? "positive" : "negative"}>{edge}</strong></span><span>模型 <strong>{order.modelId}</strong></span></div></div>
    <div className="lifecycle-track">{order.lifecycle.map((step, index) => <div className={`lifecycle-step ${step.status}`} key={`${step.name}-${index}`}><i>{step.status === "done" ? "✓" : step.status === "warning" ? "!" : index + 1}</i><div><strong>{step.name}</strong><span>{step.detail}</span><small>{step.timestamp ? utc(step.timestamp) : "等待前序状态"}</small></div></div>)}</div>
  </div>;
}

function RiskRow({ risk }: { risk: LiveRiskMetric }) {
  const usage = Math.min(100, risk.limit ? risk.current / risk.limit * 100 : 0);
  return <div className="risk-row"><div className="risk-row-head"><div><strong>{risk.name}</strong><span>{risk.hint}</span></div><div><strong>{riskValue(risk.current, risk.unit)}</strong><small>/ {riskValue(risk.limit, risk.unit)}</small></div></div><div className={`risk-bar ${risk.state}`}><i style={{ width: `${Math.max(2, usage)}%` }} /></div><footer><span>{usage.toFixed(1)}% 已使用</span><span>{risk.state === "safe" ? "安全" : risk.state === "warning" ? "关注" : "越线"}</span></footer></div>;
}

function PositionsPanel({ snapshot }: { snapshot: LiveOperationsSnapshot }) {
  return <section className="section"><div className="section-head"><div><h2 className="section-title">开放持仓</h2><p className="section-caption">以链上持仓为事实源，使用最新盘口盯市；预测年龄用于判断退出决策是否可信</p></div><span className="section-total">市值 {usd(snapshot.positions.reduce((sum, item) => sum + item.marketValue, 0))}</span></div><div className="panel table-scroll"><table className="position-table"><thead><tr><th>市场 / Outcome</th><th>策略</th><th>持仓数量</th><th>均价</th><th>标记价</th><th>成本 / 市值</th><th>未实现盈亏</th><th>预测年龄</th><th>限额占用</th></tr></thead><tbody>{snapshot.positions.map((position) => {
    const age = position.predictionAgeMinutes;
    return <tr key={position.positionId}><td><div className="position-market"><strong>{position.marketLabel}</strong><span><i className="outcome-chip">{position.outcomeName}</i><span className="mono muted">{position.marketId}</span></span></div></td><td><span className="strategy-chip">{position.strategyId}</span></td><td className="mono">{position.shares.toFixed(2)}</td><td className="mono">{position.averagePrice.toFixed(3)}</td><td className="mono">{position.markPrice.toFixed(3)}</td><td><strong>{usd(position.cost)}</strong><small>{usd(position.marketValue)}</small></td><td><strong className={position.unrealizedPnl >= 0 ? "positive" : "negative"}>{signedUsd(position.unrealizedPnl)}</strong></td><td><span className={`prediction-age ${age === undefined ? "" : age > 45 ? "stale" : age > 30 ? "warning" : ""}`}>{age === undefined ? "—" : `${age}m`}</span></td><td><div className="mini-exposure"><i><b style={{ width: `${Math.min(100, position.exposurePct * 100)}%` }} /></i><span>{pct(position.exposurePct)}</span></div></td></tr>;
  })}{!snapshot.positions.length && <tr><td colSpan={9}><div className="empty"><strong>当前没有开放持仓</strong><p>已确认的链上持仓会在这里展示。</p></div></td></tr>}</tbody></table></div></section>;
}

function EventTabs({ value, onChange }: { value: EventFilter; onChange: (value: EventFilter) => void }) {
  return <div className="event-tabs" aria-label="事件筛选">{([['all', '全部'], ['risk', '风险'], ['trade', '成交']] as [EventFilter, string][]).map(([key, label]) => <button key={key} className={value === key ? "active" : ""} onClick={() => onChange(key)}>{label}</button>)}</div>;
}

function EventRow({ event }: { event: LiveEvent }) {
  return <div className="stream-row"><time>{clock(event.timestamp)}</time><span className={`stream-mark ${event.severity}`} /><span className="thread-chip">{event.thread}</span><div><strong>{event.title}</strong><p>{event.detail}</p>{event.marketLabel && <small>{event.marketLabel}{event.orderId ? ` · ${event.orderId}` : ""}</small>}</div></div>;
}

function HealthBadge({ health, label, pulse = false }: { health: LiveHealth; label: string; pulse?: boolean }) { return <span className={`health-badge ${health} ${pulse ? "pulse" : ""}`}><i />{label}</span>; }
function filterEvents(events: LiveEvent[], filter: EventFilter) { if (filter === "risk") return events.filter((event) => event.severity === "warning" || event.severity === "error" || event.section === "risk"); if (filter === "trade") return events.filter((event) => ["fill", "order", "reprice"].includes(event.section)); return events; }
function healthLabel(health: LiveHealth) { return health === "healthy" ? "正常" : health === "degraded" ? "关注" : "停止"; }

const moneyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (value: number) => moneyFormatter.format(value);
const signedUsd = (value: number) => `${value > 0 ? "+" : ""}${usd(value)}`;
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const signedPct = (value: number) => `${value >= 0 ? "+" : ""}${pct(value)}`;
const utc = (value: string) => new Date(value).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
const utcTime = (value: string) => new Date(value).toISOString().slice(11, 19) + " UTC";
const clock = (value: string) => new Date(value).toISOString().slice(11, 19);
const relative = (value: string, observedAt: string) => { const seconds = Math.max(0, Math.floor((new Date(observedAt).getTime() - new Date(value).getTime()) / 1000)); return seconds < 60 ? `${seconds}s 前` : `${Math.floor(seconds / 60)}m 前`; };
const duration = (value: string, observedAt: string) => { const minutes = Math.max(0, Math.floor((new Date(observedAt).getTime() - new Date(value).getTime()) / 60_000)); return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; };
const orderAge = (seconds: number) => seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
const riskValue = (value: number, unit: LiveRiskMetric["unit"]) => unit === "$" ? usd(value) : unit === "%" ? `${value.toFixed(1)}%` : unit === "minutes" ? `${value}m` : String(value);
