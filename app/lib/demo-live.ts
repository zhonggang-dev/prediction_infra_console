import type { LiveOperationsSnapshot } from "./types";

/**
 * 产品预览数据严格对应 PM_trading_v2 的三线程运行模型与 event-sourced ledger。
 * 后端聚合接口接入后，页面会自动优先展示真实快照。
 */
export function demoLiveOperations(observedAt = new Date().toISOString()): LiveOperationsSnapshot {
  const observedAtMs = new Date(observedAt).getTime();
  const ago = (seconds: number) => new Date(observedAtMs - seconds * 1000).toISOString();
  return {
    observedAt,
    dataFreshnessSeconds: 4,
    engine: {
      health: "healthy",
      runId: "ce8f3a2",
      presetName: "conservative",
      startedAt: ago(6 * 60 * 60 + 18 * 60),
      venueName: "Polymarket CLOB",
      venueStatus: "healthy",
      ledgerStatus: "healthy",
      reconciliationStatus: "degraded",
    },
    capital: {
      equity: 12842.36,
      availableCash: 9218.42,
      grossExposure: 3623.94,
      exposureLimit: 8500,
      realizedPnlToday: 184.62,
      unrealizedPnl: 76.44,
      feeToday: 13.82,
    },
    workers: [
      { id: "cycle", name: "机会扫描", purpose: "找新市场、获取预测并尝试开仓", cadence: "每 30 分钟", status: "healthy", lastHeartbeatAt: ago(96), currentTask: "等待 3 个 Echo 预测完成", metricLabel: "本轮候选", metricValue: "20" },
      { id: "monitor", name: "持仓与挂单看护", purpose: "退出判断、撤单、重报价与成交确认", cadence: "每 3 分钟", status: "healthy", lastHeartbeatAt: ago(14), currentTask: "检查 4 个挂单 · 7 个持仓", metricLabel: "下次检查", metricValue: "02:46" },
      { id: "prediction", name: "预测调度器", purpose: "Echo 请求去重、轮询与新鲜度管理", cadence: "每 15 秒轮询", status: "degraded", lastHeartbeatAt: ago(7), currentTask: "6 个请求执行中 · 1 个接近超时", metricLabel: "预测队列", metricValue: "6" },
    ],
    funnel: [
      { id: "scan", index: 1, name: "市场扫描", description: "Gamma active markets", count: 503, throughputLabel: "本轮发现", state: "done" },
      { id: "filter", index: 2, name: "策略过滤", description: "流动性、到期与领域过滤", count: 20, throughputLabel: "进入候选", state: "done" },
      { id: "predict", index: 3, name: "Echo 预测", description: "去重提交并等待概率", count: 17, throughputLabel: "17 / 20 完成", state: "active" },
      { id: "risk", index: 4, name: "边际与风控", description: "Edge、Kelly 与仓位上限", count: 6, throughputLabel: "6 个通过", state: "done" },
      { id: "route", index: 5, name: "订单执行", description: "价格校准并提交 CLOB", count: 4, throughputLabel: "4 个挂单", state: "active" },
      { id: "ledger", index: 6, name: "成交入账", description: "Fill 验真、仓位与资金账本", count: 3, throughputLabel: "3 笔已确认", state: "warning" },
    ],
    risks: [
      { id: "exposure", name: "总敞口", current: 3623.94, limit: 8500, unit: "$", hint: "所有未结算持仓的成本口径", state: "safe" },
      { id: "market", name: "单市场敞口", current: 684, limit: 1000, unit: "$", hint: "最大市场已使用 68.4%", state: "warning" },
      { id: "loss", name: "当日亏损熔断", current: 0, limit: 500, unit: "$", hint: "当前为盈利状态，未占用亏损额度", state: "safe" },
      { id: "stale", name: "预测过期", current: 1, limit: 3, unit: "count", hint: "超过 45 分钟的持仓预测", state: "warning" },
    ],
    orders: [
      {
        orderId: "0xc14f…3a92", marketId: "0x8d7a…f014", marketLabel: "Will the Federal Reserve cut rates in September?", outcomeName: "YES", side: "BUY", status: "PARTIAL", price: 0.684, shares: 36.55, filledShares: 18.5, ageSeconds: 412, modelId: "forecast-v2", strategyId: "multfactor_v2", triggeredBy: "cycle", predictedProbability: 0.742, edge: 0.058,
        lifecycle: [
          { name: "预测完成", status: "done", timestamp: ago(591), detail: "YES 74.2% · Echo 运行 31m 18s" },
          { name: "策略通过", status: "done", timestamp: ago(552), detail: "Edge +5.8% · Kelly 建议 $25.00" },
          { name: "风险校验", status: "done", timestamp: ago(548), detail: "市场敞口与总敞口均在限额内" },
          { name: "订单已接受", status: "done", timestamp: ago(412), detail: "GTC BUY 36.55 shares @ 0.684" },
          { name: "部分成交", status: "active", timestamp: ago(96), detail: "18.50 / 36.55 shares 已验真并入账" },
          { name: "完全成交 / 撤单", status: "pending", detail: "MonitorThread 持续看护" },
        ],
      },
      {
        orderId: "0xa98e…e718", marketId: "0x19bc…142e", marketLabel: "Will Bitcoin close above $120,000 this month?", outcomeName: "NO", side: "BUY", status: "LIVE", price: 0.432, shares: 23.15, filledShares: 0, ageSeconds: 1027, modelId: "forecast-v3", strategyId: "multfactor_v1", triggeredBy: "cycle", predictedProbability: 0.507, edge: 0.075,
        lifecycle: [
          { name: "预测完成", status: "done", timestamp: ago(1240), detail: "NO 50.7% · 预测仍在新鲜窗口" },
          { name: "策略通过", status: "done", timestamp: ago(1090), detail: "Edge +7.5% · 建议买入 $10.00" },
          { name: "风险校验", status: "done", timestamp: ago(1082), detail: "同 token 无重复 BUY 挂单" },
          { name: "订单已接受", status: "active", timestamp: ago(1027), detail: "等待 CLOB 撮合 · 距强制过期 43m" },
          { name: "成交验真", status: "pending", detail: "成交后将以 /trades 为最终事实源" },
          { name: "账本入账", status: "pending", detail: "等待真实 Fill" },
        ],
      },
      {
        orderId: "0xe721…9cd0", marketId: "0x72df…50aa", marketLabel: "Will the S&P 500 finish the week higher?", outcomeName: "NO", side: "SELL", status: "CANCEL_PENDING", price: 0.271, shares: 10, filledShares: 0, ageSeconds: 3520, modelId: "forecast-v2", strategyId: "rolling_exit_v2", triggeredBy: "monitor", predictedProbability: 0.338, edge: -0.021,
        lifecycle: [
          { name: "退出信号", status: "done", timestamp: ago(3620), detail: "预测衰减触发 CLOSE_FULL" },
          { name: "风险校验", status: "done", timestamp: ago(3598), detail: "可卖数量与链上持仓一致" },
          { name: "卖单已接受", status: "done", timestamp: ago(3520), detail: "GTC SELL 10 shares @ 0.271" },
          { name: "价格漂移", status: "warning", timestamp: ago(22), detail: "盘口偏移 5.4%，已请求 cancel-replace" },
          { name: "撤单竞态检查", status: "active", detail: "撤单后查询 /trades，防止漏记成交" },
          { name: "重新报价", status: "pending", detail: "仅在确认无 Fill 后重新挂单" },
        ],
      },
    ],
    positions: [
      { positionId: "pos-fed-yes", marketId: "0x8d7a…f014", marketLabel: "Will the Federal Reserve cut rates in September?", outcomeName: "YES", shares: 82.4, averagePrice: 0.612, markPrice: 0.684, cost: 50.43, marketValue: 56.36, unrealizedPnl: 5.93, exposurePct: 0.59, strategyId: "multfactor_v2", predictionAgeMinutes: 9 },
      { positionId: "pos-eth-yes", marketId: "0xc0a1…910b", marketLabel: "Will Ethereum trade above $5,000 in August?", outcomeName: "YES", shares: 54.8, averagePrice: 0.41, markPrice: 0.447, cost: 22.47, marketValue: 24.50, unrealizedPnl: 2.03, exposurePct: 0.26, strategyId: "multfactor_v1", predictionAgeMinutes: 31 },
      { positionId: "pos-spx-no", marketId: "0x72df…50aa", marketLabel: "Will the S&P 500 finish the week higher?", outcomeName: "NO", shares: 10, averagePrice: 0.35, markPrice: 0.271, cost: 3.5, marketValue: 2.71, unrealizedPnl: -0.79, exposurePct: 0.04, strategyId: "rolling_exit_v2", predictionAgeMinutes: 47 },
    ],
    events: [
      { id: "evt-1", timestamp: ago(7), severity: "success", thread: "prediction", section: "prediction", title: "Echo 预测完成", detail: "概率已写入调度器并唤醒本轮决策", marketLabel: "Fed rate cut in September" },
      { id: "evt-2", timestamp: ago(14), severity: "info", thread: "monitor", section: "heartbeat", title: "Monitor tick 完成", detail: "检查 7 个持仓、4 个挂单，用时 8.2 秒" },
      { id: "evt-3", timestamp: ago(22), severity: "warning", thread: "monitor", section: "reprice", title: "卖单触发重新报价", detail: "盘口漂移 5.4%，正在执行撤单竞态保护", marketLabel: "S&P 500 finish higher", orderId: "0xe721…9cd0" },
      { id: "evt-4", timestamp: ago(96), severity: "success", thread: "monitor", section: "fill", title: "部分成交已确认", detail: "18.50 shares 已通过 CLOB /trades 验真并写入 ledger", marketLabel: "Fed rate cut in September", orderId: "0xc14f…3a92" },
      { id: "evt-5", timestamp: ago(138), severity: "info", thread: "cycle", section: "risk", title: "开仓风险检查通过", detail: "Kelly $25.00 · 总敞口使用 42.6%", marketLabel: "Fed rate cut in September" },
      { id: "evt-6", timestamp: ago(286), severity: "warning", thread: "prediction", section: "stale", title: "持仓预测接近过期", detail: "已自动提交刷新；旧预测在新结果返回前仅用于监控", marketLabel: "S&P 500 finish higher" },
    ],
    dataQuality: [
      { id: "clob", name: "CLOB 订单与成交", status: "healthy", detail: "4 秒前完成拉取" },
      { id: "positions", name: "链上持仓", status: "healthy", detail: "与本地仓位数量一致" },
      { id: "ledger", name: "事件账本", status: "healthy", detail: "WAL 正常 · 无待写事务" },
      { id: "reconcile", name: "链上对账", status: "degraded", detail: "1 个撤单竞态正在确认" },
    ],
  };
}
