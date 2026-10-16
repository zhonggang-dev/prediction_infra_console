"use client";

import { useEffect, useMemo, useState } from "react";
import { consoleV2, type ConsoleV2DecisionCycle, type ConsoleV2Order, type ConsoleV2PositionLot, type ConsoleV2ReconciliationIssue, type ConsoleV2ReconciliationRun, type ConsoleV2Redemption, type ConsoleV2Runtime } from "../lib/console-v2";
import { formatV2Number, formatV2Time, V2Facts, V2Frame, V2ListPage, V2Tabs, v2Status, v2Unknown } from "./console-v2-resource";

type TradingView = "cycles" | "orders" | "positions" | "reconciliation" | "redemptions";

export function TradingV2Page({ view = "cycles" }: { view?: TradingView }) {
  const config = view === "orders"
    ? { eyebrow: "Trading / Orders", title: "订单执行", description: "订单履历、确认成交和账本应用分别展示；页面只读。" }
    : view === "positions"
      ? { eyebrow: "Trading / Positions", title: "仓位与 Lot", description: "按 lot 保留 model、strategy、execution account 归属；不把账户聚合成失去 binding 的单行仓位。" }
      : view === "reconciliation"
        ? { eyebrow: "Trading / Reconciliation", title: "账户对账", description: "对账运行与开放 issue 分层展示；查询失败不会被渲染成零差异，也不会触发恢复动作。" }
        : view === "redemptions"
          ? { eyebrow: "Trading / Redemptions", title: "赎回", description: "市场终态、链上确认和账本应用分层展示；未确认或未应用不冒充到账。" }
          : { eyebrow: "Trading / Decision Cycles", title: "决策周期", description: "按持久化决策周期核对输入、输出、交付和订单链路；页面只读。" };
  const tabs = [{ href: "/trading/cycles", label: "决策周期" }, { href: "/trading/orders", label: "订单执行" }, { href: "/trading/positions", label: "仓位" }, { href: "/trading/reconciliation", label: "账户对账" }, { href: "/trading/redemptions", label: "赎回" }];
  return <V2Frame eyebrow={config.eyebrow} title={config.title} description={config.description}>
    <V2Tabs tabs={tabs} active={`/trading/${view}`} />
    {view === "cycles" && <DecisionCycles />}
    {view === "orders" && <Orders />}
    {view === "positions" && <Positions />}
    {view === "reconciliation" && <Reconciliation />}
    {view === "redemptions" && <Redemptions />}
  </V2Frame>;
}

function DecisionCycles() {
  const [runtime, setRuntime] = useState<ConsoleV2Runtime>();
  const [runtimeError, setRuntimeError] = useState<string>();
  useEffect(() => { let cancelled = false; void consoleV2.trading.runtime().then((result) => { if (!cancelled) setRuntime(result.data); }).catch((error: unknown) => { if (!cancelled) setRuntimeError(error instanceof Error ? error.message : "交易运行状态不可用"); }); return () => { cancelled = true; }; }, []);
  const [status, setStatus] = useState("");
  const [model, setModel] = useState("");
  const [account, setAccount] = useState("");
  const params = useMemo(() => ({ status: status || undefined, model_id: model || undefined, execution_account_id: account || undefined }), [status, model, account]);
  const controls = <><select className="select" aria-label="周期状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="INPUT_RECORDED">已记录输入</option><option value="OUTPUT_RECORDED">已记录输出</option><option value="DELIVERY_PENDING">交付中</option><option value="DELIVERY_ATTENTION">交付需关注</option></select><input className="input" aria-label="模型" placeholder="模型 ID" value={model} onChange={(event) => setModel(event.target.value)} /><input className="input" aria-label="执行账户" placeholder="执行账户 ID" value={account} onChange={(event) => setAccount(event.target.value)} /></>;
  return <><section className="v2-runtime-card v2-cycle-runtime"><div className="section-head"><h2 className="section-title">决策运行状态与绑定</h2>{v2Status(runtime ? String(runtime.runner.state ?? runtime.runner.running ?? "unknown") : "unknown", runtime ? v2Unknown(runtime.runner.state ?? runtime.runner.running) : "未知")}</div>{runtime ? <><V2Facts values={[{ label: "观测时间", value: formatV2Time(runtime.observedAt) }, { label: "绑定数", value: String(runtime.bindings.length) }, { label: "运行间隔", value: v2Unknown(runtime.runner.intervalSeconds) }, { label: "最近完成", value: formatV2Time(runtime.runner.lastCompletedAt) }, { label: "最近错误", value: runtime.runner.hasLastError ? v2Unknown(runtime.runner.lastErrorCode) : "无" }]} /><BindingTable bindings={runtime.bindings} /></> : <p className="v2-inline-note">{runtimeError ?? "读取交易运行状态…"}</p>}<p className="v2-inline-note">这里显示决策服务当前返回的绑定关系；历史周期仍以自身保存的身份为准。</p></section><V2ListPage<ConsoleV2DecisionCycle> title="决策周期" load={consoleV2.trading.decisionCycles} params={params} controls={controls} rowKey={(item) => item.cycleId} searchPlaceholder="搜索 cycle、input、snapshot、模型或账户" columns={[
    { label: "Cycle / decision_at", className: "primary", render: (item) => <div className="v2-cell-copy"><strong className="mono">{item.cycleId}</strong><small>{formatV2Time(item.decisionAt)}</small></div> },
    { label: "Binding", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.modelId)}</span><small>{v2Unknown(item.predictionModelId, "producer 未提供")} · {v2Unknown(item.strategyId)} · {v2Unknown(item.executionAccountId)}</small></div> },
    { label: "输入快照", render: (item) => <div className="v2-cell-copy mono"><span>{v2Unknown(item.inputId)}</span><small>{v2Unknown(item.predictionSnapshotId)}</small></div> },
    { label: "预测 / Lot / Intent", render: (item) => `${formatV2Number(item.predictionCount, 0)} / ${formatV2Number(item.positionLotCount, 0)} / ${formatV2Number(item.intentCount, 0)}` },
    { label: "交付 pending / failed", render: (item) => `${formatV2Number(item.deliveryPendingCount, 0)} / ${formatV2Number(item.deliveryFailedCount, 0)}` },
    { label: "状态", render: (item) => v2Status(item.status, item.status) },
  ]} renderDetail={(item) => <CycleDetail item={item} />} /></>;
}

function CycleDetail({ item }: { item: ConsoleV2DecisionCycle }) {
  const [detail, setDetail] = useState<Record<string, unknown>>();
  const [error, setError] = useState<string>();
  useEffect(() => { let cancelled = false; const timer = window.setTimeout(() => { if (cancelled) return; setDetail(undefined); setError(undefined); void consoleV2.trading.decisionCycle(item.cycleId).then((result) => { if (!cancelled) setDetail(result.data); }).catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof Error ? requestError.message : "周期详情不可用"); }); }, 0); return () => { cancelled = true; window.clearTimeout(timer); }; }, [item.cycleId]);
  return <><V2Facts values={[{ label: "周期 ID", value: item.cycleId, mono: true }, { label: "输入创建时间", value: formatV2Time(item.inputCreatedAt) }, { label: "输出记录时间", value: formatV2Time(item.outputRecordedAt) }, { label: "盘口快照", value: v2Unknown(item.orderbookSnapshotSetId), mono: true }]} />{error && <p className="v2-inline-note">{error}</p>}{detail && <><CycleEvidence detail={detail} /><details className="v2-json-disclosure"><summary>查看安全周期原始摘要</summary><pre>{JSON.stringify(detail, null, 2)}</pre></details></>}</>;
}

function BindingTable({ bindings }: { bindings: ConsoleV2Runtime["bindings"] }) {
  if (!bindings.length) return <p className="v2-inline-note">当前没有返回绑定记录。</p>;
  return <div className="table-scroll v2-evidence-table"><table className="v2-table"><thead><tr><th>源模型</th><th>逻辑模型</th><th>策略</th><th>执行账户</th><th>来源模式</th></tr></thead><tbody>{bindings.map((binding, index) => <tr key={`${binding.executionAccountId ?? "unknown"}-${binding.strategyId ?? "unknown"}-${index}`}><td className="mono">{v2Unknown(binding.predictionModelId, "未知")}</td><td>{v2Unknown(binding.modelId)}</td><td>{v2Unknown(binding.strategyId)}</td><td className="mono">{v2Unknown(binding.executionAccountId)}</td><td>{v2Unknown(binding.sourceMode)}</td></tr>)}</tbody></table></div>;
}

function CycleEvidence({ detail }: { detail: Record<string, unknown> }) {
  const predictions = detailRecords(detail.predictions);
  const orderbooks = detailRecords(detail.orderbook_snapshots);
  const deliveries = detailRecords(detail.deliveries);
  return <section className="v2-evidence-section"><h4 className="v2-evidence-title">历史周期事实</h4><V2Facts values={[{ label: "订单提交", value: detailBool(detail.order_submission_enabled) }, { label: "入场提交", value: detailBool(detail.entry_submission_enabled) }, { label: "入场阻断原因", value: detailText(detail.entry_block_reason) }, { label: "预测快照", value: detailText(detail.prediction_snapshot_id), mono: true }, { label: "盘口快照集合", value: detailText(detail.orderbook_snapshot_set_id), mono: true }]} /><ProjectionTable title={`预测身份（${predictions.length}）`} items={predictions} columns={[{ label: "预测 ID", value: (row) => detailText(row.prediction_id) }, { label: "来源任务", value: (row) => detailText(row.source_job_id) }, { label: "市场", value: (row) => detailText(row.market_id) }, { label: "条件", value: (row) => detailText(row.condition_id) }]} /><ProjectionTable title={`盘口快照（${orderbooks.length}）`} items={orderbooks} columns={[{ label: "来源", value: (row) => detailText(row.market_source) }, { label: "市场", value: (row) => detailText(row.market_id) }, { label: "状态", value: (row) => detailText(row.status) }, { label: "观测时间", value: (row) => detailTime(row.observed_at) }]} /><ProjectionTable title={`交付与订单（${deliveries.length}）`} items={deliveries} columns={[{ label: "状态", value: (row) => detailText(row.status) }, { label: "客户订单", value: (row) => detailText(row.client_order_id) }, { label: "订单", value: (row) => orderLink(row.order_id) }, { label: "创建时间", value: (row) => detailTime(row.created_at) }, { label: "完成时间", value: (row) => detailTime(row.completed_at) }]} /></section>;
}

function OrderTraceEvidence({ item, trace }: { item: ConsoleV2Order; trace: Awaited<ReturnType<typeof consoleV2.trading.orderTrace>>["data"] }) {
  const deliveries = traceRecords(trace.deliveries);
  const events = traceRecords(trace.events);
  const attempts = traceRecords(trace.attempts);
  const fills = traceRecords(trace.fills);
  const lots = traceRecords(trace.positionLots);
  const issues = traceRecords(trace.reconciliationIssues);
  const confirmed = fills.filter((fill) => detailText(fill.confirmed_at) !== "未知").length;
  const applied = fills.filter((fill) => detailText(fill.applied_at) !== "未知").length;
  return <section className="v2-evidence-section"><h4 className="v2-evidence-title">订单履历</h4><V2Facts values={[{ label: "当前订单状态", value: item.status }, { label: "订单更新时间", value: formatV2Time(item.updatedAt) }, { label: "确认成交数", value: String(confirmed) }, { label: "已入账成交数", value: String(applied) }, { label: "Trace 观测时间", value: formatV2Time(trace.observedAt) }]} /><div className="v2-trace-counts"><TraceCount label="交付" count={deliveries.length} /><TraceCount label="状态事件" count={events.length} /><TraceCount label="提交尝试" count={attempts.length} /><TraceCount label="成交" count={fills.length} /><TraceCount label="仓位批次" count={lots.length} /><TraceCount label="对账问题" count={issues.length} /></div><ProjectionTable title="交付" items={deliveries} columns={[{ label: "状态", value: (row) => detailText(row.status) }, { label: "周期", value: (row) => detailText(row.cycle_id) }, { label: "订单", value: (row) => orderLink(row.order_id) }, { label: "创建时间", value: (row) => detailTime(row.created_at) }, { label: "完成时间", value: (row) => detailTime(row.completed_at) }]} /><ProjectionTable title="状态事件" items={events} columns={[{ label: "状态", value: (row) => detailText(row.to_status) }, { label: "触发", value: (row) => detailText(row.trigger) }, { label: "原因", value: (row) => detailText(row.reason_code) }, { label: "发生时间", value: (row) => detailTime(row.occurred_at) }]} /><ProjectionTable title="提交尝试" items={attempts} columns={[{ label: "类型", value: (row) => detailText(row.kind) }, { label: "结果", value: (row) => detailText(row.outcome) }, { label: "错误码", value: (row) => detailText(row.error_code) }, { label: "开始时间", value: (row) => detailTime(row.started_at) }, { label: "完成时间", value: (row) => detailTime(row.completed_at) }]} /><ProjectionTable title="成交" items={fills} columns={[{ label: "状态", value: (row) => detailText(row.status) }, { label: "份额 / 价格", value: (row) => `${detailText(row.shares)} / ${detailText(row.price)}` }, { label: "匹配时间", value: (row) => detailTime(row.matched_at) }, { label: "确认时间", value: (row) => detailTime(row.confirmed_at) }, { label: "入账时间", value: (row) => detailTime(row.applied_at) }]} /><ProjectionTable title="仓位批次" items={lots} columns={[{ label: "Lot ID", value: (row) => detailText(row.lot_id) }, { label: "状态", value: (row) => detailText(row.status) }, { label: "剩余份额", value: (row) => detailText(row.remaining_shares) }, { label: "开启时间", value: (row) => detailTime(row.opened_at) }, { label: "关闭时间", value: (row) => detailTime(row.closed_at) }]} /><ProjectionTable title="对账问题" items={issues} columns={[{ label: "状态", value: (row) => detailText(row.status) }, { label: "类型", value: (row) => detailText(row.issue_type) }, { label: "原因", value: (row) => detailText(row.reason_code) }, { label: "观测时间", value: (row) => detailTime(row.observed_at) }, { label: "解决时间", value: (row) => detailTime(row.resolved_at) }]} /></section>;
}

function ProjectionTable({ title, items, columns }: { title: string; items: Record<string, unknown>[]; columns: Array<{ label: string; value: (row: Record<string, unknown>) => React.ReactNode }> }) {
  if (!items.length) return <section className="v2-evidence-block"><h5>{title}</h5><p className="v2-inline-note">暂无记录</p></section>;
  return <section className="v2-evidence-block"><h5>{title}</h5><div className="table-scroll v2-evidence-table"><table className="v2-table"><thead><tr>{columns.map((column) => <th key={column.label}>{column.label}</th>)}</tr></thead><tbody>{items.map((item, index) => <tr key={`${title}-${index}`}>{columns.map((column) => <td key={column.label}>{column.value(item)}</td>)}</tr>)}</tbody></table></div></section>;
}

function TraceCount({ label, count }: { label: string; count: number }) { return <div className="v2-trace-count"><span>{label}</span><strong>{count}</strong></div>; }
function detailRecords(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item)) : []; }
function traceRecords(value: unknown): Record<string, unknown>[] { return detailRecords(value); }
function detailText(value: unknown) { return value === undefined || value === null || value === "" ? "未知" : String(value); }
function detailTime(value: unknown) { return typeof value === "string" ? formatV2Time(value) : "未知"; }
function detailBool(value: unknown) { return value === true ? "是" : value === false ? "否" : "未知"; }
function orderLink(value: unknown) { const id = detailText(value); return id === "未知" ? id : <a href={`/trading/orders?q=${encodeURIComponent(id)}`} className="link mono">{id}</a>; }
function reconciliationIdentity(item: ConsoleV2ReconciliationIssue) { const values = [item.orderId, item.venueOrderId, item.venueTradeId, item.marketId, item.conditionId, item.tokenId].filter((value): value is string => Boolean(value)); return values.length ? values.join(" · ") : item.executionAccountId ? `账户 ${item.executionAccountId}` : "未知"; }

function Orders() {
  const [status, setStatus] = useState("");
  const [account, setAccount] = useState("");
  const params = useMemo(() => ({ status: status || undefined, execution_account_id: account || undefined }), [status, account]);
  const controls = <><select className="select" aria-label="订单状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="RECEIVED">已接收</option><option value="VALIDATING">校验中</option><option value="RESERVED">已预留</option><option value="SUBMITTING">提交中</option><option value="ACKNOWLEDGED">已确认</option><option value="LIVE">活动中</option><option value="PARTIALLY_FILLED">部分成交</option><option value="FILLED">已成交</option><option value="REJECTED">已拒绝</option><option value="UNKNOWN">未知</option><option value="CANCEL_PENDING">取消中</option><option value="CANCELLED">已取消</option><option value="RECONCILING">对账中</option><option value="MANUAL_REVIEW">人工复核</option></select><input className="input" aria-label="执行账户" placeholder="执行账户 ID" value={account} onChange={(event) => setAccount(event.target.value)} /></>;
  return <V2ListPage<ConsoleV2Order> title="订单执行" load={consoleV2.trading.orders} params={params} controls={controls} rowKey={(item) => item.orderId} searchPlaceholder="搜索 order、client order、venue order、market 或 token" columns={[
    { label: "Order / Client", className: "primary", render: (item) => <div className="v2-cell-copy"><strong className="mono">{item.orderId}</strong><small className="mono">{v2Unknown(item.clientOrderId)}</small></div> },
    { label: "状态 / Side", render: (item) => <div className="v2-cell-copy"><span>{v2Status(item.status, item.status)}</span><small>{v2Unknown(item.side)}</small></div> },
    { label: "Binding", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.modelId)}</span><small>{v2Unknown(item.strategyId)} · {v2Unknown(item.executionAccountId)}</small></div> },
    { label: "市场 / 条件", render: (item) => <div className="v2-cell-copy mono"><span>{v2Unknown(item.marketId)}</span><small>{v2Unknown(item.conditionId)}</small></div> },
    { label: "Price / Shares", render: (item) => <div className="v2-cell-copy"><span>{formatV2Number(item.price, 6)} · {formatV2Number(item.shares, 4)}</span><small>filled {formatV2Number(item.filledShares, 4)}</small></div> },
    { label: "创建 / 更新", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.createdAt)}</span><small>{formatV2Time(item.updatedAt)}</small></div> },
  ]} renderDetail={(item) => <OrderDetail item={item} />} />;
}

function OrderDetail({ item }: { item: ConsoleV2Order }) {
  const [trace, setTrace] = useState<Awaited<ReturnType<typeof consoleV2.trading.orderTrace>>["data"]>();
  const [error, setError] = useState<string>();
  useEffect(() => { let cancelled = false; const timer = window.setTimeout(() => { if (cancelled) return; setTrace(undefined); setError(undefined); void consoleV2.trading.orderTrace(item.orderId).then((result) => { if (!cancelled) setTrace(result.data); }).catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof Error ? requestError.message : "订单 trace 不可用"); }); }, 0); return () => { cancelled = true; window.clearTimeout(timer); }; }, [item.orderId]);
  return <><V2Facts values={[{ label: "订单 ID", value: item.orderId, mono: true }, { label: "客户订单 ID", value: v2Unknown(item.clientOrderId), mono: true }, { label: "交易所订单 ID", value: v2Unknown(item.venueOrderId), mono: true }, { label: "交易场所", value: v2Unknown(item.source) }, { label: "市场来源", value: v2Unknown(item.marketSource) }, { label: "Token ID", value: v2Unknown(item.tokenId), mono: true }]} />{error && <p className="v2-inline-note">{error}</p>}{trace && <><OrderTraceEvidence item={item} trace={trace} /><details className="v2-json-disclosure"><summary>查看安全订单原始摘要</summary><pre>{JSON.stringify(trace, null, 2)}</pre></details></>}<p className="v2-inline-note">订单状态、确认成交和账本入账分别展示；页面只读。</p></>;
}

function Positions() {
  return <V2ListPage<ConsoleV2PositionLot> title="仓位 Lot" load={consoleV2.trading.positionLots} rowKey={(item) => item.lotId} searchPlaceholder="搜索 lot、market、condition、token 或账户" columns={[
    { label: "Lot", className: "primary mono", render: (item) => item.lotId },
    { label: "Binding", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.modelId)}</span><small>{v2Unknown(item.strategyId)} · {v2Unknown(item.executionAccountId)}</small></div> },
    { label: "市场 / Token", render: (item) => <div className="v2-cell-copy mono"><span>{v2Unknown(item.marketId)}</span><small>{v2Unknown(item.tokenId)}</small></div> },
    { label: "状态", render: (item) => v2Status(item.status, item.status) },
    { label: "Remaining / Original", render: (item) => `${formatV2Number(item.remainingShares, 6)} / ${formatV2Number(item.originalShares, 6)}` },
    { label: "Remaining cost / Opened", render: (item) => <div className="v2-cell-copy"><span>{formatV2Number(item.remainingCost, 6)}</span><small>{formatV2Time(item.openedAt)}</small></div> },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "Lot ID", value: item.lotId, mono: true }, { label: "Model", value: v2Unknown(item.modelId) }, { label: "Strategy", value: v2Unknown(item.strategyId) }, { label: "Execution account", value: v2Unknown(item.executionAccountId), mono: true }, { label: "Condition ID", value: v2Unknown(item.conditionId), mono: true }, { label: "Token ID", value: v2Unknown(item.tokenId), mono: true }, { label: "Opening order", value: v2Unknown(item.openingOrderId), mono: true }, { label: "Opening fill", value: v2Unknown(item.openingFillKey), mono: true }, { label: "Average entry", value: formatV2Number(item.averageEntryPrice, 6) }, { label: "Closed at", value: formatV2Time(item.closedAt) }]} />} />;
}

function Reconciliation() {
  const [tab, setTab] = useState<"runs" | "issues">("runs");
  return <><div className="v2-local-tabs" role="tablist" aria-label="对账视图"><button className={tab === "runs" ? "active" : ""} onClick={() => setTab("runs")} role="tab" aria-selected={tab === "runs"}>Runs</button><button className={tab === "issues" ? "active" : ""} onClick={() => setTab("issues")} role="tab" aria-selected={tab === "issues"}>Issues</button></div>{tab === "runs" ? <ReconciliationRuns /> : <ReconciliationIssues />}</>;
}

function ReconciliationRuns() {
  return <V2ListPage<ConsoleV2ReconciliationRun> title="对账运行" load={consoleV2.trading.reconciliationRuns} rowKey={(item) => item.runId} searchPlaceholder="搜索 run 或状态" columns={[
    { label: "Run ID", className: "primary mono", render: (item) => item.runId },
    { label: "状态 / 结果", render: (item) => <div className="v2-cell-copy"><span>{v2Status(item.status, item.status)}</span><small>{v2Unknown(item.result)}</small></div> },
    { label: "账户", render: (item) => v2Unknown(item.executionAccountId) },
    { label: "Started", render: (item) => formatV2Time(item.startedAt) },
    { label: "Completed", render: (item) => formatV2Time(item.completedAt) },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "Run ID", value: item.runId, mono: true }, { label: "Result", value: v2Unknown(item.result) }, { label: "Execution account", value: v2Unknown(item.executionAccountId), mono: true }, { label: "Trigger", value: v2Unknown(item.trigger) }, { label: "Focus order", value: v2Unknown(item.focusOrderId), mono: true }, { label: "Started", value: formatV2Time(item.startedAt) }, { label: "Completed", value: formatV2Time(item.completedAt) }]} />} />;
}

function ReconciliationIssues() {
  const [status, setStatus] = useState("");
  const params = useMemo(() => ({ status: status || undefined }), [status]);
  return <V2ListPage<ConsoleV2ReconciliationIssue> title="对账问题" load={consoleV2.trading.reconciliationIssues} params={params} controls={<select className="select" aria-label="问题状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="OPEN">OPEN</option><option value="RESOLVED">RESOLVED</option></select>} rowKey={(item) => item.issueId} searchPlaceholder="搜索 issue、run、entity 或原因码" columns={[
    { label: "Issue ID", className: "primary mono", render: (item) => item.issueId },
    { label: "状态 / 类型", render: (item) => <div className="v2-cell-copy"><span>{v2Status(item.status, item.status)}</span><small>{v2Unknown(item.issueType)}</small></div> },
    { label: "Reason / Resolution", className: "mono", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.reasonCode)}</span><small>{v2Unknown(item.resolution)}</small></div> },
    { label: "关联身份", render: (item) => reconciliationIdentity(item) },
    { label: "Observed", render: (item) => formatV2Time(item.observedAt) },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "Issue ID", value: item.issueId, mono: true }, { label: "Run ID", value: v2Unknown(item.runId), mono: true }, { label: "Account", value: v2Unknown(item.executionAccountId), mono: true }, { label: "Issue type", value: v2Unknown(item.issueType) }, { label: "Reason code", value: v2Unknown(item.reasonCode), mono: true }, { label: "Resolution", value: v2Unknown(item.resolution) }, { label: "关联身份", value: reconciliationIdentity(item) }, { label: "Source", value: v2Unknown(item.source) }, { label: "Local / remote", value: `${v2Unknown(item.localValue)} / ${v2Unknown(item.remoteValue)}` }, { label: "Resolved at", value: formatV2Time(item.resolvedAt) }]} />} emptyDescription="没有返回对账问题时显示为空；查询失败仍保持未知，不替换为零差异。" />;
}

function Redemptions() {
  const [status, setStatus] = useState("");
  const params = useMemo(() => ({ status: status || undefined }), [status]);
  return <V2ListPage<ConsoleV2Redemption> title="赎回" load={consoleV2.trading.redemptions} params={params} controls={<select className="select" aria-label="赎回状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="READY">待处理</option><option value="APPROVAL_SUBMITTING">提交授权中</option><option value="APPROVAL_SUBMITTED">授权已提交</option><option value="REDEEM_SUBMITTING">提交赎回中</option><option value="REDEEM_SUBMITTED">赎回已提交</option><option value="CONFIRMED">已确认</option><option value="APPLIED">已入账</option><option value="MANUAL_REVIEW">人工复核</option></select>} rowKey={(item) => item.redemptionId} searchPlaceholder="搜索 redemption、condition、账户或交易哈希" columns={[
    { label: "Redemption ID", className: "primary mono", render: (item) => item.redemptionId },
    { label: "条件 / 市场", render: (item) => <div className="v2-cell-copy mono"><span>{v2Unknown(item.conditionId)}</span><small>{v2Unknown(item.marketId)}</small></div> },
    { label: "账户", className: "mono", render: (item) => v2Unknown(item.executionAccountId) },
    { label: "状态", render: (item) => v2Status(item.status, item.status) },
    { label: "Payout base units", render: (item) => formatV2Number(item.payoutBaseUnits, 0) },
    { label: "Confirmed / Applied", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.confirmedAt)}</span><small>{formatV2Time(item.appliedAt)}</small></div> },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "Redemption ID", value: item.redemptionId, mono: true }, { label: "Condition ID", value: v2Unknown(item.conditionId), mono: true }, { label: "Execution account", value: v2Unknown(item.executionAccountId), mono: true }, { label: "Transaction hash", value: v2Unknown(item.transactionHash), mono: true }, { label: "Payout base units", value: formatV2Number(item.payoutBaseUnits, 0) }, { label: "Receipt block", value: formatV2Number(item.receiptBlockNumber, 0) }, { label: "Confirmations", value: formatV2Number(item.confirmations, 0) }, { label: "Confirmed at", value: formatV2Time(item.confirmedAt) }, { label: "Applied at", value: formatV2Time(item.appliedAt) }]} />} />;
}
