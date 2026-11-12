# Console V2 前端读取契约

新版浏览器只请求同源 `/api/console/v2/{infra|trading}/...`。BFF 在服务端加入对应 Bearer Token，过滤响应头并设置 `Cache-Control: no-store`；令牌、上游 URL、数据库连接和对象路径不会进入客户端。

所有 v2 列表使用 `data.items/total/limit/offset/has_more/observed_at/summary` envelope。`total` 必须是当前筛选与默认时间范围下的准确非负安全整数，页面据此显示总条数、总页数、跳页和 20/50/100 条每页；空结果仍显示准确的 0。请求失败、计数失败或 decoder 拒绝时显示明确不可用状态，不把缺失值当作 0，也不会回落到演示数据。

Infra 资源按契约转发到 `/api/v1/console/v2/{resource}`：`overview`、`running-markets`、`running-pool`、`running-generations`、`selection-runs`、`selected-markets`、`predictions`、`prediction-tasks`、`assets`、`dataset-members`、`market-data`、`market-settlements`、`page-jobs`、`backtest-products` 和 `service-metrics`。`outbox-events` 保持既有只读契约，由新版 BFF 映射到 `/api/v1/console/outbox-events` 并投影到相同 envelope，支持 `q/status`；它不与 Redis stream ACK/lag 视图混用。

Trading 资源转发到 `/api/v1/console/v2/{resource}`：`runtime`、`decision-cycles`、`orders`、`position-lots`、`reconciliation-runs`、`reconciliation-issues`、`redemptions` 和 `service-metrics`；只开放 `decision-cycles/{id}` 与 `orders/{id}/trace` 两种受控详情。

`app/lib/console-v2.ts` 是 wire DTO 的唯一解码入口。它保留 generation、selection run、selected market、prediction、Direct task、Sandbox/QA asset、dataset member、CLOB batch、settlement、cycle、order、lot、reconciliation issue 和 redemption 的独立身份。详情只读取安全 projection，不渲染 raw strategy/venue payload。Trading 的 `prediction_model_id`、lot 的 original/remaining shares/cost、reconciliation reason/resolution、redemption payout base units 和 trace 的 `position_lots`/`reconciliation_issues` 均按真实 DTO 映射。

归档下载使用独立的 `/api/console/downloads/*` BFF，服务端只读取 `SANDBOX_DOWNLOAD_TOKEN`，并固定代理 Sandbox 单个、按 ID 批量（最多 1000 个 ID、表单体 256 KiB）、冻结时间范围、固定版本 testset 与累计 trainset 路径。GET 下载使用浏览器原生链接，POST 表单只接受受限字段，响应体保持上游流式传输；不会把令牌、对象路径或预检结果下发到浏览器。历史回测资料页 `/backtests` 仅查询 `backtest-products` 目录；没有外部 Telonex catalog 协议时显示能力说明，不恢复 create 表单。

代表性回归位于 `tests/console-v2.test.ts`，覆盖 envelope/nullable 字段、服务端 q/generation 筛选、decoder 缺 observation 时间、GET-only、未知资源、服务端鉴权、响应头过滤和未配置依赖。

回测平台使用独立的 `/api/console/backtest/*` BFF（不改只读的 `/api/console/v2/*`），服务端读取 `BACKTEST_PLATFORM_CONSOLE_TOKEN`，并以 `X-Backtest-Operator` 头传入操作人。允许的方法与路径是白名单：GET `catalog`、`runs`、`runs/{id}`、`runs/{id}/artifacts[?path=]`（流式、无超时）、`submissions/{id}`；POST `runs`（JSON ≤ 1 MiB，浏览器生成 `Idempotency-Key`）、`runs/{id}/cancel`、`upload/{strategies|factor-tables|predictions}/{标识…}`（请求体流式转发，必须带 `Content-Length`，上限 1 GiB，超限 413、缺长度 411、类型不符 415）；PUT `factors/{id}/pool`。写操作（POST / PUT）必须带 `X-Requested-With: backtest-console`（页面客户端自动附加；缺失或 `Sec-Fetch-Site` 不是同源返回 403 `CROSS_SITE_REQUEST_REJECTED`，挡掉跨站伪造的停止 / 移池请求）。未配置 503，上游不可达 502；上游返回 401 / 403 说明服务端令牌配置有误，一律转成 502 `UPSTREAM_AUTH_FAILED`（不当作用户问题，也不透出上游鉴权头）；其余 4xx / 5xx（含 429 `TOO_MANY_ACTIVE_RUNS`、409、503 `BACKTEST_EXECUTOR_NOT_READY`）原样透传。响应头白名单并设置 `Cache-Control: no-store`；`GET runs/{id}/artifacts?path=` 的图片（png/jpeg/gif/webp）改为 `inline` 以便页面内显示，整包与其它文件保持 attachment。`app/lib/backtest-platform.ts` 是该接口 DTO 与 `result.json` 的唯一解码入口；回归在 `tests/backtest-bff.test.ts`、`tests/backtest-platform.test.ts`、`tests/backtest-selection.test.ts`、`tests/backtest-components.test.mjs` 和 `tests/rendered-html.test.mjs`。

预测默认查看已有历史结果；页面只保留结果范围、模型/平台、批次选择与原生整批 masked 下载，不再读取任务核对或展示 Direct coverage。旧 `/predictions/tasks` 重定向 `/predictions`，只保留模型/来源/范围/明确代际身份，删除任务状态、搜索、分页和旧批次私有状态。用户可见 `SANDBOX_NEW_READY` 渠道标为 Sandbox，模型原 ID 和协议枚举保持。

显式 `scope=current` 显示「当前生效预测范围」：从 `overview.sources[].current_generations` 取得所选平台各 Domain 当前 PUBLISHED 且有预测成员的代际，包括仍生效的沿用代，与 prediction_coverage 无关。统一使用 `generation_ids`（1–20 个互异正 int64，可包含同一平台不同 Domain）；与单 ID 互斥，后端拒绝未知、非发布或来源冲突。单平台旧 `source` + `generation_id` 深链继续兼容。缺任一所选平台当前范围则明确阻止查询，不能退到另一平台或历史。范围未确定时列表保持旧快照忙碌状态且不发请求；current 即使已有冻结身份也读取 overview 展示范围标签与今日进度，history 不额外读取。

「今日预测进度」与当前生效范围分开：只有 `round_schedule` 当天该轮为 PUBLISHED，且其 `generation_id` 与该 Domain 的 current 代一致时，才请求、展示这代的今日结果。缺跑、失败、处理中和未到轮次不引用沿用代的历史批次；沿用代保留独立「查看沿用结果」入口。进度行的结果跳转始终保留所选 `model`。市场今日轮次里的成员人数可沿用，但新收/退出仅显示当天已发布代的摘要；沿用代抽屉明确实际业务日。

`predictions` 新增 nullable `round_domain`：后端根据可核实的派发/代际关系投影，前端 `roundDomain` 用于「轮次 Domain」列。`primary_domain` 仍保留历史市场分类语义；无确证的轮次 Domain 显示「—」，不回退为历史分类。缺字段或 null 兼容为未知，非法非字符串或空串为合同错误。

名额明细沿用右侧抽屉布局，使用原生模态 `dialog`：打开聚焦关闭按钮、背景不可聚焦、Esc/遮罩/关闭按钮均可关闭，关闭恢复原触发位置且不滚动；所属工作区隐藏时关闭，不能残留 top-layer。

代际集合写入 URL 与列表 metadata；翻页、返回和重载保持固定范围，total 和排序来自同一后端列表，浏览器不合并局部分页。固定批次父身份包含模型、来源集合、范围、单/多代际和信息时点；改变父范围清除旧批次和分页。选中具体批次后结果/目录查询剥离 generation_ids、收窄为该批次 source + 单 generation_id，目录保留固定 max_result_id、结果另保留原精度 prediction_as_of。下载表单保持原 model_id/market_source/prediction_as_of/max_result_id/可选 generation_id，服务端一次解析完整 Sandbox 集合，保留流式响应，不受当前页或手填 20 ID 工具限制。

交易工作区共享 `execution_account_id/model_id/strategy_id/from/to`。统一工具条先编辑草稿再应用；周期、订单与仓位支持完整条件，对账和赎回按账户与时间读取，实盘只显示当前账户快照，账本按自身接口筛选。UI 日期为 UTC 整天；Trading V2 的包含式 `to` 使用当日 `23:59:59.999999Z`，账本的排除式 `to` 使用次日零点。

Tab 仅继承显式共享字段。各列表将已应用查询和分页保存在页面元数据中，激活时按目标 URL 严格恢复，隐藏页面不会被别的页面条件清空；共享重置在重新激活页面时也必须清除旧值。工具条应用/重置事件立即刷新当前列表，不能只更改地址。


## Account performance and official custom dates (2026-11-04)

GET `/api/console/v2/trading/account-performance` maps only to Trading's read-only
`/api/v1/console/v2/account-performance`. The sole optional parameter is a single
`execution_account_id`; the browser never sends chart or ledger date filters to this endpoint.
The response contains `data.observed_at` and independently identified `data.items`.
Decimal strings and explicit nulls are validated before display. Missing or stale
quotes make the account's market value, unrealized PnL, total PnL and return unknown;
coverage and the actual quote time remain visible. Current/accumulated account metrics
and the 14-UTC-day realized drawdown do not change with the official curve's dates.

Official custom dates reuse cached `all/1d` wallet series. Local calendar end dates
are inclusive through the next local midnight. Amount and hover values use the same
real baseline sample and show interval changes, even for a young wallet. Actual sample
coverage is disclosed; missing interval observations never become zero or all-time PnL.
Legacy-console, Trading writes and the lower activity list's date filters are unchanged.

## 账户核心指标与官方小时盈亏（2026-11-04）

根前端 `/trading/ledger` 使用新增固定BFF `GET /api/console/v2/trading/account-core-metrics`，仅可选单值 `execution_account_id`，转发Trading同名只读资源；原account-performance及旧13001保持兼容。

`app/lib/trading-core-metrics.ts`严格解码九项金额、资产覆盖及完整`valuation_assets`，未知与0分开；每项保留本地资产身份、份额、成本、价格、来源、来源/观测时间与稳定缺价原因。PM未结算优先官方current_price，缺失再参考mid；Kalshi mid为参考估值，两平台可靠官方结算价优先。全部账户共用紧凑表，单账户九格横条；覆盖按钮原位展开资产证据。

官方wallet-pnl响应新增nullable `source_fidelity`，points新增nullable十进制字符串`source_block`；前端完整保留，大于JS安全整数的区块不转number，缺字段/错误类型/冲突点失败。source_fidelity=1d仍允许直接使用官方小时序列原值，文案保留源精度说明。

自定义输入改为本地日期小时，`datetime-local step=3600`，结束即所选时刻，不再自动含结束日全天；重复DST小时须选明确UTC偏移，不存在小时拒绝。先取最小覆盖1d/1w/1m小时网格，否则有界all/1h（10000点/8MiB界不变）；不回退日线冒充小时。累计差额取边界前最近且1小时以内的有效官方网格值，合法同值可0；缺覆盖明确不足。绘图域严格等于输入域，域外基准只算差额不画点，域内单点可绘圆点，阶梯线不增加财务观察。轴、鼠标、触摸、键盘使用同一时间域/基准；六快捷及账本范围保持。PnL窄BFF透传父取消并组合10秒上限。

## 用户问题（2026-11-09）

`/user-questions` 页面：上传 JSON / CSV 问题文件，按文件和问题查看每日 17:00（北京时间）构建进度，下载每道题最新一份或任一历史版本的原始版 Sandbox。

- 上传：浏览器 XHR 发到 `POST /api/console/user-questions/uploads`（请求体就是文件本身，`Content-Type` 为 `application/json` 或 `text/csv`，`X-Upload-Filename` 为百分号编码的文件名）。BFF 要求同源标记头 `X-Requested-With: user-question-console`（`Sec-Fetch-Site` 若有必须同源，否则 403）、`Content-Length`（411）、64 MiB 上限（413）、类型白名单（415），服务端注入 `USER_QUESTION_CONSOLE_TOKEN` 后流式转发到 infra `POST /api/v1/console/user-question-uploads`；未配置 503，上游 401/403 转 502 `UPSTREAM_AUTH_FAILED`。
- 只读：`/api/console/v2/infra/user-question-uploads`、`user-questions`，以及两条带正整数 ID 的子路径 `user-questions/{id}/sandboxes`、`user-question-uploads/{id}/latest-sandbox-ids`（ID 非法 400）。仍用 `CONSOLE_API_TOKEN`，写方法 405。
- 下载：单个用原生链接 `sandboxes/{id}/archive?variant=original&asset_kind=USER_QUESTION`；「下载所选 / 下载整个文件」用隐藏表单 POST `sandboxes/archives:batch`（`asset_kind=USER_QUESTION`、`variant=original`）。`USER_QUESTION` 与 `GENERATED_QA` 一样只许 original。整个文件的 ID 清单在选中文件时预先取好，点击时同步提交表单，避免异步请求后新标签页被浏览器拦截。
- 有等待构建 / 构建中的题时每 30 秒刷新，全部到终态后停止。
