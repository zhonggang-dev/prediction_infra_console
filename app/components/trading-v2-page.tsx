"use client";

import { useEffect, useMemo, useState } from "react";
import { consoleV2, type ConsoleV2Order, type ConsoleV2Page, type ConsoleV2PositionLot, type ConsoleV2ReconciliationIssue, type ConsoleV2ReconciliationRun, type ConsoleV2Redemption, type ConsoleV2Runtime } from "../lib/console-v2";
import { holdingIdentity, type ConsoleV2Holding } from "../lib/trading-holdings";
import { formatV2Number, formatV2Time, V2Facts, V2Frame, V2ListPage, V2Tabs, V2WorkspacePanel, WORKSPACE_FILTER_CHANGE_EVENT, useV2Filter, useVisitedTabs, useWorkspaceTabs, v2Status, v2Unknown } from "./console-v2-resource";
import { OfficialWalletPnlPanel } from "./wallet-pnl-chart";
import { TradeRecordsPage } from "./trade-records-page";
import "./trading-workspace.css";

type TradingView = "orders" | "positions" | "ledger" | "reconciliation";
const tabs = [
  { href: "/trading/orders", label: "订单", aliases: ["/trading"] },
  { href: "/trading/positions", label: "持仓" },
  { href: "/trading/ledger", label: "收益与成交账本", aliases: ["/trades"] },
  { href: "/trading/reconciliation", label: "对账" },
] as const;

export function TradingV2Page({ view = "orders" }: { view?: TradingView }) {
  const [account, setAccount] = useV2Filter("execution_account_id");
  const [runtime, setRuntime] = useState<ConsoleV2Runtime>();
  useEffect(() => { let cancelled = false; void consoleV2.trading.runtime().then((result) => { if (!cancelled) setRuntime(result.data); }).catch(() => { if (!cancelled) setRuntime(undefined); }); return () => { cancelled = true; }; }, []);
  const workspace = useWorkspaceTabs(tabs, `/trading/${view}`, { sharedQueryKeys: ["execution_account_id"] });
  const accounts = [...new Set([...(runtime?.bindings ?? []).map((item) => item.executionAccountId), ...(runtime?.accounts ?? []).map((item) => item.executionAccountId), account].filter(Boolean))];
  const config = workspace.active === "/trading/orders" ? { title: "订单", description: "查看委托、成交与订单状态。" }
    : workspace.active === "/trading/positions" ? { title: "持仓", description: "查看当前持有资产、成本与浮动盈亏。" }
    : workspace.active === "/trading/ledger" ? { title: "收益与成交账本", description: "查看钱包盈亏与已入账的成交、结算明细。" }
    : { title: "对账", description: "查看未解决差异及处理记录。" };
  return <V2Frame eyebrow="Trading" title={config.title} description={config.description}>
    <section className="trading-account-context" aria-label="交易账户范围"><label><span>账户</span><select className="select" aria-label="交易账户范围" value={account} onChange={(event) => { setAccount(event.target.value); window.dispatchEvent(new Event(WORKSPACE_FILTER_CHANGE_EVENT)); }}><option value="">全部账户</option>{accounts.map((id) => <option key={id} value={id}>{id}</option>)}</select></label></section>
    <V2Tabs tabs={tabs} active={workspace.active} onSelect={(href) => workspace.select(href as typeof workspace.active)} />
    <V2WorkspacePanel active={workspace.active} href="/trading/orders" visited={workspace.visited.has("/trading/orders")}><Orders /></V2WorkspacePanel>
    <V2WorkspacePanel active={workspace.active} href="/trading/positions" visited={workspace.visited.has("/trading/positions")}><PositionViews /></V2WorkspacePanel>
    <V2WorkspacePanel active={workspace.active} href="/trading/ledger" visited={workspace.visited.has("/trading/ledger")}><OfficialWalletPnlPanel active={workspace.active === "/trading/ledger"} account={account} /><TradeRecordsPage embedded sharedAccountOnly compact /></V2WorkspacePanel>
    <V2WorkspacePanel active={workspace.active} href="/trading/reconciliation" visited={workspace.visited.has("/trading/reconciliation")}><ReconciliationViews /></V2WorkspacePanel>
  </V2Frame>;
}

const orderLabels: Record<string, string> = { RECEIVED: "已接收", VALIDATING: "校验中", RESERVED: "已预留", SUBMITTING: "提交中", ACKNOWLEDGED: "交易所已接收", LIVE: "挂单中", PARTIALLY_FILLED: "部分成交", FILLED: "已成交", REJECTED: "已拒绝", UNKNOWN: "待核实", CANCEL_PENDING: "取消中", CANCELLED: "已取消", RECONCILING: "对账中", MANUAL_REVIEW: "人工复核" };
const holdingLabels: Record<string, string> = { OPEN: "持有中", SETTLED_PENDING_REDEEM: "待赎回", MIXED: "含待赎回批次" };
const redemptionLabels: Record<string, string> = { READY: "待处理", APPROVAL_SUBMITTING: "提交授权中", APPROVAL_SUBMITTED: "授权已提交", REDEEM_SUBMITTING: "提交赎回中", REDEEM_SUBMITTED: "赎回已提交", CONFIRMED: "链上已确认", APPLIED: "已入账", MANUAL_REVIEW: "人工复核" };
function decimal(value: string | number | null | undefined) { return value === null || value === undefined || value === "" ? "未知" : String(value); }
function dateStart(value: string) { return value ? `${value}T00:00:00Z` : undefined; }
function dateEnd(value: string) { return value ? `${value}T23:59:59.999999Z` : undefined; }
function records(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []; }
function text(value: unknown) { return value === null || value === undefined || value === "" ? "未知" : String(value); }

function Orders() {
  const [status, setStatus] = useV2Filter("status");
  const [side, setSide] = useV2Filter("side");
  const [model, setModel] = useV2Filter("model_id");
  const [strategy, setStrategy] = useV2Filter("strategy_id");
  const [account] = useV2Filter("execution_account_id");
  const [from, setFrom] = useV2Filter("from");
  const [to, setTo] = useV2Filter("to");
  const params = useMemo(() => ({ status: status || undefined, side: side || undefined, model_id: model || undefined, strategy_id: strategy || undefined, execution_account_id: account || undefined, from: dateStart(from), to: dateEnd(to) }), [status, side, model, strategy, account, from, to]);
  return <V2ListPage<ConsoleV2Order> title="订单" description="日期筛选按订单更新时间。" load={consoleV2.trading.orders} params={params} controls={<><select className="select" aria-label="订单状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(orderLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select className="select" aria-label="买卖方向" value={side} onChange={(event) => setSide(event.target.value)}><option value="">全部方向</option><option value="BUY">买入</option><option value="SELL">卖出</option></select><TradingScopeFields key={`${model}|${strategy}|${from}|${to}`} model={model} setModel={setModel} strategy={strategy} setStrategy={setStrategy} from={from} setFrom={setFrom} to={to} setTo={setTo} /></>} rowKey={(item) => item.orderId} searchPlaceholder="搜索市场、订单或账户" columns={[
    { label: "下单时间", render: (item) => formatV2Time(item.createdAt) },
    { label: "账户", render: (item) => v2Unknown(item.executionAccountId) },
    { label: "市场 / 结果", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{v2Unknown(item.marketQuestion, item.marketId ?? "未知市场")}</strong><small>{v2Unknown(item.outcomeName)}</small></div> },
    { label: "买卖", render: (item) => item.side === "BUY" ? "买入" : item.side === "SELL" ? "卖出" : v2Unknown(item.side) },
    { label: "委托价", render: (item) => decimal(item.price) },
    { label: "委托份额 / 已成交", render: (item) => `${decimal(item.shares)} / ${decimal(item.filledShares)}` },
    { label: "状态", render: (item) => v2Status(item.status, orderLabels[item.status] ?? item.status) },
  ]} renderDetail={(item) => <OrderDetail key={item.orderId} item={item} />} />;
}

function OrderDetail({ item }: { item: ConsoleV2Order }) {
  const [trace, setTrace] = useState<Awaited<ReturnType<typeof consoleV2.trading.orderTrace>>["data"]>();
  const [error, setError] = useState<string>();
  useEffect(() => { let cancelled = false; void consoleV2.trading.orderTrace(item.orderId).then((result) => { if (!cancelled) setTrace(result.data); }).catch(() => { if (!cancelled) setError("成交凭证暂不可用。"); }); return () => { cancelled = true; }; }, [item.orderId]);
  const fills = records(trace?.fills);
  const attempts = records(trace?.attempts);
  const reasons = [...new Set(attempts.map((attempt) => typeof attempt.error_code === "string" ? attempt.error_code : "").filter(Boolean))];
  return <><V2Facts values={[
    { label: "订单编号", value: item.orderId, mono: true }, { label: "交易所订单编号", value: v2Unknown(item.venueOrderId), mono: true },
    { label: "平均成交价", value: decimal(item.averageFillPrice) }, { label: "已确认 / 已入账成交数", value: `${item.evidenceSummary.confirmedFillCount ?? "未知"} / ${item.evidenceSummary.appliedFillCount ?? "未知"}` },
    { label: "待核实成交", value: String(item.evidenceSummary.pendingFillCount ?? "未知") }, { label: "对账问题", value: String(item.evidenceSummary.openIssueCount ?? "未知") },
    { label: "历史模型 / 策略", value: `${v2Unknown(item.modelId)} / ${v2Unknown(item.strategyId)}` }, { label: "更新时间", value: formatV2Time(item.updatedAt) },
  ]} />{error && <p className="v2-inline-note">{error}</p>}{reasons.length > 0 && <p className="v2-inline-note">提交记录中的错误原因：{reasons.join("、")}</p>}{fills.length > 0 && <details className="v2-evidence-section"><summary>查看成交凭证（最多 100 条）</summary><div className="table-scroll"><table className="v2-table"><thead><tr><th>成交编号</th><th>份额 / 价格</th><th>确认时间</th><th>入账时间</th></tr></thead><tbody>{fills.map((fill, index) => <tr key={index}><td className="mono">{text(fill.venue_trade_id ?? fill.fill_key)}</td><td>{text(fill.shares)} / {text(fill.price)}</td><td>{typeof fill.confirmed_at === "string" ? formatV2Time(fill.confirmed_at) : "未知"}</td><td>{typeof fill.applied_at === "string" ? formatV2Time(fill.applied_at) : "未知"}</td></tr>)}</tbody></table></div></details>}</>;
}

function PositionViews() {
  return <TradingSubViews parameter="position_view" choices={[{ href: "holdings", label: "当前持仓", content: <Positions /> }, { href: "redemptions", label: "赎回进度", content: <Redemptions /> }]} />;
}
function ReconciliationViews() {
  return <TradingSubViews parameter="reconciliation_view" choices={[{ href: "issues", label: "对账问题", content: <ReconciliationIssues /> }, { href: "runs", label: "运行记录", content: <ReconciliationRuns /> }]} />;
}
/** Keep the applied query and pagination separate for the two secondary lists. */
function TradingSubViews({ parameter, choices }: { parameter: string; choices: Array<{ href: string; label: string; content: React.ReactNode }> }) {
  const [stored, setStored] = useV2Filter(parameter, choices[0].href);
  const active = choices.some((choice) => choice.href === stored) ? stored : choices[0].href;
  const visited = useVisitedTabs(active);
  const select = (next: string) => {
    const state = document.getElementById(`v2-panel-${next}`)?.querySelector<HTMLElement>("[data-v2-list-state]");
    const url = new URL(window.location.href);
    const nextQuery = new URLSearchParams();
    const account = url.searchParams.get("execution_account_id");
    if (account) nextQuery.set("execution_account_id", account);
    if (state) {
      for (const [key, attribute] of [["q", "data-v2-list-query"], ["limit", "data-v2-list-limit"], ["offset", "data-v2-list-offset"]]) {
        const value = state.getAttribute(attribute); if (value) nextQuery.set(key, value);
      }
      try { for (const [key, value] of Object.entries(JSON.parse(state.getAttribute("data-v2-list-params") ?? "{}"))) if (key !== "execution_account_id" && typeof value === "string" && value) nextQuery.set(key, value); } catch { /* Metadata is optional on the first visit. */ }
    }
    nextQuery.set(parameter, next);
    window.history.pushState(window.history.state, "", `${url.pathname}?${nextQuery}`);
    setStored(next);
    // useV2Filter resets offset for filters; switching saved views restores its own page.
    window.history.replaceState(window.history.state, "", `${url.pathname}?${nextQuery}`);
    visited.select(next);
    window.requestAnimationFrame(() => window.dispatchEvent(new Event("v2-workspace-url-change")));
  };
  return <><V2Tabs tabs={choices} active={active} onSelect={select} variant="local" ariaLabel={parameter === "position_view" ? "持仓视图" : "对账视图"} />{choices.map((choice) => <V2WorkspacePanel key={choice.href} active={active} href={choice.href} visited={visited.visited.has(choice.href) || active === choice.href}>{choice.content}</V2WorkspacePanel>)}</>;
}
const apiParams = (params: Record<string, string | number | undefined>) => { const next = { ...params }; delete next.position_view; delete next.reconciliation_view; if (next.status === "ALL") delete next.status; return next; };
const loadHoldings = (params: Record<string, string | number | undefined>) => consoleV2.trading.holdings(apiParams(params));
const loadRedemptions = (params: Record<string, string | number | undefined>) => consoleV2.trading.redemptions(apiParams(params));
const loadIssues = (params: Record<string, string | number | undefined>) => consoleV2.trading.reconciliationIssues(apiParams(params));
const loadRuns = (params: Record<string, string | number | undefined>) => consoleV2.trading.reconciliationRuns(apiParams(params));

function Positions() {
  const [account] = useV2Filter("execution_account_id");
  const params = useMemo(() => ({ position_view: "holdings", execution_account_id: account || undefined }), [account]);
  return <V2ListPage<ConsoleV2Holding> title="当前持仓" load={loadHoldings} params={params} rowKey={holdingIdentity} searchPlaceholder="搜索市场、账户或历史策略" columns={[
    { label: "账户", render: (item) => v2Unknown(item.executionAccountId) },
    { label: "市场 / 结果", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{v2Unknown(item.marketQuestion, item.marketId ?? "未知市场")}</strong><small>{v2Unknown(item.outcomeName)}</small></div> },
    { label: "持有份额", render: (item) => decimal(item.remainingShares) },
    { label: "持有成本", render: (item) => decimal(item.remainingCost) },
    { label: "当前价格 / 市值", render: (item) => <div className="v2-cell-copy"><span>{item.markPrice === null ? "暂无价格" : decimal(item.markPrice)}</span><small>{decimal(item.marketValue)}</small></div> },
    { label: "浮动盈亏", render: (item) => decimal(item.unrealizedPnl) },
    { label: "状态", render: (item) => holdingLabels[item.status] ?? item.status },
  ]} renderDetail={(item) => <><V2Facts values={[{ label: "历史模型 / 策略", value: `${v2Unknown(item.modelId)} / ${v2Unknown(item.strategyId)}` }, { label: "市场来源", value: v2Unknown(item.marketSource) }, { label: "市场 / 条件", value: `${v2Unknown(item.marketId)} / ${v2Unknown(item.conditionId)}`, mono: true }, { label: "Token", value: v2Unknown(item.tokenId), mono: true }, { label: "标价时间", value: formatV2Time(item.markObservedAt) }, { label: "首次开仓", value: formatV2Time(item.firstOpenedAt) }]} /><HoldingLotDetails key={holdingIdentity(item)} item={item} /></>} />;
}

function ReconciliationIssues() {
  const [status, setStatus] = useV2Filter("status", "OPEN");
  const [account] = useV2Filter("execution_account_id");
  const params = useMemo(() => ({ reconciliation_view: "issues", status: status || "OPEN", execution_account_id: account || undefined }), [status, account]);
  return <V2ListPage<ConsoleV2ReconciliationIssue> title="对账问题" load={loadIssues} params={params} rowKey={(item) => item.issueId} searchPlaceholder="搜索订单、市场或差异原因" controls={<select className="select" aria-label="问题状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="OPEN">未解决</option><option value="RESOLVED">已解决</option><option value="ALL">全部状态</option></select>} columns={[
    { label: "最近发现", render: (item) => formatV2Time(item.observedAt) }, { label: "账户", render: (item) => v2Unknown(item.executionAccountId) },
    { label: "关联对象", className: "primary mono", render: (item) => v2Unknown(item.orderId ?? item.marketId ?? item.conditionId, "账户") },
    { label: "差异说明", render: (item) => issueLabel(item.issueType, item.reasonCode) },
    { label: "状态", render: (item) => item.status === "OPEN" ? "未解决" : item.status === "RESOLVED" ? "已解决" : item.status },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "问题编号", value: item.issueId, mono: true }, { label: "原因码", value: v2Unknown(item.reasonCode) }, { label: "本地记录", value: v2Unknown(item.localValue) }, { label: "外部记录", value: v2Unknown(item.remoteValue) }, { label: "处理方式", value: resolutionLabel(item.resolution) }, { label: "影响范围", value: v2Unknown(item.impactScope) }, { label: "首次发现", value: formatV2Time(item.firstObservedAt) }, { label: "解决时间", value: formatV2Time(item.resolvedAt) }]} />} />;
}
function issueLabel(type: string | undefined, code?: string) {
  const labels: Record<string, string> = {
    MISSED_BUY_FILL: "需核对遗漏的买入成交", MISSED_SELL_FILL: "需核对遗漏的卖出成交", LOCAL_ORDER_CANCELLED: "本地订单已取消", SUBMIT_UNCONFIRMED: "订单提交结果待确认",
    EXTERNAL_ORDER: "发现外部订单", EXTERNAL_TRADE: "发现外部成交", POSITION_SETTLED: "持仓已结算", POSITION_DRIFT: "持仓数量不一致", PHANTOM_POSITION: "本地持仓未在外部快照中找到",
    EXTERNAL_POSITION_BASELINE_DRIFT: "外部持仓基线不一致", BALANCE_DRIFT: "账户余额不一致", SOURCE_UNAVAILABLE: "对账数据源暂不可用", SOURCE_CONFLICT: "多个数据源结果不一致",
    FILL_FINALITY_STALLED: "成交链上确认停滞", UNATTRIBUTED_CASH_IN: "发现未归属的资金转入", UNATTRIBUTED_CASH_OUT: "发现未归属的资金转出", REDEMPTION_APPLY_STALLED: "赎回已确认但尚未入账",
    ORDER_RECOVERY_PENDING: "订单恢复待完成", ORDER_RECOVERY_STALLED: "订单恢复停滞",
  };
  return type && labels[type] ? labels[type] : code ?? type ?? "未提供差异原因";
}
function resolutionLabel(value: string | undefined) { return value ? ({ AUTOMATIC: "自动处理", MANUAL_REVIEW: "人工复核", OBSERVED_ONLY: "仅记录" }[value] ?? value) : "未知"; }
function ReconciliationRuns() {
  const [account] = useV2Filter("execution_account_id");
  const params = useMemo(() => ({ reconciliation_view: "runs", execution_account_id: account || undefined }), [account]);
  return <V2ListPage<ConsoleV2ReconciliationRun> title="对账运行记录" load={loadRuns} params={params} rowKey={(item) => item.runId} searchPlaceholder="搜索记录或状态" columns={[
    { label: "开始时间", render: (item) => formatV2Time(item.startedAt) }, { label: "完成时间", render: (item) => formatV2Time(item.completedAt) }, { label: "账户", render: (item) => v2Unknown(item.executionAccountId) }, { label: "状态", render: (item) => v2Status(item.status, item.status) },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "记录编号", value: item.runId, mono: true }, { label: "结果", value: v2Unknown(item.result) }, { label: "触发原因", value: v2Unknown(item.trigger) }, { label: "关联订单", value: v2Unknown(item.focusOrderId), mono: true }]} />} />;
}
function Redemptions() {
  const [status, setStatus] = useV2Filter("status");
  const [account] = useV2Filter("execution_account_id");
  const params = useMemo(() => ({ position_view: "redemptions", status: status || undefined, execution_account_id: account || undefined }), [status, account]);
  return <V2ListPage<ConsoleV2Redemption> title="赎回进度" description="包括尚未入账的赎回任务。" load={loadRedemptions} params={params} rowKey={(item) => item.redemptionId} searchPlaceholder="搜索账户、条件或交易哈希" controls={<select className="select" aria-label="赎回状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(redemptionLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>} columns={[
    { label: "账户", render: (item) => v2Unknown(item.executionAccountId) }, { label: "条件", className: "primary mono", render: (item) => v2Unknown(item.conditionId) }, { label: "状态", render: (item) => redemptionLabels[item.status] ?? item.status }, { label: "更新时间", render: (item) => formatV2Time(item.updatedAt) },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "赎回编号", value: item.redemptionId, mono: true }, { label: "交易哈希", value: v2Unknown(item.transactionHash), mono: true }, { label: "兑付原始值（最小单位）", value: decimal(item.payoutBaseUnits) }, { label: "链上确认时间", value: formatV2Time(item.confirmedAt) }, { label: "入账时间", value: formatV2Time(item.appliedAt) }]} />} />;
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
  return <details className="trading-filter-details"><summary>日期与高级筛选</summary><div className="trading-scope-fields">
    {setModel && <label><span>模型</span><input className="input" aria-label="列表模型" value={draft.model} onChange={(event) => update("model", event.target.value)} placeholder="全部模型" /></label>}
    {setStrategy && <label><span>策略</span><input className="input" aria-label="列表策略" value={draft.strategy} onChange={(event) => update("strategy", event.target.value)} placeholder="全部策略" /></label>}
    {dates && setFrom && <label><span>开始日期</span><input className="input" aria-label="列表开始日期" type="date" value={draft.from} onChange={(event) => update("from", event.target.value)} /></label>}
    {dates && setTo && <label><span>结束日期</span><input className="input" aria-label="列表结束日期" type="date" value={draft.to} onChange={(event) => update("to", event.target.value)} /></label>}
    <button type="button" className="button" onClick={reset}>重置本页筛选</button><button type="button" className="button primary" onClick={apply}>应用本页筛选</button>
  </div></details>;
}


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
