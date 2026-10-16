"use client";

import { useEffect, useMemo, useState } from "react";
import { consoleV2, type ConsoleV2DecisionCycle, type ConsoleV2Order, type ConsoleV2PositionLot, type ConsoleV2ReconciliationIssue, type ConsoleV2ReconciliationRun, type ConsoleV2Redemption, type ConsoleV2Runtime } from "../lib/console-v2";
import { formatV2Number, formatV2Time, V2Facts, V2Frame, V2ListPage, V2Tabs, v2Status, v2Unknown } from "./console-v2-resource";

type TradingView = "cycles" | "orders" | "positions" | "reconciliation" | "redemptions";

export function TradingV2Page({ view = "cycles" }: { view?: TradingView }) {
  const config = view === "orders"
    ? { eyebrow: "Trading / Orders", title: "订单执行", description: "订单、订单 trace、确认成交和账本应用分别展示；页面只读，不提供 cancel、submit 或 refresh 动作。" }
    : view === "positions"
      ? { eyebrow: "Trading / Positions", title: "仓位与 Lot", description: "按 lot 保留 model、strategy、execution account 归属；不把账户聚合成失去 binding 的单行仓位。" }
      : view === "reconciliation"
        ? { eyebrow: "Trading / Reconciliation", title: "账户对账", description: "对账运行与开放 issue 分层展示；查询失败不会被渲染成零差异，也不会触发恢复动作。" }
        : view === "redemptions"
          ? { eyebrow: "Trading / Redemptions", title: "赎回", description: "市场终态、链上确认和账本应用分层展示；未确认或未应用不冒充到账。" }
          : { eyebrow: "Trading / Decision Cycles", title: "决策周期", description: "按真实 runner、binding 和持久化 cycle 输入输出核对策略链路；旧无 producer 三线程不作为主状态。" };
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
  return <><section className="v2-runtime-card v2-cycle-runtime"><div className="section-head"><h2 className="section-title">决策运行状态与绑定</h2>{v2Status(runtime ? String(runtime.runner.state ?? runtime.runner.running ?? "unknown") : "unknown", runtime ? v2Unknown(runtime.runner.state ?? runtime.runner.running) : "未知")}</div>{runtime ? <V2Facts values={[{ label: "观测时间", value: formatV2Time(runtime.observedAt) }, { label: "绑定数", value: String(runtime.bindings.length) }, { label: "运行间隔", value: v2Unknown(runtime.runner.intervalSeconds) }, { label: "最近完成", value: formatV2Time(runtime.runner.lastCompletedAt) }, { label: "最近错误", value: runtime.runner.hasLastError ? v2Unknown(runtime.runner.lastErrorCode) : "无" }]} /> : <p className="v2-inline-note">{runtimeError ?? "读取交易运行状态…"}</p>}<p className="v2-inline-note">CLOB heartbeat 与决策运行是不同事实源；这里保留服务返回的实际边界。</p></section><V2ListPage<ConsoleV2DecisionCycle> title="决策周期" load={consoleV2.trading.decisionCycles} params={params} controls={controls} rowKey={(item) => item.cycleId} searchPlaceholder="搜索 cycle、input、snapshot、模型或账户" columns={[
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
  return <><V2Facts values={[{ label: "周期 ID", value: item.cycleId, mono: true }, { label: "输入创建时间", value: formatV2Time(item.inputCreatedAt) }, { label: "输出记录时间", value: formatV2Time(item.outputRecordedAt) }, { label: "盘口快照", value: v2Unknown(item.orderbookSnapshotSetId), mono: true }]} />{error && <p className="v2-inline-note">{error}</p>}{detail && <details className="v2-json-disclosure"><summary>查看安全周期详情</summary><pre>{JSON.stringify(detail, null, 2)}</pre></details>}</>;
}

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
  return <><V2Facts values={[{ label: "Order ID", value: item.orderId, mono: true }, { label: "Client order ID", value: v2Unknown(item.clientOrderId), mono: true }, { label: "Venue order ID", value: v2Unknown(item.venueOrderId), mono: true }, { label: "Venue", value: v2Unknown(item.source) }, { label: "Market source", value: v2Unknown(item.marketSource) }, { label: "Token ID", value: v2Unknown(item.tokenId), mono: true }]} />{error && <p className="v2-inline-note">{error}</p>}{trace && <details className="v2-json-disclosure"><summary>查看有限 trace（events / attempts / fills / lots / reconciliation）</summary><pre>{JSON.stringify(trace, null, 2)}</pre></details>}<p className="v2-inline-note">订单接受、确认 fill 与账本应用保持独立状态；此处不代理写操作。</p></>;
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
    { label: "实体", render: (item) => `${v2Unknown(item.entityType)} · ${v2Unknown(item.entityId)}` },
    { label: "Observed", render: (item) => formatV2Time(item.observedAt) },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "Issue ID", value: item.issueId, mono: true }, { label: "Run ID", value: v2Unknown(item.runId), mono: true }, { label: "Account", value: v2Unknown(item.executionAccountId), mono: true }, { label: "Issue type", value: v2Unknown(item.issueType) }, { label: "Reason code", value: v2Unknown(item.reasonCode), mono: true }, { label: "Resolution", value: v2Unknown(item.resolution) }, { label: "Source", value: v2Unknown(item.source) }, { label: "Local / remote", value: `${v2Unknown(item.localValue)} / ${v2Unknown(item.remoteValue)}` }, { label: "Resolved at", value: formatV2Time(item.resolvedAt) }]} />} emptyDescription="没有返回对账 issue 时显示为空；查询失败仍保持未知，不替换为零差异。" />;
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
