import Link from "next/link";
import { ScrollReveal } from "./components/ScrollReveal";
import { SiteHeader } from "./components/SiteHeader";
import { post } from "./lib/post";

const writingTracks = [
  ["技术札记", "工程实践、工具折腾，以及值得留下来的技术细节。", "CODE"],
  ["项目复盘", "记录从想法到落地的过程，也诚实面对走过的弯路。", "BUILD"],
  ["算法竞赛", "算法模板、题目思路与那些需要反复翻阅的结论。", "ACM"],
  ["随手记录", "阅读、灵感、生活片段，以及代码之外的事情。", "LIFE"],
];

export default function Home() {
  return (
    <main>
      <SiteHeader />
      <ScrollReveal />
      <section className="hero shell personal-hero">
        <div className="hero-copy reveal">
          <p className="eyebrow"><span className="status-dot" /> PERSONAL BLOG</p>
          <h1>写代码，也写下<br /><span>代码之外的事。</span></h1>
          <p className="hero-lede">
            这里是我的个人博客。记录技术实践、项目复盘和算法竞赛，
            也收藏阅读、灵感与日常生活中那些值得记住的片段。
          </p>
          <div className="hero-actions">
            <a className="primary-button" href="#latest">看看最近文章 <span>↓</span></a>
            <a className="secondary-button" href="#about">关于这里 <span>→</span></a>
          </div>
          <div className="hero-meta">
            <span>技术</span><span>·</span><span>项目</span><span>·</span><span>算法</span><span>·</span><span>阅读</span><span>·</span><span>生活</span>
          </div>
        </div>

        <div className="code-window note-window reveal reveal-delay" aria-label="个人博客内容预览">
          <div className="window-bar">
            <div className="traffic-lights"><i /><i /><i /></div>
            <span>now.md</span>
            <span className="window-state">● writing</span>
          </div>
          <div className="note-paper">
            <p className="note-date">2026 / NOTES</p>
            <h2>正在记录</h2>
            <div className="note-line"><span>01</span><p>把做过的事情讲清楚。</p></div>
            <div className="note-line"><span>02</span><p>保留那些值得反复回看的想法。</p></div>
            <div className="note-line"><span>03</span><p>在持续学习里，建立自己的坐标。</p></div>
            <div className="note-tags"><span># code</span><span># build</span><span># acm</span><span># life</span></div>
          </div>
          <div className="window-footer"><span>随时更新</span><span>UTF-8&nbsp;&nbsp; Markdown</span></div>
        </div>
      </section>

      <section className="latest-section shell" id="latest">
        <div className="section-heading" data-scroll-reveal>
          <div><p className="eyebrow">LATEST POST</p><h2>最近写了什么</h2></div>
          <p>从一篇会反复维护的长文开始，之后这里会慢慢长出更多内容。</p>
        </div>
        <Link className="post-card" href={post.href} data-scroll-reveal>
          <div className="post-number">01</div>
          <div className="post-main">
            <div className="post-tags"><span>ALGORITHM</span><span>C++</span><span>长期维护</span></div>
            <h3>{post.title}</h3>
            <p>{post.description}</p>
            <div className="post-stats"><span>{post.updatedAt}</span><span>{post.sectionCount} 个主章节</span><span>约 {post.sizeLabel}</span></div>
          </div>
          <div className="post-arrow" aria-hidden="true">↗</div>
        </Link>
      </section>

      <section className="topics-section shell" id="writing">
        <div className="section-heading" data-scroll-reveal>
          <div><p className="eyebrow">WHAT I WRITE</p><h2>写作方向</h2></div>
          <p>不预设唯一主题，只持续记录真正做过、想过和感受到的事情。</p>
        </div>
        <div className="topic-grid writing-grid">
          {writingTracks.map(([name, desc, label], index) => (
            <div className="topic-card writing-card" data-scroll-reveal key={name}>
              <span>0{index + 1}</span><div><small>{label}</small><h3>{name}</h3><p>{desc}</p></div><b>⌁</b>
            </div>
          ))}
        </div>
      </section>

      <section className="about-section shell" id="about">
        <p className="eyebrow" data-scroll-reveal>ABOUT THIS PLACE</p>
        <div data-scroll-reveal>
          <h2>一个用来沉淀，而不是追赶的地方。</h2>
          <p>这里不会只放算法竞赛内容。它更像一张不断展开的个人地图：技术是坐标之一，项目、阅读和生活同样重要。</p>
        </div>
      </section>

      <footer className="site-footer shell">
        <div className="brand"><span className="brand-mark">Z</span><span>ZSTUACM <small>/ BLOG</small></span></div>
        <p>记录学习、构建与生活。</p>
      </footer>
    </main>
  );
}
