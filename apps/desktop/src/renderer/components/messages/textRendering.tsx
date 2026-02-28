import type { ReactNode } from "react";

import { tryParseJsonRecord } from "./toolParsing";

export function renderRichText(value: string, query: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const codeFence = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match = codeFence.exec(value);

  while (match) {
    const blockStart = match.index;
    if (blockStart > cursor) {
      const textChunk = value.slice(cursor, blockStart);
      nodes.push(renderTextChunk(textChunk, query, `${keyPrefix}:${cursor}:t`));
    }

    const language = match[1] ?? "";
    const codeValue = match[2] ?? "";
    nodes.push(
      <CodeBlock key={`${keyPrefix}:${blockStart}:c`} language={language} codeValue={codeValue} />,
    );

    cursor = blockStart + match[0].length;
    match = codeFence.exec(value);
  }

  if (cursor < value.length) {
    nodes.push(renderTextChunk(value.slice(cursor), query, `${keyPrefix}:${cursor}:tail`));
  }

  if (nodes.length === 0) {
    nodes.push(renderTextChunk(value, query, `${keyPrefix}:only`));
  }
  return nodes;
}

export function renderPlainText(value: string, query: string, keyPrefix: string): ReactNode[] {
  const lines = value.split(/\r?\n/);
  const items: ReactNode[] = [];
  for (const [index, line] of lines.entries()) {
    const key = `${keyPrefix}:${index}:${line.length}`;
    if (line.trim().length === 0) {
      items.push(<div key={`${key}:empty`} className="md-empty" />);
      continue;
    }
    items.push(
      <p key={`${key}:p`} className="md-p">
        {buildHighlightedTextNodes(line, query, `${key}:txt`)}
      </p>,
    );
  }
  return items;
}

export function looksLikeMarkdown(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.includes("```")) {
    return true;
  }
  if (/^\s{0,3}(#{1,6}|[-*+]\s+|\d+\.\s+|>\s+)/m.test(value)) {
    return true;
  }
  if (/\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\)/.test(value)) {
    return true;
  }
  return /(^|[^\\])(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_)/m.test(value);
}

function renderTextChunk(value: string, query: string, keyPrefix: string): ReactNode {
  const lines = value.split(/\r?\n/);
  const items: ReactNode[] = [];
  let lineCursor = 0;
  let listRoots: MarkdownList[] = [];
  const listStack: MarkdownListFrame[] = [];

  const flushLists = () => {
    if (listRoots.length === 0) {
      return;
    }

    for (const list of listRoots) {
      items.push(renderMarkdownList(list, query, keyPrefix));
    }
    listRoots = [];
    listStack.length = 0;
  };

  for (const line of lines) {
    const currentKey = `${lineCursor}`;
    lineCursor += line.length + 1;
    const listToken = parseMarkdownListToken(line, currentKey, listStack.length > 0);
    if (listToken) {
      appendMarkdownListToken(listToken, listRoots, listStack);
      continue;
    }

    if (line.trim().length === 0) {
      if (listStack.length > 0) {
        continue;
      }
      items.push(<div key={`${keyPrefix}:${currentKey}:empty`} className="md-empty" />);
      continue;
    }
    flushLists();

    const headingMatch = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const marks = headingMatch[1] ?? "";
      const level = marks.length;
      const text = headingMatch[2] ?? "";
      if (level === 1) {
        items.push(
          <h3 key={`${keyPrefix}:${currentKey}:h1`} className="md-h1">
            {renderInlineText(text, query, `${keyPrefix}:${currentKey}:h1`)}
          </h3>,
        );
      } else if (level === 2) {
        items.push(
          <h4 key={`${keyPrefix}:${currentKey}:h2`} className="md-h2">
            {renderInlineText(text, query, `${keyPrefix}:${currentKey}:h2`)}
          </h4>,
        );
      } else {
        items.push(
          <h5 key={`${keyPrefix}:${currentKey}:h3`} className="md-h3">
            {renderInlineText(text, query, `${keyPrefix}:${currentKey}:h3`)}
          </h5>,
        );
      }
      continue;
    }

    const quoteMatch = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (quoteMatch) {
      items.push(
        <blockquote key={`${keyPrefix}:${currentKey}:q`} className="md-quote">
          <p className="md-p">
            {renderInlineText(quoteMatch[1] ?? "", query, `${keyPrefix}:${currentKey}:q`)}
          </p>
        </blockquote>,
      );
      continue;
    }

    items.push(
      <p key={`${keyPrefix}:${currentKey}:p`} className="md-p">
        {renderInlineText(line, query, `${keyPrefix}:${currentKey}:p`)}
      </p>,
    );
  }

  flushLists();

  return <div key={`${keyPrefix}:chunk`}>{items}</div>;
}

type MarkdownListKind = "ul" | "ol";

type MarkdownListToken = {
  key: string;
  kind: MarkdownListKind;
  indent: number;
  content: string;
};

type MarkdownListItem = {
  key: string;
  content: string;
  children: MarkdownList[];
};

type MarkdownList = {
  key: string;
  kind: MarkdownListKind;
  indent: number;
  items: MarkdownListItem[];
};

type MarkdownListFrame = {
  list: MarkdownList;
  parentItem: MarkdownListItem | null;
};

function parseMarkdownListToken(
  line: string,
  key: string,
  hasActiveList: boolean,
): MarkdownListToken | null {
  const normalized = line.replace(/\t/g, "  ");

  const unorderedMatch = /^(\s*)[-*+•]\s+(.*)$/.exec(normalized);
  if (unorderedMatch) {
    const indent = (unorderedMatch[1] ?? "").length;
    if (indent <= 3 || hasActiveList) {
      return {
        key,
        kind: "ul",
        indent,
        content: unorderedMatch[2] ?? "",
      };
    }
  }

  const orderedMatch = /^(\s*)\d+\.\s+(.*)$/.exec(normalized);
  if (orderedMatch) {
    const indent = (orderedMatch[1] ?? "").length;
    if (indent <= 3 || hasActiveList) {
      return {
        key,
        kind: "ol",
        indent,
        content: orderedMatch[2] ?? "",
      };
    }
  }

  return null;
}

function appendMarkdownListToken(
  token: MarkdownListToken,
  roots: MarkdownList[],
  stack: MarkdownListFrame[],
): void {
  let current = token;

  while (stack.length > 0 && current.indent < (stack[stack.length - 1]?.list.indent ?? 0)) {
    stack.pop();
  }

  let frame = stack[stack.length - 1];

  if (!frame) {
    frame = pushMarkdownListFrame(current, null, roots, stack);
  } else if (current.indent > frame.list.indent) {
    const parentItem = frame.list.items[frame.list.items.length - 1] ?? null;
    if (parentItem) {
      frame = pushMarkdownListFrame(current, parentItem, roots, stack);
    } else {
      current = { ...current, indent: frame.list.indent };
      if (current.kind !== frame.list.kind) {
        stack.pop();
        frame = pushMarkdownListFrame(current, frame.parentItem, roots, stack);
      }
    }
  } else if (current.indent === frame.list.indent && current.kind !== frame.list.kind) {
    stack.pop();
    frame = pushMarkdownListFrame(current, frame.parentItem, roots, stack);
  }

  const item: MarkdownListItem = {
    key: current.key,
    content: current.content.trim(),
    children: [],
  };
  frame.list.items.push(item);
}

function pushMarkdownListFrame(
  token: MarkdownListToken,
  parentItem: MarkdownListItem | null,
  roots: MarkdownList[],
  stack: MarkdownListFrame[],
): MarkdownListFrame {
  const list: MarkdownList = {
    key: `${token.key}:${token.kind}:${token.indent}`,
    kind: token.kind,
    indent: token.indent,
    items: [],
  };
  if (parentItem) {
    parentItem.children.push(list);
  } else {
    roots.push(list);
  }

  const frame: MarkdownListFrame = { list, parentItem };
  stack.push(frame);
  return frame;
}

function renderMarkdownList(list: MarkdownList, query: string, keyPrefix: string): ReactNode {
  const renderedItems = list.items.map((item) => (
    <li key={item.key}>
      {renderInlineText(item.content, query, `${keyPrefix}:${item.key}`)}
      {item.children.map((child, index) =>
        renderMarkdownList(child, query, `${keyPrefix}:${item.key}:child:${index}`),
      )}
    </li>
  ));

  if (list.kind === "ol") {
    return (
      <ol key={`${keyPrefix}:${list.key}:olist`} className="md-list md-list-ordered">
        {renderedItems}
      </ol>
    );
  }

  return (
    <ul key={`${keyPrefix}:${list.key}:ulist`} className="md-list">
      {renderedItems}
    </ul>
  );
}

function renderInlineText(value: string, query: string, keyPrefix: string): ReactNode[] {
  const tokens = value.split(/(`[^`]+`)/g);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const key = `${keyPrefix}:${cursor}`;
    if (token.startsWith("`") && token.endsWith("`") && token.length >= 2) {
      nodes.push(<code key={`${key}:code`}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(...renderFormattedInlineText(token, query, `${key}:txt`));
    }
    cursor += token.length;
  }
  return nodes;
}

function renderFormattedInlineText(value: string, query: string, keyPrefix: string): ReactNode[] {
  const pattern =
    /(\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_)/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(pattern)) {
    const token = match[0] ?? "";
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push(
        ...buildHighlightedTextNodes(value.slice(cursor, index), query, `${keyPrefix}:${cursor}:t`),
      );
    }

    const linkLabel = match[2];
    const linkHref = match[3];
    if (linkLabel && linkHref) {
      const parsedHref = parseMarkdownHref(linkHref);
      if (parsedHref.kind === "external") {
        nodes.push(
          <a
            key={`${keyPrefix}:${index}:a`}
            className="md-link"
            href={parsedHref.href}
            target="_blank"
            rel="noreferrer"
          >
            {buildHighlightedTextNodes(linkLabel, query, `${keyPrefix}:${index}:a:txt`)}
          </a>,
        );
      } else if (parsedHref.kind === "local") {
        nodes.push(
          <button
            key={`${keyPrefix}:${index}:local`}
            type="button"
            className="md-link md-link-local"
            onClick={() => {
              void openLocalPath(parsedHref.path);
            }}
          >
            {buildHighlightedTextNodes(linkLabel, query, `${keyPrefix}:${index}:local:txt`)}
          </button>,
        );
      } else {
        nodes.push(...buildHighlightedTextNodes(token, query, `${keyPrefix}:${index}:unsafe-link`));
      }
      cursor = index + token.length;
      continue;
    }

    const bold = match[4] ?? match[5];
    if (bold) {
      nodes.push(
        <strong key={`${keyPrefix}:${index}:b`}>
          {buildHighlightedTextNodes(bold, query, `${keyPrefix}:${index}:b:txt`)}
        </strong>,
      );
      cursor = index + token.length;
      continue;
    }

    const italic = match[6] ?? match[7];
    if (italic) {
      nodes.push(
        <em key={`${keyPrefix}:${index}:i`}>
          {buildHighlightedTextNodes(italic, query, `${keyPrefix}:${index}:i:txt`)}
        </em>,
      );
      cursor = index + token.length;
      continue;
    }

    nodes.push(...buildHighlightedTextNodes(token, query, `${keyPrefix}:${index}:raw`));
    cursor = index + token.length;
  }

  if (cursor < value.length) {
    nodes.push(
      ...buildHighlightedTextNodes(value.slice(cursor), query, `${keyPrefix}:${cursor}:tail`),
    );
  }
  if (nodes.length === 0) {
    nodes.push(...buildHighlightedTextNodes(value, query, `${keyPrefix}:all`));
  }
  return nodes;
}

function parseMarkdownHref(
  href: string,
): { kind: "external"; href: string } | { kind: "local"; path: string } | { kind: "invalid" } {
  const normalized = href.trim();
  if (normalized.length === 0) {
    return { kind: "invalid" };
  }

  if (
    normalized.startsWith("https://") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("mailto:")
  ) {
    return { kind: "external", href: normalized };
  }

  const localPath = toLocalPath(normalized);
  if (localPath) {
    return { kind: "local", path: localPath };
  }
  return { kind: "invalid" };
}

function toLocalPath(href: string): string | null {
  let value = href.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep undecoded input.
  }

  if (value.startsWith("file://")) {
    value = value.slice("file://".length);
    if (value.startsWith("localhost/")) {
      value = value.slice("localhost".length);
    }
  }

  const hashIndex = value.indexOf("#");
  if (hashIndex >= 0) {
    value = value.slice(0, hashIndex);
  }
  value = value.trim();
  if (value.length === 0) {
    return null;
  }

  const isUnixAbsolute = value.startsWith("/");
  const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(value);
  if (!isUnixAbsolute && !isWindowsAbsolute) {
    return null;
  }

  return stripLineColumnSuffix(value);
}

function stripLineColumnSuffix(pathValue: string): string {
  const suffixMatch = /^(.*\.[A-Za-z0-9_-]+)(?::\d+(?::\d+)?)$/.exec(pathValue);
  if (!suffixMatch) {
    return pathValue;
  }
  return suffixMatch[1] ?? pathValue;
}

async function openLocalPath(path: string): Promise<void> {
  try {
    await window.codetrail.invoke("path:openInFileManager", { path });
  } catch (error) {
    console.error("[codetrail] failed opening local markdown link", path, error);
  }
}

export function CodeBlock({
  language,
  codeValue,
}: {
  language: string;
  codeValue: string;
}) {
  const normalizedLanguage = language.trim().toLowerCase();
  if (isLikelyDiff(normalizedLanguage, codeValue)) {
    return <DiffBlock codeValue={codeValue} />;
  }

  const lines = codeValue.split(/\r?\n/);
  const renderedLines = lines.map((line, index) => (
    <span key={`${index}:${line.length}`} className="code-line">
      {renderSyntaxHighlightedLine(line, normalizedLanguage)}
      {"\n"}
    </span>
  ));

  return (
    <div className="code-block">
      <div className="code-meta">{normalizedLanguage || "code"}</div>
      <pre className="code-pre">{renderedLines}</pre>
    </div>
  );
}

export function DiffBlock({ codeValue }: { codeValue: string }) {
  const lines = codeValue.split(/\r?\n/);
  const rows: ReactNode[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const lineKey = `${index}:${line.length}`;
    if (line.startsWith("@@")) {
      const hunkStart = parseDiffHunkStart(line);
      if (hunkStart) {
        oldLineNumber = hunkStart.oldLine;
        newLineNumber = hunkStart.newLine;
      }
      rows.push(
        <div key={`${lineKey}:meta`} className="diff-row diff-meta">
          <span className="diff-ln old"> </span>
          <span className="diff-ln new"> </span>
          <span className="diff-code">{line}</span>
        </div>,
      );
      index += 1;
      continue;
    }

    if (isRemovedDiffLine(line) && isAddedDiffLine(lines[index + 1] ?? "")) {
      const nextLine = lines[index + 1] ?? "";
      const inlineDiff = diffInlineSegments(line.slice(1), nextLine.slice(1));
      rows.push(
        <div key={`${lineKey}:remove`} className="diff-row diff-remove">
          <span className="diff-ln old">{oldLineNumber}</span>
          <span className="diff-ln new"> </span>
          <span className="diff-code">
            {(() => {
              let leftCursor = 0;
              return inlineDiff.left.map((part) => {
                const key = `${lineKey}:l:${leftCursor}:${part.changed ? "1" : "0"}`;
                leftCursor += part.text.length;
                return (
                  <span key={key} className={part.changed ? "diff-word-remove" : undefined}>
                    {part.text}
                  </span>
                );
              });
            })()}
          </span>
        </div>,
      );
      rows.push(
        <div key={`${lineKey}:add`} className="diff-row diff-add">
          <span className="diff-ln old"> </span>
          <span className="diff-ln new">{newLineNumber}</span>
          <span className="diff-code">
            {(() => {
              let rightCursor = 0;
              return inlineDiff.right.map((part) => {
                const key = `${lineKey}:r:${rightCursor}:${part.changed ? "1" : "0"}`;
                rightCursor += part.text.length;
                return (
                  <span key={key} className={part.changed ? "diff-word-add" : undefined}>
                    {part.text}
                  </span>
                );
              });
            })()}
          </span>
        </div>,
      );
      oldLineNumber += 1;
      newLineNumber += 1;
      index += 2;
      continue;
    }

    if (isAddedDiffLine(line)) {
      rows.push(
        <div key={`${lineKey}:add-only`} className="diff-row diff-add">
          <span className="diff-ln old"> </span>
          <span className="diff-ln new">{newLineNumber}</span>
          <span className="diff-code">{line.slice(1)}</span>
        </div>,
      );
      newLineNumber += 1;
    } else if (isRemovedDiffLine(line)) {
      rows.push(
        <div key={`${lineKey}:remove-only`} className="diff-row diff-remove">
          <span className="diff-ln old">{oldLineNumber}</span>
          <span className="diff-ln new"> </span>
          <span className="diff-code">{line.slice(1)}</span>
        </div>,
      );
      oldLineNumber += 1;
    } else if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      rows.push(
        <div key={`${lineKey}:meta`} className="diff-row diff-meta">
          <span className="diff-ln old"> </span>
          <span className="diff-ln new"> </span>
          <span className="diff-code">{line}</span>
        </div>,
      );
    } else {
      rows.push(
        <div key={`${lineKey}:context`} className="diff-row diff-context">
          <span className="diff-ln old">{oldLineNumber}</span>
          <span className="diff-ln new">{newLineNumber}</span>
          <span className="diff-code">{line.startsWith(" ") ? line.slice(1) : line}</span>
        </div>,
      );
      oldLineNumber += 1;
      newLineNumber += 1;
    }
    index += 1;
  }

  return (
    <div className="code-block diff-block">
      <div className="code-meta">diff</div>
      <div className="diff-table">{rows}</div>
    </div>
  );
}

function renderSyntaxHighlightedLine(line: string, language: string): ReactNode[] {
  const tokens = tokenizeCodeLine(line, language);
  return tokens.map((token, index) =>
    token.kind === "plain" ? (
      <span key={`${index}:${token.text.length}`}>{token.text}</span>
    ) : (
      <span key={`${index}:${token.text.length}`} className={`tok-${token.kind}`}>
        {token.text}
      </span>
    ),
  );
}

function tokenizeCodeLine(
  line: string,
  language: string,
): Array<{ text: string; kind: "plain" | "keyword" | "string" | "number" | "comment" }> {
  const keywordSet = languageKeywords(language);
  const pattern =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/.*$|#.*$|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  const tokens: Array<{
    text: string;
    kind: "plain" | "keyword" | "string" | "number" | "comment";
  }> = [];
  let cursor = 0;
  for (const match of line.matchAll(pattern)) {
    const value = match[0] ?? "";
    const index = match.index ?? 0;
    if (index > cursor) {
      tokens.push({ text: line.slice(cursor, index), kind: "plain" });
    }
    if (value.startsWith("//") || value.startsWith("#")) {
      tokens.push({ text: value, kind: "comment" });
    } else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith("`") && value.endsWith("`"))
    ) {
      tokens.push({ text: value, kind: "string" });
    } else if (/^\d/.test(value)) {
      tokens.push({ text: value, kind: "number" });
    } else if (keywordSet.has(language === "sql" ? value.toUpperCase() : value)) {
      tokens.push({ text: value, kind: "keyword" });
    } else {
      tokens.push({ text: value, kind: "plain" });
    }
    cursor = index + value.length;
  }

  if (cursor < line.length) {
    tokens.push({ text: line.slice(cursor), kind: "plain" });
  }
  if (tokens.length === 0) {
    tokens.push({ text: line, kind: "plain" });
  }
  return tokens;
}

function languageKeywords(language: string): Set<string> {
  if (
    language === "js" ||
    language === "jsx" ||
    language === "ts" ||
    language === "tsx" ||
    language === "javascript" ||
    language === "typescript"
  ) {
    return new Set([
      "const",
      "let",
      "var",
      "function",
      "return",
      "if",
      "else",
      "for",
      "while",
      "switch",
      "case",
      "break",
      "continue",
      "class",
      "extends",
      "new",
      "import",
      "from",
      "export",
      "default",
      "async",
      "await",
      "try",
      "catch",
      "finally",
      "throw",
      "type",
      "interface",
    ]);
  }
  if (language === "py" || language === "python") {
    return new Set([
      "def",
      "class",
      "if",
      "elif",
      "else",
      "for",
      "while",
      "return",
      "import",
      "from",
      "as",
      "try",
      "except",
      "finally",
      "with",
      "lambda",
      "pass",
      "raise",
      "yield",
      "async",
      "await",
    ]);
  }
  if (language === "sql") {
    return new Set([
      "SELECT",
      "FROM",
      "WHERE",
      "JOIN",
      "LEFT",
      "RIGHT",
      "INNER",
      "OUTER",
      "ON",
      "GROUP",
      "BY",
      "ORDER",
      "LIMIT",
      "OFFSET",
      "INSERT",
      "UPDATE",
      "DELETE",
      "INTO",
      "VALUES",
      "AND",
      "OR",
      "NOT",
      "AS",
    ]);
  }
  if (language === "json") {
    return new Set(["true", "false", "null"]);
  }
  if (language === "bash" || language === "sh" || language === "zsh" || language === "shell") {
    return new Set(["if", "then", "else", "fi", "for", "in", "do", "done", "case", "esac"]);
  }
  return new Set();
}

export function detectLanguageFromContent(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "text";
  }
  if (isLikelyDiff("", value)) {
    return "diff";
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = tryParseJsonRecord(value);
    if (parsed || trimmed.startsWith("[")) {
      return "json";
    }
  }
  if (trimmed.includes("<html") || trimmed.includes("</")) {
    return "html";
  }
  return "text";
}

export function detectLanguageFromFilePath(path: string | null): string {
  if (!path) {
    return "text";
  }
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".ts") || normalized.endsWith(".tsx")) {
    return "typescript";
  }
  if (normalized.endsWith(".js") || normalized.endsWith(".jsx")) {
    return "javascript";
  }
  if (normalized.endsWith(".py")) {
    return "python";
  }
  if (normalized.endsWith(".json")) {
    return "json";
  }
  if (normalized.endsWith(".css")) {
    return "css";
  }
  if (normalized.endsWith(".html")) {
    return "html";
  }
  if (normalized.endsWith(".sql")) {
    return "sql";
  }
  if (normalized.endsWith(".md")) {
    return "markdown";
  }
  if (normalized.endsWith(".sh") || normalized.endsWith(".zsh") || normalized.endsWith(".bash")) {
    return "shell";
  }
  return "text";
}

export function isLikelyDiff(language: string, codeValue: string): boolean {
  if (language.includes("diff") || language === "patch") {
    return true;
  }
  const lines = codeValue.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return false;
  }
  const hasStrongMarker = lines.some(
    (line) =>
      line.startsWith("@@") ||
      line.startsWith("diff --git") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ "),
  );
  if (hasStrongMarker) {
    return true;
  }

  const addedLines = lines.filter((line) => isAddedDiffLine(line)).length;
  const removedLines = lines.filter((line) => isRemovedDiffLine(line)).length;
  const contextLines = lines.filter((line) => line.startsWith(" ")).length;
  return addedLines > 0 && removedLines > 0 && addedLines + removedLines + contextLines >= 4;
}

function isAddedDiffLine(line: string): boolean {
  return line.startsWith("+") && !line.startsWith("+++ ");
}

function isRemovedDiffLine(line: string): boolean {
  return line.startsWith("-") && !line.startsWith("--- ");
}

function parseDiffHunkStart(line: string): { oldLine: number; newLine: number } | null {
  const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (!match) {
    return null;
  }
  const oldLine = Number(match[1]);
  const newLine = Number(match[2]);
  if (!Number.isFinite(oldLine) || !Number.isFinite(newLine)) {
    return null;
  }
  return { oldLine, newLine };
}

function diffInlineSegments(
  left: string,
  right: string,
): {
  left: Array<{ text: string; changed: boolean }>;
  right: Array<{ text: string; changed: boolean }>;
} {
  const leftTokens = left.split(/(\s+)/).filter((part) => part.length > 0);
  const rightTokens = right.split(/(\s+)/).filter((part) => part.length > 0);
  const matrix: number[][] = Array.from({ length: leftTokens.length + 1 }, () =>
    Array.from({ length: rightTokens.length + 1 }, () => 0),
  );

  for (let i = leftTokens.length - 1; i >= 0; i -= 1) {
    for (let j = rightTokens.length - 1; j >= 0; j -= 1) {
      const leftToken = leftTokens[i] ?? "";
      const rightToken = rightTokens[j] ?? "";
      const currentRow = matrix[i];
      if (!currentRow) {
        continue;
      }
      if (leftToken === rightToken) {
        currentRow[j] = (matrix[i + 1]?.[j + 1] ?? 0) + 1;
      } else {
        currentRow[j] = Math.max(matrix[i + 1]?.[j] ?? 0, currentRow[j + 1] ?? 0);
      }
    }
  }

  const leftParts: Array<{ text: string; changed: boolean }> = [];
  const rightParts: Array<{ text: string; changed: boolean }> = [];
  let i = 0;
  let j = 0;
  while (i < leftTokens.length && j < rightTokens.length) {
    const leftToken = leftTokens[i] ?? "";
    const rightToken = rightTokens[j] ?? "";
    if (leftToken === rightToken) {
      leftParts.push({ text: leftToken, changed: false });
      rightParts.push({ text: rightToken, changed: false });
      i += 1;
      j += 1;
      continue;
    }
    if ((matrix[i + 1]?.[j] ?? 0) >= (matrix[i]?.[j + 1] ?? 0)) {
      leftParts.push({ text: leftToken, changed: true });
      i += 1;
      continue;
    }
    rightParts.push({ text: rightToken, changed: true });
    j += 1;
  }

  while (i < leftTokens.length) {
    leftParts.push({ text: leftTokens[i] ?? "", changed: true });
    i += 1;
  }
  while (j < rightTokens.length) {
    rightParts.push({ text: rightTokens[j] ?? "", changed: true });
    j += 1;
  }

  return { left: leftParts, right: rightParts };
}

export function buildHighlightedTextNodes(
  value: string,
  query: string,
  keyPrefix: string,
): ReactNode[] {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    return [<span key={`${keyPrefix}:all`}>{value}</span>];
  }

  const matcher = new RegExp(`(${escapeRegExp(normalizedQuery)})`, "ig");
  const parts = value.split(matcher);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const [index, part] of parts.entries()) {
    const key = `${keyPrefix}:${cursor}:${part.length}`;
    if (index % 2 === 1) {
      nodes.push(<mark key={`${key}:m`}>{part}</mark>);
    } else if (part.length > 0) {
      nodes.push(<span key={`${key}:t`}>{part}</span>);
    }
    cursor += part.length;
  }
  return nodes;
}

export function renderMarkedSnippet(value: string): ReactNode {
  const segments = value.split(/(<\/?mark>)/g);
  let markOpen = false;
  let cursor = 0;
  const content: ReactNode[] = [];

  for (const segment of segments) {
    if (segment === "<mark>") {
      markOpen = true;
      cursor += segment.length;
      continue;
    }
    if (segment === "</mark>") {
      markOpen = false;
      cursor += segment.length;
      continue;
    }

    const key = `${cursor}:${segment.length}:${markOpen ? "m" : "t"}`;
    if (markOpen) {
      content.push(<mark key={key}>{segment}</mark>);
    } else {
      content.push(<span key={key}>{segment}</span>);
    }
    cursor += segment.length;
  }

  return content;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function tryFormatJson(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}
