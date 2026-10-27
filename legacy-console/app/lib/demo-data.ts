import type { ConsoleResource, ConsoleRow, OverviewData } from "./types";

const utc = (offsetMinutes: number) => new Date(Date.now() - offsetMinutes * 60_000).toISOString();

/** 演示数据只用于手动预览界面，不参与任何业务决策。 */
export const demoOverview: OverviewData = {
  selectedMarketTotal: 42, sandboxTotal: 36, predictionTotal: 31, backtestReadyTotal: 4,
  outboxPendingTotal: 3, currentSelectionRunID: "selrun_20260817_0830",
  lastSelectedAt: utc(25), lastSandboxAt: utc(16), lastPredictionAt: utc(8),
};

export const demoData: Record<ConsoleResource, ConsoleRow[]> = {
  "selected-markets": [
    { id: "sel_01K2AB", kind: "selected-markets", title: "Will the Federal Reserve cut rates in September?", secondary: "0x9a7c85d42e72…8f31", status: "selected", timestamp: utc(25), domains: ["Finance"], values: [{ label: "排名", value: "1" }, { label: "最佳买价", value: "0.682" }, { label: "最佳卖价", value: "0.688" }] },
    { id: "sel_01K2AC", kind: "selected-markets", title: "Will Bitcoin close above $120,000 this month?", secondary: "0x61cb2a961d4b…d400", status: "selected", timestamp: utc(25), domains: ["Crypto"], values: [{ label: "排名", value: "2" }, { label: "最佳买价", value: "0.431" }, { label: "最佳卖价", value: "0.438" }] },
  ],
  sandboxes: [
    { id: "20260817T081006Z_01K2AB", kind: "sandboxes", title: "Sandbox 20260817T081006Z", secondary: "Market 1122565", status: "committed", timestamp: utc(16), values: [{ label: "模式", value: "LIVE" }, { label: "决策时间", value: utc(26) }, { label: "归档大小", value: "1.8 MB" }] },
    { id: "20260817T081134Z_01K2AC", kind: "sandboxes", title: "Sandbox 20260817T081134Z", secondary: "Market 1122806", status: "committed", timestamp: utc(15), values: [{ label: "模式", value: "LIVE" }, { label: "决策时间", value: utc(25) }, { label: "归档大小", value: "1.2 MB" }] },
  ],
  predictions: [
    { id: "pred_01K2BX", kind: "predictions", title: "forecast-v2", secondary: "0x9a7c85d42e72…8f31", status: "received", timestamp: utc(8), values: [{ label: "执行模式", value: "LIVE" }, { label: "YES", value: "0.6840" }, { label: "NO", value: "0.3160" }] },
    { id: "pred_01K2BY", kind: "predictions", title: "forecast-v2", secondary: "0x61cb2a961d4b…d400", status: "received", timestamp: utc(7), values: [{ label: "执行模式", value: "LIVE" }, { label: "YES", value: "0.4330" }, { label: "NO", value: "0.5670" }] },
  ],
  "backtest-datasets": [
    { id: "btds_01K1S", kind: "backtest-datasets", title: "回测数据集 btds_01K1S", secondary: "2026-08-01 00:00 UTC → 2026-08-14 00:00 UTC", status: "ready", timestamp: utc(650), values: [{ label: "请求时间", value: utc(650) }] },
  ],
  "orderbook-series": [
    { id: "1", kind: "orderbook-series", title: "PM_DATA · 10 分钟 · 15 档", secondary: "LAST_IN_WINDOW", status: "active", values: [{ label: "序列 ID", value: "1" }] },
  ],
  "outbox-events": [
    { id: "out_01K3D", kind: "outbox-events", title: "live_prediction", secondary: "pred_01K2BX", status: "published", timestamp: utc(8), values: [{ label: "交付状态", value: "PUBLISHED" }] },
    { id: "out_01K3F", kind: "outbox-events", title: "live_prediction", secondary: "pred_01K2BZ", status: "pending", timestamp: utc(4), values: [{ label: "交付状态", value: "PENDING" }] },
  ],
};
