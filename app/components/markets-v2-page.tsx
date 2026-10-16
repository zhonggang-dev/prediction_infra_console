"use client";

import { useMemo, useState } from "react";
import { consoleV2, type ConsoleV2Generation, type ConsoleV2MarketData, type ConsoleV2RunningMarket, type ConsoleV2RunningPool, type ConsoleV2SelectedMarket, type ConsoleV2SelectionRun, type ConsoleV2Settlement } from "../lib/console-v2";
import { formatV2Number, formatV2Time, V2Facts, V2Frame, V2ListPage, V2Tabs, v2Bool, v2Status, v2Unknown } from "./console-v2-resource";

type MarketsView = "running" | "selection" | "data";

export function MarketsV2Page({ view = "selection" }: { view?: MarketsView }) {
  const config = view === "running"
    ? { eyebrow: "Markets / Running", title: "运行市场", description: "当前发布批次的成员与长期运行池分层展示；选盘历史不被当作当前活跃池。" }
    : view === "data"
      ? { eyebrow: "Markets / Data", title: "行情与市场结算", description: "CLOB 批次采样与来源市场终态分开查看；市场 resolved 不代表钱包已赎回。" }
      : { eyebrow: "Markets / Selection", title: "选盘批次与历史", description: "选盘批次、入选记录和当前运行市场拥有不同身份；同一市场的历史行不会累加为当前市场。" };
  const tabs = [{ href: "/markets/running", label: "运行市场" }, { href: "/markets/selection", label: "选盘批次与历史" }, { href: "/markets/data", label: "行情与结算" }];
  return <V2Frame eyebrow={config.eyebrow} title={config.title} description={config.description}>
    <V2Tabs tabs={tabs} active={`/markets/${view}`} />
    {view === "running" && <RunningMarketViews />}
    {view === "selection" && <SelectionViews />}
    {view === "data" && <MarketDataViews />}
  </V2Frame>;
}

function RunningMarketViews() {
  const [tab, setTab] = useState<"members" | "pool" | "generations">("members");
  const tabs = [{ href: "members", label: "当前发布成员" }, { href: "pool", label: "长期运行池" }, { href: "generations", label: "发布批次" }];
  return <>
    <div className="v2-local-tabs" role="tablist" aria-label="运行市场视图">{tabs.map((item) => <button key={item.href} className={tab === item.href ? "active" : ""} onClick={() => setTab(item.href as typeof tab)} role="tab" aria-selected={tab === item.href}>{item.label}</button>)}</div>
    {tab === "members" && <RunningMembers />}
    {tab === "pool" && <RunningPool />}
    {tab === "generations" && <GenerationList />}
  </>;
}

function RunningMembers() {
  const [generationId, setGenerationId] = useState("");
  const params = useMemo(() => ({ generation_id: generationId || undefined }), [generationId]);
  return <V2ListPage<ConsoleV2RunningMarket> title="运行市场" load={consoleV2.infra.runningMarkets} params={params} rowKey={(item) => item.runningMarketId} searchPlaceholder="搜索 market、condition、问题或发布批次" controls={<input className="input" aria-label="发布批次 ID" inputMode="numeric" placeholder="发布批次 ID（可选）" value={generationId} onChange={(event) => setGenerationId(event.target.value.trim())} />} columns={[
    { label: "问题 / 来源", className: "primary wide", render: (item) => <div className="v2-cell-copy"><strong>{item.question}</strong><small>当前发布批次 · 选盘批次 {item.sourceSelectionRunId}</small></div> },
    { label: "市场 / 条件", render: (item) => <div className="v2-cell-copy mono"><span>{item.marketId}</span><small>{item.conditionId}</small></div> },
    { label: "预测资格", render: (item) => v2Status(item.predictionEnabled === null ? "unknown" : item.predictionEnabled ? "ready" : "disabled", item.predictionEnabled === null ? "未知" : item.predictionEnabled ? "可预测" : "仅资料") },
    { label: "领域 / 排名", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.primaryDomain)}</span><small>排名 {v2Unknown(item.domainRank)}</small></div> },
    { label: "24h 成交量", render: (item) => formatV2Number(item.volume24h, 4) },
    { label: "结束时间", render: (item) => formatV2Time(item.endAt) },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "发布批次 ID", value: item.generationId, mono: true }, { label: "运行市场 ID", value: item.runningMarketId, mono: true }, { label: "来源入选市场 ID", value: item.sourceSelectedMarketId, mono: true }, { label: "观测时间", value: formatV2Time(item.marketObservedAt) }, { label: "匹配领域", value: item.matchedDomains.length ? item.matchedDomains.join(" · ") : "未知" }]} /> } emptyDescription="当前接口没有返回已发布批次成员；这不等于历史选盘为空。" />;
}

function RunningPool() {
  const [status, setStatus] = useState("");
  const params = useMemo(() => ({ status: status || undefined }), [status]);
  return <V2ListPage<ConsoleV2RunningPool> title="长期运行池" load={consoleV2.infra.runningPool} params={params} rowKey={(item) => item.runningMarketId} controls={<select className="select" aria-label="长期运行池状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">默认活跃池</option><option value="RETIRED">仅已退出</option></select>} searchPlaceholder="搜索运行市场、market 或 condition" columns={[
    { label: "市场", className: "primary wide", render: (item) => <div className="v2-cell-copy"><strong>{item.question}</strong><small className="mono">{item.marketId} · {item.conditionId}</small></div> },
    { label: "活跃状态", render: (item) => v2Status(item.isActive === null ? "unknown" : item.isActive ? "active" : "retired", item.isActive === null ? "未知" : item.isActive ? "活跃" : "已退出") },
    { label: "来源 run", render: (item) => <span className="mono">{item.sourceSelectionRunId}</span> },
    { label: "24h 成交量", render: (item) => formatV2Number(item.volume24h, 4) },
    { label: "退出时间", render: (item) => formatV2Time(item.retiredAt) },
    { label: "退出原因", render: (item) => v2Unknown(item.retiredReason) },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "Running market ID", value: item.runningMarketId, mono: true }, { label: "Selected market ID", value: item.sourceSelectedMarketId, mono: true }, { label: "Condition ID", value: item.conditionId, mono: true }, { label: "Market observed", value: formatV2Time(item.marketObservedAt) }, { label: "Retired reason", value: v2Unknown(item.retiredReason) }, { label: "End at", value: formatV2Time(item.endAt) }]} />} />;
}

function GenerationList() {
  const [status, setStatus] = useState("");
  const params = useMemo(() => ({ status: status || undefined }), [status]);
  return <V2ListPage<ConsoleV2Generation> title="发布批次历史" load={consoleV2.infra.runningGenerations} params={params} rowKey={(item) => item.generationId} controls={<select className="select" aria-label="发布批次状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="PENDING">PENDING</option><option value="PUBLISHED">PUBLISHED</option><option value="FAILED">FAILED</option></select>} searchPlaceholder="搜索发布批次或选盘批次" columns={[
    { label: "发布批次 ID", className: "mono", render: (item) => item.generationId },
    { label: "来源选盘批次", className: "mono", render: (item) => item.sourceSelectionRunId },
    { label: "状态", render: (item) => v2Status(item.status, item.isCurrent === true ? `${item.status} · 当前` : item.status) },
    { label: "成员数", render: (item) => formatV2Number(item.memberCount, 0) },
    { label: "预测资格数", render: (item) => formatV2Number(item.predictionEnabledCount, 0) },
    { label: "发布时间", render: (item) => formatV2Time(item.publishedAt) },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "观测时间", value: formatV2Time(item.observedAt) }, { label: "当前批次", value: v2Bool(item.isCurrent) }, { label: "成员数", value: formatV2Number(item.memberCount, 0) }, { label: "可预测数", value: formatV2Number(item.predictionEnabledCount, 0) }]} />} />;
}

function SelectionViews() {
  const [tab, setTab] = useState<"runs" | "history">("runs");
  return <>
    <div className="v2-local-tabs" role="tablist" aria-label="选盘视图"><button className={tab === "runs" ? "active" : ""} onClick={() => setTab("runs")} role="tab" aria-selected={tab === "runs"}>选盘批次</button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")} role="tab" aria-selected={tab === "history"}>入选历史</button></div>
    {tab === "runs" ? <SelectionRuns /> : <SelectedMarkets />}
  </>;
}

function SelectionRuns() {
  return <V2ListPage<ConsoleV2SelectionRun> title="选盘批次" load={consoleV2.infra.selectionRuns} rowKey={(item) => item.selectionRunId} searchPlaceholder="搜索选盘批次、策略或来源" columns={[
    { label: "Run / 来源", className: "mono", render: (item) => <div className="v2-cell-copy"><strong>{item.selectionRunId}</strong><small>{v2Unknown(item.marketSource)}</small></div> },
    { label: "策略版本", render: (item) => <div className="v2-cell-copy"><strong>{v2Unknown(item.policyName)}</strong><small>{v2Unknown(item.policyVersion)} · {v2Unknown(item.selectorType)}</small></div> },
    { label: "状态", render: (item) => v2Status(item.status, item.isCurrent === true ? `${item.status} · current` : item.status) },
    { label: "候选 / 入选 / 拒绝", render: (item) => `${formatV2Number(item.candidateCount, 0)} / ${formatV2Number(item.selectedCount, 0)} / ${formatV2Number(item.rejectedCount, 0)}` },
    { label: "开始 / 完成", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.startedAt)}</span><small>{formatV2Time(item.completedAt)}</small></div> },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "Selection run", value: item.selectionRunId, mono: true }, { label: "Market source", value: v2Unknown(item.marketSource) }, { label: "Published", value: formatV2Time(item.publishedAt) }, { label: "Candidate count", value: formatV2Number(item.candidateCount, 0) }, { label: "Selected count", value: formatV2Number(item.selectedCount, 0) }, { label: "Rejected count", value: formatV2Number(item.rejectedCount, 0) }]} />} />;
}

function SelectedMarkets() {
  const [runId, setRunId] = useState("");
  const params = useMemo(() => ({ selection_run_id: runId || undefined }), [runId]);
  return <V2ListPage<ConsoleV2SelectedMarket> title="入选历史" load={consoleV2.infra.selectedMarkets} params={params} rowKey={(item) => item.selectedMarketId} searchPlaceholder="搜索问题、market、condition 或来源" controls={<input className="input" aria-label="选盘批次 ID" inputMode="numeric" placeholder="选盘批次 ID（可选）" value={runId} onChange={(event) => setRunId(event.target.value.trim())} />} columns={[
    { label: "问题 / 来源", className: "primary wide", render: (item) => <div className="v2-cell-copy"><strong>{item.question}</strong><small>{v2Unknown(item.marketSource)} · run {item.selectionRunId}</small></div> },
    { label: "市场 / 条件", render: (item) => <div className="v2-cell-copy mono"><span>{item.marketId}</span><small>{item.conditionId}</small></div> },
    { label: "Selected market", className: "mono", render: (item) => item.selectedMarketId },
    { label: "排名 / 24h volume", render: (item) => `${v2Unknown(item.rank)} · ${formatV2Number(item.volume24h, 4)}` },
    { label: "结束时间", render: (item) => formatV2Time(item.endAt) },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "Selected market ID", value: item.selectedMarketId, mono: true }, { label: "Selection run ID", value: item.selectionRunId, mono: true }, { label: "Market source", value: v2Unknown(item.marketSource) }, { label: "Primary domain", value: v2Unknown(item.primaryDomain) }, { label: "Selected at", value: formatV2Time(item.selectedAt) }]} />} />;
}

function MarketDataViews() {
  const [tab, setTab] = useState<"data" | "settlements">("data");
  return <>
    <div className="v2-local-tabs" role="tablist" aria-label="行情与结算视图"><button className={tab === "data" ? "active" : ""} onClick={() => setTab("data")} role="tab" aria-selected={tab === "data"}>CLOB 采样批次</button><button className={tab === "settlements" ? "active" : ""} onClick={() => setTab("settlements")} role="tab" aria-selected={tab === "settlements"}>市场结算</button></div>
    {tab === "data" ? <MarketDataList /> : <SettlementList />}
  </>;
}

function MarketDataList() {
  return <V2ListPage<ConsoleV2MarketData> title="CLOB 采样批次" load={consoleV2.infra.marketData} rowKey={(item) => `${item.seriesId}-${item.sampleAt ?? "unknown"}`} searchPlaceholder="搜索采样批次或状态" columns={[
    { label: "Series / Sample", className: "mono", render: (item) => <div className="v2-cell-copy"><strong>{item.seriesId}</strong><small>{formatV2Time(item.sampleAt)}</small></div> },
    { label: "状态", render: (item) => v2Status(item.status, item.status) },
    { label: "Target / Snapshot", render: (item) => `${formatV2Number(item.targetCount, 0)} / ${formatV2Number(item.snapshotCount, 0)}` },
    { label: "OK / Empty / Missing", render: (item) => `${formatV2Number(item.okCount, 0)} / ${formatV2Number(item.emptyCount, 0)} / ${formatV2Number(item.missingCount, 0)}` },
    { label: "Error / Request", render: (item) => `${formatV2Number(item.errorCount, 0)} / ${formatV2Number(item.requestCount, 0)}` },
    { label: "完成时间", render: (item) => formatV2Time(item.completedAt) },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "Series ID", value: item.seriesId, mono: true }, { label: "Started", value: formatV2Time(item.startedAt) }, { label: "Complete", value: formatV2Time(item.completedAt) }, { label: "OK count", value: formatV2Number(item.okCount, 0) }, { label: "Empty count", value: formatV2Number(item.emptyCount, 0) }, { label: "Missing count", value: formatV2Number(item.missingCount, 0) }]} />} emptyDescription="默认查看有限近期窗口；接口没有返回数据时不回落为旧 orderbook 摘要。" />;
}

function SettlementList() {
  const [source, setSource] = useState("");
  const params = useMemo(() => ({ source: source || undefined }), [source]);
  return <V2ListPage<ConsoleV2Settlement> title="市场结算" load={consoleV2.infra.settlements} params={params} rowKey={(item) => `${item.marketSource ?? "unknown"}:${item.marketId}:${item.conditionId}`} searchPlaceholder="搜索 market、condition 或 outcome" controls={<select className="select" aria-label="市场来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="">全部来源</option><option value="POLYMARKET">Polymarket</option><option value="KALSHI">Kalshi</option></select>} columns={[
    { label: "来源 / Market", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{v2Unknown(item.marketSource)}</strong><small className="mono">{item.marketId}</small></div> },
    { label: "条件", className: "mono", render: (item) => item.conditionId },
    { label: "状态", render: (item) => v2Status(item.status, item.status) },
    { label: "Outcome", render: (item) => v2Unknown(item.resolvedOutcome) },
    { label: "Yes / No", render: (item) => `${formatV2Number(item.settlementYes, 4)} / ${formatV2Number(item.settlementNo, 4)}` },
    { label: "Resolved at", render: (item) => formatV2Time(item.resolvedAt) },
  ]} renderDetail={(item) => <><V2Facts values={[{ label: "Market source", value: v2Unknown(item.marketSource) }, { label: "Market ID", value: item.marketId, mono: true }, { label: "Condition ID", value: item.conditionId, mono: true }, { label: "Closed at", value: formatV2Time(item.closedAt) }, { label: "Source at", value: formatV2Time(item.sourceAt) }, { label: "Available at", value: formatV2Time(item.availableAt) }]} /><p className="v2-inline-note">市场终态与钱包赎回是两个事实层；请到交易中心的赎回视图核对到账。</p></>} />;
}
