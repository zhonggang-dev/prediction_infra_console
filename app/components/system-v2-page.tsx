"use client";

import { useEffect, useMemo, useState } from "react";
import { consoleApi } from "../lib/console-api";
import { consoleV2, type ConsoleV2OutboxEvent, type ConsoleV2PageJob } from "../lib/console-v2";
import { formatV2Number, formatV2Time, V2Facts, V2Frame, V2ListPage, V2Tabs, v2Bool, v2Status, v2Unknown } from "./console-v2-resource";

export function DeliveryV2Page() {
  const [status, setStatus] = useState("");
  const params = useMemo(() => ({ status: status || undefined }), [status]);
  return <V2Frame eyebrow="System / Delivery" title="消息交付" description="Outbox 事件与 Redis Stream 消费是不同边界；这里展示状态、尝试次数和时间，不把发布成功写成下游执行成功。"><V2Tabs tabs={[{ href: "/delivery", label: "Outbox 交付" }, { href: "/observability", label: "Redis 与服务监控" }]} active="/delivery" /><V2ListPage<ConsoleV2OutboxEvent> title="Outbox 事件" load={consoleV2.infra.outboxEvents} params={params} controls={<select className="select" aria-label="交付状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="PENDING">PENDING</option><option value="FAILED">FAILED</option><option value="PUBLISHED">PUBLISHED</option></select>} rowKey={(item) => item.outboxEventId} searchPlaceholder="搜索事件、对象或交付 ID" columns={[
    { label: "事件 / Aggregate", className: "primary", render: (item) => <div className="v2-cell-copy"><strong>{item.eventType}</strong><small>{v2Unknown(item.aggregateType)} · {v2Unknown(item.aggregateId)}</small></div> },
    { label: "交付状态", render: (item) => v2Status(item.deliveryStatus, item.deliveryStatus) },
    { label: "尝试次数", render: (item) => formatV2Number(item.attemptCount, 0) },
    { label: "最近尝试", render: (item) => formatV2Time(item.lastAttemptAt) },
    { label: "创建时间", render: (item) => formatV2Time(item.createdAt) },
    { label: "发布时间 / 错误", render: (item) => <div className="v2-cell-copy"><span>{formatV2Time(item.publishedAt)}</span><small>{v2Bool(item.hasLastError, "存在错误", "无错误")}</small></div> },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "交付事件 ID", value: item.outboxEventId, mono: true }, { label: "对象类型", value: v2Unknown(item.aggregateType) }, { label: "对象 ID", value: v2Unknown(item.aggregateId), mono: true }, { label: "尝试次数", value: formatV2Number(item.attemptCount, 0) }, { label: "最近尝试", value: formatV2Time(item.lastAttemptAt) }, { label: "发布时间", value: formatV2Time(item.publishedAt) }, { label: "最近错误", value: v2Bool(item.hasLastError, "存在", "无") }]} />} emptyDescription="暂无 Outbox 安全摘要；Stream entry、consumer group ACK 和 lag 请在 Redis 监控中单独核对。" /></V2Frame>;
}

export function PageJobsV2Page() {
  return <V2Frame eyebrow="System / Page Jobs" title="网页库任务" description="只读展示真实网页库回填作业摘要；依赖未配置或服务返回 503 时明确显示不可用。"><V2Tabs tabs={[{ href: "/system/page-jobs", label: "网页库任务" }, { href: "/settings", label: "连接能力" }]} active="/system/page-jobs" /><V2ListPage<ConsoleV2PageJob> title="网页库任务" load={consoleV2.infra.pageJobs} rowKey={(item) => item.jobId} searchPlaceholder="搜索任务、来源、变体或状态" columns={[
    { label: "Job", className: "primary mono", render: (item) => item.jobId },
    { label: "来源 / 资料变体", render: (item) => <div className="v2-cell-copy"><span>{v2Unknown(item.source)}</span><small>{v2Unknown(item.variant)}</small></div> },
    { label: "状态", render: (item) => v2Status(item.status, item.status) },
    { label: "尝试次数", render: (item) => formatV2Number(item.attempts, 0) },
    { label: "发现 / 导入 / 错误", render: (item) => `${formatV2Number(item.discoveredCount, 0)} / ${formatV2Number(item.importedCount, 0)} / ${formatV2Number(item.errorCount, 0)}` },
    { label: "更新时间", render: (item) => formatV2Time(item.updatedAt) },
  ]} renderDetail={(item) => <V2Facts values={[{ label: "任务 ID", value: item.jobId, mono: true }, { label: "来源", value: v2Unknown(item.source) }, { label: "资料变体", value: v2Unknown(item.variant) }, { label: "尝试次数", value: formatV2Number(item.attempts, 0) }, { label: "发现数", value: formatV2Number(item.discoveredCount, 0) }, { label: "导入数", value: formatV2Number(item.importedCount, 0) }, { label: "错误数", value: formatV2Number(item.errorCount, 0) }, { label: "完成时间", value: formatV2Time(item.completedAt) }]} />} emptyDescription="没有返回网页库作业；页面不从默认公共数据库猜测表或提供重试/清理写操作。" /></V2Frame>;
}

export function SettingsV2Page() {
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
  return <V2Frame eyebrow="System / Settings" title="系统设置" description="这里只显示脱敏后的服务端能力配置；已配置不等于连接健康，真实健康状态请分别查看服务监控与对应业务页。" onRefresh={() => setRefreshKey((value) => value + 1)} loading={loading}><V2Tabs tabs={[{ href: "/settings", label: "连接能力" }, { href: "/observability", label: "服务健康" }]} active="/settings" />{error && <div className="notice error"><div><strong>能力接口不可用</strong><p>{error}</p></div></div>}<section className="panel panel-pad v2-capability-list">{capabilities ? <><Capability label="控制台只读" value={capabilities.console_read} /><Capability label="交易只读" value={capabilities.trade_read} /><Capability label="实盘只读" value={capabilities.live_read} /><Capability label="归档下载" value={capabilities.sandbox_download} /></> : <div className="empty"><strong>{loading ? "读取能力…" : "能力未知"}</strong><p>不会以静态绿色图标表示健康。</p></div>}</section><p className="v2-inline-note">令牌、URL、Redis 地址和 webhook 永不下发到浏览器。旧回测创建能力已停用；新版回测页使用真实产品目录。</p></V2Frame>;
}

function Capability({ label, value }: { label: string; value: boolean }) { return <div className="v2-capability-row"><div><strong>{label}</strong><span>{value ? "服务端已配置" : "未配置"}</span></div><span className={`health-badge ${value ? "healthy" : "unavailable"}`}><i />{value ? "已配置" : "不可用"}</span></div>; }
