"use client";

import { useEffect, useState } from "react";
import { accountPerformance, type AccountPerformance, type AccountPerformanceResponse, type ValuationReason } from "../lib/trading-performance";
import { formatV2Time } from "./console-v2-resource";
import "./account-performance.css";

const valuationReasons: Record<ValuationReason, string> = {
  missing_batch: "暂无决策行情快照", missing_quote: "部分资产缺少报价", invalid_quote: "部分资产报价无效", stale_quote: "部分报价已超过15分钟", future_quote: "报价时间异常",
};
const money = (value: string | null) => value === null ? "—" : new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
const tone = (value: string | null) => value === null ? "" : Number(value) > 0 ? "positive" : Number(value) < 0 ? "negative" : "";

export function AccountPerformancePanel({ active, account }: { active: boolean; account: string }) {
  const [state, setState] = useState<{ key: string; data?: AccountPerformanceResponse; error?: string }>({ key: "" });
  const [retry, setRetry] = useState(0);
  const identity = `${account}:${retry}`;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void accountPerformance(account, controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ key: identity, data });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ key: identity, error: error instanceof Error ? error.message : "账户绩效暂时不可用。" });
    });
    return () => controller.abort();
  }, [active, account, retry, identity]);
  const current = state.key === identity ? state : undefined;
  return <section className="section trading-performance" aria-label="账户绩效" aria-busy={active && !current?.data && !current?.error}>
    <div className="section-head"><h2 className="section-title">账户绩效</h2>{current?.data && <span className="section-caption">账本观测 {formatV2Time(current.data.observedAt)}</span>}</div>
    <p className="section-caption trading-performance-basis">系统纳管账本口径，含接管资产；估值取最近决策行情快照。累计指标及近14日回撤独立于下方官方曲线日期。</p>
    {current?.error ? <div className="notice error" role="alert"><p>{current.error}</p><button type="button" className="button" onClick={() => setRetry((value) => value + 1)}>重试</button></div>
      : !current?.data ? <p className="trading-performance-state">正在读取账户绩效…</p>
        : !current.data.items.length ? <p className="trading-performance-state">暂无受管账户。</p>
          : <div className="trading-performance-accounts">{current.data.items.map((item) => <PerformanceRow key={item.executionAccountId} item={item} />)}</div>}
    <details className="trading-performance-explanation"><summary>指标口径</summary><p>资产数按账户当前资产分组，包含待赎回份额；累计投入含买入、接管与导入成本。已实现盈亏包含卖出、净对冲和到期结算，手续费已计入。成本收益率＝总盈亏／历史最高持仓成本，不是净入金回报率。回撤按近14个UTC自然日的账本已实现盈亏日累计计算，不含浮盈亏及日内峰谷。</p></details>
  </section>;
}

function PerformanceRow({ item }: { item: AccountPerformance }) {
  const stats = [
    { label: "持有资产数", value: String(item.assetCount) },
    { label: "最近快照持仓估值", value: money(item.marketValue) },
    { label: "历史最高持仓成本", value: money(item.peakHoldingCost) },
    { label: "累计投入成本", value: money(item.cumulativeInvestedCost) },
    { label: "累计已实现盈亏", value: money(item.realizedPnl), tone: tone(item.realizedPnl) },
    { label: "当前浮动盈亏", value: money(item.unrealizedPnl), tone: tone(item.unrealizedPnl) },
    { label: "总盈亏", value: money(item.totalPnl), tone: tone(item.totalPnl) },
    { label: "成本收益率", value: item.returnRate === null ? "—" : `${(Number(item.returnRate) * 100).toFixed(2)}%`, tone: tone(item.returnRate) },
    { label: "近14日已实现盈亏回撤", value: money(item.realizedDrawdown14d) },
  ];
  return <article className="trading-performance-account" aria-label={`${item.executionAccountId} 账户绩效`} data-performance-account={item.executionAccountId}>
    <header><h3>{item.executionAccountId}</h3><span>{item.marketSource === "KALSHI" ? "Kalshi" : "Polymarket"}</span></header>
    <dl className="trading-performance-stats">{stats.map((stat) => <div key={stat.label} data-performance-metric={stat.label}><dt>{stat.label}</dt><dd className={stat.tone}>{stat.value}</dd></div>)}</dl>
    <p className={`trading-performance-coverage${item.valuationState === "incomplete" ? " incomplete" : ""}`}>
      {item.valuationState === "incomplete" ? "估值不完整" : item.assetCount === 0 ? "当前无持有资产" : "估值覆盖完整"} · 有效报价 {item.pricedAssetCount}/{item.assetCount}
      {item.snapshotObservedAt && <> · 报价采样 {formatV2Time(item.snapshotObservedAt)}</>}
      {item.valuationReasons.length > 0 && <> · {item.valuationReasons.map((reason) => valuationReasons[reason]).join("、")}；估值、浮盈亏、总盈亏与收益率暂不提供</>}
    </p>
  </article>;
}
