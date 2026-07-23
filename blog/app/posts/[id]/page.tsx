import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArticleToc } from "../../components/ArticleNavigation";
import { ReadingProgress } from "../../components/ReadingProgress";
import { SiteHeader } from "../../components/SiteHeader";
import { csdnPosts, formatPublicationDate, getCsdnPost, getCsdnPostHtml } from "../../lib/csdn-posts";

type PageProps = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return csdnPosts.map((item) => ({ id: item.id }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const article = getCsdnPost(id);
  if (!article) return {};
  return {
    title: article.title,
    description: article.description,
    openGraph: { title: article.title, description: article.description, type: "article" },
  };
}

export default async function ImportedArticlePage({ params }: PageProps) {
  const { id } = await params;
  const article = getCsdnPost(id);
  if (!article) notFound();
  const articleHtml = await getCsdnPostHtml(id);
  if (!articleHtml) notFound();

  const headings = article.headings.map((item) => ({ ...item }));

  return (
    <main>
      <ReadingProgress />
      <SiteHeader />
      <div className={`journal-article-shell${headings.length === 0 ? " without-toc" : ""}`}>
        <article className="docs-main journal-article">
          <div className="breadcrumbs"><Link href="/">首页</Link><span>/</span><Link href="/posts">文章归档</Link></div>
          <header className="article-header">
            <p className="article-kind">{article.category} / ARCHIVE</p>
            <h1>{article.title}</h1>
            <div className="article-summary" dangerouslySetInnerHTML={{ __html: article.summaryHtml }} />
            <div className="article-meta">
              <span>{formatPublicationDate(article.publishedAt)}</span>
              <span>{article.readingMinutes} MIN READ</span>
              <a href={article.sourceUrl} target="_blank" rel="noreferrer">CSDN 原文</a>
            </div>
          </header>
          <div className="article-separator" />
          <div className="markdown-body" dangerouslySetInnerHTML={{ __html: articleHtml }} />
          <footer className="article-footer"><p>已阅至文末</p><Link href="/posts">返回文章归档</Link></footer>
        </article>
        {headings.length > 0 ? <ArticleToc headings={headings} /> : null}
      </div>
    </main>
  );
}
