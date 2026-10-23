export function summarizeAttention<T>(items: readonly T[], isIssue: (item: T) => boolean, emptyLabel = "未采集", clearLabel = "无") {
  if (!items.length) return emptyLabel;
  const count = items.filter(isIssue).length;
  return count ? `${count} 项` : clearLabel;
}

export function normalizeOverviewSources<Runtime, Snapshot>(
  runtimeResult: PromiseSettledResult<{ data: Runtime }>,
  operationsResult: PromiseSettledResult<{ data: Snapshot; mode: "live" | "demo" | "unavailable" }>,
) {
  const errors: string[] = [];
  const runtime = runtimeResult.status === "fulfilled" ? runtimeResult.value.data : undefined;
  const snapshot = operationsResult.status === "fulfilled" ? operationsResult.value.data : undefined;
  if (runtimeResult.status === "rejected") errors.push("运行状态暂不可用");
  const mode = operationsResult.status === "fulfilled" ? operationsResult.value.mode : "unavailable";
  if (operationsResult.status === "rejected") errors.push(operationsResult.reason instanceof Error ? operationsResult.reason.message : "账户快照暂不可用");
  return { runtime, snapshot, mode, errors };
}
