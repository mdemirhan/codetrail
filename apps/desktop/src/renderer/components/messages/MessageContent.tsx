import type { MessageCategory } from "@codetrail/core";

import {
  CodeBlock,
  DiffBlock,
  buildHighlightedTextNodes,
  detectLanguageFromContent,
  detectLanguageFromFilePath,
  isLikelyDiff,
  looksLikeMarkdown,
  renderPlainText,
  renderRichText,
  tryFormatJson,
} from "./textRendering";
import {
  asNonEmptyString,
  asObject,
  asString,
  buildUnifiedDiffFromTextPair,
  parseToolEditPayload,
  parseToolInvocationPayload,
  tryParseJsonRecord,
} from "./toolParsing";

export function MessageContent({
  text,
  category,
  query,
  pathRoots = [],
}: {
  text: string;
  category: MessageCategory;
  query: string;
  pathRoots?: string[];
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

  if (category === "assistant") {
    const content = looksLikeMarkdown(text)
      ? renderRichText(text, query, "assistant-md", pathRoots)
      : renderPlainText(text, query, "assistant-txt", pathRoots);
    return <div className="rich-block">{content}</div>;
  }

  return <div className="rich-block">{renderRichText(text, query, "msg", pathRoots)}</div>;
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
