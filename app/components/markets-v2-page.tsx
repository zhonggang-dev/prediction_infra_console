"use client";

import { useEffect, useMemo } from "react";
import { consoleV2, type ConsoleV2Generation, type ConsoleV2RunningMarket, type ConsoleV2RunningPool, type ConsoleV2SelectedMarket, type ConsoleV2SelectionRun, type ConsoleV2Settlement } from "../lib/console-v2";
import { formatV2Number, formatV2Time, V2ContextLinks, V2Facts, V2Frame, V2ListPage, V2SubViews, V2Tabs, V2WorkspacePanel, useV2Filter, useWorkspaceTabs, v2Status, v2Unknown } from "./console-v2-resource";

type MarketsView = "running" | "selection" | "data";
const tabs = [{ href: "/markets/running", label: "运行市场", aliases: ["/markets"] }, { href: "/markets/selection", label: "选盘与维护" }, { href: "/markets/data", label: "Polymarket 市场结算" }] as const;
export function MarketsV2Page({ view = "running" }: { view?: MarketsView }) {
  const workspace = useWorkspaceTabs(tabs, `/markets/${view}`);
  const config = workspace.active === "/markets/running" ? { title: "运行市场", description: "查看各平台当前维护批次的成员与预测资格，或查询已退出市场。" } : workspace.active === "/markets/data" ? { title: "Polymarket 市场结算", description: "官方采集快照与钱包结算入账分别核对。" } : { title: "选盘与维护", description: "选盘记录与运行池维护记录分别保留，可按真实批次追查成员。" };
  return <V2Frame eyebrow="Markets" {...config}><V2ContextLinks links={[{ href: "/predictions", label: "查看预测" }]} /><V2Tabs tabs={tabs} active={workspace.active} onSelect={(href) => workspace.select(href as typeof workspace.active)} /><V2WorkspacePanel active={workspace.active} href="/markets/running" visited={workspace.visited.has("/markets/running")}><RunningMarketViews /></V2WorkspacePanel><V2WorkspacePanel active={workspace.active} href="/markets/selection" visited={workspace.visited.has("/markets/selection")}><V2SubViews parameter="record_view" choices={[{ href: "selection", label: "选盘记录", content: <SelectionViews /> }, { href: "maintenance", label: "维护记录", content: <GenerationList /> }]} /></V2WorkspacePanel><V2WorkspacePanel active={workspace.active} href="/markets/data" visited={workspace.visited.has("/markets/data")}><SettlementList /></V2WorkspacePanel></V2Frame>;
}

function SourceFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <select className="select" aria-label="市场来源" value={value} onChange={(event) => onChange(event.target.value)}><option value="ALL">全部平台</option><option value="POLYMARKET">Polymarket</option><option value="KALSHI">Kalshi</option></select>; }
function EligibilityFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <select className="select" aria-label="预测资格" value={value} onChange={(event) => onChange(event.target.value)}><option value="">全部资格</option><option value="true">可预测</option><option value="false">仅资料</option></select>; }
function RunningMarketViews() {
  const [storedScope, setScope] = useV2Filter("market_scope", "current");
  const scope = storedScope === "retired" ? "retired" : "current";
  useEffect(() => { if (storedScope === "pool") setScope("current"); }, [storedScope, setScope]);
  return <><div className="market-scope-bar"><label><span>运行范围</span><select className="select" aria-label="运行市场范围" value={scope} onChange={(event) => setScope(event.target.value)}><option value="current">当前维护批次</option><option value="retired">已退出运行池</option></select></label></div>{scope === "current" ? <RunningMembers /> : <RetiredMarkets />}</>;
}
function RunningMembers() {
  const [generationId, setGenerationId] = useV2Filter("generation_id");
  const [source, setSource] = useV2Filter("source", "ALL");
  const [enabled, setEnabled] = useV2Filter("prediction_enabled");
  const params = useMemo(() => ({ generation_id: generationId || undefined, source, prediction_enabled: enabled || undefined, market_scope: "current" }), [generationId, source, enabled]);
  return <>{generationId && <section className="panel panel-pad selection-context"><strong>{source === "ALL" ? "指定" : source} 维护批次 {generationId}</strong><V2ContextLinks links={[{ href: "/markets/running", label: "返回当前维护成员" }, { href: "/markets/selection?record_view=maintenance", label: "返回维护记录" }, { href: `/predictions?generation_id=${encodeURIComponent(generationId)}&${source === "ALL" ? "sources=POLYMARKET,KALSHI" : `source=${source}`}&scope=history`, label: "查看本轮预测" }]} /></section>}<V2ListPage<ConsoleV2RunningMarket> title="运行市场" description="按平台、领域及域内成交量排名展示；展示排名不等同于预测资格门禁名次。" load={loadRunningMarkets} params={params} rowKey={(item) => `${item.marketSource}:${item.generationId}:${item.runningMarketId}`} controls={<><SourceFilter value={source} onChange={(next) => { setSource(next); setGenerationId(""); }} /><EligibilityFilter value={enabled} onChange={setEnabled} /></>} searchPlaceholder="搜索问题或交易所市场编号" columns={[
    { label: "平台 / 问题", className: "primary wide", render: (item) => <div className="v2-cell-copy"><strong>{item.question}</strong><small>{item.marketSource} · 维护批次 {item.generationId}</small></div> },
    { label: "交易所市场 / 条件", className: "mono", render: (item) => <div className="v2-cell-copy"><span>{item.marketId}</span>{item.conditionId && <small>{item.conditionId}</small>}</div> },
    { label: "领域", render: (item) => v2Unknown(item.primaryDomain) },
    { label: "域内成交量排名", render: (item) => formatV2Number(item.domainVolumeRank, 0) },
    { label: "24h 成交量", render: (item) => <div className="v2-cell-copy"><span>{formatV2Number(item.volume24h, 4)}</span><small>{formatV2Time(item.marketObservedAt)}</small></div> },
    { label: "预测资格", render: (item) => item.predictionEnabled === null ? "未提供" : item.predictionEnabled ? "可预测" : "仅资料" },
    { label: "预计结束", render: (item) => formatV2Time(item.endAt) },
  ]} /></>;
}
const withoutUi = (params: Record<string, string | number | undefined>) => { const result = { ...params }; delete result.market_scope; delete result.record_view; return result; };
const loadRunningMarkets = (params: Record<string, string | number | undefined>) => consoleV2.infra.runningMarkets(withoutUi(params));
const loadRetiredMarkets = (params: Record<string, string | number | undefined>) => consoleV2.infra.runningPool(withoutUi(params));
const loadGenerations = (params: Record<string, string | number | undefined>) => consoleV2.infra.runningGenerations(withoutUi(params));
const loadSelections = (params: Record<string, string | number | undefined>) => consoleV2.infra.selectionRuns(withoutUi(params));
const loadSelected = (params: Record<string, string | number | undefined>) => consoleV2.infra.selectedMarkets(withoutUi(params));
function RetiredMarkets() {
  const [source, setSource] = useV2Filter("source", "ALL");
  const params = useMemo(() => ({ status: "RETIRED", source, market_scope: "retired" }), [source]);
  return <V2ListPage<ConsoleV2RunningPool> title="已退出运行池" load={loadRetiredMarkets} params={params} rowKey={(item) => `${item.marketSource}:${item.runningMarketId}`} controls={<SourceFilter value={source} onChange={setSource} />} columns={[
    { label: "平台 / 市场", className: "primary wide", render: (item) => <div className="v2-cell-copy"><strong>{item.question}</strong><small>{item.marketSource} · {item.marketId} {item.conditionId}</small></div> },
    { label: "领域", render: (item) => v2Unknown(item.primaryDomain) }, { label: "退出时间", render: (item) => formatV2Time(item.retiredAt) }, { label: "退出原因", render: (item) => v2Unknown(item.retiredReason) },
  ]} />;
}
function GenerationList() {
  const [status, setStatus] = useV2Filter("status");
  const [source, setSource] = useV2Filter("source", "ALL");
  const params = useMemo(() => ({ status: status || undefined, source, record_view: "maintenance" }), [status, source]);
  return <V2ListPage<ConsoleV2Generation> title="运行池维护记录" load={loadGenerations} params={params} rowKey={(item) => `${item.marketSource}:${item.generationId}`} controls={<><SourceFilter value={source} onChange={setSource} /><select className="select" aria-label="维护批次状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="PENDING">处理中</option><option value="PUBLISHED">已完成</option><option value="FAILED">失败</option></select></>} columns={[
    { label: "平台 / 维护批次", render: (item) => `${item.marketSource} · ${item.generationId}` }, { label: "选盘批次", render: (item) => item.sourceSelectionRunId }, { label: "状态", render: (item) => v2Status(item.status, `${item.status === "PUBLISHED" ? "已完成" : item.status}${item.isCurrent ? " · 当前" : ""}`) }, { label: "成员数", render: (item) => formatV2Number(item.memberCount, 0) }, { label: "可预测", render: (item) => formatV2Number(item.predictionEnabledCount, 0) }, { label: "发布时间", render: (item) => formatV2Time(item.publishedAt) }, { label: "成员", render: (item) => <a className="button" href={`/markets/running?market_scope=current&generation_id=${encodeURIComponent(item.generationId)}&source=${encodeURIComponent(item.marketSource ?? "POLYMARKET")}`}>查看本轮市场</a> },
  ]} />;
}
function SelectionViews() {
  const [runId] = useV2Filter("selection_run_id");
  return runId ? <><section className="panel panel-pad selection-context"><strong>选盘批次 {runId}</strong><V2ContextLinks links={[{ href: "/markets/selection", label: "返回选盘记录" }]} /></section><SelectedMarkets runId={runId} /></> : <SelectionRuns />;
}
function SelectionRuns() {
  const params = useMemo(() => ({ record_view: "selection" }), []);
  return <V2ListPage<ConsoleV2SelectionRun> title="选盘批次" load={loadSelections} params={params} rowKey={(item) => item.selectionRunId} columns={[
    { label: "平台 / 选盘批次", render: (item) => `${item.marketSource} · ${item.selectionRunId}` }, { label: "策略版本", render: (item) => `${v2Unknown(item.policyName)} · ${v2Unknown(item.policyVersion)}` }, { label: "状态", render: (item) => v2Status(item.status, item.status) }, { label: "候选 / 入选 / 拒绝", render: (item) => `${formatV2Number(item.candidateCount, 0)} / ${formatV2Number(item.selectedCount, 0)} / ${formatV2Number(item.rejectedCount, 0)}` }, { label: "开始 / 完成", render: (item) => `${formatV2Time(item.startedAt)} / ${formatV2Time(item.completedAt)}` }, { label: "成员", render: (item) => <a className="button" href={`/markets/selection?selection_run_id=${encodeURIComponent(item.selectionRunId)}`}>查看入选成员</a> },
  ]} />;
}
function SelectedMarkets({ runId }: { runId: string }) {
  const params = useMemo(() => ({ selection_run_id: runId, record_view: "selection" }), [runId]);
  return <V2ListPage<ConsoleV2SelectedMarket> title="入选成员" description="业务按领域交易量配额选盘；这里显示完整批次内各平台、领域的成交量排名。" load={loadSelected} params={params} rowKey={(item) => item.selectedMarketId} columns={[
    { label: "平台 / 问题", className: "primary wide", render: (item) => <div className="v2-cell-copy"><strong>{item.question}</strong><small>{item.marketSource}</small></div> }, { label: "交易所市场 / 条件", className: "mono", render: (item) => `${item.marketId} ${item.conditionId}` }, { label: "领域", render: (item) => v2Unknown(item.primaryDomain) }, { label: "域内成交量排名", render: (item) => formatV2Number(item.domainVolumeRank, 0) }, { label: "24h 成交量", render: (item) => formatV2Number(item.volume24h, 4) }, { label: "预计结束", render: (item) => formatV2Time(item.endAt) },
  ]} />;
}
function SettlementList() {
  const params = useMemo(() => ({ source: "POLYMARKET" }), []);
  return <V2ListPage<ConsoleV2Settlement> title="Polymarket 市场结算" description="来自 Infra 保存的 Polymarket / Gamma 官方采集快照；未接入 Kalshi 全市场结算采集。市场结果不等于钱包兑付入账。" load={consoleV2.infra.settlements} params={params} rowKey={(item) => `${item.marketSource}:${item.marketId}:${item.conditionId}`} columns={[
    { label: "交易所市场", className: "primary mono", render: (item) => item.marketId }, { label: "条件", className: "mono", render: (item) => item.conditionId }, { label: "状态", render: (item) => v2Status(item.status, item.status === "OPEN" ? "尚未结算" : item.status) }, { label: "结果", render: (item) => item.resolvedOutcome ?? "—" }, { label: "Yes / No", render: (item) => `${item.settlementYes === null ? "—" : formatV2Number(item.settlementYes, 4)} / ${item.settlementNo === null ? "—" : formatV2Number(item.settlementNo, 4)}` }, { label: "结算时间", render: (item) => item.resolvedAt ? formatV2Time(item.resolvedAt) : "—" },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "数据来源", value: "Polymarket / Gamma 采集快照" }, { label: "关闭时间", value: item.closedAt ? formatV2Time(item.closedAt) : "—" }, { label: "采集时间", value: item.sourceAt ? formatV2Time(item.sourceAt) : "—" }, { label: "可用时间", value: item.availableAt ? formatV2Time(item.availableAt) : "—" }]} />} />;
}
