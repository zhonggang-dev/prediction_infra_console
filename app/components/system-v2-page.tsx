"use client";

import { useEffect, useState } from "react";
import { consoleApi } from "../lib/console-api";
import { consoleV2, type ConsoleV2PageJob } from "../lib/console-v2";
import { formatV2Number, formatV2Time, V2Frame, V2ListPage, v2Status, v2Unknown } from "./console-v2-resource";
import { ObservabilityV2Page } from "./observability-v2-page";

export function PageJobsV2Page({ embedded = false }: { embedded?: boolean } = {}) {
  return <V2Frame embedded={embedded} eyebrow="System / Diagnostics" title="网页库任务" description="网页库回填任务仅作为运维诊断保留；日常系统工作区不再展示此入口。"><V2ListPage<ConsoleV2PageJob> title="网页库任务" load={consoleV2.infra.pageJobs} rowKey={(item) => item.jobId} searchPlaceholder="搜索任务、来源、变体或状态" columns={[
    { label: "Job", className: "primary mono", render: (item) => item.jobId },
    { label: "来源 / 资料类型", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.source)}</span><small>{v2Unknown(item.variant)}</small></div> },
    { label: "状态", render: (item) => v2Status(item.status, item.status) },
    { label: "尝试次数", render: (item) => formatV2Number(item.attempts, 0) },
    { label: "发现 / 导入 / 错误", render: (item) => `${formatV2Number(item.discoveredCount, 0)} / ${formatV2Number(item.importedCount, 0)} / ${formatV2Number(item.errorCount, 0)}` },
    { label: "更新时间", render: (item) => formatV2Time(item.updatedAt) },
  ]} emptyDescription="当前没有可查看的网页库任务记录。" /></V2Frame>;
}

export function SettingsV2Page({ embedded = false }: { embedded?: boolean } = {}) {
  const [capabilities, setCapabilities] = useState<{ console_read: boolean; trade_read: boolean; live_read: boolean; backtest_create: boolean; sandbox_download: boolean }>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      setCapabilities(undefined);
      void consoleApi.capabilities().then((result) => { if (!cancelled) { setCapabilities(result.data); setError(undefined); } }).catch((requestError: unknown) => { if (!cancelled) setError(requestError instanceof Error ? requestError.message : "能力接口不可用"); }).finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [refreshKey]);
  return <V2Frame embedded={embedded} eyebrow="System / Diagnostics" title="服务配置诊断" description="这里只显示脱敏后的服务端能力配置；已配置不等于连接健康，真实健康状态请查看服务监控和对应业务页。" onRefresh={() => setRefreshKey((value) => value + 1)} loading={loading}>{error && <div className="notice error"><div><strong>能力接口不可用</strong><p>{error}</p></div><button type="button" className="button" disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}>重试</button></div>}<section className="panel panel-pad v2-capability-list">{capabilities ? <><Capability label="控制台只读" value={capabilities.console_read} /><Capability label="交易只读" value={capabilities.trade_read} /><Capability label="实盘只读" value={capabilities.live_read} /><Capability label="归档下载" value={capabilities.sandbox_download} /></> : <div className="empty"><strong>{loading ? "读取能力…" : "能力未知"}</strong><p>不会以静态绿色图标表示健康。</p></div>}</section><p className="v2-inline-note">令牌、URL、Redis 地址和 webhook 永不下发到浏览器。</p></V2Frame>;
}

export function SystemV2Page({ view = "observability" }: { view?: "observability" | "page-jobs" | "settings" }) {
  if (view === "page-jobs") return <PageJobsV2Page />;
  if (view === "settings") return <SettingsV2Page />;
  return <ObservabilityV2Page />;
}

function Capability({ label, value }: { label: string; value: boolean }) { return <div className="v2-capability-row"><div><strong>{label}</strong><span>{value ? "服务端已配置" : "未配置"}</span></div><span className={`health-badge ${value ? "healthy" : "unavailable"}`}><i />{value ? "已配置" : "不可用"}</span></div>; }
