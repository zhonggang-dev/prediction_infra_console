"use client";

import { useEffect, useState } from "react";
import { consoleApi } from "../lib/console-api";
import { consoleV2, type ConsoleV2ServiceMetric } from "../lib/console-v2";
import { formatV2Bytes, formatV2Number, formatV2Time, V2Frame, V2Notice, v2Status, v2Unknown } from "./console-v2-resource";
import { RedisMonitorPanel } from "./service-metrics-dashboard";

export function ObservabilityV2Page({ embedded = false }: { embedded?: boolean } = {}) {
  const [infra, setInfra] = useState<ConsoleV2ServiceMetric>();
  const [trading, setTrading] = useState<ConsoleV2ServiceMetric>();
  const [redis, setRedis] = useState<Awaited<ReturnType<typeof consoleApi.redisMonitor>>["data"]>();
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      // A refresh is a new snapshot. Clear the previous one before awaiting
      // each independent source so a failed request cannot look healthy.
      setInfra(undefined);
      setTrading(undefined);
      setRedis(undefined);
      setErrors([]);
      void Promise.allSettled([consoleV2.infra.serviceMetrics(), consoleV2.trading.serviceMetrics(), consoleApi.redisMonitor()]).then((results) => {
        if (cancelled) return;
        const nextErrors: string[] = [];
        const [infraResult, tradingResult, redisResult] = results;
        if (infraResult.status === "fulfilled") setInfra(infraResult.value.data); else { setInfra(undefined); nextErrors.push(`Prediction Infra：${message(infraResult.reason)}`); }
        if (tradingResult.status === "fulfilled") setTrading(tradingResult.value.data); else { setTrading(undefined); nextErrors.push(`Trading Execution：${message(tradingResult.reason)}`); }
        if (redisResult.status === "fulfilled") setRedis(redisResult.value.data); else { setRedis(undefined); nextErrors.push(`Redis：${message(redisResult.reason)}`); }
        setErrors(nextErrors);
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [refreshKey]);
  const services = [infra, trading].filter((service): service is ConsoleV2ServiceMetric => Boolean(service));
  return <V2Frame embedded={embedded} eyebrow="System / Observability" title="服务监控" description="查看服务运行快照与 Redis 状态。" onRefresh={() => setRefreshKey((value) => value + 1)} loading={loading}>
    {errors.map((error) => <V2Notice key={error} error title="部分监控数据不可用" description={error} />)}
    <section className="section"><div className="service-card-grid">{services.map((service) => <ServiceCard key={service.service} service={service} />)}{!services.length && !loading && <div className="panel panel-pad"><strong>没有可用服务快照</strong></div>}</div></section>
    <RedisMonitorPanel data={redis} error={errors.find((error) => error.startsWith("Redis："))?.replace(/^Redis：/, "")} loading={loading && !redis} />
  </V2Frame>;
}

function ServiceCard({ service }: { service: ConsoleV2ServiceMetric }) {
  return <article className="service-card"><header className="service-card-head"><span className="service-avatar">{service.service === "trading-execution" ? "TE" : "PI"}</span><div><h3>{service.service === "trading-execution" ? "Trading Execution" : "Prediction Infra"}</h3></div>{v2Status("available", "快照可读")}</header><div className="service-vitals"><Vital label="已运行" value={formatUptime(service.uptimeSeconds)} /><Vital label="堆内存" value={formatV2Bytes(service.memory.heapAllocBytes)} /></div><p className="service-observed">更新于 {formatV2Time(service.observedAt)}</p><details className="service-technical"><summary>技术信息</summary><div className="service-runtime-row"><div><span>Go 协程数</span><strong>{formatV2Number(service.runtime.goroutines, 0)}</strong></div><div><span>Go 版本</span><strong>{v2Unknown(service.runtime.goVersion)}</strong></div><div><span>堆使用页</span><strong>{formatV2Bytes(service.memory.heapInuseBytes)}</strong></div></div></details></article>;
}
function Vital({ label, value }: { label: string; value: string }) { return <div className="service-vital"><span>{label}</span><div><strong>{value}</strong></div></div>; }
function formatUptime(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "未知";
  const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return [days ? `${days}天` : "", hours ? `${hours}小时` : "", minutes || (!days && !hours) ? `${minutes}分钟` : ""].filter(Boolean).join(" ");
}
function message(value: unknown) { return value instanceof Error ? value.message : "接口不可用"; }
