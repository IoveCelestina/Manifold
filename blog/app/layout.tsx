import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://blog.zstuacm.xyz"),
  title: { default: "Clestiana Blog", template: "%s · Clestiana Blog" },
  description: "记录技术实践、项目复盘、算法竞赛、阅读与生活的个人博客。",
  openGraph: {
    title: "Clestiana Blog",
    description: "写代码，也写下代码之外的事。",
    type: "website",
    locale: "zh_CN",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "写代码，也写下代码之外的事 · Clestiana Blog" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" suppressHydrationWarning><body>{children}</body></html>;
}
