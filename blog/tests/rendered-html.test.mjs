import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.match(html, /CLESTIANA/);
  assert.match(html, /这里是我的个人博客/);
  assert.match(html, /项目复盘/);
  assert.match(html, /随手记录/);
  assert.match(html, /算法竞赛板子/);
  assert.match(html, /\/posts\/algorithm-templates/);
  assert.match(html, /\/posts#algorithms/);
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
  assert.match(html, /<h2 id="背包">背包<\/h2>/);
  const lcsSection = html.slice(
    html.indexOf("LCS(最长公共子序列)</h2>"),
    html.indexOf('<h2 id="背包">'),
  );
  assert.doesNotMatch(lcsSection, /katex-error/);
  assert.doesNotMatch(html, /## 背包/);
  assert.doesNotMatch(html, /\[TOC\]/);
});

test("server-renders the migrated article archive", async () => {
  const response = await render("/posts");
  assert.equal(response.status, 200);
  const html = (await response.text()).replaceAll("<!-- -->", "");
  assert.match(html, /文章归档/);
  assert.match(html, /id="algorithms"/);
  assert.match(html, /67 篇迁移文章/);
  assert.match(html, /The 2024 ICPC Asia Shenyang Regional Contest/);
  assert.match(html, /\/posts\/153637462/);
  assert.match(html, /class="archive-summary"/);
  assert.match(html, /class="katex"/);
});

test("server-renders a migrated CSDN article", async () => {
  const response = await render("/posts/153637462");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /The 2024 ICPC Asia Shenyang Regional Contest/);
  assert.match(html, /补题链接/);
  assert.match(html, /language-cpp/);
  assert.match(html, /\/csdn-assets\/153637462\//);
  assert.doesNotMatch(html, /i-blog\.csdnimg\.cn/);
  const articleHeader = html.slice(html.indexOf('class="article-header"'), html.indexOf('class="article-separator"'));
  assert.match(articleHeader, /class="article-summary"/);
  assert.match(articleHeader, /class="katex"/);
});

test("generated archive summaries do not contain nested links", async () => {
  const generated = await readFile(new URL("../app/lib/csdn-metadata.generated.ts", import.meta.url), "utf8");
  assert.doesNotMatch(generated, /<a\s/i);
});
