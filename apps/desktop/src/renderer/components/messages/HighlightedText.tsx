import type { ReactNode } from "react";

import { escapeRegExp, renderMarkedSnippet } from "./textRendering";

export function HighlightedText({
  text,
  query,
  allowMarks,
}: {
  text: string;
  query: string;
  allowMarks: boolean;
}) {
  if (allowMarks) {
    return <>{renderMarkedSnippet(text)}</>;
  }

  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return <pre>{text}</pre>;
  }

  const parts = text.split(new RegExp(`(${escapeRegExp(normalizedQuery)})`, "ig"));
  const content: ReactNode[] = [];
  let cursor = 0;
  for (const [position, part] of parts.entries()) {
    const key = `${cursor}:${part.length}:${position % 2 === 1 ? "m" : "t"}`;
    if (position % 2 === 1) {
      content.push(<mark key={key}>{part}</mark>);
    } else {
      content.push(<span key={key}>{part}</span>);
    }
    cursor += part.length;
  }

  return <pre>{content}</pre>;
}
