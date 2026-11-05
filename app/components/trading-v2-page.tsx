"use client";

import { useEffect, useMemo, useState } from "react";
import { consoleV2, type ConsoleV2Order, type ConsoleV2Page, type ConsoleV2PositionLot, type ConsoleV2ReconciliationIssue, type ConsoleV2ReconciliationRun, type ConsoleV2AccountSettlement, type ConsoleV2Account } from "../lib/console-v2";
import { portfolioHoldingIdentity, type ConsoleV2PortfolioHolding } from "../lib/trading-holdings";
import { formatV2Number, formatV2Time, V2Facts, V2Frame, V2ListPage, V2Tabs, V2WorkspacePanel, V2SubViews, WORKSPACE_FILTER_CHANGE_EVENT, useV2Filter, useWorkspaceTabs, v2Status, v2Unknown } from "./console-v2-resource";
import { OfficialWalletPnlPanel } from "./wallet-pnl-chart";
import { KalshiPnlPanel } from "./kalshi-pnl-chart";
import { AccountCoreMetricsPanel } from "./account-performance";
import { TradeRecordsPage } from "./trade-records-page";
import { orderedTradingAccounts, scopedTradingAccounts, tradingAccountScope } from "../lib/trading-account-scope";
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
  const [scope, setScope] = useV2Filter("account_scope");
  const effectiveScope = tradingAccountScope(scope);
  const [accounts, setAccounts] = useState<ConsoleV2Account[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [accountsError, setAccountsError] = useState<string>();
  const [accountsRetry, setAccountsRetry] = useState(0);
  useEffect(() => { let cancelled = false; void consoleV2.trading.accounts().then((result) => { if (!cancelled) { setAccounts(orderedTradingAccounts(result.data.accounts)); setAccountsLoaded(true); setAccountsError(undefined); } }).catch((error: unknown) => { if (!cancelled) { setAccounts([]); setAccountsLoaded(false); setAccountsError(error instanceof Error ? error.message : "账户目录不可用"); } }); return () => { cancelled = true; }; }, [accountsRetry]);
  const workspace = useWorkspaceTabs(tabs, `/trading/${view}`, { sharedQueryKeys: ["execution_account_id", "account_scope"] });
  const selectedAccount = accounts.find((item) => item.executionAccountId === account);
  const selectedSource = selectedAccount?.marketSource;
  const config = workspace.active === "/trading/orders" ? { title: "订单", description: "查看委托、成交与订单状态。" }
    : workspace.active === "/trading/positions" ? { title: "持仓", description: "查看当前持有资产、份额与成本。" }
    : workspace.active === "/trading/ledger" ? { title: "收益与成交账本", description: selectedSource === "KALSHI" ? "查看已入账的成交、对冲回款与到期结算。" : "查看钱包盈亏与已入账的成交、结算明细。" }
    : { title: "对账", description: "查看未解决差异及处理记录。" };
  return <V2Frame eyebrow="Trading" title={config.title} description={config.description}>
    <section className="trading-account-context" aria-label="交易账户范围"><label><span>账户</span><select className="select" aria-label="交易账户范围" value={account ? `account:${account}` : effectiveScope} onChange={event => {
      const value = event.target.value;
      setAccount(value.startsWith("account:") ? value.slice(8) : "");
      setScope(value === "all" ? "all" : "");
      window.dispatchEvent(new Event(WORKSPACE_FILTER_CHANGE_EVENT));
    }}><option value="active">全部活跃账户</option><option value="all">全部账户</option>{accounts.map(item => <option key={item.executionAccountId} value={`account:${item.executionAccountId}`} className={item.mode === "PAUSED" ? "trading-account-paused" : undefined}>{item.marketSource === "KALSHI" ? "Kalshi" : "Polymarket"} · {item.executionAccountId}{item.mode === "PAUSED" ? "（暂停）" : item.mode === "SELL_ONLY" ? "（仅卖出）" : item.mode ? "" : "（模式未提供）"}</option>)}{account && !accounts.some(item => item.executionAccountId === account) && <option value={`account:${account}`}>{account}（目录未确认）</option>}</select></label>{selectedAccount && <div className="trading-account-settings" aria-label="当前账户配置"><span>当前策略 <strong>{selectedAccount.strategyId ?? "未提供"}</strong></span><span>运行模式 <strong>{selectedAccount.mode === "ACTIVE" ? "启用" : selectedAccount.mode === "SELL_ONLY" ? "仅卖出" : selectedAccount.mode === "PAUSED" ? "暂停" : "未提供"}</strong></span>{selectedAccount.predictionModelId && <span>预测模型 <strong>{selectedAccount.predictionModelId}</strong></span>}</div>}</section>
    {accountsError && <div className="notice error"><p>账户目录不可用：{accountsError}</p><button className="button" type="button" onClick={() => setAccountsRetry((value) => value + 1)}>重试</button></div>}
    <V2Tabs tabs={tabs} active={workspace.active} onSelect={(href) => workspace.select(href as typeof workspace.active)} />
    <V2WorkspacePanel active={workspace.active} href="/trading/orders" visited={workspace.visited.has("/trading/orders")}><Orders /></V2WorkspacePanel>
    <V2WorkspacePanel active={workspace.active} href="/trading/positions" visited={workspace.visited.has("/trading/positions")}><PositionViews marketSource={selectedSource} /></V2WorkspacePanel>
    <V2WorkspacePanel active={workspace.active} href="/trading/ledger" visited={workspace.visited.has("/trading/ledger")}><AccountCoreMetricsPanel active={workspace.active === "/trading/ledger"} account={account} accountScope={effectiveScope} accountOrder={scopedTradingAccounts(accounts, effectiveScope).map(item => item.executionAccountId)} />{(!account || selectedSource === "POLYMARKET") && <OfficialWalletPnlPanel active={workspace.active === "/trading/ledger" && accountsLoaded} account={account} allowedAccounts={account ? [account] : scopedTradingAccounts(accounts, effectiveScope).map(item => item.executionAccountId)} />}{((!account && scopedTradingAccounts(accounts, effectiveScope).some(item => item.marketSource === "KALSHI")) || selectedSource === "KALSHI") && <KalshiPnlPanel active={workspace.active === "/trading/ledger" && accountsLoaded} account={account} allowedAccounts={account ? [account] : scopedTradingAccounts(accounts, effectiveScope).map(item => item.executionAccountId)} />}<TradeRecordsPage embedded sharedAccountOnly compact /></V2WorkspacePanel>
    <V2WorkspacePanel active={workspace.active} href="/trading/reconciliation" visited={workspace.visited.has("/trading/reconciliation")}><ReconciliationViews /></V2WorkspacePanel>
  </V2Frame>;
}

const orderLabels: Record<string, string> = { RECEIVED: "已接收", VALIDATING: "校验中", RESERVED: "已预留", SUBMITTING: "提交中", ACKNOWLEDGED: "交易所已接收", LIVE: "挂单中", PARTIALLY_FILLED: "部分成交", FILLED: "已成交", REJECTED: "已拒绝", UNKNOWN: "待核实", CANCEL_PENDING: "取消中", CANCELLED: "已取消", RECONCILING: "对账中", MANUAL_REVIEW: "人工复核" };
const holdingLabels: Record<string, string> = { OPEN: "持有中", SETTLED_PENDING_REDEEM: "待赎回", MIXED: "含待赎回批次" };
const redemptionLabels: Record<string, string> = { READY: "待处理", APPROVAL_SUBMITTING: "提交授权中", APPROVAL_SUBMITTED: "授权已提交", REDEEM_SUBMITTING: "提交赎回中", REDEEM_SUBMITTED: "赎回已提交", CONFIRMED: "链上已确认", APPLIED: "已入账", MANUAL_REVIEW: "人工复核" };
function decimal(value: string | number | null | undefined) { return value === null || value === undefined || value === "" ? "未知" : String(value); }
function records(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []; }
function text(value: unknown) { return value === null || value === undefined || value === "" ? "未知" : String(value); }

function Orders() {
  const [status, setStatus] = useV2Filter("status");
  const [side, setSide] = useV2Filter("side");
  const [account] = useV2Filter("execution_account_id");
  const [scope] = useV2Filter("account_scope");
  const params = useMemo(() => ({ status: status || undefined, side: side || undefined, execution_account_id: account || undefined, account_scope: account ? undefined : tradingAccountScope(scope) }), [status, side, account, scope]);
  return <V2ListPage<ConsoleV2Order> title="订单" discardedFilters={["model_id", "strategy_id", "from", "to"]} load={consoleV2.trading.orders} params={params} controls={<><select className="select" aria-label="订单状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(orderLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select className="select" aria-label="买卖方向" value={side} onChange={(event) => setSide(event.target.value)}><option value="">全部方向</option><option value="BUY">买入</option><option value="SELL">卖出</option></select></>} rowKey={(item) => item.orderId} searchPlaceholder="搜索市场、订单或账户" columns={[
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

function PositionViews({ marketSource }: { marketSource?: string }) {
  return <V2SubViews sharedQueryKeys={["execution_account_id", "account_scope"]} parameter="position_view" choices={[{ href: "holdings", label: "当前持仓", content: <Positions /> }, { href: "redemptions", label: "结算进度", content: <Redemptions marketSource={marketSource} /> }]} />;
}
function ReconciliationViews() {
  return <V2SubViews sharedQueryKeys={["execution_account_id", "account_scope"]} parameter="reconciliation_view" choices={[{ href: "issues", label: "对账问题", content: <ReconciliationIssues /> }, { href: "runs", label: "运行记录", content: <ReconciliationRuns /> }]} />;
}
const apiParams = (params: Record<string, string | number | undefined>) => { const next = { ...params }; delete next.position_view; delete next.reconciliation_view; if (next.status === "ALL") delete next.status; return next; };
const loadHoldings = (params: Record<string, string | number | undefined>) => consoleV2.trading.portfolioHoldings(apiParams(params));
const loadRedemptions = (params: Record<string, string | number | undefined>) => consoleV2.trading.settlements(apiParams(params));
const loadIssues = (params: Record<string, string | number | undefined>) => consoleV2.trading.reconciliationIssues(apiParams(params));
const loadRuns = (params: Record<string, string | number | undefined>) => consoleV2.trading.reconciliationRuns(apiParams(params));

function Positions() {
  const [account] = useV2Filter("execution_account_id");
  const [scope] = useV2Filter("account_scope");
  const params = useMemo(() => ({ position_view: "holdings", execution_account_id: account || undefined, account_scope: account ? undefined : tradingAccountScope(scope) }), [account, scope]);
  return <V2ListPage<ConsoleV2PortfolioHolding> title="当前持仓" discardedFilters={["model_id", "strategy_id", "from", "to"]} load={loadHoldings} params={params} rowKey={portfolioHoldingIdentity} searchPlaceholder="搜索市场或账户" columns={[
    { label: "账户", render: (item) => v2Unknown(item.executionAccountId) },
    { label: "市场 / 结果", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{v2Unknown(item.marketQuestion, item.marketId ?? "未知市场")}</strong><small>{v2Unknown(item.outcomeName)}</small></div> },
    { label: "持有份额", render: (item) => decimal(item.remainingShares) },
    { label: "持有成本", render: (item) => decimal(item.remainingCost) },
    { label: "状态", render: (item) => holdingLabels[item.status] ?? item.status },
  ]} renderDetail={(item) => <><V2Facts values={[{ label: "市场来源", value: v2Unknown(item.marketSource) }, { label: "市场 / 条件", value: `${v2Unknown(item.marketId)} / ${v2Unknown(item.conditionId)}`, mono: true }, { label: "Token", value: v2Unknown(item.tokenId), mono: true }, { label: "首次开仓", value: formatV2Time(item.firstOpenedAt) }]} /><HoldingLotDetails key={portfolioHoldingIdentity(item)} item={item} /></>} />;
}

function ReconciliationIssues() {
  const [status, setStatus] = useV2Filter("status", "OPEN");
  const [account] = useV2Filter("execution_account_id");
  const [scope] = useV2Filter("account_scope");
  const params = useMemo(() => ({ reconciliation_view: "issues", status: status || "OPEN", execution_account_id: account || undefined, account_scope: account ? undefined : tradingAccountScope(scope) }), [status, account, scope]);
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
    KALSHI_BALANCE_DRIFT: "Kalshi 账户余额差异", KALSHI_SETTLEMENT_REVIEW: "Kalshi 到期结算待复核",
    ORDER_RECOVERY_PENDING: "订单恢复待完成", ORDER_RECOVERY_STALLED: "订单恢复停滞",
  };
  return type && labels[type] ? labels[type] : code ?? type ?? "未提供差异原因";
}
function resolutionLabel(value: string | undefined) { return value ? ({ AUTOMATIC: "自动处理", MANUAL_REVIEW: "人工复核", OBSERVED_ONLY: "仅记录" }[value] ?? value) : "未知"; }
function ReconciliationRuns() {
  const [account] = useV2Filter("execution_account_id");
  const [scope] = useV2Filter("account_scope");
  const params = useMemo(() => ({ reconciliation_view: "runs", execution_account_id: account || undefined, account_scope: account ? undefined : tradingAccountScope(scope) }), [account, scope]);
  return <V2ListPage<ConsoleV2ReconciliationRun> title="对账运行记录" load={loadRuns} params={params} rowKey={(item) => item.runId} searchPlaceholder="搜索记录或状态" columns={[
    { label: "开始时间", render: (item) => formatV2Time(item.startedAt) }, { label: "完成时间", render: (item) => formatV2Time(item.completedAt) }, { label: "账户", render: (item) => v2Unknown(item.executionAccountId) }, { label: "状态", render: (item) => v2Status(item.status, item.status) },
  ]} />;
}
function Redemptions({ marketSource }: { marketSource?: string }) {
  const [status, setStatus] = useV2Filter("status");
  const [account] = useV2Filter("execution_account_id");
  const [scope] = useV2Filter("account_scope");
  const validLabels = marketSource === "KALSHI" ? { APPLIED: "已入账", MANUAL_REVIEW: "人工复核" } : redemptionLabels;
  const effectiveStatus = status && validLabels[status] ? status : "";
  const params = useMemo(() => ({ position_view: "redemptions", status: effectiveStatus || undefined, execution_account_id: account || undefined, account_scope: account ? undefined : tradingAccountScope(scope) }), [effectiveStatus, account, scope]);
  return <V2ListPage<ConsoleV2AccountSettlement> title="结算进度" description="Polymarket 显示链上赎回流程；Kalshi 显示到期结算入账或人工复核。" load={loadRedemptions} params={params} rowKey={(item) => `${item.marketSource}:${item.settlementId}`} searchPlaceholder="搜索账户、市场或条件" controls={<select className="select" aria-label="结算状态" value={effectiveStatus} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(validLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>} columns={[
    { label: "平台 / 账户", render: (item) => <div className="v2-cell-copy"><strong>{item.marketSource}</strong><small>{item.executionAccountId}</small></div> }, { label: "市场 / 条件", className: "primary mono", render: (item) => item.marketId || item.conditionId || "—" }, { label: "状态", render: (item) => redemptionLabels[item.status] ?? item.status }, { label: "更新时间", render: (item) => formatV2Time(item.updatedAt) },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "结算编号", value: item.settlementId, mono: true }, { label: "兑付金额", value: item.payout ?? "—" }, ...(item.marketSource === "POLYMARKET" ? [{ label: "交易哈希", value: item.transactionHash ?? "—", mono: true }, { label: "链上确认时间", value: formatV2Time(item.confirmedAt) }] : [{ label: "交易所结算时间", value: formatV2Time(item.settledAt) }]), { label: "入账时间", value: formatV2Time(item.appliedAt) }]} />} />;
}


function HoldingLotDetails({ item }: { item: ConsoleV2PortfolioHolding }) {
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
      void consoleV2.trading.portfolioHoldingLots(item, { limit: pageSize, offset: page * pageSize }).then((response) => { if (!cancelled) setResult(response.data); }).catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Lot 明细暂不可用"); }).finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [item, page]);
  const totalPages = result ? Math.ceil(result.total / result.limit) : 0;
  return <section className="v2-evidence-section holding-lot-details"><h4 className="v2-evidence-title">开仓批次明细</h4>{loading && !result ? <p className="v2-inline-note">正在读取 {formatV2Number(item.lotCount, 0)} 个 Lot…</p> : error ? <p className="v2-inline-note">{error}</p> : result && !result.items.length ? <p className="v2-inline-note">当前持仓身份没有返回 Lot 明细。</p> : result ? <><div className="table-scroll v2-evidence-table"><table className="v2-table"><thead><tr><th>Lot ID</th><th>开仓时模型 / 策略</th><th>状态</th><th>剩余份额 / 成本</th><th>开仓 / 关闭</th></tr></thead><tbody>{result.items.map((lot) => <tr key={lot.lotId}><td className="mono">{lot.lotId}</td><td><div className="v2-cell-copy"><strong>{v2Unknown(lot.modelId)}</strong><small>{v2Unknown(lot.strategyId)}</small></div></td><td>{holdingLabels[lot.status] ?? lot.status}</td><td>{decimal(lot.remainingShares)} / {decimal(lot.remainingCost)}</td><td>{formatV2Time(lot.openedAt)} / {formatV2Time(lot.closedAt)}</td></tr>)}</tbody></table></div><div className="v2-inline-note">第 {page + 1} / {totalPages} 页 <button type="button" className="button" disabled={page === 0 || loading} onClick={() => setPage((value) => Math.max(0, value - 1))}>上一页</button><button type="button" className="button" disabled={page + 1 >= totalPages || loading} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>下一页</button></div></> : <p className="v2-inline-note">当前汇总包含 {formatV2Number(item.lotCount, 0)} 个 Lot；未返回明细。</p>}</section>;
}
