# Prediction Console V2

Prediction Infra 的新版 React 运维控制台基础。它从线上 Console 的已提交版本独立复制，以 `13001` 和 `prediction-console-v2` 运行；旧版 `13000`、`prediction-console` 容器和原 systemd unit 不在本项目的启停范围内。浏览器只请求同源 `/api/console/*`；BFF 在服务端携带令牌请求 Go 服务，因此任何令牌都不会进入浏览器包。

新版业务页按市场、预测、题目、资料与数据、交易、系统运行分组，使用 v2 只读 projection、服务端筛选和有界分页。后端资源未配置、依赖 503 或字段不满足契约时，页面会明确显示不可用/未知，不把空结果或累计历史数量当作当前状态。

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
| `SANDBOX_DOWNLOAD_TOKEN` | 仅供服务端归档下载 BFF 使用的 Sandbox 下载令牌 |
| `BACKTEST_DATASET_TOKEN` | 独立的回测数据集读写令牌 |
| `BACKTEST_PLATFORM_CONSOLE_TOKEN` | 回测平台（`/backtest-platform`）BFF 使用的 Console 角色令牌，只在服务端；与 infra 的同名配置一致 |
| `BACKTEST_PLATFORM_OPERATOR` | 可选。BFF 通过 `X-Backtest-Operator` 头传给 infra 的操作人，缺省 `console`；V2 接入登录后改为用户名 |
| `BACKTEST_LEGACY_PLATFORM_URL` | 可选。回测平台页头「打开旧平台 PM Backtest」外链：未设置沿用过渡期默认地址；设为空串或 `off` 不显示（旧平台下线后用）；其它值必须是 http(s) 地址。请求时读取，改了重启即生效 |
| `TRADING_EXECUTION_BASE_URL` | Go 交易执行服务地址，例如 `https://execution.example.com` |
| `TRADING_EXECUTION_API_TOKEN` | 仅读取交易执行服务 API 的 Bearer Token |
| `TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN` | 实盘与基础服务监控共用的只读 Token |

回测接口会添加 `Idempotency-Key`；所有时间使用 UTC ISO 8601。

## 回测平台

`/backtest-platform` 是回测平台的工作区（交易回测、模型评测、信号测试、因子库、提交、运行记录），单个运行的结果页是 `/backtest-platform/runs/{runId}`。它与 `/backtests`（回测数据产品目录）是两回事。前端只调接口、不读文件，也不含任何指标口径；结果由 `result.json` 的七种区块（metrics、table、series、bars、matrix、text、image）渲染，图表是手写 SVG，没有引入图表库。

浏览器只请求同源 `/api/console/backtest/*`，BFF 转发到 infra 的 `/api/v1/backtest/*`：GET 目录、运行列表与详情、提交状态、产物下载（流式）；POST 发起 / 停止运行；PUT 因子池移入移出；POST 上传三类提交（请求体流式转发，页面内上限 1 GiB，更大的文件直接调 infra 接口）。令牌和操作人头只在服务端附加。契约与前端对 `result.json` 的可选扩展见 `.trellis/tasks/10-19-backtest-console-pages/decisions.md`。

本地没有后端时可用 mock 上游（数据来自 `tests/fixtures/backtest`）做界面验收：

```bash
node tests/fixtures/backtest/build-fixtures.mjs     # 重新生成 fixtures（可选）
node scripts/backtest-mock-server.mjs               # 监听 127.0.0.1:18992，令牌 mock-token
PREDICTION_INFRA_BASE_URL=http://127.0.0.1:18992 BACKTEST_PLATFORM_CONSOLE_TOKEN=mock-token pnpm start:v2
```

## 实盘监控聚合接口

`/live` 页面通过同源 `GET /api/console/live-operations` 读取 Trading Execution 的 `GET /api/v1/live-operations`，并链接到真实的 decision runtime/cycle 视图。BFF 使用独立的 `TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN`，不会把令牌发送到浏览器。这个接口应返回一次自洽的只读快照，至少包含：

- 引擎、CLOB、Ledger 与 Reconcile 健康状态；
- 钱包 PnL、风险、订单、仓位与事件流所需的安全只读摘要；
- 资金、服务端计算的预警线/硬上限/真实占用率、开放订单、持仓、订单生命周期和事件流；
- `observedAt` 与 `dataFreshnessSeconds`，让值班人员能判断页面是否陈旧。

当前后端未提供该聚合接口时，页面会明确切换到产品预览数据，不会将模拟内容标记为真实实盘状态。前端类型契约位于 `app/lib/types.ts` 的 `LiveOperationsSnapshot`。
风险卡片优先使用 Trading 返回的 `warningThreshold`、`hardLimit`、`usagePercentage`、`hardLimitEnforced`、`thresholdType` 和 `state`。金额配置当前作为只读运营目标展示，不代表 Trading 会按该金额拦截交易；进度条可以在视觉上封顶，但文字保留大于 100% 的真实目标占用率。滚动发布期间若旧 Trading 只返回 `current/limit/state`，Console 会把 `limit` 兼容解释为不强制执行的运营目标，按 80% 生成提醒线并重新计算展示状态；目标为 0 时直接展示超出数量，不执行除法。

## 基础服务监控

`/observability` 已直接嵌入 Console 导航，展示 Prediction Infra 和 Trading Execution 的实际运行时内存、Goroutine、运行时长、观测时间与可用范围；没有权威采集的 QPS、CPU 或容器限额保持未知。两个服务和 Redis 独立读取，一个依赖失败不会把其他快照伪装成健康。采集口径与接口字段见 [docs/service-observability.md](docs/service-observability.md)。

`TRADING_EXECUTION_API_TOKEN` 仅用于读取成交账本；`TRADING_EXECUTION_LIVE_READ_ONLY_TOKEN` 必须等于 Go 服务的 `LIVE_OPERATIONS_READ_ONLY_TOKEN`。生产环境不得把这两个权限不同的 Token 配成同一个值。

不要给这些变量添加 `NEXT_PUBLIC_` 前缀，也不要把真实值提交到 Git。托管演示环境不应配置生产后端地址或令牌。

## 可用命令

```bash
pnpm lint
pnpm build
pnpm test
```

## 旧版 13000 可复现构建

旧版控制台与新版源码在主干上并行。旧版发布使用 `legacy/manifest.json` 固定记录的已审查源提交 `59f0eb8fa83b237c52f54d705cf54e66ce47566d`：与当前主干相同的文件复用根源码，差异文件保存在 `legacy/overrides/`。组装器只写入被忽略的 `.legacy-console/`，会校验路径、拒绝符号链接，并在复制前后校验每个文件的 SHA-256；它不依赖构建机的 Git 历史，也不会修改根源码。

```bash
pnpm install --frozen-lockfile
pnpm legacy:prepare
pnpm legacy:check   # legacy lint + tsc + 39 项测试（包含 build）
pnpm legacy:build
(cd .legacy-console && INIT_CWD="$PWD" WRANGLER_LOG_PATH=.wrangler/wrangler.log ../node_modules/.bin/vinext start --hostname 127.0.0.1 --port 13000)
```

生产镜像使用独立的 [Dockerfile.legacy](./Dockerfile.legacy)，从完整主干源码安装一次依赖后组装旧版应用，并以旧版 `pnpm start -- --hostname ... --port 13000` 启动；新版 `pnpm build:v2`、`pnpm start:v2` 和根目录构建命令保持不变。
