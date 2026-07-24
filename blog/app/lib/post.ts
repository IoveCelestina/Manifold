import GithubSlugger from "github-slugger";
import source from "../../content/algorithm-templates.md?raw";

const normalizedSource = source.replace(/^\[TOC\]\s*$/m, "").trim();

function cleanHeading(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}

const slugger = new GithubSlugger();
const headings = normalizedSource.split(/\r?\n/).flatMap((line) => {
  const match = /^(#{1,2})\s+(.+?)\s*$/.exec(line);
  if (!match) return [];
  const title = cleanHeading(match[2]);
  return [{ level: match[1].length, title, id: slugger.slug(title) }];
});

export const post = {
  title: "算法竞赛板子",
  description: "一份覆盖 STL、数据结构、图论、数学、动态规划与计算几何的 C++ 算法模板合集。",
  href: "/posts/algorithm-templates",
  category: "ALGORITHM NOTE",
  publishedAt: "2026-07-22 00:00:00",
  updatedAt: "2026.07.22",
  sizeLabel: "173 KB",
  sectionCount: headings.filter((heading) => heading.level === 1).length,
  headings,
  source: normalizedSource,
};
