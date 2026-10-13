"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { consoleApi } from "../lib/console-api";
import { demoServiceMetrics } from "../lib/demo-service-metrics";
import type { RedisMonitorData } from "../lib/redis-monitor";
import type { ApiMode, ServiceMetricsOverview, ServiceRuntimeMetrics } from "../lib/types";
import { ConsoleShell } from "./console-shell";
import { Icon } from "./icons";

type HistoryPoint = { at: string; values: Record<string, number> };

const labels: Record<ServiceRuntimeMetrics["service"], { name: string; role: string; short: string }> = {
  "prediction-infra": { name: "Prediction Infra", role: "选盘、Sandbox 与预测链路", short: "PI" },
  "trading-execution": { name: "Trading Execution", role: "订单执行、风控与交易账本", short: "TE" },
};

export function ServiceMetricsDashboard() {
  const [data, setData] = useState<ServiceMetricsOverview>();
  const [mode, setMode] = useState<ApiMode>("live");
  const [error, setError] = useState<string>();
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [refreshSeconds, setRefreshSeconds] = useState(5);
  const [loading, setLoading] = useState(true);
  const [redisData, setRedisData] = useState<RedisMonitorData>();
  const [redisError, setRedisError] = useState<string>();
  const [redisLoading, setRedisLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setRedisLoading(true);
    const [serviceResult, redisResult] = await Promise.allSettled([consoleApi.serviceMetrics(), consoleApi.redisMonitor()]);

    if (serviceResult.status === "fulfilled") {
      const result = serviceResult.value;
      const hasLiveService = result.data.services.some((service) => service.status !== "unavailable");
      const next = hasLiveService ? result.data : demoServiceMetrics();
      setData(next);
      setMode(hasLiveService ? result.mode : "demo");
      setError(hasLiveService ? undefined : "两个服务尚未配置监控连接，当前展示产品预览数据。");
      appendHistory(setHistory, next);
    } else {
      const next = demoServiceMetrics();
      setData(next);
      setMode("demo");
      setError(serviceResult.reason instanceof Error ? serviceResult.reason.message : "监控聚合接口不可用");
      appendHistory(setHistory, next);
    }

    if (redisResult.status === "fulfilled") {
      setRedisData(redisResult.value.data);
      setRedisError(undefined);
    } else {
      setRedisData(undefined);
      setRedisError(redisResult.reason instanceof Error ? redisResult.reason.message : "Redis 监控接口不可用");
    }
    setRedisLoading(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), refreshSeconds * 1000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load, refreshSeconds]);

  const summary = useMemo(() => summarize(data?.services ?? []), [data]);

  return <ConsoleShell>
    <header className="page-head service-page-head">
      <div><p className="eyebrow">Service Observability</p><h1>服务监控</h1><p className="description">Prediction Infra 与 Trading Execution 的实时资源和请求负载。</p></div>
      <div className="service-head-actions">
        <label className="refresh-select">自动刷新
          <select value={refreshSeconds} onChange={(event) => setRefreshSeconds(Number(event.target.value))} aria-label="自动刷新间隔">
            <option value={5}>5 秒</option><option value={15}>15 秒</option><option value={30}>30 秒</option>
          </select>
        </label>
        <button className="button" onClick={() => void load()} disabled={loading}><Icon name="refresh" /> {loading ? "刷新中" : "立即刷新"}</button>
      </div>
    </header>

    {mode === "demo" && <div className="notice live-preview-notice"><div><strong>Go 服务指标为演示数据</strong><p>{error} Redis 数据独立来自 Redis 实际接口，不受该演示状态影响。</p></div></div>}

    <section className="service-summary" aria-label="服务监控摘要">
      <Summary label="可用服务" value={`${summary.available} / 2`} meta={summary.available === 2 ? "全部通过就绪检查" : "存在不可用服务"} tone={summary.available === 2 ? "positive" : "warning"} />
      <Summary label="合计 QPS" value={decimal(summary.qps, 1)} meta="近 1 分钟平均" />
      <Summary label="平均 CPU" value={`${decimal(summary.cpu, 1)}%`} meta="Go 调度器容量占用" />
      <Summary label="内存占用" value={summary.memoryPercent === undefined ? "—" : `${decimal(summary.memoryPercent, 1)}%`} meta={`${bytes(summary.memoryBytes)} 当前使用`} />
    </section>

    <RedisMonitorPanel data={redisData} error={redisError} loading={redisLoading} />

    <section className="section">
      <div className="section-head"><div><h2 className="section-title">服务实例</h2><p className="section-caption">指标窗口 60 秒 · 健康状态来自 readiness 检查</p></div><span className="mono muted">{utc(data?.observedAt)}</span></div>
      <div className="service-card-grid">
        {(data?.services ?? []).map((service) => <ServiceCard key={service.service} service={service} history={history} />)}
        {!data && <><ServiceCardSkeleton /><ServiceCardSkeleton /></>}
      </div>
    </section>

    <section className="section service-bottom-grid">
      <div>
        <div className="section-head"><h2 className="section-title">请求窗口</h2></div>
        <div className="panel service-table-wrap"><table className="service-table"><thead><tr><th>服务</th><th>请求总量</th><th>平均延迟</th><th>峰值延迟</th><th>5xx 比例</th></tr></thead><tbody>
          {(data?.services ?? []).map((service) => <tr key={service.service}><td className="primary-cell">{labels[service.service].name}</td><td className="mono">{integer(service.requests.total)}</td><td className="mono">{decimal(service.requests.avgLatencyMs, 1)} ms</td><td className="mono">{decimal(service.requests.maxLatencyMs, 1)} ms</td><td className={`mono ${service.requests.errorRate > 1 ? "negative" : service.requests.errorRate > .2 ? "warning" : "positive"}`}>{decimal(service.requests.errorRate, 2)}%</td></tr>)}
        </tbody></table></div>
      </div>
      <div>
        <div className="section-head"><h2 className="section-title">采集口径</h2></div>
        <div className="panel panel-pad metric-notes">
          <MetricNote title="QPS 与错误率" detail="应用请求的 60 秒滚动窗口；健康探针和本页轮询不计入。" />
          <MetricNote title="CPU" detail="当前 Go 运行时调度容量的区间占用，范围 0–100%。" />
          <MetricNote title="内存" detail="容器部署读取 cgroup 使用量与限制；非容器环境展示进程运行时内存。" />
        </div>
      </div>
    </section>
  </ConsoleShell>;
}

function RedisMonitorPanel({ data, error, loading }: { data?: RedisMonitorData; error?: string; loading: boolean }) {
  const cacheCategories = data?.keys.categories.filter((category) => category.kind === "cache") ?? [];
  const streamCategories = data?.keys.categories.filter((category) => category.kind === "stream") ?? [];
  const status = data ? redisStatus(data.status) : "等待采样";
  const hasSnapshot = Boolean(data && data.status !== "disabled" && data.status !== "unavailable");
  const statusTone = data?.status === "ok" ? "positive" : data?.status === "degraded" || data?.status === "stale" ? "warning" : "";

  return <section className="section redis-monitor-section" aria-label="Redis 监控">
    <div className="section-head">
      <div><h2 className="section-title">Redis 队列监控</h2><p className="section-caption">Redis 只读共享快照 · 业务消息与缓存分开统计</p></div>
      <span className="mono muted">{utc(data?.sampledAt)}</span>
    </div>

    {error && <div className="notice live-error-notice redis-monitor-notice"><div><strong>Redis 监控暂不可用</strong><p>{error}</p></div></div>}
    {!error && data?.status === "disabled" && <div className="notice redis-monitor-notice"><div><strong>Redis 监控未启用</strong><p>后端未开启 Redis 监控采样，页面不会用演示数据或零值代替真实状态。</p></div></div>}
    {!error && data?.status === "unavailable" && <div className="notice live-error-notice redis-monitor-notice"><div><strong>Redis 实例暂时不可用</strong><p>尚未取得有效容量快照，请稍后刷新。</p></div></div>}
    {data && (data.status === "degraded" || data.status === "stale") && <div className="notice redis-monitor-notice"><div><strong>{data.status === "stale" ? "Redis 快照已过时" : "Redis 快照部分可用"}</strong><p>{redisErrors(data.errors).join("；") || "部分明细采集失败，当前数值请结合采样时间判断。"}</p></div></div>}

    {loading && !data && <div className="panel panel-pad redis-monitor-loading"><div className="skeleton" /><div className="skeleton tall" /></div>}
    {!loading && !data && !error && <div className="panel redis-monitor-empty"><strong>等待 Redis 监控快照</strong><p>首次采样完成后显示容量、消息消费和分类占用。</p></div>}

    {data && hasSnapshot && <>
      <section className="redis-capacity-summary" aria-label="Redis 容量摘要">
        <Summary label="采样状态" value={status} meta={data.stale ? "数据已超过采样窗口" : "来自后端共享快照"} tone={statusTone} />
        <Summary label="实际用量" value={bytes(data.instance.usedMemoryBytes)} meta={data.instance.maxMemoryConfigured ? `上限 ${bytes(data.instance.maxMemoryBytes)}` : "未设置 maxmemory"} />
        <Summary label="使用率" value={data.instance.maxMemoryConfigured ? `${decimal(data.instance.usagePercent, 1)}%` : "—"} meta={data.instance.maxMemoryConfigured ? "80% 提醒 · 90% 高风险" : "无有效上限，不计算百分比"} tone={redisLevelTone(data.instance.level)} />
        <Summary label="Key 总数" value={integer(data.keys.totalKeys)} meta={data.keys.scanComplete ? `已扫描 ${integer(data.keys.scannedKeys)}` : `已扫描 ${integer(data.keys.scannedKeys)} · 部分`} />
      </section>
      <div className="redis-monitor-meta">
        <span className={`health-badge ${redisHealthClass(data.instance.level)}`}><i />{redisLevelText(data.instance.level)}</span>
        {data.instance.evictionPolicy && <span>淘汰策略：<strong>{data.instance.evictionPolicy}</strong></span>}
        <span>清理策略：<strong>{cleanupText(data.cleanup)}</strong></span>
        {data.keys.scanComplete ? <span>分类统计已完成</span> : <span className="warning">分类统计受扫描上限影响</span>}
      </div>

      <div className="redis-monitor-grid">
        <div>
          <div className="section-head"><div><h3 className="section-title">Stream 消息</h3><p className="section-caption">消息数、估算占用及消费组 lag / pending</p></div></div>
          <div className="panel service-table-wrap"><table className="service-table redis-table"><thead><tr><th>业务类别</th><th>消息数</th><th>估算占用</th><th>消费组状态</th></tr></thead><tbody>
            {data.streams.map((stream) => <tr key={stream.key}><td className="primary-cell">{redisCategoryLabel(stream.category)}</td><td className="mono">{integer(stream.length)}</td><td className="mono">{bytes(stream.estimatedBytes)}</td><td className="redis-groups">{stream.error ? <span className="negative">{streamErrorText(stream.error)}</span> : stream.groups.length ? stream.groups.map((group) => <span key={group.name}><strong>{group.name}</strong> · lag {nullableInteger(group.lag)} · pending {nullableInteger(group.pending)}</span>) : <span className="muted">无消费组</span>}</td></tr>)}
            {!data.streams.length && <tr><td colSpan={4} className="muted">未发现 Stream</td></tr>}
          </tbody></table></div>
          {streamCategories.length > 0 && <p className="redis-footnote">Stream 分类合计：{streamCategories.map((category) => `${redisCategoryLabel(category.name)} ${bytes(category.estimatedBytes)}`).join(" · ")}</p>}
        </div>
        <div>
          <div className="section-head"><div><h3 className="section-title">缓存与标记</h3><p className="section-caption">分项为 MEMORY USAGE 估算，不替代实例实际用量</p></div></div>
          <div className="panel service-table-wrap"><table className="service-table redis-table"><thead><tr><th>业务类别</th><th>Key 数</th><th>估算占用</th></tr></thead><tbody>
            {cacheCategories.map((category) => <tr key={category.name}><td className="primary-cell">{redisCategoryLabel(category.name)}</td><td className="mono">{integer(category.keyCount)}</td><td className="mono">{bytes(category.estimatedBytes)}</td></tr>)}
            {!cacheCategories.length && <tr><td colSpan={3} className="muted">未发现非 Stream Key</td></tr>}
          </tbody></table></div>
          <p className="redis-footnote">清理状态：{cleanupText(data.cleanup)}{data.cleanup.message ? ` · ${data.cleanup.message}` : ""}</p>
        </div>
      </div>
    </>}
  </section>;
}

function ServiceCard({ service, history }: { service: ServiceRuntimeMetrics; history: HistoryPoint[] }) {
  const meta = labels[service.service];
  const available = service.status !== "unavailable";
  const memoryValue = service.memory.usagePercent;
  const points = history.map((point) => point.values[service.service] ?? 0);
  return <article className={`service-card ${service.status}`}>
    <header className="service-card-head"><span className="service-avatar">{meta.short}</span><div><h3>{meta.name}</h3><p>{meta.role}</p></div><Health status={service.status} /></header>
    {!available && <div className="service-unavailable"><strong>暂时无法采集指标</strong><span>{service.reason ?? "服务未返回监控数据"}</span></div>}
    <div className={`service-vitals ${!available ? "dimmed" : ""}`}>
      <Vital label="请求速率" value={available ? decimal(service.requests.qps, 1) : "—"} unit="QPS" detail="近 1 分钟" />
      <Vital label="CPU 使用率" value={available ? decimal(service.cpu.usagePercent, 1) : "—"} unit="%" detail={`${service.cpu.gomaxprocs || "—"} GOMAXPROCS`} meter={available ? service.cpu.usagePercent : undefined} />
      <Vital label="内存占用率" value={available && memoryValue !== undefined ? decimal(memoryValue, 1) : "—"} unit={memoryValue === undefined ? "" : "%"} detail={available ? `${bytes(service.memory.usageBytes)} / ${service.memory.limitBytes ? bytes(service.memory.limitBytes) : "未设限制"}` : "等待指标"} meter={available ? memoryValue : undefined} />
    </div>
    <div className="service-trend"><div className="service-trend-head"><span>QPS 趋势</span><strong>{points.length ? `${points.length} 个采样点` : "等待采样"}</strong></div><TrendBars points={points} /></div>
    <footer className="service-runtime-row">
      <RuntimeItem label="平均延迟" value={`${decimal(service.requests.avgLatencyMs, 1)} ms`} />
      <RuntimeItem label="5xx" value={`${decimal(service.requests.errorRate, 2)}%`} />
      <RuntimeItem label="Goroutines" value={integer(service.runtime.goroutines)} />
      <RuntimeItem label="已运行" value={duration(service.uptimeSeconds)} />
    </footer>
  </article>;
}

function TrendBars({ points }: { points: number[] }) {
  const display = points.length ? points : [0, 0, 0, 0, 0, 0, 0, 0];
  const maximum = Math.max(...display, 1);
  return <div className="trend-bars" aria-label="QPS 趋势图">{display.map((value, index) => <i key={`${index}-${value}`} style={{ height: `${Math.max(value / maximum * 100, 5)}%` }} />)}</div>;
}

function Vital({ label, value, unit, detail, meter }: { label: string; value: string; unit: string; detail: string; meter?: number }) {
  const tone = meter !== undefined && meter >= 85 ? "danger" : meter !== undefined && meter >= 70 ? "warning" : "safe";
  return <div className="service-vital"><span>{label}</span><div><strong>{value}</strong><small>{unit}</small></div>{meter !== undefined && <div className="meter"><i className={tone} style={{ width: `${Math.min(Math.max(meter, 0), 100)}%` }} /></div>}<p>{detail}</p></div>;
}

function Health({ status }: { status: ServiceRuntimeMetrics["status"] }) {
  const text = status === "healthy" ? "运行正常" : status === "degraded" ? "服务降级" : "不可用";
  return <span className={`health-badge ${status}`}><i />{text}</span>;
}

function Summary({ label, value, meta, tone = "" }: { label: string; value: string; meta: string; tone?: string }) {
  return <div className="summary-cell"><span>{label}</span><strong className={tone}>{value}</strong><small>{meta}</small></div>;
}

function RuntimeItem({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
function MetricNote({ title, detail }: { title: string; detail: string }) { return <div><i /><p><strong>{title}</strong><span>{detail}</span></p></div>; }
function ServiceCardSkeleton() { return <div className="service-card"><div className="skeleton" /><div className="skeleton tall" /><div className="skeleton" /></div>; }

function appendHistory(setter: React.Dispatch<React.SetStateAction<HistoryPoint[]>>, data: ServiceMetricsOverview) {
  const point = { at: data.observedAt, values: Object.fromEntries(data.services.map((service) => [service.service, service.requests.qps])) };
  setter((current) => [...current, point].slice(-24));
}

const redisCategoryNames: Record<string, string> = {
  sandbox_build: "Sandbox 构建",
  sandbox_ready_legacy: "原 Ready",
  sandbox_ready_new: "新 Ready",
  direct_prediction: "Direct 预测",
  selected_market_notice: "选盘通知",
  backtest_probability: "回测概率",
  dataset_select: "数据集选题",
  dataset_mask: "MV 补建任务",
  dataset_sanitize: "MS 清洗任务",
  generated_dead_letter_or_event: "Generated 死信 / 事件",
  selection_conditions: "选盘条件索引",
  selection_cached_markers: "选盘 cached 标记",
  selection_run_payload: "选盘批次缓存",
  selection_current_pointer: "当前选盘指针",
  direct_generation_markers: "Direct 完成标记",
  other_stream: "其他 Stream",
  other_cache: "其他缓存",
  // 后端也可能直接返回 Redis 盘点快照中的 family 名称；统一映射，避免看板退回内部键名。
  prediction_pm_sandboxbuild: "Sandbox 构建",
  prediction_pm_sandboxready: "原 Ready",
  prediction_pm_sandboxready_new: "新 Ready",
  prediction_pm_directprediction: "Direct 任务",
  prediction_pm_selectedmarkets: "选盘通知",
  prediction_pm_backtestprob: "回测概率",
  prediction_pm_dataset_select: "数据集选题",
  prediction_pm_dataset_mask: "MV 补建任务",
  prediction_pm_dataset_sanitize: "MS 清洗任务",
  prediction_pm_liveprediction: "历史 Live 流",
  prediction_generated_market_events: "Generated 事件",
  "prediction_generated_market_events:dlq": "Generated 死信",
  prediction_generated_qa_terminal_events: "QA 终态通知",
  selection_run_conditions: "选盘条件索引",
  selection_run_cached_markers: "选盘 cached 标记",
  "prediction:selected_markets:current": "当前选盘指针",
};

function redisCategoryLabel(value: string): string { return redisCategoryNames[value] ?? value; }

function redisStatus(value: RedisMonitorData["status"]): string {
  switch (value) {
    case "ok": return "采样正常";
    case "degraded": return "采样部分可用";
    case "stale": return "采样已过时";
    case "disabled": return "采样未启用";
    default: return "采样不可用";
  }
}

function redisLevelText(value: RedisMonitorData["instance"]["level"]): string {
  switch (value) {
    case "normal": return "容量正常";
    case "warning": return "容量达到 80% 提醒线";
    case "critical": return "容量达到 90% 高风险线";
    default: return "容量上限未知";
  }
}

function redisLevelTone(value: RedisMonitorData["instance"]["level"]): string {
  return value === "critical" ? "critical" : value === "warning" ? "warning" : value === "normal" ? "positive" : "";
}

function redisHealthClass(value: RedisMonitorData["instance"]["level"]): string {
  return value === "normal" ? "healthy" : value === "critical" ? "critical" : value === "unknown" ? "unavailable" : "degraded";
}

function cleanupText(cleanup: RedisMonitorData["cleanup"]): string {
  const retention = `完成超过 ${cleanup.retentionDays} 天逐条清理`;
  switch (cleanup.status) {
    case "not_enabled": return `未接入（${retention}）`;
    case "unknown": return `待首次执行（${retention}）`;
    case "ok": return `已启用（${retention}）`;
    case "degraded": return `部分可用（${retention}）`;
  }
}

function redisErrors(errors: string[]): string[] {
  const labels: Record<string, string> = {
    redis_maxmemory_unconfigured: "未配置 Redis maxmemory",
    redis_keyspace_unavailable: "Key 总数暂不可用",
    redis_key_scan_partial: "Key 扫描部分失败",
    redis_key_scan_bounded: "Key 扫描达到采样上限",
    redis_key_type_unavailable: "部分 Key 类型读取失败",
    redis_key_memory_unavailable: "部分 Key 占用读取失败",
    redis_stream_info_unavailable: "部分 Stream 信息读取失败",
    redis_stream_groups_unavailable: "部分消费组信息读取失败",
    redis_sample_failed: "Redis 实例采样失败",
  };
  return errors.map((error) => labels[error] ?? "Redis 明细部分不可用");
}

function streamErrorText(error: string): string {
  return error === "redis_stream_groups_unavailable" ? "消费组不可用" : error === "redis_stream_info_unavailable" ? "Stream 信息不可用" : "明细不可用";
}

function nullableInteger(value?: number): string { return value === undefined ? "—" : integer(value); }

function summarize(services: ServiceRuntimeMetrics[]) {
  const available = services.filter((service) => service.status !== "unavailable");
  const memoryWithLimit = available.filter((service) => service.memory.usagePercent !== undefined);
  return {
    available: services.filter((service) => service.status === "healthy").length,
    qps: available.reduce((sum, service) => sum + service.requests.qps, 0),
    cpu: available.length ? available.reduce((sum, service) => sum + service.cpu.usagePercent, 0) / available.length : 0,
    memoryBytes: available.reduce((sum, service) => sum + service.memory.usageBytes, 0),
    memoryPercent: memoryWithLimit.length ? memoryWithLimit.reduce((sum, service) => sum + (service.memory.usagePercent ?? 0), 0) / memoryWithLimit.length : undefined,
  };
}

const decimal = (value: number, digits: number) => Number.isFinite(value) ? value.toFixed(digits) : "—";
const integer = (value: number) => Number.isFinite(value) ? new Intl.NumberFormat("zh-CN").format(value) : "—";
const bytes = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  if (value < 1_024) return `${Math.round(value)} B`;
  if (value < 1_048_576) return `${decimal(value / 1_024, value < 10_240 ? 1 : 0)} KB`;
  if (value < 1_073_741_824) return `${decimal(value / 1_048_576, value < 10_485_760 ? 2 : 0)} MB`;
  return `${decimal(value / 1_073_741_824, 2)} GB`;
};
const utc = (value?: string) => value ? new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC") : "等待首次采样";
function duration(seconds: number) { const days = Math.floor(seconds / 86_400); const hours = Math.floor((seconds % 86_400) / 3_600); return days ? `${days}天 ${hours}小时` : `${hours}小时`; }
