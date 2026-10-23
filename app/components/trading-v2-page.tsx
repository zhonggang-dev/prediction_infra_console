"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { consoleApi } from "../lib/console-api";
import { consoleV2, type ConsoleV2DecisionCycle, type ConsoleV2Order, type ConsoleV2Page, type ConsoleV2PositionLot, type ConsoleV2ReconciliationIssue, type ConsoleV2ReconciliationRun, type ConsoleV2Redemption, type ConsoleV2Runtime, type ConsoleV2RuntimeAccount } from "../lib/console-v2";
import { holdingIdentity, type ConsoleV2Holding } from "../lib/trading-holdings";
import { deriveAccountPermission } from "../lib/trading-permissions";
import { normalizeOverviewSources, summarizeAttention } from "../lib/trading-display";
import type { ApiMode, LiveOperationsSnapshot, LiveWalletSummary } from "../lib/types";
import { formatV2Number, formatV2Time, V2Facts, V2Frame, V2ListPage, V2Tabs, V2WorkspacePanel, WORKSPACE_FILTER_CHANGE_EVENT, useV2Filter, useWorkspaceTabs, v2Status, v2Unknown } from "./console-v2-resource";
import { EdgeDistributionPanel } from "./edge-distribution-panel";
import { TradeRecordsPage } from "./trade-records-page";
import "./trading-workspace.module.css";

type TradingView = "overview" | "cycles" | "orders" | "positions" | "ledger" | "reconciliation" | "redemptions";

export function TradingV2Page({ view = "overview" }: { view?: TradingView }) {
  const tabs = [{ href: "/trading/overview", label: "实盘概况", aliases: ["/trading", "/live"] }, { href: "/trading/cycles", label: "决策记录" }, { href: "/trading/orders", label: "订单" }, { href: "/trading/positions", label: "持仓" }, { href: "/trading/ledger", label: "收益与成交账本", aliases: ["/trades"] }, { href: "/trading/reconciliation", label: "对账" }, { href: "/trading/redemptions", label: "赎回" }] as const;
  const initialHref = view === "overview" ? "/trading/overview" : `/trading/${view}` as typeof tabs[number]["href"];
  const context = useTradingContext();
  const workspace = useWorkspaceTabs(tabs, initialHref, { sharedQueryKeys: ["execution_account_id"] });
  const config = workspace.active === "/trading/overview"
    ? { eyebrow: "Trading / Live", title: "实盘概况", description: "当前运行状态、账户事实、最近周期和待处理事项分开查看；历史成交与账本按原有记录核对。" }
    : workspace.active === "/trading/orders"
    ? { eyebrow: "Trading / Orders", title: "订单执行", description: "订单从接收、提交到成交确认和账本应用分别核对；页面只读。" }
    : workspace.active === "/trading/positions"
      ? { eyebrow: "Trading / Positions", title: "当前持仓", description: "按历史账户、模型和策略归属汇总仍有剩余份额的持仓，Lot 明细按实际证据核对。" }
      : workspace.active === "/trading/ledger"
        ? { eyebrow: "Trading / Ledger", title: "收益与成交账本", description: "钱包收益对比和 BUY、SELL、EXTERNAL_SELL、REDEEM 活动集中查看；订单接受不等于成交。" }
      : workspace.active === "/trading/reconciliation"
        ? { eyebrow: "Trading / Reconciliation", title: "对账", description: "默认先看开放问题，再按需查看对账运行审计；读取失败不会显示成零差异。" }
        : workspace.active === "/trading/redemptions"
          ? { eyebrow: "Trading / Redemptions", title: "赎回", description: "市场终态、链上确认和账本应用分层展示；未确认或未应用不冒充到账。" }
          : { eyebrow: "Trading / Decision Cycles", title: "决策记录", description: "查看预测覆盖、入场许可、交付计划和结果；历史周期身份以持久化记录为准。" };
  return <V2Frame eyebrow={config.eyebrow} title={config.title} description={config.description}>
    <TradingAccountContext context={context} />
    <V2Tabs tabs={tabs} active={workspace.active} onSelect={(href) => workspace.select(href as typeof workspace.active)} />
    <V2WorkspacePanel active={workspace.active} href="/trading/overview" visited={workspace.visited.has("/trading/overview")}><TradingOverview account={context.account} /></V2WorkspacePanel>
    <V2WorkspacePanel active={workspace.active} href="/trading/cycles" visited={workspace.visited.has("/trading/cycles")}><DecisionCycles /></V2WorkspacePanel>
    <V2WorkspacePanel active={workspace.active} href="/trading/orders" visited={workspace.visited.has("/trading/orders")}><Orders /></V2WorkspacePanel>
    <V2WorkspacePanel active={workspace.active} href="/trading/positions" visited={workspace.visited.has("/trading/positions")}><Positions /></V2WorkspacePanel>
    <V2WorkspacePanel active={workspace.active} href="/trading/ledger" visited={workspace.visited.has("/trading/ledger")}><Ledger /></V2WorkspacePanel>
    <V2WorkspacePanel active={workspace.active} href="/trading/reconciliation" visited={workspace.visited.has("/trading/reconciliation")}><Reconciliation /></V2WorkspacePanel>
    <V2WorkspacePanel active={workspace.active} href="/trading/redemptions" visited={workspace.visited.has("/trading/redemptions")}><Redemptions /></V2WorkspacePanel>
  </V2Frame>;
}

type TradingContext = { account: string; setAccount: (value: string) => void; reset: () => void; runtime?: ConsoleV2Runtime };

function useTradingContext(): TradingContext {
  const [account, setAccount] = useV2Filter("execution_account_id");
  const [runtime, setRuntime] = useState<ConsoleV2Runtime>();
  useEffect(() => { let cancelled = false; void consoleV2.trading.runtime().then((result) => { if (!cancelled) setRuntime(result.data); }).catch(() => { if (!cancelled) setRuntime(undefined); }); return () => { cancelled = true; }; }, []);
  const updateAccount = (value: string) => { setAccount(value); window.dispatchEvent(new Event(WORKSPACE_FILTER_CHANGE_EVENT)); };
  const reset = () => { updateAccount(""); };
  return { account, setAccount: updateAccount, reset, runtime };
}

function TradingAccountContext({ context }: { context: TradingContext }) {
  const bindings = context.runtime?.bindings ?? [];
  const accounts = uniqueContextValues([...bindings.map((item) => item.executionAccountId), ...(context.runtime?.accounts ?? []).map((item) => item.executionAccountId), context.account]);
  return <section className="trading-account-context" aria-label="交易账户范围"><div><strong>账户范围</strong><small>{context.account ? "当前页面及共享交易视图已按此账户查看" : "全部账户；各账户状态分别展示"}</small></div><label><span className="sr-only">选择执行账户</span><select className="select" aria-label="交易账户范围" value={context.account} onChange={(event) => context.setAccount(event.target.value)}><option value="">全部账户</option>{accounts.map((item) => <option key={item} value={item}>{item}{item === context.account && !bindings.some((binding) => binding.executionAccountId === item) ? " · 无当前绑定" : ""}</option>)}</select></label>{context.account && <button type="button" className="button" onClick={context.reset}>查看全部</button>}</section>;
}

function uniqueContextValues(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function TradingOverview({ account }: { account: string }) {
  const [runtime, setRuntime] = useState<ConsoleV2Runtime>();
  const [snapshot, setSnapshot] = useState<LiveOperationsSnapshot>();
  const [mode, setMode] = useState<ApiMode>("unavailable");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const requestSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    const [runtimeResult, operationsResult] = await Promise.allSettled([consoleV2.trading.runtime(), consoleApi.liveOperations()]);
    if (sequence !== requestSequence.current) return;
    const next = normalizeOverviewSources(runtimeResult, operationsResult);
    setRuntime(next.runtime);
    setSnapshot(next.snapshot);
    setMode(next.mode);
    setError(next.errors.length ? next.errors.join("；") : undefined);
    setLoading(false);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => { window.clearTimeout(timer); requestSequence.current += 1; }; }, [load]);
  const observedAt = snapshot?.observedAt ?? runtime?.observedAt;
  const accounts = runtime?.accounts ?? [];
  const visibleWallets = account ? (snapshot?.wallets.filter((wallet) => wallet.executionAccountId === account) ?? []) : (snapshot?.wallets ?? []);
  const runtimeAccounts = account ? accounts.filter((item) => item.executionAccountId === account) : accounts;
  const walletByID = new Map(visibleWallets.map((wallet) => [wallet.executionAccountId, wallet]));
  const marketValueByID = new Map<string, number>();
  for (const position of snapshot?.positions ?? []) if (position.managed) marketValueByID.set(position.executionAccountId, (marketValueByID.get(position.executionAccountId) ?? 0) + position.marketValue);
  const rows = runtimeAccounts.length ? runtimeAccounts : visibleWallets.map((wallet) => ({ executionAccountId: wallet.executionAccountId, modelId: "未知", strategyId: "未知", sourceMode: "未知", configuredBinding: null, databaseBindingEnabled: null, riskPolicyEnabled: null, accountPaused: null, strategyInputState: "未知", entryGateState: "未知", orderSubmissionState: "未知", openIssueCount: null, openOrderCount: null } as ConsoleV2RuntimeAccount));
  return <div className="trading-overview-compact">
    <div className="trading-overview-actions"><span className="v2-observed">观测于 {formatV2Time(observedAt)}</span><button type="button" className="button" onClick={() => void load()} disabled={loading}>{loading ? "刷新中" : "刷新"}</button></div>
    {error && <div className="notice v2-notice error"><div><strong>部分交易事实不可用</strong><p>{error}。缺失来源保持未知，不用另一来源的结果代替。</p></div></div>}
    {mode === "demo" && <div className="notice v2-notice"><div><strong>当前为演示数据</strong><p>账户数值仅用于页面预览，不代表真实交易。</p></div></div>}
    <section className="section panel trading-runtime-focus"><div className="trading-runtime-summary"><div className="trading-runtime-state"><span>运行状态</span>{v2Status(runtime?.runner.state ?? (runtime?.runner.running === true ? "running" : undefined), v2Unknown(runtime?.runner.state ?? runtime?.runner.running))}</div><div><span>最近周期</span><strong>{formatV2Time(runtime?.runner.lastCompletedAt)}</strong></div><div><span>实盘快照</span><strong>{snapshot ? formatV2Time(snapshot.observedAt) : "未知"}</strong></div><div><span>快照新鲜度</span><strong>{snapshot ? `${formatV2Number(snapshot.dataFreshnessSeconds, 0)} 秒` : "未知"}</strong></div>{runtime?.runner.hasLastError && <div><span>最近错误</span><strong>{v2Unknown(runtime.runner.lastErrorCode)}</strong></div>}</div></section>
    <section className="section"><div className="section-head"><div><h2 className="section-title">账户经营摘要</h2><p className="section-caption">每个账户分别展示入场许可、累计收益、浮动盈亏和纳管持仓市值；未采集的事实保持未知。</p></div></div><div className="table-scroll v2-evidence-table"><table className="v2-table trading-account-summary"><thead><tr><th>账户 / 策略</th><th>当前许可 / 最近周期</th><th>纳管持仓 / 市值</th><th>总盈亏（已实现 / 浮动）</th><th>待处理</th></tr></thead><tbody>{rows.length ? rows.map((item) => <AccountSummaryRow key={`${item.executionAccountId}:${item.strategyId}`} account={item} submission={runtime?.submission} wallet={walletByID.get(item.executionAccountId)} marketValue={snapshot ? marketValueByID.get(item.executionAccountId) ?? 0 : undefined} />) : <tr><td colSpan={5}><span className="v2-inline-note">暂未返回账户事实。</span></td></tr>}</tbody></table></div></section>
    {snapshot && <section className="section panel trading-attention"><div className="section-head"><div><h2 className="section-title">需要关注</h2><p className="section-caption">这里只保留异常入口；订单、持仓、对账和赎回的完整证据在对应 Tab 查看。风险和数据质量是全局事实；待处理订单和仓位按当前账户范围统计。</p></div></div><div className="trading-attention-grid"><AttentionFact label="全局风险提示" value={summarizeAttention(snapshot.risks, (risk) => risk.state !== "safe")} /><AttentionFact label="全局数据质量" value={summarizeAttention(snapshot.dataQuality, (item) => item.status !== "healthy")} /><AttentionFact label="待处理订单" value={aggregateAccountCount(runtimeAccounts, "openOrderCount", "条")} /><AttentionFact label="纳管仓位" value={`${snapshot.positions.filter((position) => position.managed && (!account || position.executionAccountId === account)).length} 个`} /></div></section>}
  </div>;
}

function AccountSummaryRow({ account, submission, wallet, marketValue }: { account: ConsoleV2RuntimeAccount; submission?: ConsoleV2Runtime["submission"]; wallet?: LiveWalletSummary; marketValue?: number }) {
  const permission = deriveAccountPermission(account, submission);
  return <tr><td><div className="v2-cell-copy"><strong className="mono">{account.executionAccountId}</strong><small>{v2Unknown(account.modelId)} · {v2Unknown(account.strategyId)} · {v2Unknown(account.sourceMode)}</small></div></td><td><div className="v2-cell-copy"><span>{permission.currentLabel}</span><small>{permission.currentReasons.join(" · ")}</small><small>{permission.historyLabel} · 阻断 {v2Unknown(account.lastCycleEntryBlockReason)}</small></div></td><td><div className="v2-cell-copy"><span>{wallet ? formatV2Number(wallet.positionCount, 0) : "未知"} 个</span><small>{marketValue === undefined ? "市值未知" : formatMoney(marketValue)}</small></div></td><td><div className="v2-cell-copy"><strong>{wallet ? formatMoney(wallet.totalPnl) : "未知"}</strong><small>已实现 {wallet ? formatMoney(wallet.realizedPnl) : "未知"} · 浮动 {wallet ? formatMoney(wallet.unrealizedPnl) : "未知"}</small></div></td><td>{account.openIssueCount === null || account.openOrderCount === null ? "未知" : `${account.openIssueCount} 个问题 · ${account.openOrderCount} 个订单`}</td></tr>;
}

function AttentionFact({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function aggregateAccountCount(accounts: ConsoleV2RuntimeAccount[], key: "openIssueCount" | "openOrderCount", unit: string) {
  if (!accounts.length || accounts.some((account) => account[key] === null)) return "未知";
  return `${accounts.reduce((total, account) => total + (account[key] ?? 0), 0)} ${unit}`;
}
function formatMoney(value: number | null | undefined) { return value === null || value === undefined || !Number.isFinite(value) ? "未知" : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`; }
function formatDecimal(value: string | null | undefined) { return value === null || value === undefined || value === "" ? "未知" : value; }

function Ledger() {
  return <TradeRecordsPage embedded sharedAccountOnly showPnL />;
}

function DecisionCycles() {
  const [status, setStatus] = useV2Filter("status");
  const [model, setModel] = useV2Filter("model_id");
  const [strategy, setStrategy] = useV2Filter("strategy_id");
  const [account] = useV2Filter("execution_account_id");
  const [from, setFrom] = useV2Filter("from");
  const [to, setTo] = useV2Filter("to");
  const params = useMemo(() => ({ status: status || undefined, model_id: model || undefined, strategy_id: strategy || undefined, execution_account_id: account || undefined, from: dateStart(from), to: dateEnd(to) }), [status, model, strategy, account, from, to]);
  const controls = <><select className="select" aria-label="周期状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="INPUT_RECORDED">已记录输入</option><option value="OUTPUT_RECORDED">已记录输出</option><option value="DELIVERY_PENDING">交付中</option><option value="DELIVERY_ATTENTION">交付需关注</option></select><TradingScopeFields key={`${model}|${strategy}|${from}|${to}`} model={model} setModel={setModel} strategy={strategy} setStrategy={setStrategy} from={from} setFrom={setFrom} to={to} setTo={setTo} /></>;
  return <><V2ListPage<ConsoleV2DecisionCycle> title="决策记录" description="按持久化周期核对预测覆盖、入场许可、交付计划和结果；模型、策略与日期只作用于本列表。日期筛选按决策时间。" load={consoleV2.trading.decisionCycles} params={params} controls={controls} rowKey={(item) => item.cycleId} searchPlaceholder="搜索 cycle、input、snapshot、模型或账户" columns={[
    { label: "Cycle / decision_at", className: "primary", render: (item) => <div className="v2-cell-copy"><strong className="mono">{item.cycleId}</strong><small>{formatV2Time(item.decisionAt)}</small></div> },
    { label: "Binding", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.modelId)}</span><small>{v2Unknown(item.predictionModelId, "producer 未提供")} · {v2Unknown(item.strategyId)} · {v2Unknown(item.executionAccountId)}</small></div> },
    { label: "输入快照", render: (item) => <div className="v2-cell-copy mono"><span>{v2Unknown(item.inputId)}</span><small>{v2Unknown(item.predictionSnapshotId)}</small></div> },
    { label: "预测 / Lot / Intent", render: (item) => `${formatV2Number(item.predictionCount, 0)} / ${formatV2Number(item.positionLotCount, 0)} / ${formatV2Number(item.intentCount, 0)}` },
    { label: "交付 pending / failed", render: (item) => `${formatV2Number(item.deliveryPendingCount, 0)} / ${formatV2Number(item.deliveryFailedCount, 0)}` },
    { label: "入场 gate", render: (item) => <div className="v2-cell-copy"><span>{item.entrySubmissionEnabled === null ? "未采集" : item.entrySubmissionEnabled ? "允许" : "阻断"}</span><small>{v2Unknown(item.entryBlockReason)}</small></div> },
    { label: "状态", render: (item) => v2Status(item.status, item.status) },
  ]} renderDetail={(item) => <CycleDetail item={item} />} /><LatestEdgeSnapshot modelId={model} /></>;
}

function LatestEdgeSnapshot({ modelId }: { modelId: string }) {
  const [requested, setRequested] = useState(false);
  const [distribution, setDistribution] = useState<Awaited<ReturnType<typeof consoleApi.edgeDistribution>>["data"]>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setRequested(true); setLoading(true); setError(undefined);
    try { const result = await consoleApi.edgeDistribution(modelId || undefined); setDistribution(result.data); }
    catch (requestError) { setDistribution(undefined); setError(requestError instanceof Error ? requestError.message : "最新 Edge 暂不可用"); }
    finally { setLoading(false); }
  };
  if (!requested) return <section className="section trading-edge-deferred"><div><h2 className="section-title">最新决策 Edge</h2><p className="section-caption">只读取最新决策快照，不把它当作历史周期证据。</p></div><button type="button" className="button" onClick={() => void load()}>查看最新 Edge</button></section>;
  return <EdgeDistributionPanel distribution={distribution} loading={loading} error={error} onRetry={() => void load()} />;
}

function CycleDetail({ item }: { item: ConsoleV2DecisionCycle }) {
  const [detail, setDetail] = useState<Record<string, unknown>>();
  const [error, setError] = useState<string>();
  useEffect(() => { let cancelled = false; const timer = window.setTimeout(() => { if (cancelled) return; setDetail(undefined); setError(undefined); void consoleV2.trading.decisionCycle(item.cycleId).then((result) => { if (!cancelled) setDetail(result.data); }).catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof Error ? requestError.message : "周期详情不可用"); }); }, 0); return () => { cancelled = true; window.clearTimeout(timer); }; }, [item.cycleId]);
  return <><V2Facts values={[{ label: "周期 ID", value: item.cycleId, mono: true }, { label: "模型 / 策略", value: `${v2Unknown(item.modelId)} / ${v2Unknown(item.strategyId)}` }, { label: "执行账户", value: v2Unknown(item.executionAccountId), mono: true }, { label: "决策时间", value: formatV2Time(item.decisionAt) }, { label: "输入创建时间", value: formatV2Time(item.inputCreatedAt) }, { label: "输出记录时间", value: formatV2Time(item.outputRecordedAt) }, { label: "预测 / Lot / Intent", value: `${formatV2Number(item.predictionCount, 0)} / ${formatV2Number(item.positionLotCount, 0)} / ${formatV2Number(item.intentCount, 0)}` }, { label: "交付 pending / failed", value: `${formatV2Number(item.deliveryPendingCount, 0)} / ${formatV2Number(item.deliveryFailedCount, 0)}` }, { label: "入场许可", value: item.entrySubmissionEnabled === null ? "未采集" : item.entrySubmissionEnabled ? "允许" : `阻断：${v2Unknown(item.entryBlockReason)}` }, { label: "状态", value: v2Unknown(item.status) }, { label: "盘口快照", value: v2Unknown(item.orderbookSnapshotSetId), mono: true }]} />{error && <p className="v2-inline-note">{error}</p>}{detail && <><CycleEvidence detail={detail} /><details className="v2-json-disclosure"><summary>查看安全周期原始摘要</summary><pre>{JSON.stringify(detail, null, 2)}</pre></details></>}</>;
}

function CycleEvidence({ detail }: { detail: Record<string, unknown> }) {
  const predictions = detailRecords(detail.predictions);
  const orderbooks = detailRecords(detail.orderbook_snapshots);
  const deliveries = detailRecords(detail.deliveries);
  return <section className="v2-evidence-section"><h4 className="v2-evidence-title">历史周期事实</h4><V2Facts values={[{ label: "订单提交", value: detailBool(detail.order_submission_enabled) }, { label: "入场提交", value: detailBool(detail.entry_submission_enabled) }, { label: "入场阻断原因", value: detailText(detail.entry_block_reason) }, { label: "预测快照", value: detailText(detail.prediction_snapshot_id), mono: true }, { label: "盘口快照集合", value: detailText(detail.orderbook_snapshot_set_id), mono: true }]} /><ProjectionTable title={`预测身份（${predictions.length}）`} items={predictions} columns={[{ label: "预测 ID", value: (row) => detailText(row.prediction_id) }, { label: "来源任务", value: (row) => detailText(row.source_job_id) }, { label: "市场", value: (row) => detailText(row.market_id) }, { label: "条件", value: (row) => detailText(row.condition_id) }]} /><ProjectionTable title={`盘口快照（${orderbooks.length}）`} items={orderbooks} columns={[{ label: "来源", value: (row) => detailText(row.market_source) }, { label: "市场", value: (row) => detailText(row.market_id) }, { label: "Token", value: (row) => detailText(row.token_id) }, { label: "状态", value: (row) => detailText(row.status) }, { label: "观测时间", value: (row) => detailTime(row.observed_at) }]} /><ProjectionTable title={`交付与订单（${deliveries.length}）`} items={deliveries} columns={[{ label: "状态", value: (row) => detailText(row.status) }, { label: "客户订单", value: (row) => detailText(row.client_order_id) }, { label: "订单", value: (row) => orderLink(row.order_id) }, { label: "创建时间", value: (row) => detailTime(row.created_at) }, { label: "完成时间", value: (row) => detailTime(row.completed_at) }]} /></section>;
}

function OrderTraceEvidence({ item, trace }: { item: ConsoleV2Order; trace: Awaited<ReturnType<typeof consoleV2.trading.orderTrace>>["data"] }) {
  const deliveries = traceRecords(trace.deliveries);
  const events = traceRecords(trace.events);
  const attempts = traceRecords(trace.attempts);
  const fills = traceRecords(trace.fills);
  const lots = traceRecords(trace.positionLots);
  const issues = traceRecords(trace.reconciliationIssues);
  const confirmed = item.evidenceSummary.confirmedFillCount ?? fills.filter((fill) => detailText(fill.confirmed_at) !== "未知").length;
  const applied = item.evidenceSummary.appliedFillCount ?? fills.filter((fill) => detailText(fill.applied_at) !== "未知").length;
  return <section className="v2-evidence-section"><h4 className="v2-evidence-title">订单履历</h4><V2Facts values={[{ label: "当前订单状态", value: item.status }, { label: "订单更新时间", value: formatV2Time(item.updatedAt) }, { label: "确认成交数（汇总）", value: String(confirmed) }, { label: "已入账成交数（汇总）", value: String(applied) }, { label: "Trace 观测时间", value: formatV2Time(trace.observedAt) }]} /><div className="v2-trace-counts"><TraceCount label="交付（当前 trace）" count={deliveries.length} /><TraceCount label="状态事件（当前 trace）" count={events.length} /><TraceCount label="提交尝试（当前 trace）" count={attempts.length} /><TraceCount label="成交记录（当前 trace）" count={fills.length} /><TraceCount label="仓位批次（当前 trace）" count={lots.length} /><TraceCount label="对账问题（当前 trace）" count={issues.length} /></div><ProjectionTable title="交付" items={deliveries} columns={[{ label: "状态", value: (row) => detailText(row.status) }, { label: "周期", value: (row) => detailText(row.cycle_id) }, { label: "订单", value: (row) => orderLink(row.order_id) }, { label: "创建时间", value: (row) => detailTime(row.created_at) }, { label: "完成时间", value: (row) => detailTime(row.completed_at) }]} /><ProjectionTable title="状态事件" items={events} columns={[{ label: "状态", value: (row) => detailText(row.to_status) }, { label: "触发", value: (row) => detailText(row.trigger) }, { label: "原因", value: (row) => detailText(row.reason_code) }, { label: "发生时间", value: (row) => detailTime(row.occurred_at) }]} /><ProjectionTable title="提交尝试" items={attempts} columns={[{ label: "类型", value: (row) => detailText(row.kind) }, { label: "结果", value: (row) => detailText(row.outcome) }, { label: "错误码", value: (row) => detailText(row.error_code) }, { label: "开始时间", value: (row) => detailTime(row.started_at) }, { label: "完成时间", value: (row) => detailTime(row.completed_at) }]} /><ProjectionTable title="成交" items={fills} columns={[{ label: "状态", value: (row) => detailText(row.status) }, { label: "份额 / 价格", value: (row) => `${detailText(row.shares)} / ${detailText(row.price)}` }, { label: "匹配时间", value: (row) => detailTime(row.matched_at) }, { label: "确认时间", value: (row) => detailTime(row.confirmed_at) }, { label: "入账时间", value: (row) => detailTime(row.applied_at) }]} /><ProjectionTable title="仓位批次" items={lots} columns={[{ label: "Lot ID", value: (row) => detailText(row.lot_id) }, { label: "状态", value: (row) => detailText(row.status) }, { label: "剩余份额", value: (row) => detailText(row.remaining_shares) }, { label: "开启时间", value: (row) => detailTime(row.opened_at) }, { label: "关闭时间", value: (row) => detailTime(row.closed_at) }]} /><ProjectionTable title="对账问题" items={issues} columns={[{ label: "状态", value: (row) => detailText(row.status) }, { label: "类型", value: (row) => detailText(row.issue_type) }, { label: "原因", value: (row) => detailText(row.reason_code) }, { label: "观测时间", value: (row) => detailTime(row.observed_at) }, { label: "解决时间", value: (row) => detailTime(row.resolved_at) }]} /></section>;
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
function dateStart(value: string) { return value ? `${value}T00:00:00Z` : undefined; }
function dateEnd(value: string) {
  return value ? `${value}T23:59:59.999999Z` : undefined;
}

function TradingScopeFields({ model, setModel, strategy, setStrategy, from, setFrom, to, setTo, dates = true }: { model?: string; setModel?: (value: string) => void; strategy?: string; setStrategy?: (value: string) => void; from?: string; setFrom?: (value: string) => void; to?: string; setTo?: (value: string) => void; dates?: boolean }) {
  const [draft, setDraft] = useState({ model: model ?? "", strategy: strategy ?? "", from: from ?? "", to: to ?? "" });
  const update = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const apply = () => {
    if (setModel) setModel(draft.model);
    if (setStrategy) setStrategy(draft.strategy);
    if (dates && setFrom) setFrom(draft.from);
    if (dates && setTo) setTo(draft.to);
  };
  const reset = () => {
    const empty = { model: "", strategy: "", from: "", to: "" };
    setDraft(empty);
    if (setModel) setModel("");
    if (setStrategy) setStrategy("");
    if (dates && setFrom) setFrom("");
    if (dates && setTo) setTo("");
  };
  return <span className="trading-scope-fields">
    {setModel && <label><span>模型</span><input className="input" aria-label="列表模型" value={draft.model} onChange={(event) => update("model", event.target.value)} placeholder="全部模型" /></label>}
    {setStrategy && <label><span>策略</span><input className="input" aria-label="列表策略" value={draft.strategy} onChange={(event) => update("strategy", event.target.value)} placeholder="全部策略" /></label>}
    {dates && setFrom && <label><span>开始日期</span><input className="input" aria-label="列表开始日期" type="date" value={draft.from} onChange={(event) => update("from", event.target.value)} /></label>}
    {dates && setTo && <label><span>结束日期</span><input className="input" aria-label="列表结束日期" type="date" value={draft.to} onChange={(event) => update("to", event.target.value)} /></label>}
    <button type="button" className="button" onClick={reset}>重置本页筛选</button><button type="button" className="button primary" onClick={apply}>应用本页筛选</button>
  </span>;
}

function Orders() {
  const [status, setStatus] = useV2Filter("status");
  const [model, setModel] = useV2Filter("model_id");
  const [strategy, setStrategy] = useV2Filter("strategy_id");
  const [account] = useV2Filter("execution_account_id");
  const [from, setFrom] = useV2Filter("from");
  const [to, setTo] = useV2Filter("to");
  const params = useMemo(() => ({ status: status || undefined, model_id: model || undefined, strategy_id: strategy || undefined, execution_account_id: account || undefined, from: dateStart(from), to: dateEnd(to) }), [status, model, strategy, account, from, to]);
  const controls = <><select className="select" aria-label="订单状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="RECEIVED">已接收</option><option value="VALIDATING">校验中</option><option value="RESERVED">已预留</option><option value="SUBMITTING">提交中</option><option value="ACKNOWLEDGED">已确认</option><option value="LIVE">活动中</option><option value="PARTIALLY_FILLED">部分成交</option><option value="FILLED">已成交</option><option value="REJECTED">已拒绝</option><option value="UNKNOWN">未知</option><option value="CANCEL_PENDING">取消中</option><option value="CANCELLED">已取消</option><option value="RECONCILING">对账中</option><option value="MANUAL_REVIEW">人工复核</option></select><TradingScopeFields key={`${model}|${strategy}|${from}|${to}`} model={model} setModel={setModel} strategy={strategy} setStrategy={setStrategy} from={from} setFrom={setFrom} to={to} setTo={setTo} /></>;
  return <V2ListPage<ConsoleV2Order> title="订单执行" description="核对订单接收、成交和账本证据；日期筛选按订单更新时间。" load={consoleV2.trading.orders} params={params} controls={controls} rowKey={(item) => item.orderId} searchPlaceholder="搜索 order、client order、venue order、market 或 token" columns={[
    { label: "市场 / 方向", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{v2Unknown(item.marketQuestion, item.marketId ?? "未知市场")}</strong><small>{v2Unknown(item.outcomeName)} · <span className="mono">{v2Unknown(item.marketId)}</span></small></div> },
    { label: "订单身份", render: (item) => <div className="v2-cell-copy"><strong className="mono">{item.orderId}</strong><small className="mono">{v2Unknown(item.clientOrderId)}</small></div> },
    { label: "状态 / Side", render: (item) => <div className="v2-cell-copy"><span>{v2Status(item.status, item.status)}</span><small>{v2Unknown(item.side)}</small></div> },
    { label: "Binding", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.modelId)}</span><small>{v2Unknown(item.strategyId)} · {v2Unknown(item.executionAccountId)}</small></div> },
    { label: "Price / Shares", render: (item) => <div className="v2-cell-copy"><span>{formatV2Number(item.price, 6)} · {formatV2Number(item.shares, 4)}</span><small>filled {formatV2Number(item.filledShares, 4)}</small></div> },
    { label: "成交 / 账本证据", render: (item) => <div className="v2-cell-copy"><span>{item.evidenceSummary.fillEvidenceState}</span><small>{item.evidenceSummary.confirmedFillCount ?? "未知"} confirmed · {item.evidenceSummary.appliedFillCount ?? "未知"} applied</small></div> },
    { label: "创建 / 更新", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.createdAt)}</span><small>{formatV2Time(item.updatedAt)}</small></div> },
  ]} renderDetail={(item) => <><V2Facts values={[{ label: "成交证据", value: item.evidenceSummary.fillEvidenceState }, { label: "账本状态", value: item.evidenceSummary.accountingState }, { label: "Confirmed fills", value: formatV2Number(item.evidenceSummary.confirmedFillCount, 0) }, { label: "Applied fills", value: formatV2Number(item.evidenceSummary.appliedFillCount, 0) }, { label: "Pending fills", value: formatV2Number(item.evidenceSummary.pendingFillCount, 0) }, { label: "开放问题", value: formatV2Number(item.evidenceSummary.openIssueCount, 0) }, { label: "Reservation", value: item.evidenceSummary.reservationState }]} /><OrderDetail item={item} /></>} />;
}

function OrderDetail({ item }: { item: ConsoleV2Order }) {
  const [trace, setTrace] = useState<Awaited<ReturnType<typeof consoleV2.trading.orderTrace>>["data"]>();
  const [error, setError] = useState<string>();
  useEffect(() => { let cancelled = false; const timer = window.setTimeout(() => { if (cancelled) return; setTrace(undefined); setError(undefined); void consoleV2.trading.orderTrace(item.orderId).then((result) => { if (!cancelled) setTrace(result.data); }).catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof Error ? requestError.message : "订单 trace 不可用"); }); }, 0); return () => { cancelled = true; window.clearTimeout(timer); }; }, [item.orderId]);
  return <><V2Facts values={[{ label: "订单 ID", value: item.orderId, mono: true }, { label: "客户订单 ID", value: v2Unknown(item.clientOrderId), mono: true }, { label: "交易所订单 ID", value: v2Unknown(item.venueOrderId), mono: true }, { label: "市场问题", value: v2Unknown(item.marketQuestion) }, { label: "结果方向", value: v2Unknown(item.outcomeName) }, { label: "市场 / 条件", value: `${v2Unknown(item.marketId)} / ${v2Unknown(item.conditionId)}`, mono: true }, { label: "交易场所 / 来源", value: `${v2Unknown(item.source)} / ${v2Unknown(item.marketSource)}` }, { label: "Token ID", value: v2Unknown(item.tokenId), mono: true }, { label: "模型 / 策略", value: `${v2Unknown(item.modelId)} / ${v2Unknown(item.strategyId)}` }, { label: "执行账户", value: v2Unknown(item.executionAccountId), mono: true }, { label: "状态 / Side", value: `${item.status} / ${v2Unknown(item.side)}` }, { label: "委托价格 / 数量", value: `${formatV2Number(item.price, 6)} / ${formatV2Number(item.shares, 6)}` }, { label: "成交数量 / 均价", value: `${formatV2Number(item.filledShares, 6)} / ${formatV2Number(item.averageFillPrice, 6)}` }, { label: "创建 / 更新", value: `${formatV2Time(item.createdAt)} / ${formatV2Time(item.updatedAt)}` }]} />{error && <p className="v2-inline-note">{error}</p>}{trace && <><OrderTraceEvidence item={item} trace={trace} /><details className="v2-json-disclosure"><summary>查看安全订单原始摘要</summary><pre>{JSON.stringify(trace, null, 2)}</pre></details></>}<p className="v2-inline-note">订单状态、确认成交和账本入账分别展示；页面只读。</p></>;
}

function Positions() {
  const [model, setModel] = useV2Filter("model_id");
  const [strategy, setStrategy] = useV2Filter("strategy_id");
  const [account] = useV2Filter("execution_account_id");
  const params = useMemo(() => ({ model_id: model || undefined, strategy_id: strategy || undefined, execution_account_id: account || undefined }), [model, strategy, account]);
  const controls = <TradingScopeFields key={`${model}|${strategy}`} model={model} setModel={setModel} strategy={strategy} setStrategy={setStrategy} dates={false} />;
  return <V2ListPage<ConsoleV2Holding> title="当前持仓" description="按历史账户、模型和策略归属汇总当前仍有剩余份额的持仓；本页不提供日期筛选，历史开仓时间在 Lot 明细中查看。" load={consoleV2.trading.holdings} params={params} controls={controls} rowKey={holdingIdentity} searchPlaceholder="搜索市场、条件、Token、账户或策略" columns={[
    { label: "市场 / 结果", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{v2Unknown(item.marketQuestion, item.marketId ?? "未知市场")}</strong><small>{v2Unknown(item.outcomeName)} · {v2Unknown(item.conditionId)}</small></div> },
    { label: "历史归属", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.executionAccountId)}</span><small>{v2Unknown(item.modelId)} · {v2Unknown(item.strategyId)} · {v2Unknown(item.marketSource)}</small></div> },
    { label: "剩余份额 / 成本", render: (item) => <div className="v2-cell-copy"><span>{formatDecimal(item.remainingShares)}</span><small>{formatDecimal(item.remainingCost)}</small></div> },
    { label: "标记价 / 市值", render: (item) => <div className="v2-cell-copy"><span>{formatDecimal(item.markPrice)}</span><small>{formatDecimal(item.marketValue)}</small></div> },
    { label: "浮动盈亏", render: (item) => formatDecimal(item.unrealizedPnl) },
    { label: "Lot / 时间", render: (item) => <div className="v2-cell-copy"><span>{formatV2Number(item.lotCount, 0)} 个</span><small>标价观测 {formatV2Time(item.markObservedAt)}</small><small>最近开仓 {formatV2Time(item.lastOpenedAt)}</small></div> },
  ]} renderDetail={(item) => <><V2Facts values={[{ label: "持仓身份", value: holdingIdentity(item), mono: true }, { label: "历史模型", value: v2Unknown(item.modelId) }, { label: "历史策略", value: v2Unknown(item.strategyId) }, { label: "执行账户", value: v2Unknown(item.executionAccountId), mono: true }, { label: "市场问题", value: v2Unknown(item.marketQuestion) }, { label: "市场 / 条件", value: `${v2Unknown(item.marketId)} / ${v2Unknown(item.conditionId)}`, mono: true }, { label: "Token / 结果方向", value: `${v2Unknown(item.tokenId)} / ${v2Unknown(item.outcomeName)}（${item.outcomeIndex ?? "未知"}）`, mono: true }, { label: "状态", value: v2Unknown(item.status) }, { label: "剩余份额", value: formatDecimal(item.remainingShares) }, { label: "剩余成本", value: formatDecimal(item.remainingCost) }, { label: "标记价", value: formatDecimal(item.markPrice) }, { label: "市值", value: formatDecimal(item.marketValue) }, { label: "浮动盈亏", value: formatDecimal(item.unrealizedPnl) }, { label: "标价观测", value: formatV2Time(item.markObservedAt) }, { label: "首次 / 最近开仓", value: `${formatV2Time(item.firstOpenedAt)} / ${formatV2Time(item.lastOpenedAt)}` }, { label: "Lot 数", value: formatV2Number(item.lotCount, 0) }]} /><p className="v2-inline-note">数量和成本来自只读持仓汇总；缺少标记价时保留未知，不用成本或分页行估算市值。</p><HoldingLotDetails item={item} /></>} />;
}

/**
 * The lot detail surface owns its page state locally. It uses the complete
 * holding identity endpoint, so opening a detail never changes the parent
 * holdings URL/search/page state or falls back to a fuzzy token query.
 */
function HoldingLotDetails({ item }: { item: ConsoleV2Holding }) {
  const pageSize = 5;
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<ConsoleV2Page<ConsoleV2PositionLot>>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setError(undefined);
      setResult(undefined);
      void consoleV2.trading.holdingLots(item, { limit: pageSize, offset: page * pageSize }).then((response) => { if (!cancelled) setResult(response.data); }).catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Lot 明细暂不可用"); }).finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [item, page]);
  const totalPages = result ? Math.ceil(result.total / result.limit) : 0;
  return <section className="v2-evidence-section holding-lot-details"><h4 className="v2-evidence-title">开仓批次明细</h4>{loading && !result ? <p className="v2-inline-note">正在读取 {formatV2Number(item.lotCount, 0)} 个 Lot…</p> : error ? <p className="v2-inline-note">{error}</p> : result && !result.items.length ? <p className="v2-inline-note">当前持仓身份没有返回 Lot 明细。</p> : result ? <><div className="table-scroll v2-evidence-table"><table className="v2-table"><thead><tr><th>Lot ID</th><th>状态</th><th>剩余份额 / 成本</th><th>开仓 / 关闭</th></tr></thead><tbody>{result.items.map((lot) => <tr key={lot.lotId}><td className="mono">{lot.lotId}</td><td>{lot.status}</td><td>{formatV2Number(lot.remainingShares, 6)} / {formatV2Number(lot.remainingCost, 6)}</td><td>{formatV2Time(lot.openedAt)} / {formatV2Time(lot.closedAt)}</td></tr>)}</tbody></table></div><div className="v2-inline-note">第 {page + 1} / {totalPages} 页 <button type="button" className="button" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>上一页</button><button type="button" className="button" disabled={page + 1 >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>下一页</button></div></> : <p className="v2-inline-note">当前汇总包含 {formatV2Number(item.lotCount, 0)} 个 Lot；未返回明细。</p>}</section>;
}

function Reconciliation() {
  const [active, setActive] = useV2Filter("reconciliation_view", "issues");
  const [visited, setVisited] = useState<Set<string>>(() => new Set([active]));
  const tabs = [{ href: "issues", label: "开放问题" }, { href: "runs", label: "对账运行" }];
  const select = useCallback((next: string) => {
    const target = document.getElementById(`v2-panel-${next}`);
    const state = target?.querySelector<HTMLElement>("[data-v2-list-state]");
    const url = new URL(window.location.href);
    const currentStatus = url.searchParams.get("status");
    for (const key of ["q", "limit", "offset"]) url.searchParams.delete(key);
    // ALL is a UI sentinel. Keep it across the local Runs view so returning
    // to Issues does not silently fall back to the default OPEN filter.
    if (currentStatus !== "ALL") url.searchParams.delete("status");
    if (state) {
      const query = state.getAttribute("data-v2-list-query")?.trim();
      const limit = state.getAttribute("data-v2-list-limit");
      const offset = state.getAttribute("data-v2-list-offset");
      if (query) url.searchParams.set("q", query);
      if (limit && limit !== "20") url.searchParams.set("limit", limit);
      if (offset && offset !== "0") url.searchParams.set("offset", offset);
      try {
        const params = JSON.parse(state.getAttribute("data-v2-list-params") ?? "{}") as Record<string, unknown>;
        if (typeof params.status === "string" && params.status) url.searchParams.set("status", params.status);
      } catch {
        // Keep the target panel at its safe default when metadata is stale.
      }
    } else if (next === "issues") {
      url.searchParams.set("status", "OPEN");
    }
    window.history.pushState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setActive(next);
    setVisited((current) => current.has(next) ? current : new Set([...current, next]));
    window.requestAnimationFrame(() => window.dispatchEvent(new Event(WORKSPACE_FILTER_CHANGE_EVENT)));
  }, [setActive]);
  useEffect(() => {
    const rememberActiveView = () => {
      const next = new URL(window.location.href).searchParams.get("reconciliation_view");
      if (next !== "issues" && next !== "runs") return;
      setVisited((current) => current.has(next) ? current : new Set([...current, next]));
    };
    window.addEventListener("popstate", rememberActiveView);
    window.addEventListener("v2-workspace-url-change", rememberActiveView);
    return () => { window.removeEventListener("popstate", rememberActiveView); window.removeEventListener("v2-workspace-url-change", rememberActiveView); };
  }, []);
  return <><V2Tabs tabs={tabs} active={active} onSelect={select} variant="local" ariaLabel="对账视图" /><V2WorkspacePanel active={active} href="issues" visited={visited.has("issues") || active === "issues"}><ReconciliationIssues /></V2WorkspacePanel><V2WorkspacePanel active={active} href="runs" visited={visited.has("runs") || active === "runs"}><ReconciliationRuns /></V2WorkspacePanel></>;
}

function reconciliationApiParams(params: Record<string, string | number | undefined>) {
  const next = { ...params };
  delete next.reconciliation_view;
  if (next.status === "ALL") delete next.status;
  return next;
}

const loadReconciliationRuns = (params: Record<string, string | number | undefined>) => consoleV2.trading.reconciliationRuns(reconciliationApiParams(params));
const loadReconciliationIssues = (params: Record<string, string | number | undefined>) => consoleV2.trading.reconciliationIssues(reconciliationApiParams(params));

function ReconciliationRuns() {
  const [account] = useV2Filter("execution_account_id");
  const [from, setFrom] = useV2Filter("from");
  const [to, setTo] = useV2Filter("to");
  const params = useMemo(() => ({ reconciliation_view: "runs", execution_account_id: account || undefined, from: dateStart(from), to: dateEnd(to) }), [account, from, to]);
  const controls = <TradingScopeFields key={`${from}|${to}`} from={from} setFrom={setFrom} to={to} setTo={setTo} />;
  return <V2ListPage<ConsoleV2ReconciliationRun> title="对账运行" description="查看对账运行审计；日期筛选按对账开始时间。" load={loadReconciliationRuns} params={params} controls={controls} rowKey={(item) => item.runId} searchPlaceholder="搜索 run 或状态" columns={[
    { label: "Run ID", className: "primary mono", render: (item) => item.runId },
    { label: "状态 / 结果", render: (item) => <div className="v2-cell-copy"><span>{v2Status(item.status, item.status)}</span><small>{v2Unknown(item.result)}</small></div> },
    { label: "账户", render: (item) => v2Unknown(item.executionAccountId) },
    { label: "Started", render: (item) => formatV2Time(item.startedAt) },
    { label: "Completed", render: (item) => formatV2Time(item.completedAt) },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "Run ID", value: item.runId, mono: true }, { label: "Result", value: v2Unknown(item.result) }, { label: "Execution account", value: v2Unknown(item.executionAccountId), mono: true }, { label: "Trigger", value: v2Unknown(item.trigger) }, { label: "Focus order", value: v2Unknown(item.focusOrderId), mono: true }, { label: "Started", value: formatV2Time(item.startedAt) }, { label: "Completed", value: formatV2Time(item.completedAt) }]} />} />;
}

function ReconciliationIssues() {
  const [statusParam, setStatus] = useV2Filter("status", "OPEN");
  const status = statusParam === "OPEN" || statusParam === "RESOLVED" || statusParam === "ALL" ? statusParam : "OPEN";
  const [account] = useV2Filter("execution_account_id");
  const [from, setFrom] = useV2Filter("from");
  const [to, setTo] = useV2Filter("to");
  const params = useMemo(() => ({ reconciliation_view: "issues", status, execution_account_id: account || undefined, from: dateStart(from), to: dateEnd(to) }), [status, account, from, to]);
  const controls = <><select className="select" aria-label="问题状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">全部状态</option><option value="OPEN">OPEN</option><option value="RESOLVED">RESOLVED</option></select><TradingScopeFields key={`${from}|${to}`} from={from} setFrom={setFrom} to={to} setTo={setTo} /></>;
  return <V2ListPage<ConsoleV2ReconciliationIssue> title="对账问题" description="查看账户差异和影响范围；日期筛选按差异观测时间。" load={loadReconciliationIssues} params={params} controls={controls} rowKey={(item) => item.issueId} searchPlaceholder="搜索 issue、run、entity 或原因码" columns={[
    { label: "Issue ID", className: "primary mono", render: (item) => item.issueId },
    { label: "状态 / 类型", render: (item) => <div className="v2-cell-copy"><span>{v2Status(item.status, item.status)}</span><small>{v2Unknown(item.issueType)}</small></div> },
    { label: "Reason / Resolution", className: "mono", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.reasonCode)}</span><small>{v2Unknown(item.resolution)}</small></div> },
    { label: "关联身份", render: (item) => reconciliationIdentity(item) },
    { label: "首次 / 最近观测", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.firstObservedAt)}</span><small>{formatV2Time(item.observedAt)}</small></div> },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "Issue ID", value: item.issueId, mono: true }, { label: "Run ID", value: v2Unknown(item.runId), mono: true }, { label: "Account", value: v2Unknown(item.executionAccountId), mono: true }, { label: "Issue type", value: v2Unknown(item.issueType) }, { label: "Reason code", value: v2Unknown(item.reasonCode), mono: true }, { label: "Impact scope", value: v2Unknown(item.impactScope) }, { label: "Resolution", value: v2Unknown(item.resolution) }, { label: "关联身份", value: reconciliationIdentity(item) }, { label: "Source", value: v2Unknown(item.source) }, { label: "Local / remote", value: `${v2Unknown(item.localValue)} / ${v2Unknown(item.remoteValue)}` }, { label: "First observed", value: formatV2Time(item.firstObservedAt) }, { label: "Resolved at", value: formatV2Time(item.resolvedAt) }]} />} emptyDescription="没有返回对账问题时显示为空；查询失败仍保持未知，不替换为零差异。" />;
}

function Redemptions() {
  const [status, setStatus] = useV2Filter("status");
  const [account] = useV2Filter("execution_account_id");
  const [from, setFrom] = useV2Filter("from");
  const [to, setTo] = useV2Filter("to");
  const params = useMemo(() => ({ status: status || undefined, execution_account_id: account || undefined, from: dateStart(from), to: dateEnd(to) }), [status, account, from, to]);
  const controls = <><select className="select" aria-label="赎回状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="READY">待处理</option><option value="APPROVAL_SUBMITTING">提交授权中</option><option value="APPROVAL_SUBMITTED">授权已提交</option><option value="REDEEM_SUBMITTING">提交赎回中</option><option value="REDEEM_SUBMITTED">赎回已提交</option><option value="CONFIRMED">已确认</option><option value="APPLIED">已入账</option><option value="MANUAL_REVIEW">人工复核</option></select><TradingScopeFields key={`${from}|${to}`} from={from} setFrom={setFrom} to={to} setTo={setTo} /></>;
  return <V2ListPage<ConsoleV2Redemption> title="赎回" description="查看赎回提交、确认和入账；日期筛选按赎回任务创建时间。" load={consoleV2.trading.redemptions} params={params} controls={controls} rowKey={(item) => item.redemptionId} searchPlaceholder="搜索 redemption、condition、账户或交易哈希" columns={[
    { label: "Redemption ID", className: "primary mono", render: (item) => item.redemptionId },
    { label: "条件 / 市场", render: (item) => <div className="v2-cell-copy mono"><span>{v2Unknown(item.conditionId)}</span><small>{v2Unknown(item.marketId)}</small></div> },
    { label: "账户", className: "mono", render: (item) => v2Unknown(item.executionAccountId) },
    { label: "状态", render: (item) => v2Status(item.status, item.status) },
    { label: "Payout base units", render: (item) => formatV2Number(item.payoutBaseUnits, 0) },
    { label: "Confirmed / Applied", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.confirmedAt)}</span><small>{formatV2Time(item.appliedAt)}</small></div> },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "Redemption ID", value: item.redemptionId, mono: true }, { label: "Condition ID", value: v2Unknown(item.conditionId), mono: true }, { label: "Execution account", value: v2Unknown(item.executionAccountId), mono: true }, { label: "Transaction hash", value: v2Unknown(item.transactionHash), mono: true }, { label: "Payout base units", value: formatV2Number(item.payoutBaseUnits, 0) }, { label: "Receipt block", value: formatV2Number(item.receiptBlockNumber, 0) }, { label: "Confirmations", value: formatV2Number(item.confirmations, 0) }, { label: "Confirmed at", value: formatV2Time(item.confirmedAt) }, { label: "Applied at", value: formatV2Time(item.appliedAt) }]} />} />;
}
