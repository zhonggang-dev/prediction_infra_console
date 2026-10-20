// 组件渲染测试里替代 next/navigation：服务端渲染时没有路由上下文。
export function usePathname() { return "/backtest-platform/trading"; }
export function useSearchParams() { return new URLSearchParams(); }
