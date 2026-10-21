"use client";

import { useMemo } from "react";
import { consoleV2, type ConsoleV2Generation, type ConsoleV2MarketData, type ConsoleV2RunningMarket, type ConsoleV2RunningPool, type ConsoleV2SelectedMarket, type ConsoleV2SelectionRun, type ConsoleV2Settlement } from "../lib/console-v2";
import { formatV2Number, formatV2Time, V2ContextLinks, V2Facts, V2Frame, V2ListPage, V2Tabs, V2WorkspacePanel, useV2Filter, useWorkspaceTabs, v2Bool, v2Status, v2Unknown } from "./console-v2-resource";

type MarketsView = "running" | "selection" | "data";

export function MarketsV2Page({ view = "running" }: { view?: MarketsView }) {
  const tabs = [{ href: "/markets/running", label: "运行市场", aliases: ["/markets"] }, { href: "/markets/selection", label: "选盘记录" }, { href: "/markets/data", label: "行情 / 结算" }] as const;
  const initialHref = view === "running" ? "/markets/running" : view === "data" ? "/markets/data" : "/markets/selection";
  const workspace = useWorkspaceTabs(tabs, initialHref);
  const config = workspace.active === "/markets/running"
    ? { eyebrow: "Markets / Running", title: "运行市场", description: "按当前发布范围、长期运行池和已退出范围查看市场；选盘记录单独保留。" }
    : workspace.active === "/markets/data"
      ? { eyebrow: "Markets / Data", title: "行情与市场结算", description: "行情采集与市场结算分开查看；市场结算完成不等同于账户已经完成赎回。" }
      : { eyebrow: "Markets / Selection", title: "选盘批次与历史", description: "先看选盘批次，再按批次查看入选市场；历史记录不会混入当前运行范围。" };
  return <V2Frame eyebrow={config.eyebrow} title={config.title} description={config.description}>
    <V2ContextLinks links={[{ href: "/predictions", label: "查看对应预测" }, { href: "/assets", label: "查看市场资料" }, { href: "/questions", label: "查看题目库" }, { href: "/markets/selection", label: "发布批次审计" }]} />
    <V2Tabs tabs={tabs} active={workspace.active} onSelect={(href) => workspace.select(href as typeof workspace.active)} />
    <V2WorkspacePanel active={workspace.active} href="/markets/running" visited={workspace.visited.has("/markets/running")}><RunningMarketViews /></V2WorkspacePanel>
    <V2WorkspacePanel active={workspace.active} href="/markets/selection" visited={workspace.visited.has("/markets/selection")}><SelectionViews /></V2WorkspacePanel>
    <V2WorkspacePanel active={workspace.active} href="/markets/data" visited={workspace.visited.has("/markets/data")}><MarketDataViews /></V2WorkspacePanel>
  </V2Frame>;
}

function RunningMarketViews() {
  const [scope, setScope] = useV2Filter("market_scope", "current");
  return <><div className="market-scope-bar"><label><span>运行范围</span><select className="select" aria-label="运行市场范围" value={scope} onChange={(event) => setScope(event.target.value)}><option value="current">当前发布范围</option><option value="pool">长期运行池</option><option value="retired">已退出运行池</option></select></label><span>当前范围只展示对应资源，发布批次作为审计入口。</span></div>{scope === "current" ? <RunningMembers /> : <RunningPool status={scope === "retired" ? "RETIRED" : "ACTIVE"} />}<details className="market-audit"><summary>查看发布批次审计</summary><GenerationList /></details></>;
}

function RunningMembers() {
  const [generationId, setGenerationId] = useV2Filter("generation_id");
  const params = useMemo(() => ({ generation_id: generationId || undefined }), [generationId]);
  return <V2ListPage<ConsoleV2RunningMarket> title="运行市场" load={consoleV2.infra.runningMarkets} params={params} rowKey={(item) => item.runningMarketId} searchPlaceholder="搜索 market、condition、问题或发布批次" controls={<input className="input" aria-label="发布批次 ID" inputMode="numeric" placeholder="发布批次 ID（可选）" value={generationId} onChange={(event) => setGenerationId(event.target.value.trim())} />} columns={[
    { label: "问题 / 来源", className: "primary wide", render: (item) => <div className="v2-cell-copy"><strong>{item.question}</strong><small>当前发布批次 · 选盘批次 {item.sourceSelectionRunId}</small></div> },
    { label: "市场 / 条件", render: (item) => <div className="v2-cell-copy mono"><span>{item.marketId}</span><small>{item.conditionId}</small></div> },
    { label: "本批次预测资格", render: (item) => <div className="v2-cell-copy"><span>{item.predictionEnabled === null ? "未知" : item.predictionEnabled ? "本批次启用" : "仅资料"}</span><small>当前发布批次冻结字段</small></div> },
    { label: "领域 / 排名", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.primaryDomain)}</span><small>排名 {v2Unknown(item.domainRank)}</small></div> },
    { label: "24h 成交量", render: (item) => formatV2Number(item.volume24h, 4) },
    { label: "来源观测 / 截止", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.marketObservedAt)}</span><small>{formatV2Time(item.endAt)}</small></div> },
  ]} renderDetail={(item) => <><V2Facts values={[{ label: "发布批次 ID", value: item.generationId, mono: true }, { label: "运行市场 ID", value: item.runningMarketId, mono: true }, { label: "来源入选市场 ID", value: item.sourceSelectedMarketId, mono: true }, { label: "本批次预测资格", value: item.predictionEnabled === null ? "未知" : item.predictionEnabled ? "本批次启用" : "仅资料" }, { label: "来源市场观测时间", value: formatV2Time(item.marketObservedAt) }, { label: "匹配领域", value: item.matchedDomains.length ? item.matchedDomains.join(" · ") : "未知" }]} /><p className="v2-inline-note">预测资格是当前发布批次的冻结字段；实时有效性另查行情与市场终态。来源快照截止时间不代表已结算。</p></>} emptyDescription="当前接口没有返回已发布批次成员；这不等于历史选盘为空。" />;
}

function RunningPool({ status }: { status: "ACTIVE" | "RETIRED" }) {
  const params = useMemo(() => ({ status }), [status]);
  return <V2ListPage<ConsoleV2RunningPool> title={status === "RETIRED" ? "已退出运行池" : "长期运行池"} load={consoleV2.infra.runningPool} params={params} rowKey={(item) => item.runningMarketId} searchPlaceholder="搜索运行市场、market 或 condition" columns={[
    { label: "市场", className: "primary wide", render: (item) => <div className="v2-cell-copy"><strong>{item.question}</strong><small className="mono">{item.marketId} · {item.conditionId}</small></div> },
    { label: "活跃状态", render: (item) => v2Status(item.isActive === null ? "unknown" : item.isActive ? "active" : "retired", item.isActive === null ? "未知" : item.isActive ? "活跃" : "已退出") },
    { label: "来源 run", render: (item) => <span className="mono">{item.sourceSelectionRunId}</span> },
    { label: "24h 成交量", render: (item) => formatV2Number(item.volume24h, 4) },
    { label: "退出时间", render: (item) => formatV2Time(item.retiredAt) },
    { label: "退出原因", render: (item) => v2Unknown(item.retiredReason) },
  ]} renderDetail={(item) => <><V2Facts values={[{ label: "Running market ID", value: item.runningMarketId, mono: true }, { label: "Selected market ID", value: item.sourceSelectedMarketId, mono: true }, { label: "Condition ID", value: item.conditionId, mono: true }, { label: "Market observed", value: formatV2Time(item.marketObservedAt) }, { label: "Retired reason", value: v2Unknown(item.retiredReason) }, { label: "来源快照截止", value: formatV2Time(item.endAt) }]} /><p className="v2-inline-note">来源快照截止时间不代表已结算；市场终态请到行情与结算视图核对。</p></>} />;
}

function GenerationList() {
  const [status, setStatus] = useV2Filter("status");
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
  return <><SelectionRuns /><SelectedMarkets /></>;
}

function SelectionRuns() {
  return <V2ListPage<ConsoleV2SelectionRun> title="选盘批次" load={consoleV2.infra.selectionRuns} rowKey={(item) => item.selectionRunId} searchPlaceholder="搜索选盘批次、策略或来源" columns={[
    { label: "Run / 来源", className: "mono", render: (item) => <div className="v2-cell-copy"><strong>{item.selectionRunId}</strong><small>{v2Unknown(item.marketSource)}</small></div> },
    { label: "策略版本", render: (item) => <div className="v2-cell-copy"><strong>{v2Unknown(item.policyName)}</strong><small>{v2Unknown(item.policyVersion)} · {v2Unknown(item.selectorType)}</small></div> },
    { label: "状态", render: (item) => v2Status(item.status, item.isCurrent === true ? `${item.status} · current` : item.status) },
    { label: "候选 / 入选 / 拒绝", render: (item) => `${formatV2Number(item.candidateCount, 0)} / ${formatV2Number(item.selectedCount, 0)} / ${formatV2Number(item.rejectedCount, 0)}` },
    { label: "开始 / 完成", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.startedAt)}</span><small>{formatV2Time(item.completedAt)}</small></div> },
  ]} renderDetail={(item) => <><V2Facts values={[{ label: "Selection run", value: item.selectionRunId, mono: true }, { label: "Market source", value: v2Unknown(item.marketSource) }, { label: "Published", value: formatV2Time(item.publishedAt) }, { label: "Candidate count", value: formatV2Number(item.candidateCount, 0) }, { label: "Selected count", value: formatV2Number(item.selectedCount, 0) }, { label: "Rejected count", value: formatV2Number(item.rejectedCount, 0) }]} /><V2ContextLinks links={[{ href: `/markets/selection?selection_run_id=${encodeURIComponent(item.selectionRunId)}`, label: "查看该批次入选成员" }]} /></>} />;
}

function SelectedMarkets() {
  const [runId, setRunId] = useV2Filter("selection_run_id");
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
  return <><MarketDataList /><SettlementList /></>;
}

function MarketDataList() {
  return <V2ListPage<ConsoleV2MarketData> title="CLOB 采样批次" load={consoleV2.infra.marketData} rowKey={(item) => `${item.seriesId}-${item.sampleAt ?? "unknown"}`} searchPlaceholder="搜索采样批次或状态" columns={[
    { label: "Series / Sample", className: "mono", render: (item) => <div className="v2-cell-copy"><strong>{item.seriesId}</strong><small>{formatV2Time(item.sampleAt)}</small></div> },
    { label: "状态", render: (item) => v2Status(item.status, item.status) },
    { label: "Target / Snapshot", render: (item) => `${formatV2Number(item.targetCount, 0)} / ${formatV2Number(item.snapshotCount, 0)}` },
    { label: "OK / Empty / Missing", render: (item) => `${formatV2Number(item.okCount, 0)} / ${formatV2Number(item.emptyCount, 0)} / ${formatV2Number(item.missingCount, 0)}` },
    { label: "Error / Request", render: (item) => `${formatV2Number(item.errorCount, 0)} / ${formatV2Number(item.requestCount, 0)}` },
    { label: "完成时间", render: (item) => formatV2Time(item.completedAt) },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "Series ID", value: item.seriesId, mono: true }, { label: "Started", value: formatV2Time(item.startedAt) }, { label: "Complete", value: formatV2Time(item.completedAt) }, { label: "OK count", value: formatV2Number(item.okCount, 0) }, { label: "Empty count", value: formatV2Number(item.emptyCount, 0) }, { label: "Missing count", value: formatV2Number(item.missingCount, 0) }]} />} emptyDescription="当前时间范围没有可查看的行情采集记录。" />;
}

function SettlementList() {
  const [source, setSource] = useV2Filter("source");
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
