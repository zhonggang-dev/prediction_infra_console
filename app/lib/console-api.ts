"use client";

import { demoData, demoOverview } from "./demo-data";
import type { ApiMode, ApiResult, BacktestCreateParams, ConsoleList, ConsoleResource, ConsoleRow, OverviewData } from "./types";

type RawRecord = Record<string, unknown>;
type ListPayload = { items?: RawRecord[]; total?: number; limit?: number; offset?: number };

export class ConsoleApiError extends Error {
  constructor(message: string, readonly mode: ApiMode = "unavailable") { super(message); }
}

/** 从同源 BFF 获取数据，令牌仅保留于服务端环境。 */
async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`/api/console/${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers }, cache: "no-store" });
  } catch {
    throw new ConsoleApiError("控制台网络不可用，请检查前端服务连接。", "unavailable");
  }
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string; message?: string; code?: string };
  if (!response.ok) throw new ConsoleApiError(payload.message ?? payload.error ?? "请求控制台接口失败", payload.code === "BACKEND_NOT_CONFIGURED" ? "unavailable" : "live");
  return { data: payload.data ?? (payload as T), mode: "live" };
}

/** 将后端 DTO 显式映射为页面摘要，避免 UI 依赖敏感字段。 */
function mapRow(resource: ConsoleResource, item: RawRecord): ConsoleRow {
  if (resource === "selected-markets") return { id: string(item.selected_market_id), kind: resource, title: string(item.question), secondary: string(item.condition_id), status: "selected", timestamp: optional(item.selected_at), domains: optional(item.primary_domain) ? [string(item.primary_domain)] : [], values: [{ label: "排名", value: string(item.rank) }, { label: "最佳买价", value: price(item.best_bid) }, { label: "最佳卖价", value: price(item.best_ask) }] };
  if (resource === "sandboxes") return { id: string(item.sandbox_id), kind: resource, title: `Sandbox ${string(item.sandbox_id)}`, secondary: `Market ${string(item.market_id)}`, status: item.committed_at ? "committed" : "pending", timestamp: optional(item.committed_at) ?? optional(item.decision_at), values: [{ label: "模式", value: string(item.mode) }, { label: "决策时间", value: string(item.decision_at) }, { label: "归档大小", value: bytes(item.archive_size_bytes) }] };
  if (resource === "predictions") return { id: string(item.prediction_id), kind: resource, title: string(item.model_name), secondary: string(item.condition_id), status: "received", timestamp: optional(item.received_at), values: [{ label: "执行模式", value: string(item.execution_mode) }, { label: string(item.outcome_0_name, "结果 1"), value: price(item.outcome_0_probability ?? item.probability) }, { label: string(item.outcome_1_name, "结果 2"), value: price(item.outcome_1_probability) }] };
  if (resource === "backtest-datasets") return { id: string(item.dataset_id), kind: resource, title: `回测数据集 ${string(item.dataset_id)}`, secondary: `${timeText(item.prediction_from)} → ${timeText(item.prediction_to)}`, status: string(item.status), timestamp: optional(item.requested_at), values: [{ label: "请求时间", value: timeText(item.requested_at) }] };
  if (resource === "orderbook-series") return { id: string(item.series_id), kind: resource, title: `${string(item.provider)} · ${number(item.resolution_ms) / 60_000} 分钟 · ${string(item.depth_limit)} 档`, secondary: string(item.sample_policy), status: "active", values: [{ label: "序列 ID", value: string(item.series_id) }] };
  return { id: string(item.outbox_event_id), kind: resource, title: string(item.event_type), secondary: string(item.aggregate_id), status: string(item.delivery_status), timestamp: optional(item.created_at), values: [{ label: "交付状态", value: string(item.delivery_status) }] };
}

function mapOverview(item: RawRecord): OverviewData {
  return { selectedMarketTotal: number(item.selected_market_total), sandboxTotal: number(item.sandbox_total), predictionTotal: number(item.prediction_total), backtestReadyTotal: number(item.backtest_ready_total), outboxPendingTotal: number(item.outbox_pending_total), currentSelectionRunID: optional(item.current_selection_run_id), lastSelectedAt: optional(item.last_selected_at), lastSandboxAt: optional(item.last_sandbox_at), lastPredictionAt: optional(item.last_prediction_at) };
}
const optional = (value: unknown) => typeof value === "string" && value ? value : typeof value === "number" ? String(value) : undefined;
const string = (value: unknown, fallback = "—") => value === undefined || value === null || value === "" ? fallback : String(value);
const number = (value: unknown) => typeof value === "number" ? value : Number(value ?? 0) || 0;
const price = (value: unknown) => typeof value === "number" ? value.toFixed(4) : value === undefined || value === null ? "—" : String(value);
const bytes = (value: unknown) => typeof value === "number" ? `${(value / 1_048_576).toFixed(1)} MB` : "—";
const timeText = (value: unknown) => optional(value) ? new Date(String(value)).toISOString().replace("T", " ").replace(".000Z", " UTC") : "—";

export const consoleApi = {
  capabilities: () => request<{ console_read: boolean; backtest_create: boolean }>("capabilities"),
  async overview() { const result = await request<RawRecord>("overview"); return { data: mapOverview(result.data), mode: result.mode }; },
  async list(resource: ConsoleResource, params: { limit?: number; offset?: number } = {}) {
    const query = new URLSearchParams({ limit: String(params.limit ?? 20), offset: String(params.offset ?? 0) });
    const result = await request<ListPayload>(`${resource}?${query}`);
    const data: ConsoleList = { items: (result.data.items ?? []).map((item) => mapRow(resource, item)), total: number(result.data.total), limit: number(result.data.limit) || 20, offset: number(result.data.offset) };
    return { data, mode: result.mode };
  },
  createBacktest: (params: BacktestCreateParams) => request<RawRecord>("backtest-datasets", { method: "POST", body: JSON.stringify(params), headers: { "Idempotency-Key": crypto.randomUUID() } }),
  demoOverview: (): ApiResult<OverviewData> => ({ data: demoOverview, mode: "demo" }),
  demoList: (resource: ConsoleResource, params: { limit?: number; offset?: number } = {}): ApiResult<ConsoleList> => {
    const all = demoData[resource]; const offset = params.offset ?? 0; const limit = params.limit ?? 20;
    return { data: { items: all.slice(offset, offset + limit), total: all.length, limit, offset }, mode: "demo" };
  },
};
