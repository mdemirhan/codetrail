import type { MessageCategory } from "@cch/core";
import type { IpcResponse } from "@cch/core";
import type { ReactNode, Ref } from "react";

import { formatDate, prettyCategory, prettyProvider } from "../../lib/viewUtils";

type SessionMessage = IpcResponse<"sessions:getDetail">["messages"][number];

export function MessageCard({
  message,
  query,
  isFocused,
  isExpanded,
  onToggleExpanded,
  onToggleFocused,
  cardRef,
}: {
  message: SessionMessage;
  query: string;
  isFocused: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onToggleFocused: () => void;
  cardRef?: Ref<HTMLDivElement> | null;
}) {
  const typeLabel = formatMessageTypeLabel(message.category, message.content);

  return (
    <article
      className={`message-card category-${message.category}${isFocused ? " focused" : ""}`}
      ref={cardRef ?? null}
    >
      <header className="message-header">
        <div className="message-header-meta">
          <button
            type="button"
            className={`category-badge category-toggle category-${message.category}`}
            onClick={onToggleExpanded}
            aria-expanded={isExpanded}
          >
            {typeLabel}
          </button>
          <button type="button" className="message-select-button" onClick={onToggleFocused}>
            <small>
              <span className={`provider-label provider-${message.provider}`}>
                {prettyProvider(message.provider)}
              </span>{" "}
              | {formatDate(message.createdAt)}
            </small>
          </button>
        </div>
      </header>
      {isExpanded ? (
        <>
          <div className="message-content">
            <MessageContent text={message.content} category={message.category} query={query} />
          </div>
        </>
      ) : null}
    </article>
  );
}

function formatMessageTypeLabel(category: MessageCategory, content: string): string {
  if (category !== "tool_use" && category !== "tool_edit") {
    return prettyCategory(category);
  }

  const parsed = parseToolInvocationPayload(content);
  if (!parsed?.prettyName) {
    return prettyCategory(category);
  }
  return `${prettyCategory(category)}: ${parsed.prettyName}`;
}

export function isMessageExpandedByDefault(category: MessageCategory): boolean {
  return category === "user" || category === "assistant";
}

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

function MessageContent({
  text,
  category,
  query,
}: {
  text: string;
  category: MessageCategory;
  query: string;
}) {
  if (category === "thinking") {
    return (
      <pre className="thinking-block">{buildHighlightedTextNodes(text, query, "thinking")}</pre>
    );
  }

  if (category === "tool_edit") {
    return <ToolEditContent text={text} query={query} />;
  }

  if (category === "tool_use") {
    return <ToolUseContent text={text} query={query} />;
  }

  if (category === "tool_result") {
    return <ToolResultContent text={text} />;
  }

  return <div className="rich-block">{renderRichText(text, query, "msg")}</div>;
}

function ToolUseContent({ text, query }: { text: string; query: string }) {
  const parsed = parseToolInvocationPayload(text);
  if (!parsed) {
    const formatted = tryFormatJson(text);
    return (
      <pre className="tool-block">
        {buildHighlightedTextNodes(formatted, query, "tool-use-raw")}
      </pre>
    );
  }

  if (parsed.isWrite) {
    return <ToolEditContent text={text} query={query} />;
  }

  const command = asNonEmptyString(parsed.inputRecord?.cmd ?? parsed.inputRecord?.command);
  const targetPath = asNonEmptyString(
    parsed.inputRecord?.file_path ?? parsed.inputRecord?.path ?? parsed.inputRecord?.file,
  );

  return (
    <div className="tool-use-view">
      {parsed.prettyName ? <div className="tool-use-name">{parsed.prettyName}</div> : null}
      {targetPath ? <div className="tool-edit-path">{targetPath}</div> : null}
      {command ? (
        <div className="tool-use-section">
          <div className="tool-use-section-label">Command</div>
          <CodeBlock language="shell" codeValue={command} />
        </div>
      ) : null}
      {parsed.inputRecord ? (
        <div className="tool-use-section">
          <div className="tool-use-section-label">Arguments</div>
          <CodeBlock language="json" codeValue={JSON.stringify(parsed.inputRecord, null, 2)} />
        </div>
      ) : (
        <CodeBlock language="json" codeValue={JSON.stringify(parsed.record, null, 2)} />
      )}
    </div>
  );
}

function ToolResultContent({ text }: { text: string }) {
  const parsed = tryParseJsonRecord(text);
  if (!parsed) {
    const language = detectLanguageFromContent(text);
    return (
      <div className="tool-result-view">
        <CodeBlock language={language} codeValue={text} />
      </div>
    );
  }

  const output = asString(parsed.output);
  const metadata = asObject(parsed.metadata);
  const normalizedOutput = output ? output : null;
  const inner = normalizedOutput ? tryParseJsonRecord(normalizedOutput) : null;
  const outputLanguage = detectLanguageFromContent(normalizedOutput ?? "");

  return (
    <div className="tool-result-view">
      {metadata ? (
        <div className="tool-use-section">
          <div className="tool-use-section-label">Metadata</div>
          <CodeBlock language="json" codeValue={JSON.stringify(metadata, null, 2)} />
        </div>
      ) : null}
      {normalizedOutput ? (
        <div className="tool-use-section">
          <div className="tool-use-section-label">Output</div>
          <CodeBlock
            language={inner ? "json" : outputLanguage}
            codeValue={inner ? JSON.stringify(inner, null, 2) : normalizedOutput}
          />
        </div>
      ) : (
        <CodeBlock language="json" codeValue={JSON.stringify(parsed, null, 2)} />
      )}
    </div>
  );
}

function ToolEditContent({ text, query }: { text: string; query: string }) {
  const parsed = parseToolEditPayload(text);
  if (!parsed) {
    const formatted = tryFormatJson(text);
    return (
      <pre className="tool-block tool-edit-block">
        {buildHighlightedTextNodes(formatted, query, "tool-edit")}
      </pre>
    );
  }

  if (parsed.diff && isLikelyDiff("diff", parsed.diff)) {
    return (
      <div className="tool-edit-view">
        {parsed.filePath ? <div className="tool-edit-path">{parsed.filePath}</div> : null}
        <DiffBlock codeValue={parsed.diff} />
      </div>
    );
  }

  if (parsed.oldText !== null && parsed.newText !== null) {
    const diff = buildUnifiedDiffFromTextPair({
      oldText: parsed.oldText,
      newText: parsed.newText,
      filePath: parsed.filePath,
    });
    return (
      <div className="tool-edit-view">
        {parsed.filePath ? <div className="tool-edit-path">{parsed.filePath}</div> : null}
        <DiffBlock codeValue={diff} />
      </div>
    );
  }

  if (parsed.newText !== null) {
    return (
      <div className="tool-edit-view">
        {parsed.filePath ? <div className="tool-edit-path">{parsed.filePath}</div> : null}
        <div className="tool-use-section">
          <div className="tool-use-section-label">Written Content</div>
          <CodeBlock
            language={detectLanguageFromFilePath(parsed.filePath)}
            codeValue={parsed.newText}
          />
        </div>
      </div>
    );
  }

  const formatted = tryFormatJson(text);
  return (
    <pre className="tool-block tool-edit-block">
      {buildHighlightedTextNodes(formatted, query, "tool-edit")}
    </pre>
  );
}

function renderRichText(value: string, query: string, keyPrefix: string): ReactNode[] {
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

function renderTextChunk(value: string, query: string, keyPrefix: string): ReactNode {
  const lines = value.split(/\r?\n/);
  const items: ReactNode[] = [];
  let lineCursor = 0;
  let bulletBuffer: Array<{ key: string; content: string }> = [];

  const flushBullets = () => {
    if (bulletBuffer.length === 0) {
      return;
    }

    items.push(
      <ul key={`${keyPrefix}:${bulletBuffer[0]?.key ?? "b"}:list`} className="md-list">
        {bulletBuffer.map((bullet) => (
          <li key={bullet.key}>
            {renderInlineText(bullet.content, query, `${keyPrefix}:${bullet.key}`)}
          </li>
        ))}
      </ul>,
    );
    bulletBuffer = [];
  };

  for (const line of lines) {
    const currentKey = `${lineCursor}`;
    lineCursor += line.length + 1;

    if (line.startsWith("- ")) {
      bulletBuffer.push({ key: currentKey, content: line.slice(2) });
      continue;
    }

    flushBullets();

    if (line.trim().length === 0) {
      items.push(<div key={`${keyPrefix}:${currentKey}:empty`} className="md-empty" />);
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
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

    items.push(
      <p key={`${keyPrefix}:${currentKey}:p`} className="md-p">
        {renderInlineText(line, query, `${keyPrefix}:${currentKey}:p`)}
      </p>,
    );
  }

  flushBullets();

  return <div key={`${keyPrefix}:chunk`}>{items}</div>;
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
      nodes.push(...buildHighlightedTextNodes(token, query, `${key}:txt`));
    }
    cursor += token.length;
  }
  return nodes;
}

function CodeBlock({
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

function DiffBlock({ codeValue }: { codeValue: string }) {
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

function detectLanguageFromContent(value: string): string {
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

function detectLanguageFromFilePath(path: string | null): string {
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

function isLikelyDiff(language: string, codeValue: string): boolean {
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

function parseToolInvocationPayload(text: string): {
  record: Record<string, unknown>;
  name: string | null;
  prettyName: string | null;
  inputRecord: Record<string, unknown> | null;
  isWrite: boolean;
} | null {
  const record = tryParseJsonRecord(text);
  if (!record) {
    return null;
  }

  const functionCall = asObject(record.functionCall);
  const name =
    asNonEmptyString(record.name) ??
    asNonEmptyString(record.tool_name) ??
    asNonEmptyString(record.tool) ??
    asNonEmptyString(functionCall?.name) ??
    null;
  const inputRecord = asObject(record.input) ?? asObject(record.args) ?? asObject(record.arguments);
  const rawHint = [
    name,
    asNonEmptyString(record.operation),
    asNonEmptyString(inputRecord?.operation),
  ]
    .filter((value) => !!value)
    .join(" ");

  return {
    record,
    name,
    prettyName: name ? prettyToolName(name) : null,
    inputRecord,
    isWrite: looksLikeWriteOperation(rawHint),
  };
}

function prettyToolName(name: string): string {
  const normalized = name.trim().toLowerCase();
  const mapped: Record<string, string> = {
    exec_command: "Execute Command",
    run_command: "Execute Command",
    command: "Execute Command",
    grep: "Grep",
    search: "Search",
    read: "Read",
    edit: "Edit",
    apply_patch: "Apply Patch",
    write: "Write",
    write_file: "Write File",
    str_replace: "Replace Text",
    multi_edit: "Multi Edit",
  };
  if (mapped[normalized]) {
    return mapped[normalized];
  }
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function looksLikeWriteOperation(value: string): boolean {
  const normalized = value.toLowerCase();
  if (!normalized) {
    return false;
  }
  return [
    "edit",
    "write",
    "patch",
    "apply_patch",
    "replace",
    "multi_edit",
    "create_file",
    "update_file",
    "delete_file",
    "str_replace",
  ].some((hint) => normalized.includes(hint));
}

function parseToolEditPayload(text: string): {
  filePath: string | null;
  oldText: string | null;
  newText: string | null;
  diff: string | null;
} | null {
  const parsed = tryParseJsonRecord(text);
  if (!parsed) {
    return null;
  }

  const input = asObject(parsed.input);
  const args = asObject(parsed.args);
  const payload = input ?? args ?? parsed;
  const filePath =
    asNonEmptyString(payload.file_path) ??
    asNonEmptyString(payload.path) ??
    asNonEmptyString(payload.file) ??
    asNonEmptyString(parsed.file_path) ??
    asNonEmptyString(parsed.path) ??
    null;
  const oldText =
    asString(payload.old_string) ??
    asString(payload.oldText) ??
    asString(payload.before) ??
    asString(parsed.old_string) ??
    null;
  const newText =
    asString(payload.new_string) ??
    asString(payload.newText) ??
    asString(payload.after) ??
    asString(payload.content) ??
    asString(payload.text) ??
    asString(payload.write_content) ??
    asString(payload.new_content) ??
    asString(parsed.new_string) ??
    null;
  const diff =
    asNonEmptyString(payload.diff) ??
    asNonEmptyString(payload.patch) ??
    asNonEmptyString(parsed.diff) ??
    asNonEmptyString(parsed.patch) ??
    null;
  const applyPatchInput =
    asNonEmptyString(parsed.input) ??
    asNonEmptyString(payload.input) ??
    asNonEmptyString(parsed.arguments) ??
    null;
  const normalizedDiff =
    diff ??
    (looksLikeApplyPatchPayload(parsed, payload)
      ? convertApplyPatchToUnifiedDiff(applyPatchInput)
      : null);
  const normalizedFilePath = filePath ?? extractApplyPatchFirstPath(applyPatchInput);

  return { filePath: normalizedFilePath, oldText, newText, diff: normalizedDiff };
}

function buildUnifiedDiffFromTextPair(args: {
  oldText: string;
  newText: string;
  filePath: string | null;
}): string {
  const oldLines = args.oldText.split(/\r?\n/);
  const newLines = args.newText.split(/\r?\n/);
  const operations = buildLineOperations(oldLines, newLines);
  const hunks = buildDiffHunks(operations, 2);
  const headerFile = args.filePath ?? "file";
  const output: string[] = [`--- a/${headerFile}`, `+++ b/${headerFile}`];
  if (hunks.length === 0) {
    output.push("@@ -1,0 +1,0 @@");
    return output.join("\n");
  }

  for (const hunk of hunks) {
    output.push(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
      ...hunk.lines,
    );
  }
  return output.join("\n");
}

function buildLineOperations(
  oldLines: string[],
  newLines: string[],
): Array<{ type: "equal" | "remove" | "add"; line: string; oldLine: number; newLine: number }> {
  const matrix: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    Array.from({ length: newLines.length + 1 }, () => 0),
  );

  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      const currentRow = matrix[i];
      if (!currentRow) {
        continue;
      }
      if ((oldLines[i] ?? "") === (newLines[j] ?? "")) {
        currentRow[j] = (matrix[i + 1]?.[j + 1] ?? 0) + 1;
      } else {
        currentRow[j] = Math.max(matrix[i + 1]?.[j] ?? 0, currentRow[j + 1] ?? 0);
      }
    }
  }

  const operations: Array<{
    type: "equal" | "remove" | "add";
    line: string;
    oldLine: number;
    newLine: number;
  }> = [];
  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;

  while (i < oldLines.length && j < newLines.length) {
    const left = oldLines[i] ?? "";
    const right = newLines[j] ?? "";
    if (left === right) {
      operations.push({ type: "equal", line: left, oldLine, newLine });
      i += 1;
      j += 1;
      oldLine += 1;
      newLine += 1;
      continue;
    }

    if ((matrix[i + 1]?.[j] ?? 0) >= (matrix[i]?.[j + 1] ?? 0)) {
      operations.push({ type: "remove", line: left, oldLine, newLine: 0 });
      i += 1;
      oldLine += 1;
    } else {
      operations.push({ type: "add", line: right, oldLine: 0, newLine });
      j += 1;
      newLine += 1;
    }
  }

  while (i < oldLines.length) {
    operations.push({ type: "remove", line: oldLines[i] ?? "", oldLine, newLine: 0 });
    i += 1;
    oldLine += 1;
  }
  while (j < newLines.length) {
    operations.push({ type: "add", line: newLines[j] ?? "", oldLine: 0, newLine });
    j += 1;
    newLine += 1;
  }

  return operations;
}

function buildDiffHunks(
  operations: Array<{
    type: "equal" | "remove" | "add";
    line: string;
    oldLine: number;
    newLine: number;
  }>,
  context: number,
): Array<{
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}> {
  const hunks: Array<{
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: string[];
  }> = [];
  let cursor = 0;
  while (cursor < operations.length) {
    let firstChange = -1;
    for (let index = cursor; index < operations.length; index += 1) {
      if (operations[index]?.type !== "equal") {
        firstChange = index;
        break;
      }
    }
    if (firstChange < 0) {
      break;
    }

    let hunkStart = Math.max(0, firstChange - context);
    let hunkEnd = firstChange;
    let lastChange = firstChange;
    for (let index = firstChange + 1; index < operations.length; index += 1) {
      const op = operations[index];
      if (!op) {
        continue;
      }
      if (op.type !== "equal") {
        lastChange = index;
      }
      if (index - lastChange > context) {
        break;
      }
      hunkEnd = index;
    }

    hunkEnd = Math.min(operations.length - 1, hunkEnd);
    if (lastChange + context > hunkEnd) {
      hunkEnd = Math.min(operations.length - 1, lastChange + context);
    }
    if (hunkStart > hunkEnd) {
      hunkStart = hunkEnd;
    }

    const hunkOps = operations.slice(hunkStart, hunkEnd + 1);
    const oldStartCandidate = hunkOps.find((op) => op.oldLine > 0)?.oldLine ?? 1;
    const newStartCandidate = hunkOps.find((op) => op.newLine > 0)?.newLine ?? 1;
    const oldCount = hunkOps.filter((op) => op.type !== "add").length;
    const newCount = hunkOps.filter((op) => op.type !== "remove").length;
    const lines = hunkOps.map((op) => {
      if (op.type === "remove") {
        return `-${op.line}`;
      }
      if (op.type === "add") {
        return `+${op.line}`;
      }
      return ` ${op.line}`;
    });
    hunks.push({
      oldStart: oldStartCandidate,
      oldCount,
      newStart: newStartCandidate,
      newCount,
      lines,
    });
    cursor = hunkEnd + 1;
  }
  return hunks;
}

function tryParseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return asObject(parsed);
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function looksLikeApplyPatchPayload(
  parsed: Record<string, unknown>,
  payload: Record<string, unknown>,
): boolean {
  const normalized = [
    asNonEmptyString(parsed.name),
    asNonEmptyString(parsed.tool),
    asNonEmptyString(parsed.type),
    asNonEmptyString(payload.operation),
    asNonEmptyString(payload.mode),
  ]
    .filter((value) => !!value)
    .join(" ")
    .toLowerCase();
  if (normalized.includes("apply_patch")) {
    return true;
  }
  return (
    asNonEmptyString(parsed.input)?.includes("*** Begin Patch") === true ||
    asNonEmptyString(payload.input)?.includes("*** Begin Patch") === true ||
    asNonEmptyString(parsed.arguments)?.includes("*** Begin Patch") === true
  );
}

function extractApplyPatchFirstPath(patchText: string | null): string | null {
  if (!patchText) {
    return null;
  }
  for (const line of patchText.split(/\r?\n/)) {
    if (line.startsWith("*** Update File: ")) {
      return line.slice("*** Update File: ".length).trim() || null;
    }
    if (line.startsWith("*** Add File: ")) {
      return line.slice("*** Add File: ".length).trim() || null;
    }
    if (line.startsWith("*** Delete File: ")) {
      return line.slice("*** Delete File: ".length).trim() || null;
    }
  }
  return null;
}

function convertApplyPatchToUnifiedDiff(patchText: string | null): string | null {
  if (!patchText) {
    return null;
  }

  const lines = patchText.split(/\r?\n/);
  const output: string[] = [];
  let headerDiffIndex = -1;
  let headerOldIndex = -1;
  let headerNewIndex = -1;
  let oldPath = "";
  let newPath = "";
  let hasDiffRows = false;

  const startFile = (mode: "update" | "add" | "delete", path: string) => {
    const normalized = path.trim();
    if (!normalized) {
      return;
    }

    oldPath = mode === "add" ? "/dev/null" : `a/${normalized}`;
    newPath = mode === "delete" ? "/dev/null" : `b/${normalized}`;
    headerDiffIndex = output.length;
    output.push(`diff --git ${oldPath} ${newPath}`);
    headerOldIndex = output.length;
    output.push(`--- ${oldPath}`);
    headerNewIndex = output.length;
    output.push(`+++ ${newPath}`);
  };

  for (const line of lines) {
    if (line === "*** Begin Patch" || line === "*** End Patch" || line === "*** End of File") {
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      startFile("update", line.slice("*** Update File: ".length));
      continue;
    }
    if (line.startsWith("*** Add File: ")) {
      startFile("add", line.slice("*** Add File: ".length));
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      startFile("delete", line.slice("*** Delete File: ".length));
      continue;
    }
    if (line.startsWith("*** Move to: ")) {
      const destination = line.slice("*** Move to: ".length).trim();
      if (!destination) {
        continue;
      }
      newPath = `b/${destination}`;
      if (headerDiffIndex >= 0) {
        output[headerDiffIndex] = `diff --git ${oldPath} ${newPath}`;
      }
      if (headerNewIndex >= 0) {
        output[headerNewIndex] = `+++ ${newPath}`;
      }
      continue;
    }

    if (
      line.startsWith("@@") ||
      line.startsWith("+") ||
      line.startsWith("-") ||
      line.startsWith(" ")
    ) {
      output.push(line);
      hasDiffRows = true;
    }
  }

  return hasDiffRows && output.length > 0 ? output.join("\n") : null;
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

function buildHighlightedTextNodes(value: string, query: string, keyPrefix: string): ReactNode[] {
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

function renderMarkedSnippet(value: string): ReactNode {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tryFormatJson(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return value;
  }
}
