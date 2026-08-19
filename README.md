# Prediction Console

Prediction Infra 的独立 React 运维控制台。浏览器只请求同源 `/api/console/*`；BFF 在服务端携带令牌请求 Go 服务，因此任何令牌都不会进入浏览器包。

## 本地运行

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

未配置后端时，页面会明确显示连接错误；可手动进入演示数据模式预览界面，演示模式不会写入任何业务数据。

## 部署边界

前端与 Go 服务分别构建，但生产环境建议放在同一反向代理后：

```text
浏览器 -> 公司 SSO / Nginx -> Prediction Console -> Prediction Infra
```

Console 的 BFF 会使用服务端环境变量访问 Go，浏览器不会得到这些令牌。BFF 本身必须由公司 SSO、VPN 或内网反向代理保护，不能携带真实令牌直接暴露到公网。反向代理还应限制 XXL-JOB 等内部路由，不要把它们转发给前端用户。

## 服务端环境变量

| 变量 | 用途 |
| --- | --- |
| `PREDICTION_INFRA_BASE_URL` | Go 服务地址，例如 `https://prediction.example.com` |
| `CONSOLE_API_TOKEN` | 仅读取 `/api/v1/console/*` 的控制台令牌 |
| `BACKTEST_DATASET_TOKEN` | 独立的回测数据集读写令牌 |
| `TRADING_EXECUTION_BASE_URL` | Go 交易执行服务地址，例如 `https://execution.example.com` |
| `TRADING_EXECUTION_API_TOKEN` | 仅读取交易执行服务 API 的 Bearer Token |

回测接口会添加 `Idempotency-Key`；所有时间使用 UTC ISO 8601。

## 实盘监控聚合接口

`/live` 页面通过同源 `GET /api/console/live-operations` 读取 Trading Execution 的 `GET /api/v1/live-operations`。BFF 使用独立的 `TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN`，不会把令牌发送到浏览器。这个接口应返回一次自洽的只读快照，至少包含：

- 引擎、CLOB、Ledger 与 Reconcile 健康状态；
- CycleThread、MonitorThread、PredictionScheduler 的心跳和当前任务；
- 当轮扫描到入账的交易漏斗；
- 资金、风险限额、开放订单、持仓、订单生命周期和事件流；
- `observedAt` 与 `dataFreshnessSeconds`，让值班人员能判断页面是否陈旧。

当前后端未提供该聚合接口时，页面会明确切换到产品预览数据，不会将模拟内容标记为真实实盘状态。前端类型契约位于 `app/lib/types.ts` 的 `LiveOperationsSnapshot`。

`TRADING_EXECUTION_API_TOKEN` 仅用于读取成交账本；`TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN` 必须等于 Go 服务的 `LIVE_OPERATIONS_READ_ONLY_TOKEN`。生产环境不得把这两个权限不同的 Token 配成同一个值。

不要给这些变量添加 `NEXT_PUBLIC_` 前缀，也不要把真实值提交到 Git。托管演示环境不应配置生产后端地址或令牌。

## 可用命令

```bash
pnpm lint
pnpm build
pnpm test
```
