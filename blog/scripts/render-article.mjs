import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import GithubSlugger from "github-slugger";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";

const markdownOptions = {
  remarkPlugins: [remarkGfm, remarkMath],
  rehypePlugins: [
    rehypeSlug,
    rehypeHighlight,
    [rehypeKatex, { strict: "ignore", output: "html" }],
  ],
  components: {
    img: ({ src, alt }) => src ? createElement("img", {
      src,
      alt: alt && alt !== "在这里插入图片描述" ? alt : "文章插图",
      loading: "lazy",
    }) : null,
  },
};

const summaryMarkdownOptions = {
  ...markdownOptions,
  components: {
    ...markdownOptions.components,
    a: ({ children }) => createElement("span", null, children),
    img: () => null,
  },
};

function normalizeSource(value) {
  return value
    .replace(/[\u200B\uFEFF]/g, "")
    .replace(/^\s*(?:\[TOC\]|@\[toc\])\s*$/gim, "")
    .trim();
}

function stripDuplicateLeadHeading(source, title) {
  const comparable = (value) => value
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s`*_~()[\]{}<>《》“”"'，。,:：;；.!！?？\-—–]/g, "");
  const lines = source.split(/\r?\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim());
  if (firstContentIndex === -1) return source;
  const match = /^#{1,3}\s+(.+?)\s*$/.exec(lines[firstContentIndex]);
  if (!match || comparable(cleanHeading(match[1])) !== comparable(title)) return source;
  lines.splice(firstContentIndex, 1);
  return lines.join("\n").trim();
}

function renderMarkdown(source) {
  return `${renderToStaticMarkup(createElement(ReactMarkdown, markdownOptions, source))}\n`;
}

function renderSummaryMarkdown(source) {
  return renderToStaticMarkup(createElement(ReactMarkdown, summaryMarkdownOptions, source));
}

function cleanHeading(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

function extractHeadings(source) {
  const candidates = source.split(/\r?\n/).flatMap((line) => {
    const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (!match) return [];
    return [{ sourceLevel: match[1].length, title: cleanHeading(match[2]) }];
  }).filter((item) => item.title);

  if (candidates.length === 0) return [];
  const primaryLevel = Math.min(...candidates.map((item) => item.sourceLevel));
  const slugger = new GithubSlugger();
  return candidates.map((item) => ({
    level: item.sourceLevel === primaryLevel ? 1 : 2,
    title: item.title,
    id: slugger.slug(item.title),
  }));
}

function extractSummaryMarkdown(source) {
  const blocks = source
    .replace(/```[\s\S]*?```/g, "")
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<https?:\/\/[^>]+>/g, "")
      .trim())
    .filter((block) => block && !/^#{1,6}\s/.test(block) && !/^[-*_]{3,}$/.test(block));

  const meaningful = blocks.find((block) => block
    .replace(/[*_~`>|$\\{}[\]()#]/g, "")
    .replace(/\s+/g, "")
    .length >= 24);
  return meaningful ?? blocks[0] ?? "一篇从 CSDN 迁移并保留原始内容的技术记录。";
}

function extractDescription(summaryMarkdown) {
  const plain = summaryMarkdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~`>|$\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "一篇从 CSDN 迁移并保留原始内容的技术记录。";
  return plain.length > 96 ? `${plain.slice(0, 96).trim()}…` : plain;
}

function estimateReadingMinutes(source) {
  const prose = source.replace(/```[\s\S]*?```/g, " ");
  const code = source.match(/```[\s\S]*?```/g)?.join("\n") ?? "";
  return Math.max(1, Math.ceil(prose.length / 520 + code.split(/\r?\n/).length / 90));
}

// Keep the runtime route light by compiling Markdown before dev/build.
const sourceUrl = new URL("../content/algorithm-templates.md", import.meta.url);
const outputUrl = new URL("../content/algorithm-templates.generated.html", import.meta.url);
const source = normalizeSource(await readFile(sourceUrl, "utf8"));
const html = renderMarkdown(source);
await writeFile(outputUrl, html, "utf8");

const csdnIndexUrl = new URL("../content/csdn/index.json", import.meta.url);
const csdnOutputUrl = new URL("../app/lib/csdn-content.generated.ts", import.meta.url);
const csdnMetadataUrl = new URL("../app/lib/csdn-metadata.generated.ts", import.meta.url);
const csdnHtmlUrl = new URL("../app/lib/csdn-html/", import.meta.url);
const csdnIndex = JSON.parse(await readFile(csdnIndexUrl, "utf8"));
const csdnPosts = [];
await mkdir(csdnHtmlUrl, { recursive: true });

for (const item of csdnIndex) {
  const articleSourceUrl = new URL(`../content/csdn/${item.path}`, import.meta.url);
  const rawArticleSource = normalizeSource(await readFile(articleSourceUrl, "utf8"));
  const articleSource = stripDuplicateLeadHeading(rawArticleSource, item.title);
  const articleHtml = renderMarkdown(articleSource);
  const summaryMarkdown = extractSummaryMarkdown(articleSource);
  csdnPosts.push({
    id: item.id,
    title: item.title,
    publishedAt: item.publishedAt,
    sourceUrl: item.sourceUrl,
    category: "ALGORITHM NOTE",
    description: extractDescription(summaryMarkdown),
    summaryHtml: renderSummaryMarkdown(summaryMarkdown),
    readingMinutes: estimateReadingMinutes(articleSource),
    headings: extractHeadings(articleSource),
  });
  await writeFile(
    new URL(`${item.id}.generated.ts`, csdnHtmlUrl),
    `/* Generated CSDN article. */\nconst articleHtml = ${JSON.stringify(articleHtml)};\nexport default articleHtml;\n`,
    "utf8",
  );
}

const generatedLoaders = [
  "/* This file is generated by scripts/render-article.mjs. */",
  "const loaders = {",
  ...csdnPosts.map((item) => `  ${JSON.stringify(item.id)}: () => import("./csdn-html/${item.id}.generated").then((module) => module.default),`),
  "} as const;",
  "export default loaders;",
  "",
].join("\n");
const generatedMetadata = [
  "/* This file is generated by scripts/render-article.mjs. */",
  `const posts = ${JSON.stringify(csdnPosts)} as const;`,
  "export default posts;",
  "",
].join("\n");
await writeFile(csdnOutputUrl, generatedLoaders, "utf8");
await writeFile(csdnMetadataUrl, generatedMetadata, "utf8");

console.log(`Rendered ${fileURLToPath(outputUrl)} (${Buffer.byteLength(html)} bytes)`);
console.log(`Rendered ${csdnPosts.length} CSDN articles with split HTML modules.`);
