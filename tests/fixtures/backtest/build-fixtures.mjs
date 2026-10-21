// 回测平台前端的 mock fixtures 生成器：`node tests/fixtures/backtest/build-fixtures.mjs`
// 结构严格按契约（父任务 design.md 第 3-8 节、执行器 design.md 第 5 节）；数值是确定性伪随机，只用于界面与解码测试，
// 不代表任何真实回测结果。前端对契约的可选扩展见任务目录 decisions.md。
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = dirname(fileURLToPath(import.meta.url));
const save = (name, value) => writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`);

let seed = 20261019;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const round = (v, d = 4) => Number(v.toFixed(d));
const OBSERVED = "2026-10-19T14:00:00Z";
const page = (items, extra = {}) => ({ data: { items, limit: 100, offset: 0, has_more: false, observed_at: OBSERVED, ...extra } });

// ───────────────────────── 目录 ─────────────────────────

const datasets = [
  { kind: "dataset", key: "telonex", version: "current", origin: "legacy", status: "available", metadata: { label: "正式·Telonex", coverage: { start: "2026-08-06T00:00:00+08:00", end: "2026-09-05T00:00:00+08:00" }, orderbook_end: "2026-09-05T00:00:00+08:00", market_favorite_model: "market_favorite_telonex", hourly_factor_note: "MultFactor V2 读取小时线因子：本数据集的小时线来自 orderbook 重建，口径与 official 不同。", domains: ["Crypto", "Economy", "Geopolitics", "Politics", "Sports", "Tech", "World"] } },
  { kind: "dataset", key: "mjj_tmp", version: "legacy", origin: "legacy", status: "available", metadata: { label: "临时数据", coverage: { start: "2026-08-08T00:00:00+08:00", end: "2026-08-30T00:00:00+08:00" }, orderbook_end: "2026-08-30T00:00:00+08:00", market_favorite_model: "market_favorite_tmp", domains: ["Crypto", "Economy", "Geopolitics", "Politics", "Sports", "Tech", "World"] } },
  { kind: "dataset", key: "canonical", version: "legacy", origin: "legacy", status: "available", metadata: { label: "正式·本地", coverage: { start: "2026-07-01T00:00:00+08:00", end: "2026-08-20T00:00:00+08:00" }, domains: ["Crypto", "Economy", "Politics", "Sports"] } },
];
save("catalog-datasets.json", page(datasets));

// 参数定义不手写：来自执行器 `pmbt dump-param-defs` 的导出（engine-param-definitions.json，与 inventory 登记的
// metadata.param_definitions 同形）。执行器改了参数定义，就重新导出这个文件再运行本脚本。
const paramDefinitions = JSON.parse(readFileSync(join(out, "engine-param-definitions.json"), "utf8")).param_definitions;
const NOT_BRIER = "Market 自己的概率就是中价，Brier 对它没有可比意义（配对差恒为 0）。";
const engine = {
  kind: "engine", key: "pm-engine", version: "pm-engine-20261019-3b7dbbede090", origin: "platform", status: "available",
  metadata: {
    protocol: "pearson-dmid-v8", released_at: "2026-10-19T10:00:00+08:00", is_default: true,
    signal_window: { start: "2026-08-06T00:00:00+08:00", end_exclusive: "2026-09-05T00:00:00+08:00" },
    market_view_exclusions: { "benchmark/resolved_event_brier": NOT_BRIER, "benchmark/fixed_horizon_brier": NOT_BRIER, "benchmark/calibration": NOT_BRIER, "benchmark/model_signal": "Market 没有 edge（模型概率 − 中价恒为 0）。", "benchmark/deviation": "偏离校准只评模型相对市场中价的偏离。" },
    param_definitions: paramDefinitions,
  },
};
save("catalog-engines.json", page([engine]));

// 旧策略：描述与名字相同（执行器 inventory 把 label 写进 description）
const legacyStrategies = [
  ["baseline", "Baseline", "baseline", null],
  ["baseline_v1_1", "Baseline V1.1", "baseline", null],
  ["baseline_v2", "Baseline V2", "baseline", null],
  ["wgeo_mult_factor_v1", "MultFactor v1 · W/G only", "wgeo_mult_factor", ["World", "Geopolitics"]],
  ["wgeo_mult_factor_v2", "MultFactor v2 · W/G only", "wgeo_mult_factor", ["World", "Geopolitics"]],
  ["price_v4", "Price V4（纯价格）", "price_probability", null],
].map(([key, label, kind, validated]) => ({ kind: "strategy", key, version: "legacy", origin: "legacy", status: "available", metadata: { label, description: label, definition: { kind, validated_domains: validated }, price_only: kind === "price_probability", reads_hourly_factors: key === "wgeo_mult_factor_v2", requires_execution_cache: kind !== "price_probability" } }));

// 逐时点策略（平台提交）：metadata 形状按执行器 stepwise/intake.py（definition 与 metadata 里各有一份 params / inputs / position_sizing）
const edgeThreshold = { name: "edge_threshold", type: "number", default: 0.1, min: 0, max: 1, label: "入场边际阈值", help: "预测与盘口价差超过它才入场。" };
const stepwise = (key, version, label, { predictions, sizing, domains = null, params = [], interval = "1h", seconds = 3600 }) => {
  const submissionId = `bts-20261021-${key.slice(0, 8).padEnd(8, "x")}`;
  const definition = { kind: "stepwise", api_version: 1, label, strategy_id: key, version, entry: `${key}.main:Strategy`, decision_trigger: "grid", decision_interval: interval, decision_interval_seconds: seconds, inputs: { predictions }, position_sizing: sizing, domains, params, uses_models: predictions !== "none", submission_id: submissionId, package_sha256: "f".repeat(64) };
  return { kind: "strategy", key, version, origin: "platform", status: "available", submission_id: submissionId, metadata: { definition, label, submission_id: submissionId, sha256: "f".repeat(64), decision_interval: interval, position_sizing: sizing, params, inputs: { predictions }, example_steps: 3 } };
};
const stepwiseStrategies = [
  stepwise("baseline_v3_stepwise", "1.0.0", "Baseline V3（逐时点包装）", { predictions: "required", sizing: ["native", "fixed_shares", "fixed_stake"] }),
  stepwise("edge_filter_stepwise", "0.2.0", "边际过滤（逐时点）", { predictions: "optional", sizing: ["native", "fixed_stake"], interval: "30m", seconds: 1800, params: [edgeThreshold, { name: "hold_hours", type: "integer", default: 6, min: 1, max: 48, label: "最长持有（小时）", help: "" }, { name: "use_depth", type: "bool", default: true, label: "考虑盘口深度", help: "" }, { name: "side_mode", type: "enum", default: "both", choices: ["both", "yes_only"], label: "方向", help: "" }] }),
  stepwise("mid_reversion_stepwise", "0.1.0", "中价回归（逐时点，不读模型）", { predictions: "none", sizing: ["native"], domains: ["Politics", "Sports"], params: [edgeThreshold, { name: "window_steps", type: "integer", default: 12, min: 2, max: 96, label: "回看步数", help: "" }] }),
];
const strategies = [...legacyStrategies, ...stepwiseStrategies];
save("catalog-strategies.json", page(strategies));

// 40 个模型：覆盖「选很多模型时每个 chip 都可见」的场景
const modelDefs = [];
// 目录元数据按 infra 约定：default_dataset + coverage 以数据集为键
const add = (key, dataset, start, end, tags, extra = {}, version = "legacy/legacy") => modelDefs.push({ kind: "model", key, version, origin: version === "legacy/legacy" ? "legacy" : "platform", status: "available", metadata: { ...(version === "legacy/legacy" ? { model_name: key } : {}), default_dataset: dataset, coverage: { [dataset]: { start, end } }, tags, ...extra } });
add("market_favorite_telonex", "telonex", "2026-08-06T00:00:00+08:00", "2026-09-04T23:59:59.500+08:00", ["market_view"], { market_view: true });
add("market_favorite_tmp", "mjj_tmp", "2026-08-08T00:00:00+08:00", "2026-08-29T23:59:59+08:00", ["market_view"], { market_view: true });
add("pswarm_v2", "telonex", "2026-08-07T21:16:28+08:00", "2026-08-31T21:00:34.250+08:00", ["sandbox"]);
add("pswarm_v2_subset", "telonex", "2026-08-07T21:16:28+08:00", "2026-08-31T21:00:34.250+08:00", ["sandbox", "sandbox_subset"]);
add("price50_subset", "telonex", "2026-08-10T00:00:00+08:00", "2026-09-02T12:00:00+08:00", ["sandbox", "sandbox_subset"]);
add("live_alpha", "telonex", "2026-08-12T00:00:00+08:00", "2026-09-03T00:00:00+08:00", ["sandbox", "live_subset"], { execution_cache_fresh: false });
add("echo", "mjj_tmp", "2026-08-08T10:00:00+08:00", "2026-08-29T10:00:00+08:00", ["sandbox"]);
add("echo_v2", "mjj_tmp", "2026-08-09T10:00:00+08:00", "2026-08-29T20:00:00+08:00", ["sandbox"]);
add("legacy_gbm_1", "canonical", "2026-07-01T00:00:00+08:00", "2026-08-19T23:00:00+08:00", ["legacy_pipeline"]);
add("legacy_gbm_2", "canonical", "2026-07-03T00:00:00+08:00", "2026-08-19T23:00:00+08:00", ["legacy_pipeline"]);
for (let i = 1; i <= 8; i += 1) add(`min_r1_${i}`, "telonex", "2026-08-15T00:00:00+08:00", "2026-09-04T00:00:00+08:00", ["sandbox", "min_subset:2026-10-15"]);
for (let i = 1; i <= 6; i += 1) add(`min_r2_${i}`, "telonex", "2026-08-20T00:00:00+08:00", "2026-09-04T00:00:00+08:00", ["sandbox", "min_subset:2026-11-15"]);
// 提交的预测：model_id 不含 __，版本是「训练版本/预测版本」，脚本里的名字由 infra 推导为 <model_id>__<训练>__<预测>
for (let i = 1; i <= 20; i += 1) add(`team_${String(i).padStart(2, "0")}`, "telonex", "2026-08-07T21:16:28+08:00", i % 4 === 0 ? "2026-08-25T00:00:00+08:00" : "2026-08-31T21:00:34+08:00", ["sandbox"], { dataset_coverage: { telonex: { matched_markets: 900 + i, missing_settlement: i % 3, missing_domain: 0 } } }, `v${1 + (i % 3)}/p${i}`);
// 同一个 model_id 的第二个预测版本（目录里 key 相同、version 不同）
add("team_01", "telonex", "2026-08-07T21:16:28+08:00", "2026-08-28T00:00:00+08:00", ["sandbox"], {}, "v2/p21");
save("catalog-models.json", page(modelDefs));

// 旧平台因子：版本 legacy/legacy、label 多数等于 key、迁移导入没有操作人（pool_changed_by 为空）；平台提交的因子版本是「表/数据版本」
const legacyFactors = [
  ["rev_momentum_3h", "REV 动量 3h", "pool", -1, "momentum"], ["near_logdiff", "近端对数差", "pool", 1, "orderbook"], ["book_slope_hourly", "盘口斜率（小时）", "pool", 1, "orderbook"], ["hourly_talib_rsi", "TA-Lib RSI（小时）", "pool", -1, "talib"], ["spread_pct", "spread_pct", "pool", -1, "orderbook"], ["depth_imbalance", "depth_imbalance", "pool", 1, "orderbook"],
].map(([key, label, state, direction, group]) => ({ kind: "factor", key, version: "legacy/legacy", origin: "legacy", status: "available", pool_state: state, pool_changed_at: "2026-10-12T08:30:00Z", metadata: { label, group, direction, description: `${label}：旧平台登记的因子。`, available: true, coverage: { start: "2026-08-06T00:00:00+08:00", end: "2026-09-04T23:00:00+08:00" }, latest_run_id: key === "rev_momentum_3h" ? "btr-20261019-sig00001" : undefined } }));
// 批量生成的旧因子：让因子库超过一页（每页 50）
const bulkFactors = Array.from({ length: 118 }, (_, i) => { const key = `hourly_feature_${String(i + 1).padStart(3, "0")}`; return { kind: "factor", key, version: "legacy/legacy", origin: "legacy", status: "available", pool_state: "experiment", pool_changed_at: "2026-10-12T08:30:00Z", metadata: { label: key, group: ["talib", "momentum", "orderbook", "volume"][i % 4], direction: i % 3 === 0 ? -1 : 1, available: true, coverage: { start: "2026-08-06T00:00:00+08:00", end: "2026-09-04T23:00:00+08:00" } } }; });
const platformFactors = [
  ["vol_burst", "成交突增", "experiment", 1], ["resid_edge", "残差 edge", "experiment", 1], ["late_trade_ratio", "尾盘成交占比", "experiment", -1],
].map(([key, label, state, direction]) => ({ kind: "factor", key, version: "research_0919/20260919-a", origin: "platform", status: "available", pool_state: state, pool_changed_by: "console:alice", pool_changed_at: "2026-10-14T03:00:00Z", metadata: { label, direction, description: `${label}：研究侧提交的因子。`, available: key !== "late_trade_ratio", unavailable_reason: key === "late_trade_ratio" ? "telonex 小时线因子目录缺少该因子" : undefined, coverage: { start: "2026-08-06T00:00:00+08:00", end: "2026-09-04T23:00:00+08:00" } } }));
const factorDefs = [...legacyFactors, ...platformFactors, ...bulkFactors];
save("catalog-factors.json", page(factorDefs));

// ───────────────────────── result.json ─────────────────────────

const base = (board, item, headline, scope) => ({ schema_version: "backtest.result.v1", board, item, headline, scope_card: scope, warnings: [], sections: [], artifacts: [] });
const scope = (extra = {}) => ({ window: { start: "2026-08-07T21:16:28+08:00", end_exclusive: "2026-08-31T21:00:35+08:00", align: "strict_common" }, domains: ["All domains"], dataset: "telonex", engine: engine.version, protocol: "pearson-dmid-v8", sample_scope: "strict", sample_counts: { 共同样本题数: 842, "pswarm_v2": 842, "market_favorite_telonex": 842 }, batch_members: [], ...extra });

const START = Date.parse("2026-08-07T21:16:28+08:00");
const walk = (n, drift, vol) => { let v = 0; return Array.from({ length: n }, (_, i) => { v += drift + (rand() - 0.5) * vol; return [new Date(START + i * 3.2 * 3600 * 1000).toISOString(), round(v, 2)]; }); };

function tradingResult() {
  const groups = ["Baseline × pswarm_v2", "Baseline v2 × pswarm_v2", "MultFactor v2 · W/G only × pswarm_v2"];
  const series = groups.flatMap((group, g) => {
    const mtm = walk(180, 0.4 - g * 0.12, 6);
    const realised = mtm.map(([t, v], i) => [t, round(v * 0.7 + (i % 9 === 0 ? 1.5 : 0), 2)]);
    return [{ name: `${group} · Realised`, group, variant: "realised", points: realised }, { name: `${group} · MTM`, group, variant: "mtm", points: mtm }];
  });
  const metricsCols = [
    { key: "strategy", label: "策略", kind: "text" }, { key: "model", label: "模型", kind: "text" }, { key: "selected", label: "候选", kind: "number", digits: 0 }, { key: "trades", label: "成交", kind: "number", digits: 0 },
    { key: "pnl", label: "总PnL", kind: "number", digits: 2, signed: true, prefix: "$" }, { key: "writeoff", label: "归0", kind: "text", sortable: true }, { key: "peak_cash", label: "峰值资本", kind: "number", digits: 2, prefix: "$" },
    { key: "return_pct", label: "回报%", kind: "percent", digits: 2, signed: true }, { key: "mdd", label: "MDD", kind: "number", digits: 2, prefix: "$" }, { key: "mdd_pct", label: "MDD%", kind: "percent", digits: 2 },
    { key: "sharpe", label: "Sharpe", kind: "interval", digits: 2, signed: true, help: "区间未做多重比较校正（含本次行数）。" }, { key: "ir", label: "IR", kind: "interval", digits: 2, signed: true }, { key: "win_rate", label: "胜率%", kind: "percent", digits: 1 },
  ];
  const rows = groups.map((group, g) => {
    const pnl = round(180 - g * 55 + rand() * 20, 2); const peak = round(900 + g * 80, 2);
    return { strategy: group.split(" × ")[0], model: group.split(" × ")[1], selected: 940 - g * 30, trades: 612 - g * 40, pnl, writeoff: { text: `$${(12.4 + g).toFixed(2)} (占|总PnL| ${(6.9 + g).toFixed(1)}%)`, sort: 12.4 + g }, peak_cash: peak, return_pct: round(pnl / peak * 100, 2), mdd: round(-48 - g * 6, 2), mdd_pct: round(-5.3 - g * 0.4, 2), sharpe: [round(0.4 + g * 0.1, 2), round(2.4 - g * 0.2, 2), round(1.4 - g * 0.15, 2)], ir: { lower: round(-0.3, 2), upper: round(2.1, 2), value: round(0.9 - g * 0.1, 2) }, win_rate: round(58.2 - g * 1.5, 1) };
  });
  // 旧运行已存的结果：旧引擎原因码有中文说明；逐时点账户的原因码（below_one_share、no_liquidity）说明列就是原因码本身
  const drop = ["no_buy_quote", "thin_book", "cash_short", "below_one_share", "no_liquidity"];
  const dropExplain = ["吸收档无买价", "盘口过薄无法成交", "现金不足", "below_one_share", "no_liquidity"];
  const entryCombos = groups.slice(0, 2);
  const bars = [];
  for (const combo of entryCombos) for (const dir of ["all", "yes", "no"]) for (let b = 0; b < 20; b += 1) {
    const centre = (b + 0.5) * 0.05; const density = Math.exp(-((centre - 0.42) ** 2) / 0.05) * (dir === "no" ? 0.8 : dir === "yes" ? 1.1 : 1);
    bars.push({ label: `${(b * 0.05).toFixed(2)}–${((b + 1) * 0.05).toFixed(2)}`, value: Math.round(density * 90 + rand() * 6), x0: round(b * 0.05, 2), x1: round((b + 1) * 0.05, 2), filters: { entry_combo: combo, direction: dir } });
  }
  return {
    ...base("trading", "strategy_comparison", "Baseline · All domains · native sizing · pswarm_v2 · 2026-08-07 → 2026-08-31", scope({ sample_counts: { 逐题交集: 842, "pswarm_v2 答题率": "100%" } })),
    warnings: [{ level: "warning", text: "MultFactor v2 读取小时线因子：本数据集的小时线来自 orderbook 重建，口径与 official 不同。" }],
    sections: [
      { id: "pnl_curves", type: "series", x: "time", x_label: "时间", y_label: "累计 PnL ($)", y_format: "money", reference_lines: [{ axis: "y", value: 0 }], series },
      { id: "final_pnl", type: "bars", digits: 2, bars: rows.map((r) => ({ label: `${r.strategy} × ${r.model}`, value: r.pnl })), caption: "期末 PnL 横条排名（**MTM** 口径），`$` 为美元。" },
      { id: "metrics_main", type: "table", columns: metricsCols, rows, default_sort: { key: "pnl", direction: "desc" }, notes: ["候选 = 进入策略漏斗前的 selected 数；回报% = 总PnL ÷ 峰值资本；MDD% = MDD ÷ 峰值资本。", "归0 接近或超过 100% 说明总PnL 的符号由数据缺口决定。"] },
      { id: "metrics_detail", type: "table", title: "辅表 · 现金约束", columns: [{ key: "strategy", label: "策略", kind: "text" }, { key: "cash_constraint", label: "cash_constraint", kind: "text" }, { key: "cash_skipped", label: "cash_skipped_trades", kind: "number", digits: 0 }, { key: "open", label: "open_positions", kind: "number", digits: 0 }], rows: rows.map((r, i) => ({ strategy: r.strategy, cash_constraint: "unlimited", cash_skipped: i * 3, open: 14 - i })) },
      { id: "drop_reasons", type: "table", columns: [{ key: "strategy", label: "策略", kind: "text" }, { key: "model", label: "模型", kind: "text" }, { key: "reason", label: "原因", kind: "text" }, { key: "description", label: "说明", kind: "text" }, { key: "count", label: "笔数", kind: "number", digits: 0 }, { key: "share", label: "占 selected", kind: "percent", digits: 1 }], rows: rows.flatMap((r, i) => drop.map((d, j) => ({ strategy: r.strategy, model: r.model, reason: d, description: dropExplain[j], count: 40 - i * 5 - j * 7, share: round((40 - i * 5 - j * 7) / (940 - i * 30) * 100, 1) }))), default_sort: { key: "count", direction: "desc" }, caption: "candidates = 窗口与 domain 内的概率条数；selected = 过门后的候选笔数；trades = 成交。" },
      { id: "entry_prices", type: "bars", orientation: "vertical", digits: 0, filters: [{ key: "entry_combo", label: "strategy × model", options: entryCombos, default: entryCombos[0] }, { key: "direction", label: "方向", options: [{ value: "all", label: "YES + NO" }, { value: "yes", label: "仅 YES" }, { value: "no", label: "仅 NO" }], default: "all" }], bars, reference_lines: [{ value: 0.42, label: "均值" }, { value: 0.39, label: "中位数" }], caption: "bin 0.05；均值与中位数以竖线标出。" },
      { id: "manifests", type: "text", format: "json", title: "manifest · 载体配置", text: JSON.stringify({ strategy: "baseline", engine: engine.version, args: ["--scope", "strict", "--position-sizing", "native"] }) },
    ],
    artifacts: [{ name: "metrics.csv", path: "metrics.csv", bytes: 2287 }, { name: "pnl_comparison_mtm.png", path: "pnl_comparison_mtm.png", bytes: 88123 }],
  };
}

/** 新版执行器（中文标题行、原因码在最后一列、账户规则只在口径卡片里出现一次）产出的逐时点策略结果，只有一条曲线。 */
function stepwiseTradingResult() {
  const group = "Baseline V3（逐时点包装） × pswarm_v2";
  const mtm = walk(120, 0.35, 5);
  const rule = "逐时点账户规则：盘口深度 15 档 · 整股成交 · 费率 0 · 现金不足时部分成交 · 报价容忍 10 分钟 · 快照最长陈旧 20 分钟 · 补齐盘口缺口 · 先卖后买 · 区间结束按中价估值（默认值待研究侧确认）";
  const pnl = round(mtm[mtm.length - 1][1], 2);
  return {
    ...base("trading", "strategy_comparison", "Baseline V3（逐时点包装） · 全部 Domain · 策略自带仓位 · 无限资金 · pswarm_v2 · 2026-08-07 21:16 → 2026-08-31 21:00（UTC+08:00）", scope({ sample_scope: "own", sample_counts: { 策略数: 1, 模型数: 1, 账户规则: rule } })),
    sections: [
      { id: "pnl_curves", type: "series", x: "time", x_label: "时间", y_label: "累计 PnL ($)", y_format: "money", reference_lines: [{ axis: "y", value: 0 }], series: [{ name: `${group} · MTM`, group, variant: "mtm", points: mtm }, { name: `${group} · Realised`, group, variant: "realised", points: mtm.map(([t, v]) => [t, round(v * 0.8, 2)]) }] },
      { id: "final_pnl", type: "bars", digits: 2, bars: [{ label: group, value: pnl }], caption: "期末 PnL 横条排名（MTM 口径）。" },
      { id: "metrics_main", type: "table", columns: [{ key: "strategy", label: "策略", kind: "text" }, { key: "model", label: "模型", kind: "text" }, { key: "trades", label: "成交", kind: "number", digits: 0 }, { key: "pnl", label: "总PnL", kind: "number", digits: 2, signed: true, prefix: "$" }], rows: [{ strategy: "Baseline V3（逐时点包装）", model: "pswarm_v2", trades: 412, pnl }] },
      { id: "drop_reasons", type: "table", title: "未成交候选的原因明细", columns: [{ key: "strategy", label: "策略", kind: "text" }, { key: "model", label: "模型", kind: "text" }, { key: "description", label: "未成交原因", kind: "text" }, { key: "count", label: "笔数", kind: "number", digits: 0 }, { key: "share", label: "占入选候选", kind: "percent", digits: 2, fraction: true }, { key: "reason", label: "原因代码", kind: "text" }], rows: [{ strategy: "Baseline V3（逐时点包装）", model: "pswarm_v2", description: "按整股成交，目标不足一股", count: 31, share: 0.042, reason: "below_one_share" }, { strategy: "Baseline V3（逐时点包装）", model: "pswarm_v2", description: "对手盘一档有效报价都没有", count: 12, share: 0.016, reason: "no_liquidity" }], default_sort: { key: "count", direction: "desc" }, caption: "候选（candidates）= 窗口与 Domain 内的概率条数；入选（selected）= 过门后的候选笔数；**成交**（trades）= 真正成交的笔数。" },
      { id: "manifests", type: "text", format: "json", title: "运行清单（原始 JSON）", text: JSON.stringify({ strategy: "baseline_v3_stepwise", engine: engine.version }) },
    ],
    artifacts: [{ name: "metrics.csv", path: "metrics.csv", bytes: 1187 }],
  };
}

function overviewResult() {
  const models = ["Market", "pswarm_v2", "pswarm_v2_subset", "price50_subset", "echo", "team_01__v2__p1", "team_02__v3__p2"];
  const strat = ["baseline", "baseline_v1_1", "baseline_v2", "wgeo_mult_factor_v1", "wgeo_mult_factor_v2"];
  const stratLabels = ["交易·Baseline v1", "交易·Baseline v1.1", "交易·Baseline v2", "交易·MultFactor v1 · W/G only", "交易·MultFactor v2 · W/G only"];
  const columns = [
    { key: "model", label: "模型", kind: "text", sortable: false },
    ...strat.map((key, i) => ({ key: `strategy_${key}`, label: `${stratLabels[i]} PnL/回报/Sharpe`, kind: "text", best: "high" })),
    { key: "signal_ic", label: "信号·IC (pooled · Mid→Mid · 24h)", kind: "text", best: "high" }, { key: "signal_icir", label: "信号·ICIR (同口径)", kind: "text", best: "high" },
    { key: "brier", label: "概率质量·Brier (市场等权)", kind: "number", digits: 4, best: "low" }, { key: "ece", label: "概率质量·校准 ECE", kind: "number", digits: 4, best: "low" },
    { key: "fixed_tte", label: "概率质量·固定 TTE Brier (T-7)", kind: "number", digits: 4, best: "low" }, { key: "deviation", label: "概率质量·偏离 market÷模型 (τ=0.1 · >1 及格)", kind: "number", digits: 3, best: "high" },
  ];
  const rows = models.map((model, m) => {
    const row = { model };
    strat.forEach((key, i) => {
      if (m === 0 && i > 2) { row[`strategy_${key}`] = { text: "—", sort: null }; return; }
      const pnl = round((m === 0 ? 0 : 120 - m * 14 + i * 9) + rand() * 6, 2);
      row[`strategy_${key}`] = m === 3 && i === 4 ? { text: "0 笔", sort: null } : { text: `${pnl >= 0 ? "+" : ""}${pnl.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n${(pnl / 9).toFixed(1)}%\nSh ${(pnl / 90).toFixed(1)}${i % 2 ? "*" : ""}`, sort: pnl };
    });
    row.signal_ic = m === 0 ? { text: "不适用", sort: null } : { text: (0.05 + 0.01 * (7 - m)).toFixed(3), sort: 0.05 + 0.01 * (7 - m) };
    row.signal_icir = m === 0 ? { text: "不适用", sort: null } : { text: (0.6 + 0.05 * (7 - m)).toFixed(3), sort: 0.6 + 0.05 * (7 - m) };
    row.brier = round(0.19 + m * 0.004 + rand() * 0.003, 4); row.ece = round(0.03 + m * 0.002, 4);
    row.fixed_tte = m === 5 ? null : round(0.21 + m * 0.003, 4); row.deviation = m === 0 ? null : round(1.05 - m * 0.02, 3);
    return row;
  });
  rows.forEach((row, m) => { row.pnl_per_share = m === 0 ? 0 : round(0.02 + (7 - m) * 0.004, 4); });
  const labelOf = (k) => k === "pnl_per_share" ? "交易·结算 PnL/share" : columns.find((c) => c.key === k).label;
  const metricKeys = [...columns.slice(1).map((c) => c.key), "pnl_per_share"];
  const matrix = metricKeys.map((a, i) => metricKeys.map((b, j) => i === j ? 1 : round(Math.sin((i + 1) * (j + 2)) * 0.9, 2)));
  const symmetric = matrix.map((row, i) => row.map((v, j) => i <= j ? v : matrix[j][i]));
  return {
    ...base("benchmark", "overview", "默认 Benchmark 总表 · 7 个模型 · 2026-08-07 → 2026-08-31", scope({ sample_counts: { 模型数: 6, "共同市场数": 842 } })),
    warnings: [{ level: "info", text: "整张表当前使用公共时间区间；五个策略列固定原生仓位与无限资金。" }, { level: "warning", text: "偏离列仅作逐行阅读，不是排行榜。" }],
    sections: [
      { id: "completion", type: "metrics", items: [{ label: "已完成 Benchmark", value: "6 / 6" }, { label: "五个策略列", value: "已完成" }, { label: "时间窗口（全表共用）", value: "2026-08-07 21:16 → 2026-08-31 21:00" }] },
      { id: "main", type: "table", columns, rows, default_sort: { key: "brier", direction: "asc" }, pin_sorted_columns: true, rank_column: true, searchable: false, caption: "点表头排序，再点同列反向；点过的列固定在左侧；空值排最后且无排名号。" },
      { id: "metric_correlation", type: "matrix", rows: metricKeys.map((k) => labelOf(k).slice(0, 22)), cols: metricKeys.map((k) => labelOf(k).slice(0, 14)), values: symmetric, counts: symmetric.map((r, i) => r.map((_, j) => i === j ? 6 : (i + j) % 7 === 0 ? 4 : 6)), domain: [-1, 1], caption: "越小越好的列已取负统一朝向；Market 行不参与；n<5 标 n。" },
      { id: "metric_bars", type: "bars", digits: 4, filters: [{ key: "metric", label: "看哪张图", options: metricKeys.map((k) => ({ value: k, label: labelOf(k) })), default: "brier" }], bars: metricKeys.flatMap((k) => models.map((model, m) => ({ label: model, value: typeof rows[m][k] === "number" ? rows[m][k] : (rows[m][k]?.sort ?? null), highlight: m === 0 ? "market" : m === 1 ? "best" : undefined, lower: typeof rows[m][k] === "number" && k === "brier" ? round(rows[m][k] - 0.004, 4) : undefined, upper: typeof rows[m][k] === "number" && k === "brier" ? round(rows[m][k] + 0.004, 4) : undefined, filters: { metric: k } }))), reference_lines: [] },
      { id: "detail", type: "table", columns: [{ key: "model", label: "模型", kind: "text" }, { key: "raw_all", label: "原始预测条数(整表)", kind: "number", digits: 0 }, { key: "raw_window", label: "原始预测条数(窗口内)", kind: "number", digits: 0 }, { key: "brier_markets", label: "Brier已结算市场数", kind: "number", digits: 0 }, { key: "ece_mcb", label: "校准MCB", kind: "number", digits: 4 }], rows: models.map((model, i) => ({ model, raw_all: 120000 + i * 3000, raw_window: 98000 + i * 2500, brier_markets: 842 - i, ece_mcb: round(0.012 + i * 0.001, 4) })) },
    ],
    artifacts: [{ name: "benchmark_overview.csv", path: "overview/benchmark_overview.csv", bytes: 5120 }],
  };
}

function brierResult() {
  const models = ["Market", "pswarm_v2", "echo", "team_01__v2__p1", "team_02__v3__p2"];
  const levels = [90, 95, 99]; const scopes = [["all", "全部市场"], ["odds_20_80", "赔率 20%–80%"]];
  const rows = []; const bars = []; const rank = [];
  scopes.forEach(([scopeKey]) => levels.forEach((lvl) => models.forEach((model, m) => {
    const shift = m === 0 ? 0 : -0.0095 + m * 0.0042; const brier = round(0.19 + shift + (scopeKey === "all" ? 0 : 0.04), 4); const half = 0.0045 * (lvl === 99 ? 1.5 : lvl === 90 ? 0.8 : 1);
    const delta = m === 0 ? 0 : round(shift, 4);
    const verdict = m === 0 ? "基准" : delta + half < 0 ? "更准" : delta - half > 0 ? "更差" : "分不出";
    rows.push({ filters: { odds_scope: scopeKey, ci_level: String(lvl) }, model, n_markets: 842 - m * 2, brier: { text: brier.toFixed(4), sort: brier }, interval: [round(brier - half, 4), round(brier + half, 4)], delta: m === 0 ? null : delta, verdict: { text: verdict, tone: verdict === "更准" ? "good" : verdict === "更差" ? "bad" : verdict === "基准" ? "muted" : "warn" }, hint: m === 3 && lvl === 99 ? "⚠ 样本不足" : "" });
    bars.push({ label: model, value: brier, lower: round(brier - half, 4), upper: round(brier + half, 4), highlight: m === 0 ? "market" : undefined, filters: { odds_scope: scopeKey, ci_level: String(lvl) } });
  })));
  models.forEach((model, m) => rank.push({ model, brier_all: round(0.19 + m * 0.004, 4), rank_all: m + 1, brier_band: round(0.23 + m * 0.004 + (m === 2 ? 0.01 : 0), 4), rank_band: m === 2 ? 4 : m === 3 ? 3 : m + 1, shift: m === 2 ? "↓2 位" : m === 3 ? "↑1 位" : "持平", markets_band: 610 - m, rows_band: 3880 - m * 5 }));
  return {
    ...base("benchmark", "resolved_event_brier", "已结算市场 · Brier · 5 个模型", scope({ sample_counts: { 共同面板市场: 842, 打分时点: 3920 } })),
    filters: [{ key: "odds_scope", label: "赔率口径", options: scopes.map(([value, label]) => ({ value, label })), default: "all" }, { key: "ci_level", label: "置信水平", options: levels.map((l) => ({ value: String(l), label: `${l}%` })), default: "95" }],
    sections: [
      { id: "brier_bars", type: "bars", digits: 4, bars, reference_lines: [], caption: "Market 橙色，其余蓝色；误差棒为所选置信水平的区间。" },
      { id: "verdicts", type: "text", format: "markdown", text: "**整体低于 Market（更准）**：pswarm_v2\n\n**整体高于 Market（更差）**：team_02__v3__p2\n\n**区间跨 0（分不出）**：echo、team_01__v2__p1\n\n- 99% 档且 ci_events < 200 时尾部不可信。" },
      { id: "metrics", type: "table", columns: [{ key: "model", label: "模型", kind: "text" }, { key: "n_markets", label: "已结算市场数", kind: "number", digits: 0 }, { key: "brier", label: "市场等权Brier", kind: "number", digits: 4, best: "low" }, { key: "interval", label: "区间", kind: "interval", digits: 4 }, { key: "delta", label: "对Market差", kind: "number", digits: 4, signed: true }, { key: "verdict", label: "与Market比", kind: "badge" }, { key: "hint", label: "提示", kind: "text" }], rows, default_sort: { key: "brier", direction: "asc" }, notes: ["共同面板：842 个已结算市场 · 3920 个打分时点（平均 4.7 次/市场）。"], searchable: false },
      { id: "scope_ranks", type: "table", columns: [{ key: "model", label: "模型", kind: "text" }, { key: "brier_all", label: "全样本Brier", kind: "number", digits: 4 }, { key: "rank_all", label: "全样本排名", kind: "number", digits: 0 }, { key: "brier_band", label: "带内Brier", kind: "number", digits: 4 }, { key: "rank_band", label: "带内排名", kind: "number", digits: 0 }, { key: "shift", label: "排名变化", kind: "badge" }, { key: "markets_band", label: "带内市场数", kind: "number", digits: 0 }, { key: "rows_band", label: "带内时点数", kind: "number", digits: 0 }], rows: rank, default_sort: { key: "rank_all", direction: "asc" }, notes: ["样本漏斗：842 市场 / 3920 时点 → 610 / 3880（留下 72%）。Spearman ρ = 0.80（读自 manifest）。"] },
      { id: "metrics_raw", type: "table", columns: [{ key: "model", label: "model", kind: "text" }, { key: "ci_events", label: "ci_events", kind: "number", digits: 0 }, { key: "ci_usable", label: "ci_usable", kind: "number", digits: 0 }], rows: models.map((model, i) => ({ model, ci_events: 842 - i, ci_usable: i === 3 ? 0 : 1 })) },
      { id: "manifest", type: "text", format: "json", text: JSON.stringify({ benchmark: "resolved_event_brier", seed: 20260806, bootstrap: 2000 }) },
    ],
  };
}

function calibrationResult() {
  const models = ["Market", "pswarm_v2", "echo"];
  const modes = [["first_entry", "首次进入桶"], ["mean_in_bucket", "桶内均值"]];
  const series = [];
  modes.forEach(([mode]) => models.forEach((model, m) => series.push({ name: model, highlight: m === 0, filters: { representative_mode: mode }, points: Array.from({ length: 10 }, (_, b) => { const x = round((b + 0.5) / 10 + (mode === "first_entry" ? 0 : 0.01), 3); const n = Math.round(260 * Math.exp(-((x - 0.5) ** 2) / 0.05) + 4 + rand() * 5); const y = round(Math.min(0.99, Math.max(0.01, x + (m - 1) * 0.04 * Math.sin(b) + (rand() - 0.5) * 0.03)), 3); const half = 1.96 * Math.sqrt(y * (1 - y) / Math.max(n, 1)); return { x, y, size: n, lower: round(Math.max(0, y - half), 3), upper: round(Math.min(1, y + half), 3), low_sample: n < 20 }; }) })));
  return {
    ...base("benchmark", "calibration", "概率校准 · 3 个模型", scope()),
    warnings: [{ level: "warning", text: "MCB 与 Brier 要并排读；MCB 小不代表预测准。" }],
    filters: [{ key: "representative_mode", label: "代表概率口径", options: modes.map(([value, label]) => ({ value, label })), default: "first_entry" }],
    sections: [
      { id: "curve", type: "series", mode: "scatter", x: "number", x_label: "桶内平均预测概率", y_label: "实际 YES 率", reference_lines: [{ axis: "diagonal" }], series, caption: "点大小 ∝ 唯一市场数；竖线 = 实际 YES 率区间；灰色空心点 = 低样本桶；点击图例只看该模型。" },
      { id: "summary", type: "table", columns: [{ key: "model", label: "模型", kind: "text" }, { key: "ece", label: "ECE", kind: "number", digits: 4, best: "low" }, { key: "mcb", label: "MCB", kind: "number", digits: 4, best: "low" }, { key: "max_gap", label: "最大桶偏差", kind: "number", digits: 3 }, { key: "valid_buckets", label: "有效桶数", kind: "number", digits: 0 }, { key: "rank", label: "校准排名", kind: "number", digits: 0 }], rows: modes.flatMap(([mode]) => models.map((model, m) => ({ filters: { representative_mode: mode }, model, ece: round(0.02 + m * 0.006, 4), mcb: round(0.011 + m * 0.004, 4), max_gap: round(0.05 + m * 0.02, 3), valid_buckets: 10 - m, rank: m + 1 }))), default_sort: { key: "ece", direction: "asc" }, notes: ["排名列用 expected_calibration_error，不用脚本的 MCB 排名（calibration_rank）。"] },
      { id: "report", type: "text", format: "markdown", text: "# 校准报告\n\n- 桶边界：10 个等宽桶\n- 最小唯一市场数门槛：20\n\n| 模型 | ECE |\n| --- | --- |\n| Market | 0.0200 |\n| pswarm_v2 | 0.0260 |" },
    ],
  };
}

const HORIZONS = [["1", "1h"], ["12", "12h"], ["24", "24h"], ["48", "48h"], ["96", "4d"], ["168", "7d"]];

/** 单因子的区块集合；批量结果里每个因子一组，id 加 `factor:<因子>:` 前缀。 */
function factorSections(prefix, factorId) {
  const id = (name) => `${prefix}${name}`;
  return [
    { id: id("screen"), type: "metrics", items: [{ label: "初筛状态", value: "通过初筛" }, { label: "24h Pearson IC", value: 0.0412, digits: 6 }, { label: "稳健 t", value: 3.18, digits: 2 }, { label: "Rank IC", value: 0.0377, digits: 6 }, { label: "24h 截面数", value: 612, digits: 0 }, { label: "市场数", value: 842, digits: 0 }, { label: "因子覆盖率", value: 97.4, kind: "percent", digits: 1 }, { label: "标签覆盖率", value: 99.1, kind: "percent", digits: 1 }], caption: "单对象 Holm = 自身 p；覆盖率只标注。", title: `${factorId} · 初筛` },
    { id: id("horizons"), type: "table", title: "六周期汇总", columns: [{ key: "horizon_label", label: "Horizon", kind: "text" }, { key: "ic", label: "Pearson IC", kind: "number", digits: 4, signed: true }, { key: "icir", label: "ICIR", kind: "number", digits: 3 }, { key: "t", label: "稳健 t", kind: "number", digits: 2 }, { key: "ci", label: "IC 区间", kind: "interval", digits: 4 }, { key: "rank_ic", label: "Rank IC", kind: "number", digits: 4 }, { key: "spread", label: "最高桶 − 最低桶 ($/share)", kind: "number", digits: 4 }, { key: "sections", label: "截面数", kind: "number", digits: 0 }, { key: "note", label: "备注", kind: "text" }], rows: HORIZONS.map(([value, label], i) => ({ horizon: value, horizon_label: label, ic: round(0.02 + (i === 2 ? 0.021 : i * 0.002), 4), icir: round(0.4 + i * 0.05, 3), t: round(1.4 + i * 0.5, 2), ci: [round(0.005 + i * 0.001, 4), round(0.04 + i * 0.004, 4)], rank_ic: round(0.018 + i * 0.002, 4), spread: round(0.004 + i * 0.001, 4), sections: 700 - i * 50, note: value === "24" ? "主口径" : "" })) },
    ...HORIZONS.map(([value, label]) => ({ id: id(`deciles_${value}`), type: "image", title: `${label} 分桶 · 平均 Δmid ($/share)`, artifact: "report/rev_momentum_3h/quantiles_compact_v2.png", alt: `${label} 十分位分桶图`, when: { horizon: value } })),
    { id: id("deciles_table"), type: "table", tab: "分桶明细", title: "分桶明细", columns: [{ key: "bucket", label: "分位桶", kind: "text" }, { key: "mean_dmid", label: "平均 Δmid ($/share)", kind: "number", digits: 4, signed: true }, { key: "n", label: "样本数", kind: "number", digits: 0 }], rows: HORIZONS.flatMap(([value]) => Array.from({ length: 10 }, (_, k) => ({ filters: { horizon: value }, bucket: `D${k + 1}`, mean_dmid: round((k - 4.5) * 0.0011, 4), n: 6200 - k * 40 }))), notes: ["最高桶 − 最低桶 95% CI：[0.0041, 0.0102]"] },
    { id: id("ic_series"), type: "series", tab: "IC 时序", title: "IC 时序", x: "time", y_label: "IC", series: ["pearson", "rank", "mid_pearson"].map((name, n) => ({ name, points: walk(60, 0, 0.04 + n * 0.01).map(([t, v]) => [t, round(v / 20 + 0.03, 4)]) })), reference_lines: [{ axis: "y", value: 0 }] },
    { id: id("price_strata"), type: "table", tab: "价格分层", title: "价格分层", columns: [{ key: "stratum", label: "价格层", kind: "text" }, { key: "ic", label: "Pearson IC", kind: "number", digits: 4 }, { key: "n", label: "样本数", kind: "number", digits: 0 }], rows: [["0–20%", 0.031, 21000], ["20–50%", 0.044, 48000], ["50–80%", 0.039, 47000], ["80–100%", 0.018, 15000]].map(([stratum, ic, n]) => ({ stratum, ic, n })) },
    { id: id("by_domain"), type: "table", tab: "分 Domain", title: "分 Domain", columns: [{ key: "domain", label: "Domain", kind: "text" }, { key: "ic", label: "Pearson IC", kind: "number", digits: 4 }, { key: "markets", label: "市场数", kind: "number", digits: 0 }, { key: "status", label: "状态", kind: "badge" }], rows: [["Crypto", 0.051, 210, "已排名"], ["Politics", 0.043, 188, "已排名"], ["Sports", 0.012, 31, "截面不足，不排名"]].map(([domain, ic, markets, status]) => ({ domain, ic, markets, status })), caption: "诊断，不做多重检验。" },
    { id: id("by_period"), type: "table", tab: "分期对照", title: "分期对照", columns: [{ key: "period", label: "时期", kind: "text" }, { key: "ic", label: "24h Pearson IC", kind: "number", digits: 4 }, { key: "t", label: "稳健 t", kind: "number", digits: 2 }], rows: [{ period: "研究期 2026-08-06 → 08-25", ic: 0.0451, t: 3.4 }, { period: "对照期 2026-08-25 → 09-04", ic: 0.0322, t: 1.9 }] },
    { id: id("files"), type: "text", tab: "文件", title: "文件", format: "markdown", text: "- 因子报告 JSON：`report/rev_momentum_3h/factor.json`\n- 分桶 CSV：`report/rev_momentum_3h/deciles.csv`" },
  ];
}

function signalResult() {
  return {
    ...base("signal", "factor", "单因子 · rev_momentum_3h · pearson-dmid-v8", scope({ domains: ["All domains"], sample_scope: "pooled" })),
    filters: [{ key: "horizon", label: "明细周期", options: HORIZONS.map(([value, label]) => ({ value, label })), default: "24" }],
    sections: factorSections("", "rev_momentum_3h"),
    artifacts: [{ name: "factor.json", path: "report/rev_momentum_3h/factor.json", bytes: 40211 }],
  };
}

function batchResult() {
  const factors = [["rev_momentum_3h", "通过初筛"], ["vol_burst", "人工复审"], ["resid_edge", "样本不足"]];
  const statuses = ["通过初筛", "人工复审", "暂无证据", "样本不足", "数据异常"];
  return {
    ...base("signal", "factor_batch", "批量因子表 · research_0919 / 20260919-a · 3 个因子", scope({ sample_scope: "pooled", batch_members: factors.map(([id]) => id) })),
    warnings: [{ level: "info", text: "Holm 校正按本批 3 个对象计算，单独评估结果可能不同。" }],
    filters: [{ key: "horizon", label: "明细周期", options: HORIZONS.map(([value, label]) => ({ value, label })), default: "24" }],
    sections: [
      { id: "status_counts", type: "metrics", items: statuses.map((label) => ({ label, value: factors.filter(([, st]) => st === label).length, digits: 0 })) },
      { id: "summary", type: "table", title: "批次汇总", filters: [{ key: "status", label: "状态", options: [{ value: "all", label: "全部" }, ...statuses.map((v) => ({ value: v, label: v }))], default: "all" }], columns: [{ key: "factor", label: "因子", kind: "text" }, { key: "status", label: "状态", kind: "badge" }, { key: "reason", label: "原因", kind: "text" }, { key: "ic", label: "Pearson IC", kind: "number", digits: 4 }, { key: "icir", label: "ICIR", kind: "number", digits: 3 }, { key: "t", label: "稳健 t", kind: "number", digits: 2 }, { key: "holm_p", label: "Holm p", kind: "number", digits: 4 }, { key: "validation", label: "样本外验证", kind: "text" }], rows: factors.map(([factor, status], i) => ({ filters: { status: [status, "all"] }, factor, status, reason: status === "通过初筛" ? "" : status === "人工复审" ? "IC 方向与对照期不一致" : "有效截面 < 20", ic: round(0.041 - i * 0.012, 4), icir: round(0.62 - i * 0.2, 3), t: round(3.18 - i * 1.1, 2), holm_p: round(0.004 + i * 0.09, 4), validation: i === 0 ? "对照期通过" : "—" })), default_sort: { key: "t", direction: "desc" } },
      ...factors.flatMap(([factor]) => factorSections(`factor:${factor}:`, factor)),
    ],
    artifacts: [{ name: "summary.csv", path: "report/summary.csv", bytes: 1204 }],
  };
}

function correlationResult() {
  const names = ["REV 动量 3h", "近端对数差", "盘口斜率（小时）", "TA-Lib RSI（小时）", "买卖价差占比", "深度失衡", "MODEL:pswarm_v2:EDGE"];
  const n = names.length;
  const values = names.map((_, i) => names.map((__, j) => i === j ? 1 : round(Math.cos((i + 1) * (j + 1)) * 0.8, 3)));
  const sym = values.map((r, i) => r.map((_, j) => i <= j ? values[i][j] : values[j][i]));
  return {
    ...base("signal", "correlation", "因子池 Correlation · 7 个特征", scope({ sample_scope: "pooled" })),
    sections: [
      { id: "overview", type: "metrics", items: [{ label: "特征数", value: n, digits: 0 }, { label: "市场数", value: 842, digits: 0 }, { label: "小时数", value: 690, digits: 0 }, { label: "小时侧别样本", value: 412380, digits: 0 }] },
      { id: "spearman", type: "matrix", rows: names, cols: names, values: sym, counts: sym.map((r) => r.map(() => 412380)), domain: [-1, 1], digits: 2, caption: "截面 rank 后合并 Spearman；每小时每特征 ≥ 20 样本。" },
      { id: "spearman_png", type: "image", title: "截面 Rank Correlation（引擎图）", artifact: "spearman_heatmap.png", alt: "Spearman 热力图" },
      { id: "pairs", type: "table", columns: [{ key: "a", label: "特征 A", kind: "text" }, { key: "b", label: "特征 B", kind: "text" }, { key: "spearman", label: "Spearman", kind: "number", digits: 3, signed: true }, { key: "samples", label: "样本", kind: "number", digits: 0 }], rows: names.flatMap((a, i) => names.slice(i + 1).map((b, j) => ({ a, b, spearman: sym[i][i + 1 + j], samples: 412380 - i * 10 }))), default_sort: { key: "spearman", direction: "desc" } },
    ],
  };
}

/** 覆盖七种 section 与两级 filters 的最小样例（单元测试与文档示例）。 */
function allSections() {
  return {
    ...base("benchmark", "resolved_event_brier", "全部区块类型示例", scope()),
    filters: [{ key: "ci_level", label: "置信水平", options: [{ value: "90", label: "90%" }, { value: "95", label: "95%" }], default: "95" }],
    sections: [
      { id: "kpis", type: "metrics", items: [{ label: "样本", value: 842, digits: 0 }, { label: "覆盖率", value: 97.4, kind: "percent", digits: 1 }, { label: "状态", value: "通过初筛" }, { label: "空值", value: null }] },
      { id: "table", type: "table", columns: [{ key: "model", label: "模型", kind: "text" }, { key: "brier", label: "Brier", kind: "number", digits: 4, best: "low" }, { key: "interval", label: "区间", kind: "interval", digits: 4 }, { key: "pct", label: "占比", kind: "percent", digits: 1 }, { key: "verdict", label: "结论", kind: "badge" }], rows: [{ model: "A", brier: 0.19, interval: [0.18, 0.2], pct: 12.5, verdict: "更准", filters: { ci_level: "95" } }, { model: "A", brier: 0.19, interval: [0.17, 0.21], pct: 12.5, verdict: "分不出", filters: { ci_level: "90" } }, { model: "B", brier: null, interval: null, pct: null, verdict: null, filters: { ci_level: "95" } }], default_sort: "brier", notes: ["示例表"] },
      { id: "series", type: "series", x: "time", series: [{ name: "s1", points: [["2026-08-07T00:00:00Z", 1], ["2026-08-08T00:00:00Z", 2], ["2026-08-09T00:00:00Z", null]] }], reference_lines: [{ axis: "y", value: 0 }] },
      { id: "bars", type: "bars", bars: [{ label: "A", value: 0.2, lower: 0.18, upper: 0.22, highlight: "market", filters: { ci_level: "95" } }, { label: "B", value: 0.21, lower: 0.17, upper: 0.25, filters: { ci_level: "90" } }], reference_line: { value: 0.2, label: "基准" } },
      { id: "matrix", type: "matrix", rows: ["a", "b"], cols: ["a", "b"], values: [[1, 0.5], [0.5, null]], counts: [[10, 3], [3, 10]], domain: [-1, 1] },
      { id: "text", type: "text", markdown: "# 标题\n\n**加粗** 与 `代码`\n\n- 列表" },
      { id: "image", type: "image", artifact: "plots/a.png", alt: "示例图", when: { ci_level: "95" } },
    ],
  };
}

// stepwise 放在最后：它会消耗伪随机数，放前面会让其它 fixture 的数值整体变化
const results = { trading: tradingResult(), overview: overviewResult(), brier: brierResult(), calibration: calibrationResult(), signal: signalResult(), batch: batchResult(), correlation: correlationResult(), stepwise: stepwiseTradingResult() };
save("result-all-sections.json", allSections());

// ───────────────────────── 运行 ─────────────────────────

const reproduceText = (id, title, extra = "") => `实验 ID：${id} · ${title}
服务器：8.211.188.216 · 结果 /var/lib/pm-backtest/runs/${id}
配置：/var/lib/pm-backtest/runs/${id}/run-config.json
窗口：[2026-08-07T21:16:28+08:00, 2026-08-31T21:00:35+08:00) · Domain 全部 · 数据集 telonex/20260913-v0uepugf
输入：pswarm_v2_subset sha256=9f2c…e1 · price50_subset sha256=77ab…03 · 预测表全集 100 个 sha256=4c0d…aa · 结算 sha256=b1e2…9c · 域映射 sha256=0d3f…52
引擎：pm-engine@${engine.version} · pearson-dmid-v8 · 执行器 5a6d16b · Python 3.13 · 依赖锁 sha256=ab12…77
命令：cd /opt/pm-backtest-engine/releases/${engine.version}/pm_backtest_v2 && python -m scripts.run_brier_score_model_comparison --window-start 2026-08-07T21:16:28+08:00 ${extra}
重跑：/opt/pm-backtest-runner/releases/5a6d16b/bin/pmbt rerun ${id}`;

const configOf = (id, board, item, extra = {}) => ({ schema_version: "backtest.run_config.v1", run_id: id, batch_id: "btb-20261019-7h2kd9wq", parent_run_id: null, board, item, engine: engine.version, dataset: "telonex", data_generation: "dg-1f3a9c20b7d44e10", window: { start: "2026-08-07T21:16:28+08:00", end_exclusive: "2026-08-31T21:00:35+08:00", align: "strict_common" }, domains: { mode: "include", values: ["all"] }, objects: { models: [{ key: "pswarm_v2", version: "legacy/legacy", model_name: "pswarm_v2", sha256: "9f2c0000000000000000000000000000000000000000000000000000000000e1" }], strategies: [], factors: [] }, params: { scope: "strict" }, requested_by: "console:console", created_at: "2026-10-19T14:30:00+08:00", ...extra });

const fingerprints = (extra = {}) => ({ data_generation: "dg-1f3a9c20b7d44e10", files: { "backtest/market_data/settlement.parquet": "sha256:b1e2000000000000000000000000000000000000000000000000000000009c", "backtest/model_pred/sidecar/domain_authority_settlement.parquet": "sha256:0d3f000000000000000000000000000000000000000000000000000000000052", "backtest/model_pred/pswarm_v2_pred.parquet": "sha256:9f2c0000000000000000000000000000000000000000000000000000000000e1", ...extra } });

const run = (id, board, item, status, over = {}) => ({ run_id: id, batch_id: "btb-20261019-7h2kd9wq", parent_run_id: null, origin: "platform", board, item, status, lost: false, stage: null, stage_label: null, progress: null, log_tail: null, heartbeat_at: null, attempt: 1, cancel_requested: false, config_sha256: `${id.slice(-8)}${"a1b2c3d4".repeat(7)}`.slice(0, 64), config: configOf(id, board, item), rerunnable: true, requested_by: "console:console", created_at: "2026-10-19T14:30:00Z", started_at: null, finished_at: null, ...over });
const done = (id, board, item, result, title, extra = {}) => run(id, board, item, "succeeded", { started_at: "2026-10-19T14:30:05Z", finished_at: "2026-10-19T14:41:22Z", heartbeat_at: "2026-10-19T14:41:20Z", result, reproduce: { text: reproduceText(id, title), fields: { run_id: id, engine: engine.version } }, input_fingerprints: fingerprints(), restored_inputs: [], artifacts_url: `/api/v1/backtest/runs/${id}/artifacts`, artifacts_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", ...extra });

const runs = {
  "btr-20261019-trade001": done("btr-20261019-trade001", "trading", "strategy_comparison", results.trading, "Trading / 策略对比"),
  "btr-20261019-ovrvw001": done("btr-20261019-ovrvw001", "benchmark", "overview", results.overview, "Benchmark / 总览"),
  "btr-20261019-brier001": done("btr-20261019-brier001", "benchmark", "resolved_event_brier", results.brier, "Benchmark / 已结算市场 Brier"),
  "btr-20261019-calib001": done("btr-20261019-calib001", "benchmark", "calibration", results.calibration, "Benchmark / 概率校准"),
  "btr-20261019-sig00001": done("btr-20261019-sig00001", "signal", "factor", results.signal, "Signal / 单因子"),
  "btr-20261019-corr0001": done("btr-20261019-corr0001", "signal", "correlation", results.correlation, "Signal / Correlation"),
  "btr-20261019-brier002": done("btr-20261019-brier002", "benchmark", "resolved_event_brier", { ...results.brier, headline: "已结算市场 · Brier · 重跑（新结算表）" }, "Benchmark / 已结算市场 Brier（重跑）", { parent_run_id: "btr-20261019-brier001", config: configOf("btr-20261019-brier002", "benchmark", "resolved_event_brier", { parent_run_id: "btr-20261019-brier001", data_generation: "dg-8c7d6e5f4a3b2c1d", params: { scope: "strict", ci_level: 95 } }), input_fingerprints: fingerprints({ "backtest/market_data/settlement.parquet": "sha256:ffff000000000000000000000000000000000000000000000000000000000001" }), restored_inputs: [] }),
  "btr-20261019-queue001": run("btr-20261019-queue001", "benchmark", "model_signal", "queued"),
  "btr-20261019-run00001": run("btr-20261019-run00001", "trading", "strategy_comparison", "running", { stage: "cache_build", stage_label: "构建执行缓存 2/3", progress: { done: 2, total: 3 }, started_at: "2026-10-19T14:30:05Z", heartbeat_at: "2026-10-19T14:31:00Z", log_tail: "[14:30:41] build_all_execution_caches --incremental --workers 4\n[14:30:58] pswarm_v2@telonex 1,540,221 rows\n[14:31:00] echo@telonex 812,004 rows" }),
  "btr-20261019-lost0001": run("btr-20261019-lost0001", "benchmark", "calibration", "running", { lost: true, stage: "bench", stage_label: "运行 calibration", started_at: "2026-10-19T13:00:05Z", heartbeat_at: "2026-10-19T13:04:00Z", log_tail: "[13:04:00] bootstrap 800/2000" }),
  "btr-20261019-fail0001": run("btr-20261019-fail0001", "benchmark", "fixed_horizon_brier", "failed", { started_at: "2026-10-19T12:00:05Z", finished_at: "2026-10-19T12:03:00Z", error: { code: "script_failed", message: "run_fixed_horizon_brier_benchmark 以退出码 1 结束", log_tail: "Traceback (most recent call last):\n  File \"scripts/run_fixed_horizon_brier_benchmark.py\", line 212, in main\nValueError: x_days 7 has no candidate markets" }, reproduce: { text: reproduceText("btr-20261019-fail0001", "Benchmark / 固定 TTE Brier"), fields: {} } }),
  "btr-20261019-cancel01": run("btr-20261019-cancel01", "trading", "strategy_comparison", "cancelled", { finished_at: "2026-10-19T11:00:00Z" }),
  "btr-20261019-batch001": done("btr-20261019-batch001", "signal", "factor_batch", results.batch, "Signal / 批量因子表"),
  "btr-legacy-factor-v7-01": done("btr-legacy-factor-v7-01", "signal", "factor_batch", { ...results.batch, headline: "旧平台批量因子评估 · factor_evaluation_v7（历史）", scope_card: { ...results.batch.scope_card, protocol: "pearson-dmid-v7" } }, "Signal / 批量因子（旧平台导入）", { origin: "legacy", rerunnable: false, requested_by: "legacy-import", reproduce: null, input_fingerprints: null }),
};
// 逐时点策略的运行（新版结果）与不同发起人的运行
runs["btr-20261021-stepw001"] = done("btr-20261021-stepw001", "trading", "strategy_comparison", results.stepwise, "Trading / 逐时点策略", {
  requested_by: "console:alice", created_at: "2026-10-21T09:30:00Z",
  config: configOf("btr-20261021-stepw001", "trading", "strategy_comparison", { requested_by: "console:alice", objects: { models: [{ key: "pswarm_v2", version: "legacy/legacy", model_name: "pswarm_v2" }], strategies: [{ key: "baseline_v3_stepwise", version: "1.0.0", definition: stepwiseStrategies[0].metadata.definition }], factors: [] }, params: { scope: "strict", stepwise: { strategy_params: "{}" } } }),
});
runs["btr-20261019-batch001"].requested_by = "research";
runs["btr-20261019-ovrvw001"].requested_by = "console:accept";
runs["btr-legacy-factor-v7-01"].requested_by = "legacy-import";
runs["btr-20261019-corr0001"].requested_by = "trainer";

// 提交校验运行（board=intake）：运行配置里带 submission（提交编号 / 类型 / 标识）；同一份提交重复提交会有两条校验运行
const intake = (id, item, submissionId, kind, identity, status, createdAt, by) => run(id, "intake", item, status, {
  requested_by: by, created_at: createdAt, batch_id: null, started_at: createdAt, finished_at: status === "queued" || status === "running" ? null : createdAt,
  config: { ...configOf(id, "intake", item), batch_id: null, window: null, domains: null, dataset: "", params: {}, objects: { models: [], strategies: [], factors: [] }, submission: { submission_id: submissionId, kind, identity, sha256: "a".repeat(64), bytes: 48123456, content_type: "application/octet-stream" }, requested_by: by },
});
runs["btr-20261019-intake001"] = intake("btr-20261019-intake001", "prediction", "bts-20261019-val00001", "prediction", { model_id: "team_03", train_version: "v2", prediction_version: "p3" }, "running", "2026-10-19T15:00:00Z", "trainer");
runs["btr-20261019-intake002"] = intake("btr-20261019-intake002", "factor_table", "bts-20261019-ok000001", "factor_table", { table: "research_0919", version: "20260919-a" }, "succeeded", "2026-10-19T14:20:00Z", "research");
runs["btr-20261019-intake003"] = intake("btr-20261019-intake003", "factor_table", "bts-20261019-ok000001", "factor_table", { table: "research_0919", version: "20260919-a" }, "succeeded", "2026-10-19T13:50:00Z", "research");
runs["btr-20261019-intake004"] = intake("btr-20261019-intake004", "factor_table", "bts-20261019-bad00001", "factor_table", { table: "research_0919", version: "20260919-b" }, "failed", "2026-10-19T13:00:00Z", "research");
runs["btr-20261021-intake005"] = intake("btr-20261021-intake005", "strategy", "bts-20261021-baseline_", "strategy", { id: "baseline_v3_stepwise", version: "1.0.0" }, "succeeded", "2026-10-21T08:00:00Z", "console:alice");

for (const [id, value] of Object.entries(runs)) save(`run-${id}.json`, { data: value });
const summary = (r) => { const { result, reproduce, input_fingerprints, ...rest } = r; void result; void reproduce; void input_fingerprints; return rest; };
save("runs-list.json", page(Object.values(runs).map(summary), { limit: 20 }));

// ───────────────────────── 提交 ─────────────────────────

// 提交的字段名按 infra（model.BacktestSubmission）：主键是 submission_id，identity 是字符串映射，没有 summary
const submissions = {
  "bts-20261019-val00001": { submission_id: "bts-20261019-val00001", kind: "prediction", identity: { model_id: "team_03", train_version: "v2", prediction_version: "p3" }, identity_key: "team_03/v2/p3", status: "validating", sha256: "a".repeat(64), bytes: 48123456, content_type: "application/vnd.apache.parquet", errors: [], intake_run_id: "btr-20261019-queue001", submitted_by: "console:console", created_at: "2026-10-19T14:20:00Z" },
  "bts-20261019-ok000001": { submission_id: "bts-20261019-ok000001", kind: "factor_table", identity: { table: "research_0919", version: "20260919-a" }, identity_key: "research_0919/20260919-a", status: "accepted", sha256: "b".repeat(64), bytes: 9123456, content_type: "application/vnd.apache.parquet", errors: [], submitted_by: "console:console", created_at: "2026-10-19T13:00:00Z", decided_at: "2026-10-19T13:02:00Z", intake_run_id: "btr-20261019-brier001" },
  "bts-20261019-bad00001": { submission_id: "bts-20261019-bad00001", kind: "factor_table", identity: { table: "research_0919", version: "20260919-b" }, identity_key: "research_0919/20260919-b", status: "rejected", sha256: "c".repeat(64), bytes: 7123456, content_type: "application/vnd.apache.parquet", errors: [{ path: "vol_burst", code: "missing_values", message: "value 列有 12% 空值" }, { path: "resid_edge", code: "ts_timezone", message: "ts 必须带时区" }], submitted_by: "console:console", created_at: "2026-10-19T12:00:00Z", decided_at: "2026-10-19T12:01:00Z" },
  "bts-20261021-baseline_": { submission_id: "bts-20261021-baseline_", kind: "strategy", identity: { id: "baseline_v3_stepwise", version: "1.0.0" }, identity_key: "baseline_v3_stepwise/1.0.0", status: "accepted", sha256: "f".repeat(64), bytes: 183422, content_type: "application/gzip", errors: [], intake_run_id: "btr-20261021-intake005", submitted_by: "console:alice", created_at: "2026-10-21T08:00:00Z", decided_at: "2026-10-21T08:01:10Z" },
};
for (const [id, value] of Object.entries(submissions)) save(`submission-${id}.json`, { data: value });

// ───────────────────────── 占位图（PNG，渐变） ─────────────────────────

function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) { raw[y * (width * 3 + 1)] = 0; for (let x = 0; x < width; x += 1) { const bar = Math.floor(x / (width / 10)); const h = (bar + 1) / 10 * (height - 20); const on = height - y < h; const o = y * (width * 3 + 1) + 1 + x * 3; raw[o] = on ? 29 : 248; raw[o + 1] = on ? 141 : 248; raw[o + 2] = on ? 117 : 243; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
writeFileSync(join(out, "placeholder.png"), png(640, 280));
console.log("fixtures written to", out);
