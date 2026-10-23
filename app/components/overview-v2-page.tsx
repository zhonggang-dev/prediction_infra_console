"use client";

import { useEffect, useState } from "react";
import { consoleApi } from "../lib/console-api";
import type { GeneratedQAList } from "../lib/types";
import { consoleV2, type ConsoleV2Overview, type ConsoleV2Runtime } from "../lib/console-v2";
import { ROTATION_VARIANTS, type DatasetRotationData, type RotationVariant } from "../lib/dataset-rotation";
import { formatV2Number, formatV2Time, V2Frame } from "./console-v2-resource";

type SourceState<T> = { data?: T; loading: boolean; error?: string; observedAt?: string };

export function OverviewV2Page() {
  const [overviewState, setOverviewState] = useState<SourceState<ConsoleV2Overview>>({ loading: true });
  const [runtimeState, setRuntimeState] = useState<SourceState<ConsoleV2Runtime>>({ loading: true });
  const [datasetsState, setDatasetsState] = useState<SourceState<DatasetRotationData>>({ loading: true });
  const [questionsState, setQuestionsState] = useState<SourceState<GeneratedQAList>>({ loading: true });
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = <T,>(setState: (state: SourceState<T>) => void, request: () => Promise<{ data: T }>, observedAt: (data: T) => string | undefined = () => undefined) => {
      setState({ loading: true });
      void request().then((result) => { if (!cancelled) setState({ data: result.data, loading: false, observedAt: observedAt(result.data) }); }).catch((cause: unknown) => { if (!cancelled) setState({ loading: false, error: cause instanceof Error ? cause.message : "接口不可用" }); });
    };
    load(setOverviewState, consoleV2.infra.overview, (data) => data.observedAt);
    load(setRuntimeState, consoleV2.trading.runtime, (data) => data.observedAt);
    load(setDatasetsState, consoleApi.datasetRotation, (data) => data.observedAt);
    load(setQuestionsState, () => consoleApi.generatedQAs({ limit: 1 }), (data) => data.observedAt);
    return () => { cancelled = true; };
  }, [refreshKey]);

  const overview = overviewState.data;
  const runtime = runtimeState.data;
  const generation = overview?.currentGeneration;
  const loading = overviewState.loading || runtimeState.loading;
  return <V2Frame eyebrow="运行概览" title="运行概览" description="从当前业务状态开始，按市场与预测、数据集、题目和交易继续追查。" observedAt={overview?.observedAt} onRefresh={() => setRefreshKey((value) => value + 1)} loading={loading}>
    <section className="home-business-grid" aria-label="业务概览">
      <HomeCard title="市场与预测" caption="当前发布成员、预测资格和任务覆盖" links={[{ href: "/markets/running", label: "进入当前市场" }, { href: "/predictions", label: "查看预测" }]}>
        <HomeSourcePanel title="市场" state={overviewState} onRetry={() => setRefreshKey((value) => value + 1)}><HomeFacts values={[{ label: "当前成员", value: generation ? formatV2Number(generation.memberCount, 0) : "—" }, { label: "可预测", value: generation ? formatV2Number(generation.predictionEnabledCount, 0) : "—" }, { label: "状态", value: generation?.status ?? "—" }]}><details className="home-audit"><summary>发布来源</summary><span>批次 {generation?.generationId ?? "—"} · 选盘 {generation?.sourceSelectionRunId ?? "—"}</span></details></HomeFacts></HomeSourcePanel>
        <HomeSourcePanel title="Direct 当前维护任务" state={overviewState} onRetry={() => setRefreshKey((value) => value + 1)}><HomeFacts values={[{ label: "预期任务", value: formatV2Number(overview?.predictionCoverage?.expectedTaskCount, 0) }, { label: "已完成", value: formatV2Number(overview?.predictionCoverage?.completedTaskCount, 0) }, { label: "待完成", value: formatV2Number(overview?.predictionCoverage?.pendingTaskCount, 0) }]}><span className="home-caption">仅统计 Direct 当前维护任务；不包含 Sandbox 模型结果。信息时点 {formatV2Time(overview?.predictionCoverage?.predictionAsOf)}</span></HomeFacts></HomeSourcePanel>
      </HomeCard>
      <HomeCard title="数据集轮转" caption="四种资料类型的当前版本与训练集合" links={[{ href: "/dataset-rotation", label: "查看数据集轮转" }, { href: "/sandboxes", label: "查看 Sandbox" }]}>
        <HomeSourcePanel title="数据集版本" state={datasetsState} onRetry={() => setRefreshKey((value) => value + 1)}><DatasetTypeSummary data={datasetsState.data} /><span className="home-caption">固定测试和累计训练下载在数据集轮转中按资料类型选择</span></HomeSourcePanel>
      </HomeCard>
      <HomeCard title="题目" caption="题目总数与待关注状态" links={[{ href: "/questions", label: "进入题目库" }]}>
        <HomeSourcePanel title="题目状态" state={questionsState} onRetry={() => setRefreshKey((value) => value + 1)}><HomeFacts values={[{ label: "题目总数", value: questionsState.data ? formatV2Number(questionsState.data.total, 0) : "—" }, { label: "等待中", value: questionsState.data ? formatV2Number(questionsState.data.statusCounts.PENDING, 0) : "—" }, { label: "未解决", value: questionsState.data ? formatV2Number(questionsState.data.statusCounts.UNRESOLVED, 0) : "—" }]}><span className="home-caption">题目定义、时间依据和结果审计在题目库查看</span></HomeFacts></HomeSourcePanel>
      </HomeCard>
      <HomeCard title="交易" caption="运行状态、账户数据与待处理事项" links={[{ href: "/trading", label: "进入交易工作区" }, { href: "/live", label: "打开实盘视图" }]}>
        <HomeSourcePanel title="运行与账户" state={runtimeState} onRetry={() => setRefreshKey((value) => value + 1)}><HomeFacts values={[{ label: "Runner", value: runtime ? runtimeStatus(runtime) : "—" }, { label: "账户事实", value: runtime ? (runtime.accountDataState === "available" ? `${runtime.accounts.length} 个` : "未采集") : "—" }, { label: "开放问题", value: runtime ? formatV2Number(runtime.accounts.reduce((sum, account) => sum + (account.openIssueCount ?? 0), 0), 0) : "—" }]}><span className="home-caption">进入交易工作区核对最近决策、订单与账户差异</span></HomeFacts></HomeSourcePanel>
      </HomeCard>
    </section>
  </V2Frame>;
}
function HomeCard({ title, caption, links, children }: { title: string; caption: string; links: Array<{ href: string; label: string }>; children: React.ReactNode }) {
  return <section className="home-business-card"><header className="home-card-head"><div><h2>{title}</h2><p>{caption}</p></div><nav aria-label={`${title}入口`}>{links.map((link) => <a key={link.href} href={link.href}>{link.label} <span aria-hidden="true">→</span></a>)}</nav></header>{children}</section>;
}

function HomeSourcePanel({ title, state, onRetry, children }: { title: string; state: SourceState<unknown>; onRetry: () => void; children: React.ReactNode }) {
  return <section className="home-source-panel"><div className="home-source-head"><strong>{title}</strong><span className={`home-source-state ${state.error ? "error" : state.loading ? "loading" : "ready"}`}>{state.error ? "不可用" : state.loading ? "读取中" : "已观测"}</span></div>{state.error ? <div className="home-source-error"><p>{state.error}</p><button type="button" className="button" onClick={onRetry}>重试</button></div> : state.loading ? <div className="home-skeleton" aria-label={`${title}读取中`}><i /><i /><i /></div> : children}{state.observedAt && <small className="home-freshness">观测于 {formatV2Time(state.observedAt)}</small>}</section>;
}

function HomeFacts({ values, children }: { values: Array<{ label: string; value: React.ReactNode }>; children?: React.ReactNode }) {
  return <><div className="home-facts">{values.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>{children}</>;
}

function DatasetTypeSummary({ data }: { data?: DatasetRotationData }) {
  const labels: Record<RotationVariant, string> = { mv: "MV", ms: "MS", original: "original", syn: "Syn" };
  return <div className="home-dataset-types">{ROTATION_VARIANTS.map((variant) => {
    const current = data?.currentVersions.find((item) => item.variant === variant);
    const train = data?.trainingSets.find((item) => item.variant === variant);
    return <div className="home-dataset-type" key={variant}><strong>{labels[variant]}</strong><span>{current?.datasetVersion ?? "暂无已发布版本"}</span><small>测试 {current ? formatV2Number(current.testCount, 0) : "—"} · 累计训练 {train ? formatV2Number(train.count, 0) : "—"}</small></div>;
  })}</div>;
}

function runtimeStatus(runtime: ConsoleV2Runtime) {
  const raw = runtime.runner.state ?? runtime.runner.running ?? runtime.runner.enabled;
  if (raw === true || raw === "running" || raw === "enabled") return "running";
  if (raw === false || raw === "disabled" || raw === "stopped") return "disabled";
  return String(raw ?? "unknown");
}
