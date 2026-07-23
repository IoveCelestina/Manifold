"use client";

import articleHtml from "../../content/algorithm-templates.generated.html?raw";

export function ArticleBody() {
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: articleHtml }} />;
}
