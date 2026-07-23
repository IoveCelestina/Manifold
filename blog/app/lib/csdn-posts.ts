import articleLoaders from "./csdn-content.generated";
import generatedPosts from "./csdn-metadata.generated";

export type ArticleHeading = {
  level: number;
  title: string;
  id: string;
};

export type CsdnPost = {
  id: string;
  title: string;
  publishedAt: string;
  sourceUrl: string;
  category: string;
  description: string;
  summaryHtml: string;
  readingMinutes: number;
  headings: readonly ArticleHeading[];
};

export const csdnPosts = generatedPosts as readonly CsdnPost[];

export function getCsdnPost(id: string) {
  return csdnPosts.find((item) => item.id === id);
}

export async function getCsdnPostHtml(id: string) {
  const loader = articleLoaders[id as keyof typeof articleLoaders];
  return loader ? loader() : undefined;
}

export function formatArchiveDate(value: string) {
  return value.slice(0, 10).replaceAll("-", ".");
}

export function formatPublicationDate(value: string) {
  const date = new Date(value.replace(" ", "T"));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date).toUpperCase();
}
