"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { consoleApi } from "../lib/console-api";
import { demoServiceMetrics } from "../lib/demo-service-metrics";
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await consoleApi.serviceMetrics();
      const hasLiveService = result.data.services.some((service) => service.status !== "unavailable");
      const next = hasLiveService ? result.data : demoServiceMetrics();
      setData(next);
      setMode(hasLiveService ? result.mode : "demo");
      setError(hasLiveService ? undefined : "两个服务尚未配置监控连接，当前展示产品预览数据。");
      appendHistory(setHistory, next);
    } catch (requestError) {
      const next = demoServiceMetrics();
      setData(next);
      setMode("demo");
      setError(requestError instanceof Error ? requestError.message : "监控聚合接口不可用");
      appendHistory(setHistory, next);
    } finally {
      setLoading(false);
    }
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

    {mode === "demo" && <div className="notice live-preview-notice"><div><strong>当前为演示数据</strong><p>{error} 接通服务后页面会自动切换为真实指标。</p></div></div>}

    <section className="service-summary" aria-label="服务监控摘要">
      <Summary label="可用服务" value={`${summary.available} / 2`} meta={summary.available === 2 ? "全部通过就绪检查" : "存在不可用服务"} tone={summary.available === 2 ? "positive" : "warning"} />
      <Summary label="合计 QPS" value={decimal(summary.qps, 1)} meta="近 1 分钟平均" />
      <Summary label="平均 CPU" value={`${decimal(summary.cpu, 1)}%`} meta="Go 调度器容量占用" />
      <Summary label="内存占用" value={summary.memoryPercent === undefined ? "—" : `${decimal(summary.memoryPercent, 1)}%`} meta={`${bytes(summary.memoryBytes)} 当前使用`} />
    </section>

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
const bytes = (value: number) => value >= 1_073_741_824 ? `${decimal(value / 1_073_741_824, 2)} GB` : `${decimal(value / 1_048_576, 0)} MB`;
const utc = (value?: string) => value ? new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC") : "等待首次采样";
function duration(seconds: number) { const days = Math.floor(seconds / 86_400); const hours = Math.floor((seconds % 86_400) / 3_600); return days ? `${days}天 ${hours}小时` : `${hours}小时`; }
