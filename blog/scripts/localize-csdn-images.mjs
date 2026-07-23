import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";

const indexUrl = new URL("../content/csdn/index.json", import.meta.url);
const publicUrl = new URL("../public/csdn-assets/", import.meta.url);
const index = JSON.parse(await readFile(indexUrl, "utf8"));
const imagePattern = /https:\/\/(?:i-blog|img-blog)\.csdnimg\.cn\/[^)\s]+/g;
let downloaded = 0;

for (const item of index) {
  const markdownUrl = new URL(`../content/csdn/${item.path}`, import.meta.url);
  let markdown = await readFile(markdownUrl, "utf8");
  const references = [...new Set(markdown.match(imagePattern) ?? [])];
  if (references.length === 0) continue;

  const articleAssetUrl = new URL(`${item.id}/`, publicUrl);
  await mkdir(articleAssetUrl, { recursive: true });

  for (const reference of references) {
    const remoteUrl = reference.split("#")[0];
    const remotePath = new URL(remoteUrl).pathname;
    const suffix = extname(remotePath).toLowerCase() || ".bin";
    const digest = createHash("sha1").update(remoteUrl).digest("hex").slice(0, 16);
    const filename = `${digest}${suffix}`;
    const targetUrl = new URL(filename, articleAssetUrl);
    const response = await fetch(remoteUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; ClestianaArchive/1.0)" },
    });
    if (!response.ok) throw new Error(`Failed to download ${remoteUrl}: ${response.status}`);
    await writeFile(targetUrl, Buffer.from(await response.arrayBuffer()));
    markdown = markdown.split(reference).join(`/csdn-assets/${item.id}/${filename}`);
    downloaded += 1;
  }

  await writeFile(markdownUrl, markdown, "utf8");
}

console.log(`Localized ${downloaded} CSDN image references.`);
