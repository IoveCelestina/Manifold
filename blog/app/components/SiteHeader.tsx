import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="header-inner shell">
        <Link className="brand" href="/" aria-label="Clestiana Blog 首页">
          <span className="brand-mark">C</span><span>CLESTIANA <small>/ BLOG</small></span>
        </Link>
        <nav aria-label="主导航"><Link href="/">首页</Link><Link href="/#latest">文章</Link><Link href="/#writing">分类</Link><Link href="/#about">关于</Link></nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
