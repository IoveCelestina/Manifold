import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://blog.zstuacm.xyz"),
  title: { default: "ZSTU ACM Notes", template: "%s · ZSTU ACM Notes" },
  description: "算法竞赛笔记、代码模板与解题方法的长期知识库。",
  openGraph: {
    title: "ZSTU ACM Notes",
    description: "把复杂算法，整理成随时可用的板子。",
    type: "website",
    locale: "zh_CN",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "算法竞赛板子 · ZSTU ACM Notes" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN" suppressHydrationWarning><body>{children}</body></html>;
}
