import {
  Archive, ArrowRight, Box, ChartNoAxesCombined, Grid2X2, Menu, RefreshCw, Send, Settings, SlidersHorizontal, type LucideProps,
} from "lucide-react";

type IconName = "grid" | "markets" | "box" | "trend" | "archive" | "send" | "settings" | "menu" | "refresh" | "arrow";

const icons = { grid: Grid2X2, markets: SlidersHorizontal, box: Box, trend: ChartNoAxesCombined, archive: Archive, send: Send, settings: Settings, menu: Menu, refresh: RefreshCw, arrow: ArrowRight };

/** 使用统一的 Lucide 图标，保持控制台图形语言一致。 */
export function Icon({ name, ...props }: { name: IconName } & LucideProps) {
  const Component = icons[name];
  return <Component size={17} strokeWidth={1.7} aria-hidden="true" {...props} />;
}
