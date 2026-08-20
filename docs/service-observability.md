# 双服务基础监控

Prediction Console 的 `/observability` 页面直接嵌在现有控制台中，不需要 iframe。它通过同源 BFF 聚合两个 Go 服务，浏览器不会接触服务端 Bearer Token。

## 指标口径

| 指标 | 口径 |
| --- | --- |
| QPS | 最近 60 秒完成的应用请求数除以有效窗口秒数 |
| 5xx 比例 | 最近 60 秒 HTTP 5xx 请求占比 |
| 平均 / 峰值延迟 | 最近 60 秒应用请求耗时 |
| CPU | Go scheduler CPU classes 的区间利用率，按可用调度容量归一到 0–100% |
| 内存 | Linux 容器优先读取 cgroup v2/v1 的 usage 与 limit；无 cgroup 时回退到 Go runtime Sys |
| Runtime | Go 版本、Goroutine 数、GC 次数、进程启动时间和运行时长 |

健康探针和指标接口自身不进入 QPS 窗口，避免监控轮询污染业务流量。

## 安全边界

- Prediction Infra 的指标位于已有 Console Bearer Token 保护的路由组。
- Trading Execution 的指标使用 `LIVE_OPERATIONS_READ_ONLY_TOKEN`。
- BFF 只输出聚合数值，不输出路径标签、请求参数、订单、账户或市场数据。
- readiness 失败只会把对应服务标记为 `degraded`；另一个服务仍正常展示。

## 聚合响应

```json
{
  "data": {
    "observed_at": "2026-08-20T04:30:00Z",
    "services": [
      {
        "service": "prediction-infra",
        "status": "healthy",
        "uptime_seconds": 836120,
        "requests": {
          "total": 13826491,
          "qps_1m": 184.2,
          "error_rate_1m": 0.18,
          "avg_latency_ms_1m": 42.0,
          "max_latency_ms_1m": 176.4
        },
        "cpu": { "usage_percent": 38.2, "gomaxprocs": 4, "logical_cpus": 4 },
        "memory": {
          "usage_bytes": 1331277824,
          "limit_bytes": 2147483648,
          "usage_percent": 62.0,
          "heap_inuse_bytes": 905268920,
          "heap_objects": 418230
        },
        "runtime": { "go_version": "go1.26.0", "goroutines": 86, "gc_cycles": 8421 }
      }
    ]
  }
}
```

字段缺失时前端显示 `—`；只有两个服务都不可用时才切换为明确标识的演示数据。
