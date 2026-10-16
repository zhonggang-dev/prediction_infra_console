# 双服务基础监控

新版 `/observability` 页面通过同源 BFF 分别读取 Prediction Infra 与 Trading Execution 的运行时快照，并独立读取 Redis 共享监控快照。浏览器不会接触任何服务端 Bearer Token；一个依赖失败时，其他快照仍按自己的观测时间展示。

## 指标口径

| 指标 | 口径 |
| --- | --- |
| 运行时 | 服务端实际返回的 Go 版本、Goroutine 数和 uptime |
| 内存 | 服务端实际返回的 heap alloc、heap inuse 与 sys bytes |
| 观测时间 | 每个服务快照自己的 `observed_at` |
| QPS / CPU / 容器限额 | 当前没有权威采集时显示未知，不生成 0 或演示值 |
| Redis | 容量、Key 分类、Stream 消息和消费组状态来自独立共享快照；分类估算不替代实例实际用量 |

采集成功只说明快照可读，不代表业务依赖 readiness 或交易链路已就绪。页面会保留服务分别返回的 `availability` 说明；`503`、未配置和 decoder 拒绝都会显示为不可用。

## 同源路径与安全边界

- Prediction Infra：`GET /api/console/v2/infra/service-metrics`，服务端使用 `CONSOLE_API_TOKEN`。
- Trading Execution：`GET /api/console/v2/trading/service-metrics`，服务端使用 `TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN`。
- Redis：`GET /api/console/redis-monitor`，服务端使用 `CONSOLE_API_TOKEN`。
- BFF 只代理固定资源和固定上游路径，过滤 `set-cookie`，设置 `Cache-Control: no-store`，拒绝写请求。
- 页面无删除、清理、手工 Stream 配置或密钥输入；查询失败不会回落到演示健康值。

## 运行时快照示例

```json
{
  "data": {
    "service": "prediction-infra",
    "observed_at": "2026-10-16T08:30:00Z",
    "uptime_seconds": 836120,
    "runtime": { "go_version": "go1.26.0", "goroutines": 86 },
    "memory": {
      "heap_alloc_bytes": 905268920,
      "heap_inuse_bytes": 1105268920,
      "sys_bytes": 1331277824
    },
    "availability": { "qps": "unavailable", "cpu": "unavailable" }
  }
}
```

未知数值在页面上显示“未知”；Redis 未配置 `maxmemory` 时不计算使用率，lag 缺失时也不替换成 0。
