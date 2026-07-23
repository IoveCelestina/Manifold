import type { Metadata } from "next";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { ArticleNavigation, ArticleToc } from "../../components/ArticleNavigation";
import { ReadingProgress } from "../../components/ReadingProgress";
import { SiteHeader } from "../../components/SiteHeader";
import { post } from "../../lib/post";

export const metadata: Metadata = {
  title: post.title,
  description: post.description,
  openGraph: { title: post.title, description: post.description, type: "article" },
};

export default function AlgorithmTemplatesPage() {
  return (
    <main>
      <ReadingProgress />
      <SiteHeader />
      <div className="docs-shell">
        <ArticleNavigation headings={post.headings} />
        <article className="docs-main">
          <div className="breadcrumbs"><Link href="/">首页</Link><span>/</span><span>算法模板</span></div>
          <header className="article-header">
            <p className="article-kind">研究档案 / 算法竞赛</p>
            <h1>{post.title}</h1>
            <p>{post.description}</p>
            <div><span>{post.updatedAt} 更新</span><span>{post.sizeLabel}</span><span>{post.sectionCount} 个主章节</span></div>
          </header>
          <div className="article-separator" />
          <div className="markdown-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeSlug, rehypeHighlight, [rehypeKatex, { strict: "ignore" }]]}
              components={{ img: ({ src, alt }) => {
                if (!src) return null;
                // eslint-disable-next-line @next/next/no-img-element
                return <img src={src} alt={alt ?? ""} />;
              } }}
            >{post.source}</ReactMarkdown>
          </div>
          <footer className="article-footer"><p>已阅至文末</p><Link href="/">← 返回首页</Link></footer>
        </article>
        <ArticleToc headings={post.headings} />
      </div>
    </main>
  );
}
