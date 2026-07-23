"use client";

import { useEffect, useMemo, useState } from "react";

type Heading = { level: number; title: string; id: string };

export function ArticleNavigation({ headings }: { headings: Heading[] }) {
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState(headings.find((item) => item.level === 1)?.id ?? "");
  const items = useMemo(() => {
    if (!query.trim()) return headings.filter((item) => item.level === 1);
    const needle = query.trim().toLowerCase();
    return headings.filter((item) => item.title.toLowerCase().includes(needle)).slice(0, 24);
  }, [headings, query]);

  useEffect(() => {
    const syncSectionFromHash = () => {
      const hashId = decodeURIComponent(window.location.hash.slice(1));
      const activeIndex = headings.findIndex((item) => item.id === hashId);
      if (activeIndex === -1) return;

      let sectionIndex = activeIndex;
      while (sectionIndex > 0 && headings[sectionIndex].level !== 1) sectionIndex -= 1;
      setActiveSection(headings[sectionIndex].id);
    };

    syncSectionFromHash();
    window.addEventListener("hashchange", syncSectionFromHash);
    return () => window.removeEventListener("hashchange", syncSectionFromHash);
  }, [headings]);

  return (
    <>
      <aside className="docs-left">
        <label className="docs-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文章目录..." /><kbd>/</kbd></label>
        <p className="nav-kicker">文章索引</p>
        <nav aria-label="文章章节">
          {items.map((item) => <a className={[item.level === 2 ? "nested" : "", item.id === activeSection ? "active" : ""].filter(Boolean).join(" ")} href={`#${item.id}`} key={item.id}>{item.title}</a>)}
        </nav>
        <div className="nav-note"><span>文章维护</span><p>发现错误或想补充内容，可以直接修改源 Markdown。</p></div>
      </aside>
      <details className="docs-mobile-nav">
        <summary>浏览文章目录</summary>
        <label className="docs-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文章目录..." /></label>
        <nav aria-label="移动端文章章节">
          {items.map((item) => <a className={item.id === activeSection ? "active" : ""} href={`#${item.id}`} key={item.id}>{item.title}</a>)}
        </nav>
      </details>
    </>
  );
}

export function ArticleToc({ headings }: { headings: Heading[] }) {
  const [active, setActive] = useState(headings[0]?.id ?? "");

  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(".markdown-body h1, .markdown-body h2"));
    const syncActiveFromHash = () => {
      const hashId = decodeURIComponent(window.location.hash.slice(1));
      if (hashId && document.getElementById(hashId)) setActive(hashId);
    };
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive((visible[0].target as HTMLElement).id);
    }, { rootMargin: "-80px 0px -72% 0px" });
    elements.forEach((element) => observer.observe(element));
    syncActiveFromHash();
    window.addEventListener("hashchange", syncActiveFromHash);
    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", syncActiveFromHash);
    };
  }, []);

  const activeIndex = Math.max(0, headings.findIndex((item) => item.id === active));
  let sectionIndex = activeIndex;
  while (sectionIndex > 0 && headings[sectionIndex].level !== 1) sectionIndex -= 1;
  const nextSection = headings.findIndex((item, index) => index > sectionIndex && item.level === 1);
  const sectionItems = headings.slice(sectionIndex, nextSection === -1 ? undefined : nextSection).slice(0, 18);

  return (
    <aside className="docs-right">
      <p>本页内容</p>
      <nav aria-label="当前章节目录">
        {sectionItems.map((item) => <a className={`${item.level === 2 ? "nested" : ""} ${item.id === active ? "active" : ""}`} href={`#${item.id}`} key={item.id}>{item.title}</a>)}
      </nav>
    </aside>
  );
}
