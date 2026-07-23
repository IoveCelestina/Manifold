import { ScrollReveal } from "./components/ScrollReveal";
import { SiteHeader } from "./components/SiteHeader";
import { post } from "./lib/post";

const writingTracks = [
  ["算法竞赛", "算法模板、题目思路，以及值得反复查阅的推导。"],
  ["随手记录", "收藏阅读、灵感，以及代码之外值得留下的生活片段。"],
  ["项目复盘", "从想法、约束到落地结果，记录真实决策与走过的弯路。"],
];

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
            <a className="secondary-button" href={post.href}>阅读专题</a>
          </div>
        </div>

        <a className="cover-visual reveal reveal-delay" href={post.href} aria-label={`阅读专题：${post.title}`}>
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/research-desk.webp" width="1024" height="1280" loading="eager" alt="摊开的算法研究笔记、打印图表与电子硬件原型" />
          </figure>
        </a>
      </section>

      <section className="latest-section shell" id="latest">
        <div className="section-heading" data-scroll-reveal>
          <h2>近期归档</h2>
          <p>从一篇会持续维护的算法手册开始，逐步建立可复查的个人知识索引。</p>
        </div>
        <a className="post-row" href={post.href} data-scroll-reveal>
          <div className="post-date"><span>{post.updatedAt}</span><small>算法竞赛</small></div>
          <div className="post-main">
            <h3>{post.title}</h3>
            <p>{post.description}</p>
            <div className="post-stats"><span>C++</span><span>{post.sectionCount} 个主章节</span><span>约 {post.sizeLabel}</span></div>
          </div>
          <div className="post-arrow" aria-hidden="true">→</div>
        </a>
      </section>

      <section className="topics-section shell" id="writing">
        <div className="section-heading" data-scroll-reveal>
          <h2>研究目录</h2>
          <p>按真实工作与长期兴趣组织内容，让技术、阅读和生活保持在同一份档案里。</p>
        </div>
        <div className="topic-ledger">
          {writingTracks.map(([name, desc]) => (
            <a className="topic-entry" href="#latest" key={name} data-scroll-reveal>
              <h3>{name}</h3><p>{desc}</p>
            </a>
          ))}
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
