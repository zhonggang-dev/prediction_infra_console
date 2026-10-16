"use client";

import { useEffect, useState } from "react";
import { consoleV2, type ConsoleV2Overview, type ConsoleV2Runtime } from "../lib/console-v2";
import { formatV2Number, formatV2Time, V2Facts, V2Frame, V2Notice, v2Bool, v2Status, v2Unknown } from "./console-v2-resource";

export function OverviewV2Page() {
  const [overview, setOverview] = useState<ConsoleV2Overview>();
  const [runtime, setRuntime] = useState<ConsoleV2Runtime>();
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setOverview(undefined);
      setRuntime(undefined);
      setErrors([]);
      void Promise.allSettled([consoleV2.infra.overview(), consoleV2.trading.runtime()]).then((results) => {
        if (cancelled) return;
        const messages: string[] = [];
        const infra = results[0];
        const trading = results[1];
        if (infra.status === "fulfilled") setOverview(infra.value.data); else { setOverview(undefined); messages.push(infra.reason instanceof Error ? `Infra：${infra.reason.message}` : "Infra：接口不可用"); }
        if (trading.status === "fulfilled") setRuntime(trading.value.data); else { setRuntime(undefined); messages.push(trading.reason instanceof Error ? `Trading：${trading.reason.message}` : "Trading：接口不可用"); }
        setErrors(messages);
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [refreshKey]);

  const generation = overview?.currentGeneration;
  return <V2Frame eyebrow="运行概览 / 新版" title="运行概览" description="首页以当前发布批次、长期运行池和真实交易运行状态为主；历史累计不再拼成当前漏斗。" observedAt={overview?.observedAt} onRefresh={() => setRefreshKey((value) => value + 1)} loading={loading}>
    {errors.map((error) => <V2Notice key={error} error title="部分运行数据不可用" description={error} />)}
    <div className="v2-summary-grid">
      <Summary label="当前发布批次" value={generation?.generationId} meta={generation ? `${generation.status} · ${formatV2Time(generation.observedAt)}` : "没有可用当前发布批次"} unknown={!generation} />
      <Summary label="当前发布成员" value={formatV2Number(generation?.memberCount, 0)} meta={`可预测数：${formatV2Number(generation?.predictionEnabledCount, 0)}`} unknown={generation?.memberCount === null || generation?.memberCount === undefined} />
      <Summary label="长期运行池" value={formatV2Number(overview?.activePoolCount, 0)} meta={overview?.poolDiffersFromGeneration === null || overview?.poolDiffersFromGeneration === undefined ? "成员集合差异：未知" : `与当前批次差异：${overview.poolDiffersFromGeneration ? "有" : "无"}`} unknown={overview?.activePoolCount === null || overview?.activePoolCount === undefined} />
      <Summary label="交易运行状态" value={runtime ? runtimeStatus(runtime) : "未知"} meta={runtime ? `观测于 ${formatV2Time(runtime.observedAt)}` : "未配置或接口不可用"} unknown={!runtime} />
    </div>
    <section className="section v2-runtime-grid">
      <div className="v2-runtime-card"><div className="section-head"><h2 className="section-title">当前发布批次</h2>{v2Status(generation?.status, generation ? generation.status : "未知")}</div>{generation ? <V2Facts values={[{ label: "发布批次 ID", value: generation.generationId, mono: true }, { label: "来源选盘批次", value: generation.sourceSelectionRunId, mono: true }, { label: "发布时间", value: formatV2Time(generation.publishedAt) }, { label: "当前", value: v2Bool(generation.isCurrent) }]} /> : <div className="empty"><strong>当前发布批次未知</strong><p>接口没有返回当前发布批次，不生成 0 或“正常”。</p></div>}</div>
      <div className="v2-runtime-card"><div className="section-head"><h2 className="section-title">交易运行状态 / 绑定</h2>{v2Status(runtime ? runtimeStatus(runtime) : "unknown", runtime ? runtimeStatus(runtime) : "未知")}</div>{runtime ? <><V2Facts values={[{ label: "观测时间", value: formatV2Time(runtime.observedAt) }, { label: "绑定数", value: String(runtime.bindings.length) }, { label: "运行状态", value: v2Unknown(runtime.runner.state ?? runtime.runner.running ?? runtime.runner.enabled) }, { label: "最近错误", value: runtime.runner.hasLastError ? v2Unknown(runtime.runner.lastErrorCode) : "无" }, { label: "订单提交", value: v2Unknown(runtime.submission.order_submission_enabled) }]} /><details className="v2-json-disclosure"><summary>查看安全运行摘要</summary><pre>{JSON.stringify({ runner: runtime.runner, bindings: runtime.bindings, submission: runtime.submission }, null, 2)}</pre></details></> : <div className="empty"><strong>交易运行状态未知</strong><p>服务未返回运行快照，不以旧线程或演示数据代替。</p></div>}</div>
    </section>
    <section className="section v2-hero-note"><strong>链路口径：</strong>running market 成员、预测资格、Direct task、结果回传、策略输出、订单接受、确认成交和账本应用分别由具名接口提供。首页不把某一层的缺失解释为下一层失败。</section>
  </V2Frame>;
}

function Summary({ label, value, meta, unknown }: { label: string; value: React.ReactNode; meta: string; unknown: boolean }) {
  return <div className={`v2-summary-card ${unknown ? "unknown" : ""}`}><span>{label}</span><strong>{value ?? "未知"}</strong><small>{meta}</small></div>;
}

function runtimeStatus(runtime: ConsoleV2Runtime) {
  const raw = runtime.runner.state ?? runtime.runner.running ?? runtime.runner.enabled;
  if (raw === true || raw === "running" || raw === "enabled") return "running";
  if (raw === false || raw === "disabled" || raw === "stopped") return "disabled";
  return String(raw ?? "unknown");
}
