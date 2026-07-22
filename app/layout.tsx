import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://blog.zstuacm.xyz"),
  title: { default: "ZSTUACM Blog", template: "%s · ZSTUACM Blog" },
  description: "记录技术实践、项目复盘、算法竞赛、阅读与生活的个人博客。",
  openGraph: {
    title: "ZSTUACM Blog",
    description: "写代码，也写下代码之外的事。",
    type: "website",
    locale: "zh_CN",
    images: [{ url: "/og.svg", width: 1200, height: 630, alt: "写代码，也写下代码之外的事 · ZSTUACM Blog" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" suppressHydrationWarning><body>{children}</body></html>;
}
