import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("系统直接展示服务监控，不保留消息或单项Tab", async () => {
  const response = await render("/system");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /服务监控/);
  assert.doesNotMatch(html, /role="tab"|消息交付|技术信息|网页库任务/);
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

test("旧消息地址清理旧筛选后重定向服务监控", async () => {
  for (const path of ["/delivery?status=FAILED&q=old&offset=40", "/system/delivery?status=PENDING&offset=20"]) {
    const response = await render(path);
    assert.ok([307, 308].includes(response.status));
    assert.equal(response.headers.get("location"), "/system/observability");
  }
});
