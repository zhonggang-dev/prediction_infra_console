// 用 Vite 的 SSR 加载 TSX 组件并渲染成静态 HTML（不走 vinext 构建产物）。
// next/navigation 换成桩；组件里的 effect 不会执行，所以只验证首屏渲染结果。
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);

export async function createComponentLoader() {
  const server = await createServer({
    root, configFile: false, appType: "custom", logLevel: "error",
    plugins: [react()],
    resolve: { alias: { "next/navigation": fileURLToPath(new URL("./next-navigation-stub.ts", import.meta.url)) } },
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const React = require("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  return {
    load: (path) => server.ssrLoadModule(path),
    render: (Component, props = {}) => renderToStaticMarkup(React.createElement(Component, props)),
    close: () => server.close(),
  };
}
