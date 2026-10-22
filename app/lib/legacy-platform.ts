/**
 * 旧 PM Backtest（8501）外链配置。
 *
 * 环境变量 `BACKTEST_LEGACY_PLATFORM_URL`：
 * - 未设置：沿用过渡期的默认地址（升级后不用改环境变量，链接不会悄悄消失）；
 * - 设置为空串或 `off`：不显示外链（旧平台下线后用）；
 * - 其它值：显示该地址（必须是 http / https）。
 */
export const DEFAULT_LEGACY_BACKTEST_URL = "http://172.21.20.221:8501/";

export function legacyBacktestUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const raw = env.BACKTEST_LEGACY_PLATFORM_URL;
  if (raw === undefined) return DEFAULT_LEGACY_BACKTEST_URL;
  const value = raw.trim();
  if (value === "" || value.toLowerCase() === "off") return undefined;
  return /^https?:\/\//i.test(value) ? value : undefined;
}
