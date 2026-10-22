"use client";

import { useState } from "react";
import { backtestApi, type RawRecord } from "../../lib/backtest-platform";
import { V2Loading, V2Notice, v2ErrorText } from "../console-v2-resource";
import { useCatalog, type CatalogData } from "./catalog-context";

/** 目录就绪后才渲染表单；加载中 / 失败 / 引擎未登记都明确提示，不用空表单冒充可用。 */
export function CatalogGate({ children }: { children: (data: CatalogData) => React.ReactNode }) {
  const { state, reload } = useCatalog();
  if (state.status === "error") return <><V2Notice error title="回测目录不可用" description={state.message} /><button type="button" className="button" onClick={reload}>重试</button></>;
  if (state.status !== "ready") return <V2Loading />;
  if (!state.data.engine) return <V2Notice error title="没有可用的引擎版本" description="执行器还没有登记引擎（PUT /executor/inventory），无法发起运行。" />;
  return <>{children(state.data)}</>;
}

export function useLauncher() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const launch = async (runs: RawRecord[], force: boolean) => {
    setBusy(true); setError(undefined);
    try {
      const created = await backtestApi.createRuns({ runs, force });
      if (created.runs.length === 1) {
        const only = created.runs[0];
        window.location.href = `/backtest-platform/runs/${encodeURIComponent(only.runId)}${only.reused ? "?reused=1" : ""}`;
      } else if (created.batchId) window.location.href = `/backtest-platform/runs?batch_id=${encodeURIComponent(created.batchId)}`;
      else window.location.href = "/backtest-platform/runs";
    } catch (cause) { setError(v2ErrorText(cause)); setBusy(false); }
  };
  return { busy, error, launch };
}

export function SubmitBar({ blockers, busy, error, label, onSubmit, force, onForce }: { blockers: string[]; busy: boolean; error?: string; label: string; onSubmit: () => void; force: boolean; onForce: (value: boolean) => void }) {
  return <div className="bt-submit">
    {blockers.length > 0 && <ul className="bt-blockers" aria-label="暂时不能运行的原因">{blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
    {error && <V2Notice error title="发起失败" description={error} />}
    <div className="bt-form-row">
      <button type="button" className="button primary" disabled={busy || blockers.length > 0} onClick={onSubmit}>{busy ? "正在提交…" : label}</button>
      <label className="bt-check"><input type="checkbox" checked={force} onChange={(event) => onForce(event.target.checked)} /><span>强制重跑（跳过相同配置的已有结果）</span></label>
    </div>
    <p className="bt-note">相同配置与相同输入版本已有成功运行时，会直接返回它；需要重新计算请勾选「强制重跑」。</p>
  </div>;
}
