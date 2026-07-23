import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";

// Keep the runtime route light by compiling the long-form article before dev/build.
const sourceUrl = new URL("../content/algorithm-templates.md", import.meta.url);
const outputUrl = new URL("../content/algorithm-templates.generated.html", import.meta.url);
const source = (await readFile(sourceUrl, "utf8")).replace(/^\[TOC\]\s*$/m, "").trim();

const article = createElement(
  ReactMarkdown,
  {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [
      rehypeSlug,
      rehypeHighlight,
      [rehypeKatex, { strict: "ignore", output: "html" }],
    ],
    components: {
      img: ({ src, alt }) => src ? createElement("img", { src, alt: alt ?? "" }) : null,
    },
  },
  source,
);

const html = `${renderToStaticMarkup(article)}\n`;
await writeFile(outputUrl, html, "utf8");

console.log(`Rendered ${fileURLToPath(outputUrl)} (${Buffer.byteLength(html)} bytes)`);
