import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("系统主工作区只暴露服务监控和消息交付", async () => {
  const response = await render("/system");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="v2-tab-system-observability"[^>]*>服务监控/);
  assert.match(html, /id="v2-tab-system-delivery"[^>]*>消息交付/);
  assert.equal((html.match(/role="tab"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /网页库任务/);
  assert.doesNotMatch(html, /连接能力/);
});

test("网页库任务和服务配置诊断仍可由旧直达地址访问，但不恢复系统主Tab", async () => {
  const pageJobs = await (await render("/system/page-jobs")).text();
  assert.match(pageJobs, /网页库任务/);
  assert.match(pageJobs, /运维诊断保留/);
  assert.doesNotMatch(pageJobs, /role="tab"/);

  const settings = await (await render("/system/settings")).text();
  assert.match(settings, /服务配置诊断/);
  assert.doesNotMatch(settings, /role="tab"/);
});

test("嵌入消息交付不重复渲染系统页内导航，独立直达页保留相关入口", async () => {
  const embedded = await (await render("/system/delivery")).text();
  assert.doesNotMatch(embedded, /aria-label="相关页面"/);

  const direct = await (await render("/delivery")).text();
  assert.match(direct, /aria-label="相关页面"/);
});
