export type SandboxArchiveStatus = "available" | "missing" | "incomplete" | "not_supported" | "unknown";
export interface SandboxArchiveOption { variant: "original" | "masked"; status: SandboxArchiveStatus; reasonCode?: string }
export interface SandboxArchiveOptions { sandboxId: string; observedAt: string; variants: SandboxArchiveOption[] }
const statuses = new Set(["available", "missing", "incomplete", "not_supported", "unknown"]);
export function decodeSandboxArchiveOptions(value: unknown, expectedId: string): SandboxArchiveOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("下载状态返回无效。");
  const data = value as Record<string, unknown>;
  if (data.sandbox_id !== expectedId || typeof data.observed_at !== "string" || !Number.isFinite(Date.parse(data.observed_at)) || !Array.isArray(data.variants)) throw new Error("下载状态与当前 Sandbox 不一致。");
  const seen = new Set<string>();
  const variants = data.variants.map((raw): SandboxArchiveOption => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("文件版本状态无效。");
    const option = raw as Record<string, unknown>;
    if ((option.variant !== "original" && option.variant !== "masked") || typeof option.status !== "string" || !statuses.has(option.status) || seen.has(option.variant)) throw new Error("文件版本状态无效。");
    seen.add(option.variant);
    return { variant: option.variant, status: option.status as SandboxArchiveStatus, reasonCode: typeof option.reason_code === "string" ? option.reason_code : undefined };
  });
  if (!seen.has("original") || !seen.has("masked")) throw new Error("文件版本状态不完整。");
  return { sandboxId: expectedId, observedAt: data.observed_at, variants };
}
export async function sandboxArchiveOptions(sandboxId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/console/downloads/sandboxes/${encodeURIComponent(sandboxId)}/archive-options`, { signal, cache: "no-store" });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error("暂时无法核对文件，请稍后重试。");
  return decodeSandboxArchiveOptions(payload?.data, sandboxId);
}
export function archiveOptionLabel(option: SandboxArchiveOption): string {
  const labels: Record<SandboxArchiveStatus, string> = { available: `${option.variant} 可下载`, missing: `暂无 ${option.variant} 资料`, incomplete: `${option.variant} 资料尚不完整，暂不可下载`, not_supported: `此来源不提供 ${option.variant} 资料`, unknown: `暂时无法核对 ${option.variant} 资料` };
  return labels[option.status];
}
