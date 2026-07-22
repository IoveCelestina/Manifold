import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the blog home page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /ZSTUACM/);
  assert.match(html, /这里是我的个人博客/);
  assert.match(html, /技术札记/);
  assert.match(html, /随手记录/);
  assert.match(html, /算法竞赛板子/);
  assert.match(html, /\/posts\/algorithm-templates/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("server-renders the complete algorithm article", async () => {
  const response = await render("/posts/algorithm-templates");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /算法竞赛板子/);
  assert.match(html, /STL/);
  assert.match(html, /数据结构/);
  assert.match(html, /计算几何/);
  assert.doesNotMatch(html, /\[TOC\]/);
});
