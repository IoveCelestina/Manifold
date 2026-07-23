import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "../components/SiteHeader";
import { csdnPosts, formatArchiveDate } from "../lib/csdn-posts";

export const metadata: Metadata = {
  title: "文章归档",
  description: "算法竞赛题解、技术笔记与长期维护的个人文章归档。",
};

const groups = Object.entries(
  csdnPosts.reduce<Record<string, typeof csdnPosts[number][]>>((result, item) => {
    const year = item.publishedAt.slice(0, 4);
    result[year] ??= [];
    result[year].push(item);
    return result;
  }, {}),
).sort(([left], [right]) => Number(right) - Number(left));

export default function PostsPage() {
  return (
    <main>
      <SiteHeader />
      <header className="archive-header shell">
        <p>WRITING ARCHIVE</p>
        <h1>文章归档</h1>
        <div>
          <p>从算法竞赛题解到零散技术记录，按最初发表时间保存这份持续生长的个人索引。</p>
          <span>{csdnPosts.length} 篇迁移文章</span>
        </div>
      </header>

      <section className="archive-category shell" id="algorithms">
        <div><span>ALGORITHMS</span><h2>算法竞赛</h2></div>
        <p>竞赛题解、训练记录与算法方法整理。这里收录从 CSDN 迁移的全部相关文章。</p>
        <small>{csdnPosts.length} ARTICLES</small>
      </section>

      <nav className="archive-years shell" aria-label="按年份浏览">
        {groups.map(([year, posts]) => <a href={`#year-${year}`} key={year}>{year}<small>{posts.length}</small></a>)}
      </nav>

      <div className="archive-ledger shell">
        {groups.map(([year, posts]) => (
          <section className="archive-year" id={`year-${year}`} key={year}>
            <h2>{year}</h2>
            <ol>
              {posts.map((item) => (
                <li key={item.id}>
                  <div className="archive-entry">
                    <time dateTime={item.publishedAt.slice(0, 10)}>{formatArchiveDate(item.publishedAt).slice(5)}</time>
                    <div className="archive-entry-content">
                      <span>{item.category}</span>
                      <h3><Link href={`/posts/${item.id}`}>{item.title}</Link></h3>
                      <div className="archive-summary" dangerouslySetInnerHTML={{ __html: item.summaryHtml }} />
                    </div>
                    <small>{item.readingMinutes} MIN</small>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>

      <footer className="site-footer shell">
        <div className="brand"><span className="brand-mark">C</span><span>CLESTIANA <small>/ RESEARCH JOURNAL</small></span></div>
        <p>算法竞赛与技术记录。</p>
      </footer>
    </main>
  );
}
