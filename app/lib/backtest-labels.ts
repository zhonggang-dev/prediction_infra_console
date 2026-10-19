/** 回测平台的中文名称对照：板块、项目、运行状态。 */

import type { RunStatus } from "./backtest-platform.ts";

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
