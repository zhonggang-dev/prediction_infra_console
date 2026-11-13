"use client";

import { RefreshCw } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { accountCohortMetrics, cohortOpeningRangeError, type AccountCohortMetrics as AccountCoreMetrics, type AccountCohortMetricsResponse as AccountCoreMetricsResponse, type AccountCohortQuery, type UnavailableCohortAccount, type CorePriceSource, type CorePriceReason, type CohortDrawdownReason, type SharpeReason } from "../lib/trading-core-metrics";
import { formatV2Time, useV2Filter } from "./console-v2-resource";
import { LocalHourInput } from "./wallet-pnl-chart";
import { validateWalletPnlRange, walletPnlLocalHour, walletPnlHourCandidates, formatWalletPnlOffset } from "../lib/wallet-pnl";
import { formatCoreRatio, formatCoreMoney as money, formatCorePercent as percent, coreMetricTone as tone } from "../lib/core-metric-display";
import "./account-performance.css";

const sourceLabels: Record<CorePriceSource, string> = { PM_CURRENT_PRICE: "Polymarket 官方现价", PM_CLOB_MID: "Polymarket 盘口中间价（参考）", KALSHI_BOOK_MID: "Kalshi 盘口中间价（参考）", KALSHI_LAST_TRADE: "Kalshi 官方最近成交价", OFFICIAL_SETTLEMENT: "官方确认结算价", HISTORY_HOURLY: "小时历史价格" };
const reasonLabels: Record<CorePriceReason, string> = { missing_price: "未返回价格", one_sided: "缺少有效双边盘口", invalid_price: "价格无效", identity_mismatch: "资产身份不一致", stale: "报价已过期", timeout: "取价超时", source_unavailable: "价格来源暂不可用", unconfirmed_settlement: "结算结果尚未最终确认", history_missing: "缺少历史价格", history_not_synced: "历史价格待同步" };
const drawdownLabels: Record<CohortDrawdownReason, string> = { not_synced: "待同步", syncing: "同步中", missing_prices: "历史价格缺口", stale_endpoint: "区间末估值不足", budget_exceeded: "范围暂未计算" };
function drawdownStatus(item: AccountCoreMetrics): string {
  return item.drawdownState === "available" ? "已计算" : item.drawdownCoverage?.reason ? drawdownLabels[item.drawdownCoverage.reason] : "历史回撤尚未计算";
}
const sharpeReasons: Record<SharpeReason, string> = { not_synced: "历史数据待同步", missing_prices: "历史价格缺口", budget_exceeded: "范围暂未计算", insufficient_samples: "有效天数不足", zero_variance: "日收益波动为0", nonpositive_nav: "净值不足，无法计算" };
function sharpeDetail(item: AccountCoreMetrics): string | undefined {
  const coverage = item.sharpAnnualCoverage;
  if (!coverage) return "暂未计算";
  return coverage.reason ? sharpeReasons[coverage.reason] : undefined;
}
function stats(item: AccountCoreMetrics) {
  const drawdown = item.maxDrawdown === null ? null : Number(item.maxDrawdown) > 0 ? `-${item.maxDrawdown}` : "0";
  return [
    { label: "区间开仓资产数", value: String(item.openedAssetCount), detail: `持仓 ${item.holdingAssetCount} ＋ 已平仓 ${item.closedAssetCount}` },
    { label: "区间末持仓估值", value: money(item.marketValue) },
    { label: "最高同时持仓本金", value: money(item.peakHoldingCost) },
    { label: "累计投入本金", value: money(item.cumulativeInvestedCost) },
    { label: "已实现盈亏", value: money(item.realizedPnl, true), tone: tone(item.realizedPnl) },
    { label: "区间末浮动盈亏", value: money(item.unrealizedPnl, true), tone: tone(item.unrealizedPnl) },
    { label: "总盈亏", value: money(item.totalPnl, true), tone: tone(item.totalPnl) },
    { label: "ROI（累计本金）", value: percent(item.roi), tone: tone(item.roi, "percent") },
    { label: "Return（峰值本金）", value: percent(item.returnRate), tone: tone(item.returnRate, "percent") },
    { label: "最大回撤", value: money(drawdown), tone: tone(drawdown), detail: item.drawdownState === "history_unavailable" ? drawdownStatus(item) : undefined },
    { label: "年化夏普", value: formatCoreRatio(item.sharpAnnual ?? null), tone: tone(item.sharpAnnual ?? null), detail: sharpeDetail(item) },
    { label: "买入手续费", value: money(item.buyFees) },
    { label: "卖出手续费", value: money(item.sellFees) },
  ];
}
const LABELS = ["区间开仓资产数", "区间末持仓估值", "最高同时持仓本金", "累计投入本金", "已实现盈亏", "区间末浮动盈亏", "总盈亏", "ROI（累计本金）", "Return（峰值本金）", "最大回撤", "年化夏普", "买入手续费", "卖出手续费"];

export function AccountCoreMetricsPanel({ active, account, accountOrder = [], accountScope = "active" }: { active: boolean; account: string; accountOrder?: string[]; accountScope?: "active" | "all" }) {
  const [state, setState] = useState<{ key: string; data?: AccountCoreMetricsResponse; error?: string }>({ key: "" });
  const [retry, setRetry] = useState(0);
  const [openingFrom] = useV2Filter("opening_from"), [openingTo] = useV2Filter("opening_to");
  const identity = `${account}:${accountScope}:${openingFrom}/${openingTo}`;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void accountCohortMetrics({ ...(account ? { execution_account_id: account } : { account_scope: accountScope }), ...(openingFrom ? { opening_from: openingFrom } : {}), ...(openingTo ? { opening_to: openingTo } : {}) }, controller.signal).then(data => { if (!controller.signal.aborted) setState({ key: identity, data }); }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState(previous => ({ key: identity, ...(previous.key === identity && previous.data ? { data: previous.data } : {}), error: error instanceof Error ? error.message : "账户核心指标暂时不可用。" }));
    });
    return () => controller.abort();
  }, [active, account, accountScope, openingFrom, openingTo, retry, identity]);
  const current = state.key === identity ? state : undefined;
  const needsHistoryRefresh = current?.data?.items.some(item => item.drawdownCoverage?.lastComplete || item.sharpAnnualCoverage?.lastComplete || item.drawdownCoverage?.reason === "not_synced" || item.sharpAnnualCoverage?.reason === "not_synced") ?? false;
  useEffect(() => {
    if (!active || !needsHistoryRefresh) return;
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = document.visibilityState === "visible" ? window.setTimeout(() => {
        if (document.visibilityState === "visible") setRetry(value => value + 1);
      }, 60_000) : undefined;
    };
    const visibilityChanged = () => {
      schedule();
      if (document.visibilityState === "visible") setRetry(value => value + 1);
    };
    schedule();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => { if (timer !== undefined) window.clearTimeout(timer); document.removeEventListener("visibilitychange", visibilityChanged); };
  }, [active, needsHistoryRefresh, retry]);
  const rows = current?.data ? [
    ...current.data.items.map(item => ({ kind: "available" as const, executionAccountId: item.executionAccountId, item })),
    ...current.data.unavailableAccounts.map(item => ({ kind: "unavailable" as const, executionAccountId: item.executionAccountId, item })),
  ].toSorted((a, b) => {
    const ai = accountOrder.indexOf(a.executionAccountId), bi = accountOrder.indexOf(b.executionAccountId);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi) || a.executionAccountId.localeCompare(b.executionAccountId);
  }) : undefined;
  return <section className="section trading-core-metrics" data-v2-extra-query={JSON.stringify({ opening_from: openingFrom, opening_to: openingTo })} aria-label="账户核心指标" aria-busy={active && !current?.data && !current?.error}>
    <div className="section-head"><h2 className="section-title">账户核心指标</h2><div className="trading-block-actions">{current?.data && <span className="section-caption">账本观测 {formatV2Time(current.data.observedAt)}</span>}<button type="button" className="button trading-block-refresh" aria-label="刷新账户核心指标" disabled={active && !current?.data && !current?.error} onClick={() => setRetry(value => value + 1)}><RefreshCw size={14} aria-hidden="true" />刷新</button></div></div>
    <p className="section-caption trading-core-basis">系统纳管口径 · 追踪所选时间内开的仓位，截至区间结束时的表现；剩余持仓按区间末价格计算。最大回撤按小时采样，含浮动盈亏，未扣手续费。</p>
    <OpeningRangeForm key={`${openingFrom}/${openingTo}`} from={openingFrom} to={openingTo} />
    {current?.error && <div className="notice error" role="alert"><p>{current.error}</p><button type="button" className="button" onClick={() => setRetry(v => v + 1)}>重试</button></div>}
    {!rows ? !current?.error && <p className="trading-core-state">正在读取账户核心指标…</p>
        : !rows.length ? <p className="trading-core-state">暂无受管账户。</p>
          : account ? rows[0].kind === "available" ? <SingleAccount key={rows[0].executionAccountId} item={rows[0].item} /> : <UnavailableSingleAccount item={rows[0].item} />
            : <LocalScroll label="全部账户核心指标表格"><table className="trading-core-table"><thead><tr><th scope="col">账户 / 平台</th>{LABELS.map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row => row.kind === "available" ? <AccountTableRow key={row.executionAccountId} item={row.item} /> : <UnavailableAccountRow key={row.executionAccountId} item={row.item} />)}</tbody></table></LocalScroll>}
    <details className="trading-core-explanation"><summary>指标口径</summary><ol>
      <li><strong>区间开仓资产数</strong><p>按开仓时间选择批次，同一种结果资产合并计数。区间开仓资产数 ＝ 区间末持仓 ＋ 已平仓；部分平仓仍算持仓，包含待赎回资产。区间外买入的份额不计入。</p></li>
      <li><strong>区间末持仓估值</strong><p>入选批次区间末的剩余数量 × 区间末价格，再求和。已确认结算价优先；Polymarket 其次用官方现价、有效盘口中间价；Kalshi 其次用官方最近成交价、有效盘口中间价。</p></li>
      <li><strong>最高同时持仓本金</strong><p>入选批次从开仓至区间末，同时尚未收回的买入本金最高值；不含手续费、空闲余额或未成交挂单。</p></li>
      <li><strong>累计投入本金</strong><p>入选批次的买入、接管和导入本金累计。重复买入会重复累计，不是充值额。</p></li>
      <li><strong>已实现盈亏</strong><p>入选批次已平部分的毛回款 − 对应买入本金。区间结束后发生的卖出、赎回、Kalshi 净对冲和到期结算，不计入。</p></li>
      <li><strong>区间末浮动盈亏</strong><p>区间末持仓估值 − 入选批次的剩余买入本金。</p></li>
      <li><strong>总盈亏</strong><p>已实现盈亏 ＋ 区间末浮动盈亏。</p></li>
      <li><strong>ROI 与 Return</strong><p>ROI ＝ 总盈亏 ÷ 累计投入本金；Return ＝ 总盈亏 ÷ 最高同时持仓本金。两者都未扣手续费，分母为零时显示“—”。</p></li>
      <li><strong>最大回撤</strong><p>这批仓位从开仓至区间末，总盈亏从历史高点到后续低点的最大下降金额。按小时采样，含浮动盈亏，未扣手续费；小时内的短暂峰谷可能未被记录。历史数据暂缺时保留同账户、同开仓范围的最近完整结果；没有完整结果时显示“—”及具体原因。</p></li>
      <li><strong>年化夏普</strong><p>日收益率均值 ÷ 日收益率样本标准差 × √365，无风险利率按0计算。使用所选开仓批次的资金调整后净值收益率，含浮动盈亏、未扣手续费；加减仓时分段计算并合并为每日收益。只统计完整北京时间自然日（00:00 至次日 00:00），未纳管现金不参与；无资金占用的整日不填0。历史数据暂缺时保留同账户、同开仓范围的最近完整结果；至少需要2个有效日，净值不足或标准差为0时显示“—”。</p></li>
      <li><strong>买入手续费与卖出手续费</strong><p>只列实际记录并归属入选批次的费用，其余指标全部不含手续费。Kalshi 反向买入产生的净对冲费用仍计入买入手续费；到期结算不生成卖出手续费。接管前未记录的费用不补算。</p></li>
    </ol></details>
  </section>;
}
const missingDispositionMessage = "历史仓位缺少平仓流水，暂时无法核算。可调整开仓范围后重试。";
function UnavailableAccountRow({ item }: { item: UnavailableCohortAccount }) {
  return <tr data-core-metrics-account={item.executionAccountId} className="trading-core-unavailable"><th scope="row"><span>{item.executionAccountId}</span><small>{item.marketSource === "KALSHI" ? "Kalshi" : "Polymarket"}</small></th><td colSpan={LABELS.length}><p>{missingDispositionMessage}</p></td></tr>;
}
function UnavailableSingleAccount({ item }: { item: UnavailableCohortAccount }) {
  return <div className="notice trading-core-unavailable" role="status" data-core-metrics-account={item.executionAccountId}><p>{missingDispositionMessage}</p></div>;
}
function AccountTableRow({ item }: { item: AccountCoreMetrics }) {
  const [open, setOpen] = useState(false); const id = useId();
  return <Fragment><tr data-core-metrics-account={item.executionAccountId}><th scope="row"><button type="button" className="trading-core-coverage" aria-label={`${item.executionAccountId} 取价明细`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}>{item.executionAccountId}</button><small>{item.marketSource === "KALSHI" ? "Kalshi" : "Polymarket"}</small></th>{stats(item).map(stat => <td key={stat.label} data-core-metric={stat.label} className={stat.tone}>{stat.value}{stat.detail && <small>{stat.detail}</small>}</td>)}</tr>{open && <tr className="trading-core-detail-row"><td colSpan={LABELS.length + 1}><div id={id}><AssetDetails item={item} /></div></td></tr>}</Fragment>;
}
function SingleAccount({ item }: { item: AccountCoreMetrics }) {
  const [open, setOpen] = useState(false); const id = useId();
  return <article data-core-metrics-account={item.executionAccountId} className="trading-core-single" aria-label={`${item.executionAccountId} 账户核心指标`}>
    <LocalScroll label="单账户核心指标横条"><dl className="trading-core-strip">{stats(item).map(stat => <div key={stat.label} data-core-metric={stat.label}><dt>{stat.label}</dt><dd className={stat.tone}>{stat.value}</dd>{stat.detail && <small>{stat.detail}</small>}</div>)}</dl></LocalScroll>
    <div className="trading-core-single-status"><button type="button" className="trading-core-coverage" aria-label={`${item.executionAccountId} 取价明细`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}>取价明细</button>{item.quoteObservedFrom && <span>报价观测 {formatV2Time(item.quoteObservedFrom ?? undefined)}{item.quoteObservedTo !== item.quoteObservedFrom && <> 至 {formatV2Time(item.quoteObservedTo ?? undefined)}</>}</span>}</div>
    {open && <div id={id}><AssetDetails item={item} /></div>}
  </article>;
}
function AssetDetails({ item }: { item: AccountCoreMetrics }) {
  return <section className="trading-core-assets" aria-label={`${item.executionAccountId} 资产取价明细`}><DrawdownCoverageDetails item={item} /><p>账本 {formatV2Time(item.ledgerObservedAt)} · 已定价 {item.pricedAssetCount}/{item.assetCount}。份额与成本来自本地账本；缺少任一资产价格时，账户估值、浮盈亏、总盈亏及收益率保留未知。</p>{item.valuationAssets.length === 0 ? <p>当前没有纳管持仓。</p> : <div className="trading-core-scroll"><table><thead><tr><th>市场 / 结果</th><th>本地份额 / 成本</th><th>价格 / 估值</th><th>来源 / 状态</th><th>观测时间</th></tr></thead><tbody>{item.valuationAssets.map(asset => <tr key={JSON.stringify([asset.marketSource, asset.marketId, asset.conditionId, asset.tokenId, asset.outcomeIndex, asset.outcomeName])} data-core-asset={asset.tokenId}>
      <td><strong>{asset.marketQuestion || asset.marketId || asset.conditionId}</strong><small>{asset.outcomeName ?? (asset.outcomeIndex === null ? "结果未提供" : String(asset.outcomeIndex))}</small></td><td><span>{asset.remainingShares}</span><small>{money(asset.remainingCost)}</small></td><td><span>{asset.price === null ? "—" : asset.price}</span><small>{money(asset.marketValue)}</small></td><td>{asset.priceSource ? sourceLabels[asset.priceSource] : asset.reason ? reasonLabels[asset.reason] : "—"}</td><td>{formatV2Time(asset.observedAt ?? undefined)}{asset.sourceAt && <small>来源时间 {formatV2Time(asset.sourceAt ?? undefined)}</small>}</td>
    </tr>)}</tbody></table></div>}</section>;
}

function DrawdownCoverageDetails({ item }: { item: AccountCoreMetrics }) {
  const coverage = item.drawdownCoverage;
  if (!coverage) return null;
  return <section aria-label={`${item.executionAccountId} 历史回撤覆盖`}><h3>历史回撤覆盖</h3><dl className="trading-core-drawdown-coverage">
    <div><dt>计算状态</dt><dd>{drawdownStatus(item)}</dd></div>
    <div><dt>采样口径</dt><dd>按小时采样，含浮动盈亏，未扣手续费</dd></div>
    {coverage.from !== null && <div><dt>覆盖开始</dt><dd>{formatV2Time(coverage.from)}</dd></div>}
    {coverage.to !== null && <div><dt>覆盖结束</dt><dd>{formatV2Time(coverage.to)}</dd></div>}
    {coverage.missingAssetCount !== null && <div><dt>缺口资产数</dt><dd>{coverage.missingAssetCount} 项</dd></div>}
    {coverage.missingPointCount !== null && <div><dt>缺口采样点</dt><dd>{coverage.missingPointCount} 个</dd></div>}
    {coverage.computedAt !== null && <div><dt>最近计算</dt><dd>{formatV2Time(coverage.computedAt)}</dd></div>}
  </dl></section>;
}

function LocalScroll({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null); const id = useId(); const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const element = ref.current; if (!element) return;
    const observer = new ResizeObserver(() => setOverflow(element.scrollWidth > element.clientWidth + 1));
    observer.observe(element); if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);
  return <div className="trading-core-scroll-wrap">{overflow && <div className="trading-core-scroll-actions"><button type="button" aria-label={`${label}向左查看`} aria-controls={id} onClick={() => ref.current?.scrollBy({ left: -320, behavior: "smooth" })}>←</button><button type="button" aria-label={`${label}向右查看`} aria-controls={id} onClick={() => ref.current?.scrollBy({ left: 320, behavior: "smooth" })}>→</button></div>}<div id={id} ref={ref} className="trading-core-scroll" role="region" aria-label={label}>{children}</div></div>;
}


function OpeningRangeForm({ from, to }: { from: string; to: string }) {
  const initialLocal = (value: string) => {
    if (!value || !Number.isFinite(Date.parse(value))) return "";
    const date = new Date(value);
    const minutes = String(date.getMinutes()).padStart(2, "0"), seconds = String(date.getSeconds()).padStart(2, "0");
    return `${walletPnlLocalHour(date.getTime()).slice(0, 14)}${minutes}${date.getSeconds() || date.getMilliseconds() ? `:${seconds}${date.getMilliseconds() ? `.${String(date.getMilliseconds()).padStart(3, "0")}` : ""}` : ""}`;
  };
  const [custom, setCustom] = useState(Boolean(from || to));
  const [start, setStart] = useState(""), [end, setEnd] = useState("");
  const [localReady, setLocalReady] = useState(false);
  const [invalidAppliedRange, setInvalidAppliedRange] = useState(false);
  const [startInstant, setStartInstant] = useState(from ? String(Date.parse(from)) : ""), [endInstant, setEndInstant] = useState(to ? String(Date.parse(to)) : "");
  const [error, setError] = useState<string>();
  const [max, setMax] = useState("");
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => { setStart(from && Number.isFinite(Date.parse(from)) ? walletPnlLocalHour(Date.parse(from)) : ""); setEnd(to && Number.isFinite(Date.parse(to)) ? walletPnlLocalHour(Date.parse(to)) : ""); setMax(walletPnlLocalHour()); setInvalidAppliedRange(Boolean(cohortOpeningRangeError({ opening_from: from || undefined, opening_to: to || undefined }))); setLocalReady(true); });
    return () => window.cancelAnimationFrame(frame);
  }, [from, to]);
  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    let range: Pick<AccountCohortQuery, "opening_from" | "opening_to"> = {};
    if (custom) {
      const result = validateWalletPnlRange(start, end, Date.now(), { startMs: startInstant ? Number(startInstant) : undefined, endMs: endInstant ? Number(endInstant) : undefined });
      if (!result.range) { setError(result.error); return; }
      range = { opening_from: new Date(result.range.startMs).toISOString(), opening_to: new Date(result.range.endMs).toISOString() };
    }
    const url = new URL(window.location.href);
    for (const key of ["opening_from", "opening_to"] as const) { if (range[key]) url.searchParams.set(key, range[key]); else url.searchParams.delete(key); }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new Event("v2-workspace-url-change"));
    setError(undefined);
  };
  return <><form className="trading-core-range" onSubmit={apply} aria-label="核心指标开仓时间范围" noValidate>
    <label><span>开仓时间</span><select className="select" aria-label="核心指标开仓范围" value={custom ? "custom" : "all"} onChange={event => { setCustom(event.target.value === "custom"); setError(undefined); setMax(walletPnlLocalHour()); }}><option value="all">全部开仓</option><option value="custom">自定义区间</option></select></label>
    {custom && <><LocalHourInput label="开始" ariaPrefix="开仓区间" value={start} max={max} onChange={value => { setStart(value); setStartInstant(""); setError(undefined); }} />
      {walletPnlHourCandidates(start).length > 1 && <label>开始时区偏移<select className="select" aria-label="开仓开始小时偏移" value={startInstant} onChange={event => setStartInstant(event.target.value)}><option value="">请选择重复小时</option>{walletPnlHourCandidates(start).map(time => <option key={time} value={time}>{formatWalletPnlOffset(time)}</option>)}</select></label>}
      <LocalHourInput label="结束" ariaPrefix="开仓区间" value={end} max={max} onChange={value => { setEnd(value); setEndInstant(""); setError(undefined); }} />
      {walletPnlHourCandidates(end).length > 1 && <label>结束时区偏移<select className="select" aria-label="开仓结束小时偏移" value={endInstant} onChange={event => setEndInstant(event.target.value)}><option value="">请选择重复小时</option>{walletPnlHourCandidates(end).map(time => <option key={time} value={time}>{formatWalletPnlOffset(time)}</option>)}</select></label>}</>}
    <button type="submit" className="button primary">应用开仓范围</button>{error && <p role="alert">{error}</p>}
  </form><p className="section-caption trading-core-range-applied">{from && to ? !localReady ? "正在读取已应用的开仓区间…" : `${invalidAppliedRange ? "链接范围尚未应用，请改选本地整点：" : "已应用："}${initialLocal(from).replace("T", " ")} 至 ${initialLocal(to).replace("T", " ")} 前开仓（本地时间）` : "已应用：全部历史开仓"} · 与下方官方钱包曲线、成交明细的日期分别筛选。</p></>;
}
