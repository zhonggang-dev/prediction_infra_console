"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { backtestApi, decodeEngine, type CatalogItem, type EngineInfo, type ParamDef } from "../../lib/backtest-platform";
import { datasetInfo, modelInfo, strategyInfo, type DatasetInfo, type ModelInfo, type StrategyInfo } from "../../lib/backtest-selection";
import { v2ErrorText } from "../console-v2-resource";

export interface CatalogData {
  models: ModelInfo[];
  strategies: StrategyInfo[];
  datasets: DatasetInfo[];
  engines: EngineInfo[];
  /** 默认引擎：标了 is_default 的，否则发布时间最新的。 */
  engine?: EngineInfo;
  factors: CatalogItem[];
  domains: string[];
}

export type CatalogState = { status: "idle" | "loading" } | { status: "error"; message: string } | { status: "ready"; data: CatalogData };

interface CatalogContextValue { state: CatalogState; ensure: () => void; reload: () => void }
const CatalogContext = createContext<CatalogContextValue | undefined>(undefined);

async function loadCatalog(): Promise<CatalogData> {
  const [models, strategies, datasets, engines, factors] = await Promise.all([
    backtestApi.catalogAll("model"), backtestApi.catalogAll("strategy"), backtestApi.catalogAll("dataset"), backtestApi.catalogAll("engine"), backtestApi.catalogAll("factor"),
  ]);
  const engineInfos = engines.filter((item) => item.status === "available").map(decodeEngine);
  const engine = engineInfos.find((e) => e.isDefault) ?? [...engineInfos].sort((a, b) => (b.releasedAt ?? "").localeCompare(a.releasedAt ?? ""))[0];
  const datasetInfos = datasets.filter((item) => item.status === "available").map(datasetInfo);
  const domains = Array.from(new Set([...datasetInfos.flatMap((d) => d.domains), ...(engine?.domains ?? [])])).sort();
  return {
    models: models.filter((item) => item.status === "available").map(modelInfo),
    strategies: strategies.filter((item) => item.status === "available").map(strategyInfo),
    datasets: datasetInfos, engines: engineInfos, engine, factors: factors.filter((item) => item.status === "available"), domains,
  };
}

export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CatalogState>({ status: "idle" });
  const started = useRef(false);
  const run = useCallback(() => {
    setState({ status: "loading" });
    loadCatalog().then((data) => setState({ status: "ready", data })).catch((error: unknown) => setState({ status: "error", message: v2ErrorText(error) }));
  }, []);
  const ensure = useCallback(() => { if (!started.current) { started.current = true; run(); } }, [run]);
  const reload = useCallback(() => { started.current = true; run(); }, [run]);
  const value = useMemo(() => ({ state, ensure, reload }), [state, ensure, reload]);
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

/** 首次使用时才加载目录（不预抓未访问 Tab 的数据）。 */
export function useCatalog() {
  const context = useContext(CatalogContext);
  if (!context) throw new Error("useCatalog 必须在 CatalogProvider 内使用");
  const { ensure } = context;
  useEffect(() => { const timer = window.setTimeout(ensure, 0); return () => window.clearTimeout(timer); }, [ensure]);
  return context;
}

/** 某个 board/item 的参数定义；引擎里没有登记则返回空数组（表单只显示对象选择部分）。 */
export function paramDefsFor(engine: EngineInfo | undefined, board: string, item: string): ParamDef[] {
  return engine?.paramDefinitions[`${board}/${item}`] ?? [];
}
