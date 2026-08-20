import type { ServiceMetricsOverview, ServiceRuntimeMetrics } from "./types";

const startedAt = new Date(Date.now() - 9.7 * 24 * 60 * 60 * 1000).toISOString();

/** 托管预览未连接内网服务时使用，并始终由页面明确标记为演示数据。 */
export function demoServiceMetrics(): ServiceMetricsOverview {
  const tick = Date.now() / 5_000;
  return {
    observedAt: new Date().toISOString(),
    services: [
      service("prediction-infra", {
        qps: 184 + Math.sin(tick) * 24,
        cpu: 38 + Math.sin(tick / 1.7) * 9,
        memory: 62 + Math.sin(tick / 4) * 2.5,
        usageBytes: 1_331_277_824,
        latency: 42,
        errors: 0.18,
        goroutines: 86,
        total: 13_826_491,
      }),
      service("trading-execution", {
        qps: 72 + Math.sin(tick / 1.3) * 13,
        cpu: 24 + Math.sin(tick / 2.2) * 7,
        memory: 46 + Math.sin(tick / 3.2) * 1.8,
        usageBytes: 987_758_592,
        latency: 28,
        errors: 0.04,
        goroutines: 54,
        total: 5_247_830,
      }),
    ],
  };
}

function service(name: ServiceRuntimeMetrics["service"], values: { qps: number; cpu: number; memory: number; usageBytes: number; latency: number; errors: number; goroutines: number; total: number }): ServiceRuntimeMetrics {
  return {
    service: name,
    status: "healthy",
    version: "v1.8.2",
    observedAt: new Date().toISOString(),
    startedAt,
    uptimeSeconds: (Date.now() - Date.parse(startedAt)) / 1000,
    requests: { total: values.total, qps: Math.max(values.qps, 0), errorRate: values.errors, avgLatencyMs: values.latency, maxLatencyMs: values.latency * 4.2 },
    cpu: { usagePercent: Math.max(values.cpu, 0), gomaxprocs: 4, logicalCpus: 4 },
    memory: { usageBytes: values.usageBytes, limitBytes: 2_147_483_648, usagePercent: values.memory, heapInuseBytes: values.usageBytes * 0.68, heapObjects: name === "prediction-infra" ? 418_230 : 263_840 },
    runtime: { goVersion: "go1.26.0", goroutines: values.goroutines, gcCycles: name === "prediction-infra" ? 8_421 : 5_116 },
  };
}
