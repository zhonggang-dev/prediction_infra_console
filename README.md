# Prediction Console V2

Prediction Infra 的新版 React 运维控制台基础。它从线上 Console 的已提交版本独立复制，以 `13001` 和 `prediction-console-v2` 运行；旧版 `13000`、`prediction-console` 容器和原 systemd unit 不在本项目的启停范围内。浏览器只请求同源 `/api/console/*`；BFF 在服务端携带令牌请求 Go 服务，因此任何令牌都不会进入浏览器包。

当前阶段只提供原有真实页面的分组入口与视觉基础，市场运行池、账户对账、新版回测数据产品等读模型尚未接入时会显示“待接入”，不会用空数据页或累计数量代替真实状态。

## 本地运行

```bash
cp .env.example .env.local
pnpm install
```

新版本地入口默认只绑定 `127.0.0.1:13001`，与旧版开发命令隔离：

```bash
pnpm dev:v2
pnpm build:v2
pnpm start:v2
```

可以通过 `PREDICTION_CONSOLE_V2_BIND_ADDRESS` 和 `PREDICTION_CONSOLE_V2_PORT` 为本地新版进程显式设置私网地址和端口；启动前应先确认端口未被占用，不会自动终止占用者。

未配置后端时，页面会明确显示连接错误；可手动进入演示数据模式预览界面，演示模式不会写入任何业务数据。

## 部署边界

前端与 Go 服务分别构建，但生产环境建议放在同一反向代理后：

```text
浏览器 -> 公司 SSO / Nginx -> Prediction Console -> Prediction Infra
```

Console 的 BFF 会使用服务端环境变量访问 Go，浏览器不会得到这些令牌。BFF 本身必须由公司 SSO、VPN 或内网反向代理保护，不能携带真实令牌直接暴露到公网。反向代理还应限制 XXL-JOB 等内部路由，不要把它们转发给前端用户。

新版 systemd 部署使用独立的 `prediction-console-v2.service`、`prediction-console-v2:current` 镜像、`/etc/prediction-console-v2` 配置目录和 `127.0.0.1:13001` 默认绑定。构建和安装步骤如下：

```bash
docker build -f Dockerfile.v2 -t prediction-console-v2:current .
sudo install -m 0644 deploy/prediction-console-v2.service /etc/systemd/system/prediction-console-v2.service
sudo install -d -m 0750 /etc/prediction-console-v2
sudo install -m 0640 deploy/service.env.v2.example /etc/prediction-console-v2/service.env
# 将只读后端变量写入 /etc/prediction-console-v2/env（不要提交真实值）
sudo systemctl daemon-reload
sudo systemctl enable --now prediction-console-v2.service
curl http://127.0.0.1:13001/
```

如果需要直接通过服务器内网地址访问，编辑独立的 `/etc/prediction-console-v2/service.env`，把 `PREDICTION_CONSOLE_V2_BIND_ADDRESS` 设置为该服务器的明确内网 IP 后重启新版 unit。不要设置成 `0.0.0.0`，避免绕过 VPN、SSO 或内网边界。新版停止时只执行 `sudo systemctl stop prediction-console-v2.service`；不要把旧版 unit、容器或镜像名填入新版命令。

新版的配置示例位于 `deploy/service.env.v2.example`，旧版 `deploy/service.env.example` 和 `deploy/prediction-console.service` 仅供旧入口使用。

## 服务端环境变量

| 变量 | 用途 |
| --- | --- |
| `PREDICTION_INFRA_BASE_URL` | Go 服务地址，例如 `https://prediction.example.com` |
| `CONSOLE_API_TOKEN` | 仅读取 `/api/v1/console/*` 的控制台令牌 |
| `BACKTEST_DATASET_TOKEN` | 独立的回测数据集读写令牌 |
| `TRADING_EXECUTION_BASE_URL` | Go 交易执行服务地址，例如 `https://execution.example.com` |
| `TRADING_EXECUTION_API_TOKEN` | 仅读取交易执行服务 API 的 Bearer Token |
| `TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN` | 实盘与基础服务监控共用的只读 Token |

回测接口会添加 `Idempotency-Key`；所有时间使用 UTC ISO 8601。

## 实盘监控聚合接口

`/live` 页面通过同源 `GET /api/console/live-operations` 读取 Trading Execution 的 `GET /api/v1/live-operations`。BFF 使用独立的 `TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN`，不会把令牌发送到浏览器。这个接口应返回一次自洽的只读快照，至少包含：

- 引擎、CLOB、Ledger 与 Reconcile 健康状态；
- CycleThread、MonitorThread、PredictionScheduler 的心跳和当前任务；
- 当轮扫描到入账的交易漏斗；
- 资金、服务端计算的预警线/硬上限/真实占用率、开放订单、持仓、订单生命周期和事件流；
- `observedAt` 与 `dataFreshnessSeconds`，让值班人员能判断页面是否陈旧。

当前后端未提供该聚合接口时，页面会明确切换到产品预览数据，不会将模拟内容标记为真实实盘状态。前端类型契约位于 `app/lib/types.ts` 的 `LiveOperationsSnapshot`。
风险卡片优先使用 Trading 返回的 `warningThreshold`、`hardLimit`、`usagePercentage`、`hardLimitEnforced`、`thresholdType` 和 `state`。金额配置当前作为只读运营目标展示，不代表 Trading 会按该金额拦截交易；进度条可以在视觉上封顶，但文字保留大于 100% 的真实目标占用率。滚动发布期间若旧 Trading 只返回 `current/limit/state`，Console 会把 `limit` 兼容解释为不强制执行的运营目标，按 80% 生成提醒线并重新计算展示状态；目标为 0 时直接展示超出数量，不执行除法。

## 基础服务监控

`/observability` 已直接嵌入 Console 导航，展示 Prediction Infra 和 Trading Execution 的近 1 分钟 QPS、5xx 比例、请求延迟、CPU、内存、Goroutine 与运行时长。浏览器只访问同源 `GET /api/console/service-metrics`，BFF 会并行调用：

- Prediction Infra `GET /api/v1/console/service-metrics`；
- Trading Execution `GET /api/v1/service-metrics`；
- 两个服务各自的 `GET /health/ready`。

一个服务离线不会遮蔽另一个服务。未连接后端时页面会明确标注演示模式。采集口径与接口字段见 [docs/service-observability.md](docs/service-observability.md)。

`TRADING_EXECUTION_API_TOKEN` 仅用于读取成交账本；`TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN` 必须等于 Go 服务的 `LIVE_OPERATIONS_READ_ONLY_TOKEN`。生产环境不得把这两个权限不同的 Token 配成同一个值。

不要给这些变量添加 `NEXT_PUBLIC_` 前缀，也不要把真实值提交到 Git。托管演示环境不应配置生产后端地址或令牌。

## 可用命令

```bash
pnpm lint
pnpm build
pnpm test
```
