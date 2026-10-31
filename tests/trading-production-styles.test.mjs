import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("production asset keeps trading workspace layout rules", async () => {
  const cssDir = join(process.cwd(), "dist", "client", "_next", "static", "css");
  const manifest = JSON.parse(await readFile(join(process.cwd(), "dist", "client", ".vite", "manifest.json"), "utf8"));
  const tradingEntry = manifest["app/components/trading-v2-page.tsx"];
  assert.ok(Array.isArray(tradingEntry?.css) && tradingEntry.css.length > 0, "trading entry must link a production CSS asset");
  const files = tradingEntry.css.map((file) => {
    assert.match(file, /^_next\/static\/css\/[A-Za-z0-9._-]+\.css$/, "trading CSS must stay in the production CSS directory");
    return file.split("/").at(-1);
  }).filter(Boolean);
  const css = (await Promise.all(files.map((file) => readFile(join(cssDir, file), "utf8")))).join("\n");
  assert.doesNotMatch(css, /:global\(/, "production CSS must not retain CSS Module :global syntax");
  assert.match(css, /\.trading-account-context[^{}]*\{[^{}]*display:flex/);
  assert.match(css, /\.trading-account-context label>span\{(?=[^{}]*white-space:nowrap)(?=[^{}]*flex:(?:none|0 0 auto)(?:;|\}))/, "account label must not collapse into a vertical column beside the full-width select");
  assert.match(css, /\.trading-account-context \.select\{(?=[^{}]*min-width:0)(?=[^{}]*flex:(?:auto|1(?: 1 auto)?)(?:;|\}))/, "account select must shrink within the available row width");
  assert.match(css, /\.trading-runtime-summary[^{}]*\{[^{}]*display:flex/);
  assert.match(css, /\.trading-attention-grid[^{}]*\{[^{}]*display:grid/);
  assert.match(css, /@media\s*\([^)]*max-width:\s*720px[^)]*\)/, "responsive trading rules must ship");
  assert.match(css, /\.trading-diagnostic-row\{[^{}]*grid-template-columns:1fr/, "narrow diagnostic layout must ship");
  assert.match(css, /\.trading-scope-fields \.input/, "shared selectors must remain scoped to the trading workspace");
});
