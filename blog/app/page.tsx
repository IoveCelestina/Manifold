import { ScrollReveal } from "./components/ScrollReveal";
import { SiteHeader } from "./components/SiteHeader";
import { formatPublicationDate } from "./lib/csdn-posts";
import { featuredPost, journalSections, latestPosts } from "./lib/journal-posts";

export default function Home() {
  return (
    <main>
      <SiteHeader />
      <ScrollReveal />

      <section className="hero shell">
        <div className="hero-copy reveal">
          <p className="hero-kicker">CLST RESEARCH JOURNAL</p>
          <h1>写代码，也写下<span>代码之外的事。</span></h1>
          <p className="hero-lede">这里是我的个人博客，也是一份关于技术实践、项目复盘、算法竞赛与阅读生活的私人研究档案。</p>
          <div className="hero-actions">
            <a className="primary-button" href="#latest">进入档案</a>
            <a className="secondary-button" href={featuredPost.href}>阅读专题</a>
          </div>
        </div>

        <a className="cover-visual reveal reveal-delay" href={featuredPost.href} aria-label={`阅读专题：${featuredPost.title}`}>
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/research-desk.webp" width="1024" height="1280" loading="eager" alt="摊开的算法研究笔记、打印图表与电子硬件原型" />
          </figure>
        </a>
      </section>

      <section className="featured-section shell" id="featured">
        <div className="editorial-heading" data-scroll-reveal>
          <div>
            <p>FEATURED ARTICLE</p>
            <h2>精选文章</h2>
          </div>
          <p>最近更新的一篇文章，来自持续整理中的个人技术档案。</p>
        </div>
        <a className="index-entry" href={featuredPost.href} data-scroll-reveal>
          <span className="entry-number">01</span>
          <div className="entry-content">
            <span className="entry-category">{featuredPost.category}</span>
            <h3>{featuredPost.title}</h3>
            {featuredPost.summaryHtml
              ? <div className="entry-summary" dangerouslySetInnerHTML={{ __html: featuredPost.summaryHtml }} />
              : <div className="entry-summary"><p>{featuredPost.description}</p></div>}
          </div>
          <time dateTime={featuredPost.publishedAt.slice(0, 10)}>{formatPublicationDate(featuredPost.publishedAt)}</time>
        </a>
      </section>

      <section className="latest-section shell" id="latest">
        <div className="editorial-heading" data-scroll-reveal>
          <div>
            <p>LATEST NOTES</p>
            <h2>最新笔记</h2>
          </div>
          <p>按发表时间自动更新，收录近期写下的题解、实践与零散记录。</p>
        </div>
        <div className="index-list">
          {latestPosts.map((item, index) => (
            <a className="index-entry" href={item.href} key={item.id} data-scroll-reveal>
              <span className="entry-number">{String(index + 1).padStart(2, "0")}</span>
                <div className="entry-content">
                  <span className="entry-category">{item.category}</span>
                  <h3>{item.title}</h3>
                  {item.summaryHtml
                    ? <div className="entry-summary" dangerouslySetInnerHTML={{ __html: item.summaryHtml }} />
                    : <div className="entry-summary"><p>{item.description}</p></div>}
                </div>
              <time dateTime={item.publishedAt.slice(0, 10)}>{formatPublicationDate(item.publishedAt)}</time>
            </a>
          ))}
        </div>
      </section>

      <section className="topics-section shell" id="writing">
        <div className="editorial-heading" data-scroll-reveal>
          <div>
            <p>PUBLICATION SECTIONS</p>
            <h2>刊物栏目</h2>
          </div>
          <p>三个长期写作方向，构成这份个人技术刊物的内容索引。</p>
        </div>
        <div className="publication-index">
          {journalSections.map((section) => {
            const content = (
              <>
                <span>{section.id}</span>
                <h3>{section.name}</h3>
                <p>{`${section.count} ARTICLES / ${section.description}`}</p>
              </>
            );
            return section.href
              ? <a className="publication-track" href={section.href} key={section.id} data-scroll-reveal>{content}</a>
              : <div className="publication-track publication-track-static" key={section.id} data-scroll-reveal>{content}</div>;
          })}
        </div>
      </section>

      <section className="about-section shell" id="about">
        <div data-scroll-reveal>
          <h2>一个用来沉淀，而不是追赶的地方。</h2>
          <p>这里不会只放算法竞赛内容。它更像一张不断展开的个人地图：技术是坐标之一，项目、阅读和生活同样重要。</p>
        </div>
      </section>

      <footer className="site-footer shell">
        <div className="brand"><span className="brand-mark">C</span><span>CLESTIANA <small>/ RESEARCH JOURNAL</small></span></div>
        <p>私人研究档案，持续整理中。</p>
      </footer>
    </main>
  );
}
