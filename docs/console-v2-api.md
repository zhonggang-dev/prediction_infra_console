# Console V2 前端读取契约

新版浏览器只请求同源 `/api/console/v2/{infra|trading}/...`。BFF 在服务端加入对应 Bearer Token，过滤响应头并设置 `Cache-Control: no-store`；令牌、上游 URL、数据库连接和对象路径不会进入客户端。

所有 v2 列表使用 `data.items/limit/offset/has_more/observed_at/summary` envelope。页面只根据 `has_more` 分页，不显示后端没有提供的全量 total。请求失败或 decoder 拒绝时清除旧快照并显示“不可用/未知”，不会回落到演示 0。

Infra 资源按契约转发到 `/api/v1/console/v2/{resource}`：`overview`、`running-markets`、`running-pool`、`running-generations`、`selection-runs`、`selected-markets`、`predictions`、`prediction-tasks`、`assets`、`dataset-members`、`market-data`、`market-settlements`、`page-jobs`、`backtest-products` 和 `service-metrics`。`outbox-events` 保持既有只读契约，由新版 BFF 映射到 `/api/v1/console/outbox-events` 并投影到相同 envelope，支持 `q/status`；它不与 Redis stream ACK/lag 视图混用。

Trading 资源转发到 `/api/v1/console/v2/{resource}`：`runtime`、`decision-cycles`、`orders`、`position-lots`、`reconciliation-runs`、`reconciliation-issues`、`redemptions` 和 `service-metrics`；只开放 `decision-cycles/{id}` 与 `orders/{id}/trace` 两种受控详情。

`app/lib/console-v2.ts` 是 wire DTO 的唯一解码入口。它保留 generation、selection run、selected market、prediction、Direct task、Sandbox/QA asset、dataset member、CLOB batch、settlement、cycle、order、lot、reconciliation issue 和 redemption 的独立身份。详情只读取安全 projection，不渲染 raw strategy/venue payload。Trading 的 `prediction_model_id`、lot 的 original/remaining shares/cost、reconciliation reason/resolution、redemption payout base units 和 trace 的 `position_lots`/`reconciliation_issues` 均按真实 DTO 映射。

归档下载使用独立的 `/api/console/downloads/*` BFF，服务端只读取 `SANDBOX_DOWNLOAD_TOKEN`，并固定代理 Sandbox 单个、少量 ID 批量、冻结时间范围、固定版本 testset 与累计 trainset 路径。GET 下载使用浏览器原生链接，POST 表单只接受受限字段，响应体保持上游流式传输；不会把令牌、对象路径或预检结果下发到浏览器。新版回测页仅查询 `backtest-products` 目录；没有外部 Telonex catalog 协议时显示能力说明，不恢复 create 表单。

代表性回归位于 `tests/console-v2.test.ts`，覆盖 envelope/nullable 字段、服务端 q/generation 筛选、decoder 缺 observation 时间、GET-only、未知资源、服务端鉴权、响应头过滤和未配置依赖。

回测平台使用独立的 `/api/console/backtest/*` BFF（不改只读的 `/api/console/v2/*`），服务端读取 `BACKTEST_PLATFORM_CONSOLE_TOKEN`，并以 `X-Backtest-Operator` 头传入操作人。允许的方法与路径是白名单：GET `catalog`、`runs`、`runs/{id}`、`runs/{id}/artifacts[?path=]`（流式、无超时）、`submissions/{id}`；POST `runs`（JSON ≤ 1 MiB，浏览器生成 `Idempotency-Key`）、`runs/{id}/cancel`、`upload/{strategies|factor-tables|predictions}/{标识…}`（请求体流式转发，必须带 `Content-Length`，上限 1 GiB，超限 413、缺长度 411、类型不符 415）；PUT `factors/{id}/pool`。写操作（POST / PUT）必须带 `X-Requested-With: backtest-console`（页面客户端自动附加；缺失或 `Sec-Fetch-Site` 不是同源返回 403 `CROSS_SITE_REQUEST_REJECTED`，挡掉跨站伪造的停止 / 移池请求）。未配置 503，上游不可达 502；上游返回 401 / 403 说明服务端令牌配置有误，一律转成 502 `UPSTREAM_AUTH_FAILED`（不当作用户问题，也不透出上游鉴权头）；其余 4xx / 5xx（含 429 `TOO_MANY_ACTIVE_RUNS`、409、503 `BACKTEST_EXECUTOR_NOT_READY`）原样透传。响应头白名单并设置 `Cache-Control: no-store`；`GET runs/{id}/artifacts?path=` 的图片（png/jpeg/gif/webp）改为 `inline` 以便页面内显示，整包与其它文件保持 attachment。`app/lib/backtest-platform.ts` 是该接口 DTO 与 `result.json` 的唯一解码入口；回归在 `tests/backtest-bff.test.ts`、`tests/backtest-platform.test.ts`、`tests/backtest-selection.test.ts`、`tests/backtest-components.test.mjs` 和 `tests/rendered-html.test.mjs`。
