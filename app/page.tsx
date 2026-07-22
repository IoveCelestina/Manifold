import Link from "next/link";
import { SiteHeader } from "./components/SiteHeader";
import { post } from "./lib/post";

const topicGroups = [
  ["STL", "容器、算法与常用工具"],
  ["数据结构", "并查集、树状数组、线段树"],
  ["图论", "最短路、网络流、连通性"],
  ["数学", "数论、组合、矩阵与多项式"],
  ["动态规划", "背包、区间与数位 DP"],
  ["计算几何", "点线圆、凸包与坐标变换"],
];

export default function Home() {
  return (
    <main>
      <SiteHeader />
      <section className="hero shell">
        <div className="hero-copy reveal">
          <p className="eyebrow"><span className="status-dot" /> NOTES / 01</p>
          <h1>把复杂算法，整理成<br /><span>随时可用的板子。</span></h1>
          <p className="hero-lede">
            一份持续维护的算法竞赛知识库。少一点翻找，多一点思考；
            从 STL 到计算几何，代码和结论放在真正需要它们的位置。
          </p>
          <div className="hero-actions">
            <Link className="primary-button" href={post.href}>开始阅读 <span>→</span></Link>
            <a className="secondary-button" href="#topics">浏览目录 <span>↓</span></a>
          </div>
          <div className="hero-meta">
            <span>01 篇长文</span><span>·</span><span>{post.sectionCount} 个章节</span><span>·</span><span>Markdown 驱动</span>
          </div>
        </div>

        <div className="code-window reveal reveal-delay" aria-label="算法代码预览">
          <div className="window-bar">
            <div className="traffic-lights"><i /><i /><i /></div>
            <span>template.cpp</span>
            <span className="window-state">● ready</span>
          </div>
          <div className="window-tabs"><span className="active">最短路</span><span>数据结构</span><span>数学</span></div>
          <pre className="hero-code"><code><span className="code-muted">// Dijkstra · O((n + m) log n)</span>{"\n"}<span className="code-keyword">while</span> (!q.empty()) {"{"}{"\n"}  <span className="code-keyword">auto</span> [d, u] = q.top();{"\n"}  q.pop();{"\n"}  <span className="code-keyword">if</span> (vis[u]) <span className="code-keyword">continue</span>;{"\n"}  vis[u] = <span className="code-number">true</span>;{"\n"}  <span className="code-muted">// relax every outgoing edge</span>{"\n"}{"}"}</code></pre>
          <div className="window-footer"><span>Ln 42, Col 18</span><span>C++20&nbsp;&nbsp; UTF-8</span></div>
        </div>
      </section>

      <section className="latest-section shell" id="latest">
        <div className="section-heading">
          <div><p className="eyebrow">LATEST NOTE</p><h2>最近更新</h2></div>
          <p>先挂一篇真正会反复翻阅的文章。</p>
        </div>
        <Link className="post-card" href={post.href}>
          <div className="post-number">01</div>
          <div className="post-main">
            <div className="post-tags"><span>ALGORITHM</span><span>C++</span><span>长期维护</span></div>
            <h3>{post.title}</h3>
            <p>{post.description}</p>
            <div className="post-stats"><span>{post.updatedAt}</span><span>{post.sectionCount} 个章节</span><span>约 {post.sizeLabel}</span></div>
          </div>
          <div className="post-arrow" aria-hidden="true">↗</div>
        </Link>
      </section>

      <section className="topics-section shell" id="topics">
        <div className="section-heading">
          <div><p className="eyebrow">INDEX</p><h2>文章涵盖</h2></div>
          <p>从常用语法到复杂模型，按问题类型快速定位。</p>
        </div>
        <div className="topic-grid">
          {topicGroups.map(([name, desc], index) => (
            <Link className="topic-card" href={`${post.href}#${name.toLowerCase()}`} key={name}>
              <span>0{index + 1}</span><div><h3>{name}</h3><p>{desc}</p></div><b>→</b>
            </Link>
          ))}
        </div>
      </section>

      <footer className="site-footer shell">
        <div className="brand"><span className="brand-mark">Z</span><span>ZSTU ACM <small>/ NOTES</small></span></div>
        <p>Built for thinking clearly.</p>
      </footer>
    </main>
  );
}
