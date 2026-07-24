import { csdnPosts } from "./csdn-posts";
import { post } from "./post";

export type JournalSection = "PROJECTS" | "ALGORITHMS" | "NOTES";

export type JournalPost = {
  id: string;
  href: string;
  title: string;
  publishedAt: string;
  category: string;
  section: JournalSection;
  description: string;
  summaryHtml?: string;
};

const sectionDefinitions = [
  {
    id: "PROJECTS",
    name: "项目复盘",
    description: "从想法、约束到落地结果，记录真实决策与走过的弯路。",
  },
  {
    id: "ALGORITHMS",
    name: "算法竞赛",
    description: "算法模板、题目思路，以及值得反复查阅的推导。",
  },
  {
    id: "NOTES",
    name: "随手记录",
    description: "收藏阅读、灵感，以及代码之外值得留下的生活片段。",
  },
] as const;

function resolveSection(category: string): JournalSection {
  const normalized = category.toUpperCase();
  if (normalized.includes("PROJECT")) return "PROJECTS";
  if (normalized.includes("ALGORITHM")) return "ALGORITHMS";
  return "NOTES";
}

function normalizeExcerpt(value: string, maximumLength = 96) {
  const excerpt = value.replace(/\s+/g, " ").trim();
  return excerpt.length > maximumLength ? `${excerpt.slice(0, maximumLength - 1).trimEnd()}…` : excerpt;
}

function publicationTime(value: string) {
  return new Date(value.replace(" ", "T").replaceAll(".", "-")).getTime();
}

export const journalPosts: readonly JournalPost[] = [
  {
    id: "algorithm-templates",
    href: post.href,
    title: post.title,
    publishedAt: post.publishedAt,
    category: post.category,
    section: resolveSection(post.category),
    description: normalizeExcerpt(post.description),
  },
  ...csdnPosts.map((item) => ({
    id: item.id,
    href: `/posts/${item.id}`,
    title: item.title,
    publishedAt: item.publishedAt,
    category: item.category,
    section: resolveSection(item.category),
    description: normalizeExcerpt(item.description),
    summaryHtml: item.summaryHtml,
  })),
].sort((left, right) => publicationTime(right.publishedAt) - publicationTime(left.publishedAt));

export const featuredPost = journalPosts[0];
export const latestPosts = journalPosts.slice(1, 6);

export const journalSections = sectionDefinitions.map((definition) => {
  const posts = journalPosts.filter((item) => item.section === definition.id);
  return {
    ...definition,
    count: posts.length,
    href: posts.length > 0 ? `/posts#${definition.id.toLowerCase()}` : undefined,
  };
});
