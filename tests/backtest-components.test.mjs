import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, before } from "node:test";
import { createComponentLoader } from "./helpers/render-component.mjs";

const dir = new URL("./fixtures/backtest/", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));

let loader;
let platform;
let charts;
let sections;
let resultView;
let runPage;
let pickers;
let selection;
const run = (id) => platform.decodeRun(fixture(`run-${id}.json`).data);
const count = (html, pattern) => (html.match(pattern) ?? []).length;

before(async () => {
  loader = await createComponentLoader();
  [platform, charts, sections, resultView, runPage, pickers, selection] = await Promise.all([
    loader.load("/app/lib/backtest-platform.ts"), loader.load("/app/components/backtest/charts.tsx"), loader.load("/app/components/backtest/result-sections.tsx"),
    loader.load("/app/components/backtest/result-view.tsx"), loader.load("/app/components/backtest/run-page.tsx"),
    loader.load("/app/components/backtest/pickers.tsx"), loader.load("/app/lib/backtest-selection.ts"),
  ]);
});
after(async () => { await loader?.close(); });

const decodeSection = (id, source = "result-all-sections.json") => platform.decodeResult(fixture(source)).sections.find((s) => s.id === id);

test("折线图：图例按曲线数量出现、可点击隔离；空数据明确提示", () => {
  const section = platform.decodeResult(fixture("run-btr-20261019-trade001.json").data.result).sections.find((s) => s.id === "pnl_curves");
  const html = loader.render(charts.SeriesChart, { section, title: "PnL" });
  assert.match(html, /<svg[^>]*role="img"[^>]*aria-label="PnL"/);
  assert.equal(count(html, /class="bt-legend-item/g), 6, "3 个组合 × Realised / MTM");
  assert.equal(count(html, /aria-pressed="false"/g), 6);
  assert.equal(count(html, /class="bt-line"/g), 6);
  assert.match(html, /class="bt-zero"/, "零线单独着色");
  assert.match(html, /\$/, "y 轴按 money 格式化");
  const empty = loader.render(charts.SeriesChart, { section: { ...section, series: [{ name: "a", points: [{ x: 1, y: null }] }] } });
  assert.match(empty, /没有可绘制的数据点/);
  const single = loader.render(charts.SeriesChart, { section: { ...section, series: [section.series[0]] } });
  assert.equal(count(single, /class="bt-legend-item/g), 0, "只有一条曲线不画图例");
});

test("校准曲线：散点带点大小、置信区间、低样本灰色空心点与 45° 参考线", () => {
  const section = platform.decodeResult(fixture("run-btr-20261019-calib001.json").data.result).sections.find((s) => s.id === "curve");
  const first = { ...section, series: section.series.filter((l) => l.filters?.representative_mode === "first_entry") };
  const html = loader.render(charts.SeriesChart, { section: first, title: "校准曲线" });
  assert.equal(count(html, /class="bt-legend-item/g), 3);
  assert.equal(count(html, /class="bt-ci"/g), 30, "每个点一条 CI 竖线");
  assert.ok(count(html, /stroke-dasharray="2 2"/g) > 0, "低样本桶是虚线空心点");
  assert.match(html, /fill="#fff"/);
  assert.match(html, /class="bt-ref"/, "45° 参考线");
  assert.ok(/r="(\d+\.?\d*)"/.test(html));
  const radii = new Set([...html.matchAll(/<circle[^>]*r="([\d.]+)"/g)].map((m) => m[1]));
  assert.ok(radii.size > 3, "点大小随唯一市场数变化");
});

test("条形图：误差棒、参考线、市场高亮色；纵向直方图按数值轴摆放并标均值 / 中位数", () => {
  const brier = platform.decodeResult(fixture("run-btr-20261019-brier001.json").data.result).sections.find((s) => s.id === "brier_bars");
  const html = loader.render(charts.BarsChart, { section: { ...brier, bars: brier.bars.filter((b) => b.filters.odds_scope === "all" && b.filters.ci_level === "95") }, title: "Brier" });
  assert.equal(count(html, /<rect /g), 5);
  assert.equal(count(html, /class="bt-errbar"/g), 5);
  assert.match(html, /fill="#F28E2B"/, "Market 为橙色");
  const trading = platform.decodeResult(fixture("run-btr-20261019-trade001.json").data.result).sections.find((s) => s.id === "entry_prices");
  const hist = loader.render(charts.BarsChart, { section: { ...trading, bars: trading.bars.filter((b) => b.filters.entry_combo === trading.filters[0].defaultValue && b.filters.direction === "all") }, title: "Entry" });
  assert.equal(count(hist, /<rect /g), 20, "0.05 分桶共 20 根");
  assert.equal(count(hist, /class="bt-ref"/g), 2);
  assert.match(hist, /均值 0\.420/);
  assert.match(hist, /中位数 0\.390/);
  assert.match(loader.render(charts.BarsChart, { section: { ...brier, bars: [] } }), /没有可绘制的数据/);
});

test("热力图：固定色域、|ρ|>0.6 白字、样本不足的格子显示 —、n<5 标注", () => {
  const section = decodeSection("matrix");
  const html = loader.render(charts.Heatmap, { section, title: "秩相关" });
  assert.match(html, /<th scope="row"[^>]*>a<\/th>/);
  assert.match(html, /class="bt-heat-null"[^>]*>—</, "null 不显示为 0");
  assert.match(html, /color:#fff/, "|1|>0.6 用白字");
  const overview = platform.decodeResult(fixture("run-btr-20261019-ovrvw001.json").data.result).sections.find((s) => s.id === "metric_correlation");
  const big = loader.render(charts.Heatmap, { section: overview });
  assert.equal(count(big, /<tr>/g), 13);
  assert.match(big, /<small>n=4<\/small>/);
});

test("指标卡片：空值显示 —，百分比与金额按 kind 格式化", () => {
  const html = loader.render(sections.MetricsView, { section: decodeSection("kpis") });
  assert.match(html, /<strong[^>]*>842<\/strong>/);
  assert.match(html, /97\.4%/);
  assert.match(html, /通过初筛/);
  assert.match(html, /空值<\/span><strong[^>]*>—<\/strong>/);
  const money = loader.render(sections.MetricsView, { section: { items: [{ label: "最终", value: -12.5, kind: "money" }] } });
  assert.match(money, /negative[^>]*>-\$12\.50/);
});

test("表格：默认排序列带 aria-sort，导出按钮、徽章、空值 —、排名列", () => {
  const section = decodeSection("table");
  const html = loader.render(sections.SortableTable, { section, selection: { ci_level: "95" }, csvName: "t" });
  assert.match(html, /aria-sort="ascending"/);
  assert.match(html, /导出 CSV/);
  assert.match(html, /bt-badge good[^>]*>更准/);
  assert.equal(count(html, /<tbody><tr>/g), 1);
  assert.equal(count(html, /<tr>/g), 3, "表头 + 筛选后的 2 行（A 的 95 档、B）");
  assert.match(html, /<td[^>]*>—<\/td>/, "空值显示 —");
  const overview = platform.decodeResult(fixture("run-btr-20261019-ovrvw001.json").data.result).sections.find((s) => s.id === "main");
  const pinned = loader.render(sections.SortableTable, { section: overview, selection: {}, csvName: "o" });
  assert.match(pinned, /<th[^>]*>#<\/th>/, "排名列");
  assert.match(pinned, /点过的列固定在左侧/);
  assert.equal(count(pinned, /class="bt-th-button"/g), 11, "除模型列外每列都可点表头排序");
  const filtered = loader.render(sections.SortableTable, { section: { ...section, rows: [] }, selection: {}, csvName: "t" });
  assert.match(filtered, /没有符合条件的行/);
});

test("文本：最小 markdown（标题、加粗、代码、列表、表格），JSON 美化", () => {
  const html = loader.render(sections.TextView, { section: decodeSection("text") });
  assert.match(html, /<h4>标题<\/h4>/);
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.match(html, /<code>代码<\/code>/);
  assert.match(html, /<ul><li>列表<\/li><\/ul>/);
  const table = loader.render(sections.TextView, { section: { text: "| a | b |\n| --- | --- |\n| 1 | **2** |", format: "markdown" } });
  assert.match(table, /<th>a<\/th>/);
  assert.match(table, /<td[^>]*>1<\/td>/);
  const json = loader.render(sections.TextView, { section: { text: '{"a":1}', format: "json" } });
  assert.match(json, /&quot;a&quot;: 1|"a": 1/);
  const injected = loader.render(sections.TextView, { section: { text: "<script>alert(1)</script>", format: "markdown" } });
  assert.doesNotMatch(injected, /<script>/, "内容被转义，不会注入标签");
});

test("区块外壳：折叠区块用 details；图片走产物接口并可新窗口打开", () => {
  const collapsed = loader.render(sections.SectionFrame, { section: { id: "metrics_raw", type: "text", filters: [] }, children: "x" });
  assert.match(collapsed, /<details class="bt-section bt-details"[^>]*><summary>原始指标列<\/summary>/);
  const open = loader.render(sections.SectionFrame, { section: { id: "metrics_main", type: "table", filters: [] }, children: "x" });
  assert.match(open, /<h3 class="bt-section-title"[^>]*>指标明细<\/h3>/);
  const explicit = loader.render(sections.SectionFrame, { section: { id: "pairs", type: "table", title: "自定义", collapsed: true, filters: [] }, children: "x" });
  assert.match(explicit, /<summary>自定义<\/summary>/, "区块自带 title / collapsed 优先于默认");
  const image = loader.render(sections.SectionBody, { section: decodeSection("image"), runId: "btr-1", selection: {}, csvName: "x" });
  assert.match(image, /src="\/api\/console\/backtest\/runs\/btr-1\/artifacts\?path=plots%2Fa\.png"/);
  const unsupported = loader.render(sections.SectionBody, { section: { id: "f", type: "unsupported", originalType: "sankey", filters: [] }, runId: "btr-1", selection: {}, csvName: "x" });
  assert.match(unsupported, /暂不支持的区块类型：sankey/);
});

test("筛选条：少量选项用单选按钮组，多于 8 项改下拉", () => {
  const few = loader.render(sections.FilterBar, { filters: [{ key: "k", label: "置信水平", options: [{ value: "90", label: "90%" }, { value: "95", label: "95%" }], defaultValue: "95" }], selection: {}, onSelect() {} });
  assert.match(few, /role="radiogroup"/);
  assert.match(few, /aria-checked="true"[^>]*>95%/);
  const many = loader.render(sections.FilterBar, { filters: [{ key: "k", label: "指标", options: Array.from({ length: 12 }, (_, i) => ({ value: String(i), label: `m${i}` })), defaultValue: "3" }], selection: {}, onSelect() {} });
  assert.match(many, /<select/);
  assert.match(many, /<option value="3" selected/);
  assert.equal(loader.render(sections.FilterBar, { filters: [], selection: {}, onSelect() {} }), "");
});

test("结果页 · Brier：结果级筛选按默认档位只显示对应行，折叠区块与复现信息", () => {
  const html = loader.render(resultView.ResultView, { run: run("btr-20261019-brier001") });
  assert.match(html, /aria-label="结果显示档位"/);
  assert.match(html, /赔率口径/);
  assert.match(html, /置信水平/);
  assert.match(html, /aria-checked="true"[^>]*>全部市场/);
  assert.match(html, /aria-checked="true"[^>]*>95%/);
  const metrics = html.slice(html.indexOf('id="bt-section-metrics"'), html.indexOf('id="bt-section-scope_ranks"'));
  assert.equal(count(metrics, /<tbody>/g), 1);
  assert.equal(count(metrics, /<tr>/g), 6, "表头 + 5 个模型（只显示 全部市场 × 95%）");
  assert.match(metrics, /更准/);
  assert.match(html, /<details class="bt-section bt-details" id="bt-section-metrics_raw"/);
  assert.match(html, /Spearman ρ/);
});

test("结果页 · Trading：PnL 曲线口径默认 MTM、Gap 对比、未成交原因、Entry price 筛选", () => {
  const html = loader.render(resultView.ResultView, { run: run("btr-20261019-trade001") });
  assert.match(html, /PnL 曲线口径（只切换显示，不重跑）/);
  assert.match(html, /aria-checked="true"[^>]*>MTM/);
  assert.equal(count(html.slice(html.indexOf('id="bt-section-pnl_curves"'), html.indexOf('id="bt-section-final_pnl"')), /class="bt-legend-item/g) >= 3, true);
  assert.match(html, /PnL Gap 对比/);
  assert.match(html, /请选择两条不同的 PnL 曲线|最终 Gap/);
  assert.match(html, /最终 Gap/);
  assert.match(html, /对齐规则：两条曲线取事件时间并集/);
  assert.match(html, /未成交候选的原因明细/);
  assert.match(html, /strategy × model/);
  assert.match(html, /仅 YES/);
  assert.match(html, /<details class="bt-section bt-details" id="bt-section-metrics_detail"/, "辅表默认折叠");
});

test("结果页 · 总览：主表带排名列与固定列提示，单指标图的筛选有 12 项（下拉）", () => {
  const html = loader.render(resultView.ResultView, { run: run("btr-20261019-ovrvw001") });
  assert.match(html, /<th[^>]*>#<\/th>/);
  assert.match(html, /点表头排序，再点反向；点过的列固定在左侧/);
  assert.match(html, /<select[^>]*aria-label="看哪张图"/);
  assert.match(html, /id="bt-section-metric_correlation"/);
  assert.match(html, /指标之间的秩相关/);
  assert.match(html, /偏离列仅作逐行阅读/);
});

test("结果页 · Signal：按周期只显示对应分桶图（when），六周期汇总表，六个明细标签页", () => {
  const html = loader.render(resultView.ResultView, { run: run("btr-20261019-sig00001") });
  assert.equal(count(html, /<img /g), 1, "6 个周期分桶图区块里只有 24h 可见");
  assert.match(html, /24h 分桶/);
  assert.doesNotMatch(html, /1h 分桶/);
  assert.match(html, /aria-checked="true"[^>]*>24h/);
  assert.match(html, /通过初筛/);
  assert.match(html, /\/api\/console\/backtest\/runs\/btr-20261019-sig00001\/artifacts\?path=report%2Frev_momentum_3h%2Fquantiles_compact_v2\.png/);
  const tabs = [...html.matchAll(/role="tab"[^>]*id="bt-tab-\$-([^"]+)"|id="bt-tab-\$-([^"]+)"[^>]*role="tab"/g)].map((m) => m[1] ?? m[2]);
  assert.deepEqual(tabs, ["分桶明细", "IC 时序", "价格分层", "分 Domain", "分期对照", "文件"]);
  assert.match(html, /id="bt-tab-\$-分桶明细"[^>]*aria-selected="true"|aria-selected="true"[^>]*id="bt-tab-\$-分桶明细"/);
  assert.match(html, /role="tabpanel"/);
  assert.equal(count(html, /D1<\/td>/g), 1, "分桶明细表按周期筛选，只显示 24h 的 10 个桶");
  assert.doesNotMatch(html, /截面不足，不排名/, "其它标签页的内容不渲染");
});

test("结果页 · 批量因子：状态计数、状态筛选、因子明细选择器只显示选中因子的区块", () => {
  const html = loader.render(resultView.ResultView, { run: run("btr-20261019-batch001") });
  assert.match(html, /Holm 校正按本批 3 个对象计算/);
  assert.match(html, /通过初筛<\/span><strong[^>]*>1<\/strong>/);
  assert.match(html, /aria-label="批次汇总 显示档位"/);
  assert.match(html, /<select[^>]*aria-label="因子明细"[^>]*>/);
  assert.equal(count(html, /<option value="(rev_momentum_3h|vol_burst|resid_edge)"/g), 3);
  assert.match(html, /rev_momentum_3h · 初筛/, "默认显示第一个因子的明细");
  assert.doesNotMatch(html, /vol_burst · 初筛/);
  assert.equal(count(html, /<img /g), 1);
  const summary = html.slice(html.indexOf('id="bt-section-summary"'), html.indexOf("因子明细（"));
  assert.equal(count(summary, /<tr>/g), 4, "状态筛选默认「全部」：表头 + 3 个因子");
  assert.match(summary, /bt-badge warn[^>]*>人工复审/);
});

test("结果页 · Correlation：热力图 + 引擎图 + 因子对明细", () => {
  const html = loader.render(resultView.ResultView, { run: run("btr-20261019-corr0001") });
  assert.match(html, /截面 Rank Correlation/);
  assert.match(html, /class="bt-heat-table"/);
  assert.match(html, /因子对明细/);
  assert.match(html, /<img /);
});

test("口径卡片：窗口（北京时间）、数据集、引擎协议、样本数、批次成员 Holm 提示", () => {
  const r = run("btr-20261019-trade001");
  const html = loader.render(resultView.ScopeCardView, { result: r.result, run: r });
  assert.match(html, /2026-08-07 21:16:28 → 2026-08-31 21:00:35 · 公共时间区间/);
  assert.match(html, /telonex/);
  assert.match(html, /pm-engine-20261019-3b7dbbede090 · pearson-dmid-v8/);
  assert.match(html, /逐题交集 842/);
  const batch = { ...r.result, scopeCard: { ...r.result.scopeCard, batchMembers: ["a", "b", "c"] } };
  assert.match(loader.render(resultView.ScopeCardView, { result: batch, run: r }), /Holm 校正按本批 3 个对象计算/);
  const legacy = run("btr-legacy-factor-v7-01");
  assert.match(loader.render(resultView.ScopeCardView, { result: legacy.result, run: legacy }), /旧平台历史结果/);
});

test("复现信息：整段文本可见、一键复制按钮、输入指纹明细", () => {
  const html = loader.render(runPage.ReproduceBlock, { run: run("btr-20261019-brier001") });
  assert.match(html, /一键复制/);
  assert.match(html, /实验 ID：btr-20261019-brier001/);
  assert.match(html, /pmbt rerun btr-20261019-brier001/);
  assert.match(html, /输入指纹（3 个文件 · dg-1f3a9c20b7d44e10）/);
  assert.match(html, /backtest\/market_data\/settlement\.parquet/);
  const legacy = loader.render(runPage.ReproduceBlock, { run: run("btr-legacy-factor-v7-01") });
  assert.match(legacy, /没有复现信息/);
});

test("运行状态徽章：失联单独标红，不改终态文案", () => {
  const html = loader.render(runPage.RunStatusBadge, { run: run("btr-20261019-lost0001") });
  assert.match(html, /运行中/);
  assert.match(html, /bt-lost[^>]*>失联/);
  assert.match(loader.render(runPage.RunStatusBadge, { run: run("btr-20261019-cancel01") }), /已停止/);
});

test("模型选择器：同一 model_id 的多个版本各是一个选项，没有重复 key 警告，参数表单为带 choices 的整数渲染下拉", () => {
  const items = fixture("catalog-models.json").data.items.map(platform.decodeCatalogItem);
  const datasets = fixture("catalog-datasets.json").data.items.map(platform.decodeCatalogItem).map(selection.datasetInfo);
  const pool = items.map(selection.modelInfo).filter((m) => !m.marketView);
  const errors = [];
  const original = console.error;
  console.error = (...args) => { errors.push(args.join(" ")); };
  let html;
  let formHtml;
  try {
    html = loader.render(pickers.ModelPicker, { pool, selected: ["team_01@v2/p1", "team_01@v2/p21"], onChange: () => undefined, datasets });
    const defs = [platform.decodeParamDef({ name: "horizon_hours", type: "integer", label: "horizon", default: 24, choices: [1, 12, 24, 48, 96, 168] })];
    formHtml = loader.render(pickers.ParamForm, { defs, values: { horizon_hours: "24" }, errors: {}, onChange: () => undefined });
  } finally { console.error = original; }
  assert.deepEqual(errors, [], "不应出现 React 的重复 key / 受控组件警告");
  assert.ok(html.includes("team_01__v2__p1 (") && html.includes("team_01__v2__p21 ("));
  assert.equal(count(html, /aria-label="移除 team_01__v2__p(1|21)"/g), 2, "两个版本的 chip 都可见、可删");
  assert.match(formHtml, /<select[^>]*>.*<option value="168">168<\/option>/);
});
