"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { accountCoreMetrics, type AccountCoreMetrics, type AccountCoreMetricsResponse, type CorePriceSource, type CorePriceReason } from "../lib/trading-core-metrics";
import { formatV2Time } from "./console-v2-resource";
import "./account-performance.css";

const sourceLabels: Record<CorePriceSource, string> = { PM_CURRENT_PRICE: "Polymarket 官方现价", PM_CLOB_MID: "Polymarket 盘口中间价（参考）", KALSHI_BOOK_MID: "Kalshi 盘口中间价（参考）", OFFICIAL_SETTLEMENT: "官方确认结算价" };
const reasonLabels: Record<CorePriceReason, string> = { missing_price: "未返回价格", one_sided: "缺少有效双边盘口", invalid_price: "价格无效", identity_mismatch: "资产身份不一致", stale: "报价已过期", timeout: "取价超时", source_unavailable: "价格来源暂不可用", unconfirmed_settlement: "结算结果尚未最终确认" };
const money = (value: string | null) => value === null ? "—" : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
const tone = (value: string | null) => value === null ? "" : Number(value) > 0 ? "positive" : Number(value) < 0 ? "negative" : "";
function stats(item: AccountCoreMetrics) {
  return [
    { label: "纳管资产数", value: String(item.assetCount) },
    { label: "当前持仓估值", value: money(item.marketValue) },
    { label: "历史最高持仓成本", value: money(item.peakHoldingCost) },
    { label: "累计投入成本", value: money(item.cumulativeInvestedCost) },
    { label: "累计已实现盈亏", value: money(item.realizedPnl), tone: tone(item.realizedPnl) },
    { label: "当前浮动盈亏", value: money(item.unrealizedPnl), tone: tone(item.unrealizedPnl) },
    { label: "总盈亏", value: money(item.totalPnl), tone: tone(item.totalPnl) },
    { label: "成本收益率", value: item.returnRate === null ? "—" : `${(Number(item.returnRate) * 100).toFixed(2)}%`, tone: tone(item.returnRate) },
    { label: "近14日已实现盈亏回撤", value: money(item.realizedDrawdown14d) },
  ];
}
const LABELS = ["纳管资产数", "当前持仓估值", "历史最高持仓成本", "累计投入成本", "累计已实现盈亏", "当前浮动盈亏", "总盈亏", "成本收益率", "近14日已实现盈亏回撤"];

export function AccountCoreMetricsPanel({ active, account, accountOrder = [] }: { active: boolean; account: string; accountOrder?: string[] }) {
  const [state, setState] = useState<{ key: string; data?: AccountCoreMetricsResponse; error?: string }>({ key: "" });
  const [retry, setRetry] = useState(0);
  const identity = `${account}:${retry}`;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void accountCoreMetrics(account, controller.signal).then(data => { if (!controller.signal.aborted) setState({ key: identity, data }); }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ key: identity, error: error instanceof Error ? error.message : "账户核心指标暂时不可用。" });
    });
    return () => controller.abort();
  }, [active, account, retry, identity]);
  const current = state.key === identity ? state : undefined;
  const items = current?.data?.items.toSorted((a, b) => {
    const ai = accountOrder.indexOf(a.executionAccountId), bi = accountOrder.indexOf(b.executionAccountId);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi) || a.executionAccountId.localeCompare(b.executionAccountId);
  });
  return <section className="section trading-core-metrics" aria-label="账户核心指标" aria-busy={active && !current?.data && !current?.error}>
    <div className="section-head"><h2 className="section-title">账户核心指标</h2>{current?.data && <span className="section-caption">账本观测 {formatV2Time(current.data.observedAt)}</span>}</div>
    <p className="section-caption trading-core-basis">系统纳管口径 · 金额 USD · 累计指标及近14日回撤独立于下方官方曲线日期。</p>
    {current?.error ? <div className="notice error" role="alert"><p>{current.error}</p><button type="button" className="button" onClick={() => setRetry(v => v + 1)}>重试</button></div>
      : !items ? <p className="trading-core-state">正在读取账户核心指标…</p>
        : !items.length ? <p className="trading-core-state">暂无受管账户。</p>
          : account ? <SingleAccount key={items[0].executionAccountId} item={items[0]} />
            : <LocalScroll label="全部账户核心指标表格"><table className="trading-core-table"><thead><tr><th scope="col">账户 / 平台</th>{LABELS.map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{items.map(item => <AccountTableRow key={item.executionAccountId} item={item} />)}</tbody></table></LocalScroll>}
    <details className="trading-core-explanation"><summary>指标口径</summary><ol>
      <li><strong>纳管资产数</strong><p>按本地当前持仓统计，同一种结果资产的多次买入合并为一项，包含待赎回资产。</p></li>
      <li><strong>当前持仓估值</strong><p>各项本地持仓数量 × 对应价格，再求和。</p><p>已确认结算的资产优先使用官方结算价。Polymarket 未结算资产优先用官方现价，缺失才用有效盘口中间价；Kalshi 使用对应 Yes／No 的有效双边盘口中间价，属于参考估值。</p></li>
      <li><strong>历史最高持仓成本</strong><p>从本地账本重放，取历史上同时持有资产成本的最高值，包含已入账的买入手续费。</p></li>
      <li><strong>累计投入成本</strong><p>累计买入、接管和导入资产时增加的成本。资金重复买入会重复累计，不是充值额。</p></li>
      <li><strong>累计已实现盈亏</strong><p>本地已入账的卖出、赎回、Kalshi 净对冲和到期结算收益，手续费只计入一次。</p></li>
      <li><strong>当前浮动盈亏</strong><p>当前持仓估值 − 当前剩余持仓成本。不预扣未来卖出费用。</p></li>
      <li><strong>总盈亏</strong><p>累计已实现盈亏 ＋ 当前浮动盈亏，表示系统纳管范围的累计表现。</p></li>
      <li><strong>成本收益率</strong><p>总盈亏 ÷ 历史最高持仓成本 × 100%。不是官方 ROI，分母为零时显示“—”。</p></li>
      <li><strong>近14日已实现盈亏回撤</strong><p>按包含今天的14个 UTC 自然日，累计本地已实现盈亏，取从高点最大回落的美元金额。包含 Kalshi 净对冲和到期结算，不含浮盈亏及日内波动。</p></li>
    </ol></details>
  </section>;
}
function AccountTableRow({ item }: { item: AccountCoreMetrics }) {
  const [open, setOpen] = useState(false); const id = useId();
  return <Fragment><tr data-core-metrics-account={item.executionAccountId}><th scope="row"><button type="button" className="trading-core-coverage" aria-label={`${item.executionAccountId} 取价明细`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}>{item.executionAccountId}</button><small>{item.marketSource === "KALSHI" ? "Kalshi" : "Polymarket"}</small></th>{stats(item).map(stat => <td key={stat.label} data-core-metric={stat.label} className={stat.tone}>{stat.value}</td>)}</tr>{open && <tr className="trading-core-detail-row"><td colSpan={10}><div id={id}><AssetDetails item={item} /></div></td></tr>}</Fragment>;
}
function SingleAccount({ item }: { item: AccountCoreMetrics }) {
  const [open, setOpen] = useState(false); const id = useId();
  return <article data-core-metrics-account={item.executionAccountId} className="trading-core-single" aria-label={`${item.executionAccountId} 账户核心指标`}>
    <LocalScroll label="单账户核心指标横条"><dl className="trading-core-strip">{stats(item).map(stat => <div key={stat.label} data-core-metric={stat.label}><dt>{stat.label}</dt><dd className={stat.tone}>{stat.value}</dd></div>)}</dl></LocalScroll>
    <div className="trading-core-single-status"><button type="button" className="trading-core-coverage" aria-label={`${item.executionAccountId} 取价明细`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}>取价明细</button>{item.quoteObservedFrom && <span>报价观测 {formatV2Time(item.quoteObservedFrom ?? undefined)}{item.quoteObservedTo !== item.quoteObservedFrom && <> 至 {formatV2Time(item.quoteObservedTo ?? undefined)}</>}</span>}</div>
    {open && <div id={id}><AssetDetails item={item} /></div>}
  </article>;
}
function AssetDetails({ item }: { item: AccountCoreMetrics }) {
  return <section className="trading-core-assets" aria-label={`${item.executionAccountId} 资产取价明细`}><p>账本 {formatV2Time(item.ledgerObservedAt)} · 已定价 {item.pricedAssetCount}/{item.assetCount}。份额与成本来自本地账本；缺少任一资产价格时，账户估值、浮盈亏、总盈亏及收益率保留未知。</p>{item.valuationAssets.length === 0 ? <p>当前没有纳管持仓。</p> : <div className="trading-core-scroll"><table><thead><tr><th>市场 / 结果</th><th>本地份额 / 成本</th><th>价格 / 估值</th><th>来源 / 状态</th><th>观测时间</th></tr></thead><tbody>{item.valuationAssets.map(asset => <tr key={JSON.stringify([asset.marketSource, asset.marketId, asset.conditionId, asset.tokenId, asset.outcomeIndex, asset.outcomeName])} data-core-asset={asset.tokenId}>
      <td><strong>{asset.marketQuestion || asset.marketId || asset.conditionId}</strong><small>{asset.outcomeName ?? (asset.outcomeIndex === null ? "结果未提供" : String(asset.outcomeIndex))}</small></td><td><span>{asset.remainingShares}</span><small>{money(asset.remainingCost)}</small></td><td><span>{asset.price === null ? "—" : asset.price}</span><small>{money(asset.marketValue)}</small></td><td>{asset.priceSource ? sourceLabels[asset.priceSource] : asset.reason ? reasonLabels[asset.reason] : "—"}</td><td>{formatV2Time(asset.observedAt ?? undefined)}{asset.sourceAt && <small>来源时间 {formatV2Time(asset.sourceAt ?? undefined)}</small>}</td>
    </tr>)}</tbody></table></div>}</section>;
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
