"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { consoleApi } from "../lib/console-api";
import { demoLiveOperations } from "../lib/demo-live";
import type { ApiMode, DailyPnLReport, EdgeDistribution, LiveEvent, LiveHealth, LiveOperationsSnapshot, LiveOrder, LivePosition, LiveRiskMetric, LiveWalletSummary } from "../lib/types";
import { ConsoleShell } from "./console-shell";
import { DailyPnLDashboard } from "./daily-pnl-dashboard";
import { EdgeDistributionPanel } from "./edge-distribution-panel";
import { Icon } from "./icons";

type EventFilter = "all" | "risk" | "trade";

/** 实盘值班主视图：把线程健康、交易漏斗、订单生命周期、风险与对账放在同一张屏幕。 */
export function LiveTradingPage({ previewObservedAt }: { previewObservedAt: string }) {
  const previewSnapshot = useMemo(() => demoLiveOperations(previewObservedAt), [previewObservedAt]);
  const [snapshot, setSnapshot] = useState<LiveOperationsSnapshot>();
  const [mode, setMode] = useState<ApiMode>("unavailable");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [pnlReport, setPnlReport] = useState<DailyPnLReport>();
  const [pnlMode, setPnlMode] = useState<ApiMode>("unavailable");
  const [pnlError, setPnlError] = useState<string>();
  const [pnlLoading, setPnlLoading] = useState(true);
  const [pnlDays, setPnlDays] = useState(14);
  const [edgeDistribution, setEdgeDistribution] = useState<EdgeDistribution>();
  const [edgeError, setEdgeError] = useState<string>();
  const [edgeLoading, setEdgeLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshMs, setRefreshMs] = useState(15_000);
  const [selectedWalletId, setSelectedWalletId] = useState<string>();
  const [selectedOrderId, setSelectedOrderId] = useState<string>();
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");

  const loadOperations = useCallback(async () => {
    setLoading(true);
    try {
      const result = await consoleApi.liveOperations();
      setSnapshot(result.data);
      setMode(result.mode);
      setError(undefined);
    } catch (requestError) {
      setSnapshot(undefined);
      setMode("unavailable");
      setError(requestError instanceof Error ? requestError.message : "实盘聚合接口尚未接入");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPnL = useCallback(async (days: number) => {
    setPnlLoading(true);
    try {
      const result = await consoleApi.dailyPnL(days);
      setPnlReport(result.data);
      setPnlMode(result.mode);
      setPnlError(undefined);
    } catch (requestError) {
      setPnlReport(undefined);
      setPnlMode("unavailable");
      setPnlError(requestError instanceof Error ? requestError.message : "每日盈亏接口尚未接入");
    } finally {
      setPnlLoading(false);
    }
  }, []);

  /** 读取最新 Edge 分布并同步页面错误状态。 */
  const loadEdges = useCallback(async () => {
    setEdgeLoading(true);
    try {
      const result = await consoleApi.edgeDistribution();
      setEdgeDistribution(result.data);
      setEdgeError(undefined);
    } catch (requestError) {
      setEdgeDistribution(undefined);
      setEdgeError(requestError instanceof Error ? requestError.message : "Edge 分布接口尚未接入");
    } finally {
      setEdgeLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    await Promise.all([loadOperations(), loadPnL(pnlDays), loadEdges()]);
  }, [loadEdges, loadOperations, loadPnL, pnlDays]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void Promise.all([loadOperations(), loadPnL(14), loadEdges()]); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [loadEdges, loadOperations, loadPnL]);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => { void load(); }, refreshMs);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load, refreshMs]);
  const showPreview = () => {
    setAutoRefresh(false);
    setSnapshot(previewSnapshot);
    setMode("demo");
    setLoading(false);
    setPnlReport(consoleApi.demoDailyPnL(pnlDays).data);
    setPnlMode("demo");
    setPnlLoading(false);
  };
  const retryLive = () => {
    setSnapshot(undefined);
    setPnlReport(undefined);
    setMode("unavailable");
    setPnlMode("unavailable");
    setError(undefined);
    setPnlError(undefined);
    setEdgeDistribution(undefined);
    setEdgeError(undefined);
    setAutoRefresh(true);
    void load();
  };
  const changePnLDays = (days: number) => {
    setPnlDays(days);
    if (pnlMode === "demo") setPnlReport(consoleApi.demoDailyPnL(days).data);
    else void loadPnL(days);
  };

  const activeSnapshot = snapshot;
  const selectedWallet = activeSnapshot?.wallets.find((wallet) => wallet.executionAccountId === selectedWalletId) ?? activeSnapshot?.wallets[0];
  const effectiveWalletId = selectedWallet?.executionAccountId;
  const walletOrders = activeSnapshot?.orders.filter((order) => order.executionAccountId === effectiveWalletId) ?? [];
  const walletPositions = activeSnapshot?.positions.filter((position) => position.executionAccountId === effectiveWalletId && position.managed) ?? [];
  const effectiveOrderId = walletOrders.some((order) => order.orderId === selectedOrderId) ? selectedOrderId : walletOrders[0]?.orderId;
  const selectedOrder = walletOrders.find((order) => order.orderId === effectiveOrderId);
  const filteredEvents = activeSnapshot ? filterEvents(activeSnapshot.events, eventFilter) : [];
  const walletPnLReport = useMemo(() => {
    if (!pnlReport || !effectiveWalletId) return undefined;
    return { ...pnlReport, items: pnlReport.items.filter((point) => point.executionAccountId === effectiveWalletId) };
  }, [effectiveWalletId, pnlReport]);

  return <ConsoleShell>
    <header className="page-head live-page-head">
      <div>
        <p className="eyebrow">Live Trading / Command Center</p>
        <div className="live-title-line"><h1>实盘监控</h1>{activeSnapshot ? <HealthBadge health={activeSnapshot.engine.health} label={healthLabel(activeSnapshot.engine.health)} pulse /> : <span className="health-badge unavailable"><i />{loading ? "读取中" : "数据不可用"}</span>}</div>
        <p className="description">从机会扫描到成交入账的全链路观测面；用于值班判断与追踪，不在此页面直接修改策略或发起交易。</p>
      </div>
      <div className="live-head-actions">
        <label className="refresh-select"><span>刷新</span><select value={refreshMs} onChange={(event) => setRefreshMs(Number(event.target.value))} aria-label="自动刷新间隔"><option value={15000}>15 秒</option><option value={30000}>30 秒</option><option value={60000}>60 秒</option></select></label>
        <button className={`button auto-refresh ${autoRefresh ? "active" : ""}`} aria-pressed={autoRefresh} onClick={() => setAutoRefresh((value) => !value)}><i /> 自动</button>
        <button className="button" onClick={() => void load()} disabled={loading || pnlLoading || edgeLoading}><Icon name="refresh" /> {loading || pnlLoading || edgeLoading ? "刷新中" : "立即刷新"}</button>
      </div>
    </header>

    {mode === "unavailable" && !loading && <div className="notice live-error-notice"><div><strong>真实钱包数据不可用</strong><p>为避免把演示值误认成真实收益，当前不会自动填充产品预览。原因：{error}</p></div><div className="notice-actions"><button className="button" onClick={retryLive}>重试真实数据</button><button className="button" onClick={showPreview}>查看产品预览</button></div></div>}
    {mode === "demo" && <div className="notice live-preview-notice"><div><strong>当前为用户主动打开的产品预览</strong><p>以下钱包、仓位与盈亏均为演示数据，不代表任何真实钱包。</p></div><button className="button" onClick={retryLive}>返回真实数据</button></div>}
    {mode === "live" && pnlMode === "unavailable" && !pnlLoading && <div className="notice live-error-notice"><div><strong>每日盈亏数据不可用</strong><p>实盘快照正常，但每日账本收益不会使用演示值替代。原因：{pnlError}</p></div><div className="notice-actions"><button className="button" onClick={() => void loadPnL(pnlDays)}>重试盈亏数据</button><button className="button" onClick={showPreview}>查看产品预览</button></div></div>}

    {activeSnapshot && <LiveStatusBar snapshot={activeSnapshot} mode={mode} />}
    <WalletPerformance wallets={activeSnapshot?.wallets ?? []} wallet={selectedWallet} selectedWalletId={effectiveWalletId} onWallet={setSelectedWalletId} loading={loading && !activeSnapshot} />
    <DailyPnLDashboard report={walletPnLReport} loading={pnlLoading && !pnlReport} days={pnlDays} onDays={changePnLDays} preview={pnlMode === "demo"} />
    <EdgeDistributionPanel distribution={edgeDistribution} loading={edgeLoading} error={edgeError} onRetry={() => void loadEdges()} />

    {!activeSnapshot && <section className="section panel live-data-state"><strong>{loading ? "正在读取真实实盘快照" : "没有可展示的真实实盘快照"}</strong><p>{loading ? "钱包指标将在服务端返回完整快照后显示。" : "请重试真实数据，或明确选择查看产品预览。"}</p></section>}
    {activeSnapshot && <>
    <WorkerGrid snapshot={activeSnapshot} />
    <TradingFunnel snapshot={activeSnapshot} />

    <section className="section live-workbench">
      <div className="live-orders-column">
        <div className="section-head"><div><h2 className="section-title">活跃订单</h2><p className="section-caption">所选钱包 · 点击订单查看从预测到成交验真的完整生命周期</p></div><a className="link" href="/trades">查看成交账本 <Icon name="arrow" /></a></div>
        <div className="panel live-orders-panel">
          <OrderList orders={walletOrders} selectedOrderId={selectedOrder?.orderId} onSelect={setSelectedOrderId} />
          {selectedOrder && <OrderLifecycle order={selectedOrder} />}
        </div>
      </div>
      <div>
        <div className="section-head"><div><h2 className="section-title">全局风险概览</h2><p className="section-caption">统计所有钱包及外部未纳管仓位 · 阈值和状态由 Trading 服务端计算</p></div></div>
        <div className="panel risk-panel">{activeSnapshot.risks.map((risk) => <RiskRow risk={risk} key={risk.id} />)}<div className="risk-footer"><span><i className="risk-shield">✓</i>交易权限</span><strong>Trading 金额硬上限已启用</strong></div></div>
      </div>
    </section>

    <PositionsPanel positions={walletPositions} walletId={effectiveWalletId} />

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
    </>}
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

function WalletPerformance({ wallets, wallet, selectedWalletId, onWallet, loading }: { wallets: LiveWalletSummary[]; wallet?: LiveWalletSummary; selectedWalletId?: string; onWallet: (id: string) => void; loading: boolean }) {
  const metrics = [
    { label: "系统管理持仓", value: wallet ? String(wallet.positionCount) : "—", meta: "不含未纳管链上仓位", tone: "" },
    { label: "Peak Cash Used", value: wallet ? usd(wallet.peakCashUsed) : "—", meta: "历史最大同时在场成本（含买入费）", tone: "" },
    { label: "累计投入成本", value: wallet ? usd(wallet.cumulativeInvestedCost) : "—", meta: "已确认买入累计成本", tone: "" },
    { label: "Realized PnL", value: wallet ? signedUsd(wallet.realizedPnl) : "—", meta: "累计已实现盈亏", tone: wallet ? pnlTone(wallet.realizedPnl) : "" },
    { label: "Unrealized PnL", value: wallet ? signedUsd(wallet.unrealizedPnl) : "—", meta: "当前系统持仓盯市", tone: wallet ? pnlTone(wallet.unrealizedPnl) : "" },
    { label: "Total PnL", value: wallet ? signedUsd(wallet.totalPnl) : "—", meta: "Realized + Unrealized", tone: wallet ? pnlTone(wallet.totalPnl) : "" },
    { label: "Return", value: wallet?.return === null || wallet?.return === undefined ? "—" : signedPct(wallet.return), meta: "Total PnL / Peak Cash Used", tone: wallet?.return === null || wallet?.return === undefined ? "" : pnlTone(wallet.return) },
  ];
  return <section className="section wallet-performance" aria-labelledby="wallet-performance-title">
    <div className="section-head wallet-performance-head"><div><h2 className="section-title" id="wallet-performance-title">钱包核心指标</h2><p className="section-caption">单钱包累计口径；全局线程与风险状态不随选择器变化</p></div><label className="wallet-selector"><span>选择钱包</span><select className="select" value={selectedWalletId ?? ""} onChange={(event) => onWallet(event.target.value)} disabled={!wallets.length} aria-label="选择实盘钱包">{wallets.length ? wallets.map((item) => <option value={item.executionAccountId} key={item.executionAccountId}>{item.executionAccountId}</option>) : <option value="">{loading ? "正在读取钱包" : "暂无真实钱包"}</option>}</select></label></div>
    <div className={`live-metrics wallet-metrics ${loading ? "is-loading" : ""}`}>{metrics.map((metric) => <div className="live-metric" key={metric.label}><span>{metric.label}</span><strong className={metric.tone}>{metric.value}</strong><small>{metric.meta}</small></div>)}</div>
  </section>;
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

/** 展示服务端返回的风险当前值、预警线、硬上限和执行状态。 */
function RiskRow({ risk }: { risk: LiveRiskMetric }) {
  const limitLabel = risk.thresholdType === "target" ? "运营目标" : "硬上限";
  return <div className={`risk-row ${risk.state}`}>
    <div className="risk-row-head"><div><strong>{risk.name}</strong><span>{risk.hint}</span></div><div className="risk-row-value"><strong>{riskValue(risk.current, risk.unit)}</strong><small>{limitLabel} {riskValue(risk.hardLimit, risk.unit)}</small></div></div>
    <div className="risk-thresholds">{riskThresholdSummary(risk)}</div>
    <div className={`risk-bar ${risk.state}`}><i style={{ width: `${riskBarWidth(risk)}%` }} /></div>
    <footer><span>{riskUsageLabel(risk)}</span><span>{riskStateLabel(risk)}</span></footer>
  </div>;
}

/** 只限制进度条的视觉宽度，保留后端返回的真实占用率文本。 */
function riskBarWidth(risk: LiveRiskMetric) {
  if (risk.usagePercentage === undefined) return risk.current > risk.hardLimit ? 100 : 0;
  if (risk.usagePercentage <= 0) return 0;
  return Math.min(100, Math.max(2, risk.usagePercentage));
}

/** 生成风险阈值来源和执行语义说明。 */
function riskThresholdSummary(risk: LiveRiskMetric) {
  if (risk.thresholdType === "target") return `仅监控 · 目标 ${riskValue(risk.hardLimit, risk.unit)}`;
  const enforcement = risk.hardLimitEnforced ? "Trading 强制执行" : "未强制执行";
  return `预警线 ${riskValue(risk.warningThreshold, risk.unit)} · ${enforcement}`;
}

/** 生成占用率或零目标超出数量，避免出现除以零。 */
function riskUsageLabel(risk: LiveRiskMetric) {
  if (risk.usagePercentage !== undefined) return `${risk.usagePercentage.toFixed(1)}% 硬上限占用`;
  const exceeded = Math.max(0, risk.current - risk.hardLimit);
  return exceeded > 0 ? `超出目标 ${riskValue(exceeded, risk.unit)}` : "目标已达成";
}

/** 把后端风险状态转换为清晰的中文操作提示。 */
function riskStateLabel(risk: LiveRiskMetric) {
  if (risk.state === "safe") return "安全";
  if (risk.state === "warning") return "接近硬上限";
  if (risk.thresholdType === "target") return "未达目标";
  return risk.current > risk.hardLimit ? "已超硬上限" : "已达硬上限";
}

function PositionsPanel({ positions, walletId }: { positions: LivePosition[]; walletId?: string }) {
  return <section className="section"><div className="section-head"><div><h2 className="section-title">系统管理持仓明细</h2><p className="section-caption">仅展示所选钱包中 managed=true 的仓位；以链上数量为事实源，使用最新盘口盯市</p></div><span className="section-total">{walletId && <span className="mono">{walletId} · </span>}市值 {usd(positions.reduce((sum, item) => sum + item.marketValue, 0))}</span></div><div className="panel table-scroll"><table className="position-table"><thead><tr><th>市场 / Outcome</th><th>策略</th><th>持仓数量</th><th>均价</th><th>标记价</th><th>成本 / 市值</th><th>未实现盈亏</th><th>预测年龄</th><th>限额占用</th></tr></thead><tbody>{positions.map((position) => {
    const age = position.predictionAgeMinutes;
    return <tr key={position.positionId}><td><div className="position-market"><strong>{position.marketLabel}</strong><span><i className="outcome-chip">{position.outcomeName}</i><span className="mono muted">{position.marketId}</span></span></div></td><td><span className="strategy-chip">{position.strategyId}</span></td><td className="mono">{position.shares.toFixed(2)}</td><td className="mono">{position.averagePrice.toFixed(3)}</td><td className="mono">{position.markPrice.toFixed(3)}</td><td><strong>{usd(position.cost)}</strong><small>{usd(position.marketValue)}</small></td><td><strong className={position.unrealizedPnl >= 0 ? "positive" : "negative"}>{signedUsd(position.unrealizedPnl)}</strong></td><td><span className={`prediction-age ${age === undefined ? "" : age > 45 ? "stale" : age > 30 ? "warning" : ""}`}>{age === undefined ? "—" : `${age}m`}</span></td><td><div className="mini-exposure"><i><b style={{ width: `${Math.min(100, position.exposurePct * 100)}%` }} /></i><span>{pct(position.exposurePct)}</span></div></td></tr>;
  })}{!positions.length && <tr><td colSpan={9}><div className="empty"><strong>当前没有系统管理持仓</strong><p>所选钱包中已纳管且确认的开放仓位会在这里展示。</p></div></td></tr>}</tbody></table></div></section>;
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
function pnlTone(value: number) { return value > 0 ? "positive" : value < 0 ? "negative" : ""; }

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
