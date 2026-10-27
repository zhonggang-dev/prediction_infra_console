/** 回测平台的中文名称对照：板块、项目、运行状态。 */

import { record, text, type BacktestRun, type RunStatus } from "./backtest-platform.ts";
import { displayBeijing } from "./backtest-selection.ts";

export const BOARD_LABELS: Record<string, string> = { trading: "Trading PnL", benchmark: "Benchmark", signal: "Signal Test", intake: "提交校验", admin: "平台管理" };

export const ITEM_LABELS: Record<string, string> = {
  "trading/strategy_comparison": "策略对比",
  "benchmark/overview": "总览（全部默认 Benchmark）",
  "benchmark/model_signal": "Model Signal（IC / ICIR）",
  "benchmark/directional_roi": "交易 · 结算 PnL/share",
  "benchmark/resolved_event_brier": "已结算市场 · Brier",
  "benchmark/fixed_horizon_brier": "固定 TTE · Brier",
  "benchmark/calibration": "概率校准",
  "benchmark/deviation": "偏离校准",
  "signal/model": "模型 Signal Test",
  "signal/factor": "单因子 Signal Test",
  "signal/factor_batch": "批量因子表",
  "signal/correlation": "因子池 Correlation",
  "intake/prediction": "预测表校验",
  "intake/factor_table": "因子表校验",
  "intake/strategy": "策略校验",
  "admin/settlement_update": "结算更新",
};

export function runTitle(board: string, item: string): string {
  return `${BOARD_LABELS[board] ?? board} · ${ITEM_LABELS[`${board}/${item}`] ?? item}`;
}

export const STATUS_LABELS: Record<RunStatus, string> = { queued: "排队中", running: "运行中", succeeded: "已完成", failed: "失败", cancelled: "已停止" };

/** 运行状态到全局 .status 样式类（已有：ready / pending / running / failed ...）。 */
export const STATUS_CLASS: Record<RunStatus, string> = { queued: "pending", running: "running", succeeded: "ready", failed: "failed", cancelled: "default" };

/** 板块 → 工作区 Tab 路径，用于「返回」链接。 */
export const BOARD_TAB: Record<string, string> = { trading: "/backtest-platform/trading", benchmark: "/backtest-platform/benchmark", signal: "/backtest-platform/signal", intake: "/backtest-platform/submissions", admin: "/backtest-platform/runs" };

/** 发起人：内部标识 → 可读名称。未知的原样显示，不猜。 */
export function requesterLabel(requestedBy: string | undefined): string {
  if (!requestedBy) return "未知";
  if (requestedBy === "research") return "研究侧接口";
  if (requestedBy === "trainer") return "训练侧接口";
  if (requestedBy === "legacy-import") return "旧平台导入";
  if (requestedBy.startsWith("console:")) {
    const operator = requestedBy.slice("console:".length);
    if (operator === "accept" || operator === "e2e") return "测试（控制台）";
    return !operator || operator === "console" ? "控制台" : `控制台（${operator}）`;
  }
  return requestedBy;
}

export const SUBMISSION_KIND_LABELS: Record<string, string> = { prediction: "预测表", factor_table: "因子表", strategy: "策略" };

const preview = (names: string[], limit = 3) => names.length <= limit ? names.join("、") : `${names.slice(0, limit).join("、")} 等 ${names.length} 个`;

/** 运行记录的副行：所选对象与窗口（来自列表里带回的运行配置）；配置缺失时返回 undefined。 */
export function runSummary(run: Pick<BacktestRun, "config">): string | undefined {
  const config = run.config;
  if (!config) return undefined;
  const submission = record(config.submission);
  if (Object.keys(submission).length > 0) {
    const kind = SUBMISSION_KIND_LABELS[text(submission.kind) ?? ""] ?? text(submission.kind) ?? "提交";
    const identity = Object.values(record(submission.identity)).map(String).join(" / ");
    return identity ? `${kind} ${identity}` : kind;
  }
  const objects = record(config.objects);
  const names = (value: unknown, pick: (entry: Record<string, unknown>) => string | undefined) => (Array.isArray(value) ? value : []).map((entry) => pick(record(entry))).filter((name): name is string => !!name);
  const strategies = names(objects.strategies, (e) => text(e.key));
  const models = names(objects.models, (e) => text(e.model_name) ?? text(e.key));
  const factors = names(objects.factors, (e) => text(e.key));
  const parts = [strategies.length ? `策略 ${preview(strategies)}` : "", models.length ? `模型 ${preview(models)}` : "", factors.length ? `因子 ${preview(factors)}` : ""].filter(Boolean);
  const window = record(config.window);
  const start = text(window.start); const end = text(window.end_exclusive ?? window.end);
  if (start && end) parts.push(`${displayBeijing(start).slice(0, 10)} → ${displayBeijing(end).slice(0, 10)}`);
  return parts.length ? parts.join(" · ") : undefined;
}

/** 样本口径（口径卡片）→ 中文；认不出的原样显示。 */
export const SAMPLE_SCOPE_LABELS: Record<string, string> = {
  strict: "严格交集", own: "各模型自有全集", mixed: "混合（旧策略严格交集，逐时点策略自有全集）",
  full: "各模型自身全量", common: "共同样本", common_3h_grid: "共同三小时网格", pooled: "合并样本",
};
export const sampleScopeLabel = (value: string): string => SAMPLE_SCOPE_LABELS[value] ?? value;

/**
 * 未成交原因码 → 中文。新运行的结果里执行器已经翻译好；这张表只给旧运行（已存结果里「说明」列就是原因码）兜底。
 *
 * 逐时点策略（pm_sim）的原因码是 pm_sim 的 `RejectReason` 枚举，文案与执行器 `pmbt/stepwise/reasons.py` 的
 * REASON_LABELS 逐字一致（改那边就同步这里）。
 */
export const PM_SIM_REASON_LABELS: Record<string, string> = {
  unknown_market: "结算表里没有这个市场",
  market_closed: "市场已关闭",
  no_book: "没有盘口：这个市场不在本次允许交易的范围（Domain / 数据集）内，或此刻没有盘口",
  stale_book: "盘口超过年龄上限（看簿、买卖、估值同一标准）",
  book_before_decision: "下一格成交时只有决策之前观测到的盘口（那一格缺数据），订单作废",
  no_visible_depth: "盘口深度不够，只成交了可见的部分（或一股都没有）",
  crossed_book: "盘口交叉（无风险套利，只可能来自数据瑕疵），不成交",
  limit_price_not_reached: "没有达到限价",
  below_min_size: "按整股成交，取整后不足一股",
  nothing_to_sell: "没有可卖的持仓",
  unknown_lot: "指定平仓的那一手不存在",
  insufficient_cash: "现金不足",
  event_exposure_cap: "超过事件敞口上限",
  invalid_order: "订单不合规（股数 / 金额 / 限价不合法）",
  ambiguous_target: "同一市场方向上已有更早的单，调到目标仓位算不出要买卖多少，拒绝",
  window_end: "区间结束时还没到执行时刻",
};

/**
 * 改用 pm_sim 之前，执行器自写的逐时点账户用过的原因码：只为改造前那几次逐时点运行的已存结果兜底，文案标明是旧口径。
 * 与 pm_sim 同名的码（stale_book / insufficient_cash / invalid_order / market_closed）统一用 pm_sim 的文案。
 */
export const LEGACY_STEPWISE_REASON_LABELS: Record<string, string> = {
  no_quote: "决策时点往前报价容忍内没有盘口快照（旧逐时点账户口径）",
  thin_book: "盘口深度不够，只成交了可见的部分（旧逐时点账户口径）",
  no_liquidity: "对手盘一档有效报价都没有（旧逐时点账户口径）",
  below_one_share: "按整股成交，目标不足一股（旧逐时点账户口径）",
  domain_not_allowed: "市场不在本次运行的 Domain / 数据范围内（旧逐时点账户口径）",
  duplicate_order: "同一时点对同一 (市场, 方向) 重复下单（旧逐时点账户口径）",
  exceeds_position: "要卖的股数超过持仓（或没有持仓）（旧逐时点账户口径）",
  already_at_target: "已在目标仓位，无需成交（旧逐时点账户口径）",
};

export const DROP_REASON_LABELS: Record<string, string> = { ...LEGACY_STEPWISE_REASON_LABELS, ...PM_SIM_REASON_LABELS };

/** 旧结果的标题文案 → 新文案（只改展示）。 */
export const TITLE_REWRITES: Record<string, string> = { "manifest · 载体配置": "运行清单（原始 JSON）" };

const HEADLINE_TOKENS: Array<[RegExp, string]> = [
  [/^All domains$/, "全部 Domain"], [/^native sizing$/, "策略自带仓位"], [/^fixed shares\b/, "固定股数"], [/^fixed stake\b/, "固定金额"],
  [/^unlimited$/, "无限资金"], [/^bankroll \$/, "有限资金 $"], [/^(\d+) models$/, "$1 个模型"],
];
const HEADLINE_TIME = /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?/g;

/** 旧运行的标题行兜底：常见英文词换成中文，时间去掉秒与纳秒尾巴。新运行的标题行执行器已处理，原样通过。 */
export function prettyHeadline(headline: string): string {
  const segments = headline.split(" · ").map((segment) => {
    for (const [pattern, replacement] of HEADLINE_TOKENS) if (pattern.test(segment)) return segment.replace(pattern, replacement);
    return segment;
  });
  return segments.join(" · ").replace(HEADLINE_TIME, (_, date: string, time: string, zone?: string) => `${date} ${time}${zone ? (zone === "Z" ? "（UTC）" : zone) : ""}`);
}
