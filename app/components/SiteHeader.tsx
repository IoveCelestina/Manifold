import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="header-inner shell">
        <Link className="brand" href="/" aria-label="ZSTU ACM Notes 首页">
          <span className="brand-mark">Z</span><span>ZSTU ACM <small>/ NOTES</small></span>
        </Link>
        <nav aria-label="主导航"><Link href="/">首页</Link><Link href="/#latest">文章</Link><Link href="/#topics">专题</Link></nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
