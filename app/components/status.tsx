/** 将后端状态收敛为可读的中文状态标签。 */
export function Status({ value }: { value?: unknown }) {
  const raw = String(value ?? "unknown").toLowerCase();
  const labels: Record<string, string> = { ready: "就绪", committed: "已提交", published: "已发布", active: "正常", done: "完成", selected: "已选中", received: "已收到", pending: "等待中", processing: "处理中", running: "运行中", failed: "失败", error: "异常" };
  const state = ["ready", "committed", "published", "active", "done", "selected", "received", "pending", "processing", "running", "failed", "error"].includes(raw) ? raw : "default";
  return <span className={`status ${state}`}>{labels[raw] ?? String(value ?? "未知")}</span>;
}
