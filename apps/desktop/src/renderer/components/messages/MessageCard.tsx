import type { MessageCategory } from "@codetrail/core";
import type { KeyboardEvent, MouseEvent, Ref } from "react";

import { formatDate, prettyCategory } from "../../lib/viewUtils";

import { MessageContent } from "./MessageContent";
import {
  asNonEmptyString,
  asObject,
  asString,
  buildUnifiedDiffFromTextPair,
  parseToolEditPayload,
  parseToolInvocationPayload,
  tryParseJsonRecord,
} from "./toolParsing";
import type { SessionMessage } from "./types";

export function MessageCard({
  message,
  query,
  pathRoots,
  isFocused,
  isExpanded,
  onToggleExpanded,
  onToggleFocused,
  onRevealInSession,
  cardRef,
}: {
  message: SessionMessage;
  query: string;
  pathRoots: string[];
  isFocused: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onToggleFocused: () => void;
  onRevealInSession?: () => void;
  cardRef?: Ref<HTMLDivElement> | null;
}) {
  const typeLabel = formatMessageTypeLabel(message.category, message.content);
  const operationDurationLabel = formatOperationDurationLabel(
    message.operationDurationMs,
    message.operationDurationConfidence,
  );

  const handleToggleButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleExpanded();
  };

  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    if (event.target !== event.currentTarget) {
      return;
    }

    event.preventDefault();
    onToggleExpanded();
  };

  const handleSelectButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleFocused();
  };

  const handleCopyRawButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void copyTextToClipboard(JSON.stringify(message, null, 2));
  };

  const handleCopyBodyButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void copyTextToClipboard(formatMessageBodyForClipboard(message));
  };

  const handleRevealButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onRevealInSession?.();
  };

  return (
    <article
      className={`message category-${message.category}${isFocused ? " focused" : ""}${
        isExpanded ? " expanded" : " collapsed"
      }`}
      ref={cardRef ?? null}
    >
      <header
        className="message-header"
        onClick={onToggleExpanded}
        onKeyDown={handleHeaderKeyDown}
        tabIndex={0}
      >
        <div className="message-header-left">
          <button
            type="button"
            className="message-toggle-button"
            onClick={handleToggleButtonClick}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Collapse message" : "Expand message"}
            title={isExpanded ? "Collapse message" : "Expand message"}
          >
            <svg className="msg-chevron" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" />
            </svg>
            <span className={`msg-role category-toggle category-${message.category}`}>
              {typeLabel}
            </span>
          </button>
          <div className="message-meta">
            <span className="msg-time">{formatDate(message.createdAt)}</span>
            {operationDurationLabel ? (
              <>
                <span className="msg-separator" aria-hidden="true">
                  ·
                </span>
                <span className="msg-time">Took: {operationDurationLabel}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="message-header-actions">
          <button
            type="button"
            className="message-action-button"
            onClick={handleCopyBodyButtonClick}
            aria-label="Copy formatted message body"
            title="Copy formatted message body"
          >
            Copy
          </button>
          <button
            type="button"
            className="message-action-button"
            onClick={handleCopyRawButtonClick}
            aria-label="Copy raw message data"
            title="Copy raw message data"
          >
            Copy Raw
          </button>
          <button
            type="button"
            className={`message-action-button message-select-button${isFocused ? " is-active" : ""}`}
            onClick={handleSelectButtonClick}
            aria-label={isFocused ? "Clear message focus" : "Focus this message"}
            title={isFocused ? "Unselect message" : "Select message"}
          >
            <span className="message-select-label">{isFocused ? "Unselect" : "Select"}</span>
          </button>
          {onRevealInSession ? (
            <button
              type="button"
              className="message-action-button message-reveal-button"
              onClick={handleRevealButtonClick}
              aria-label="Reveal this message in session"
              title="Reveal in session"
            >
              Reveal in Session
            </button>
          ) : null}
        </div>
      </header>
      {isExpanded ? (
        <div className="message-body">
          <div className="message-content">
            <MessageContent
              text={message.content}
              category={message.category}
              query={query}
              pathRoots={pathRoots}
            />
          </div>
        </div>
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

function formatOperationDurationLabel(
  durationMs: number | null,
  confidence: "high" | "low" | null,
): string | null {
  if (
    confidence !== "high" ||
    durationMs === null ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  ) {
    return null;
  }

  if (durationMs < 1000) {
    return "~<1s";
  }

  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) {
    return `~${seconds}s`;
  }

  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) {
    return `~${minutes}m`;
  }

  const hours = Math.max(1, Math.round(minutes / 60));
  if (hours < 24) {
    return `~${hours}h`;
  }

  const days = Math.max(1, Math.round(hours / 24));
  return `~${days}d`;
}

function formatMessageBodyForClipboard(message: SessionMessage): string {
  if (message.category === "tool_use") {
    return formatToolUseBodyForClipboard(message.content);
  }
  if (message.category === "tool_edit") {
    return formatToolEditBodyForClipboard(message.content);
  }
  if (message.category === "tool_result") {
    return formatToolResultBodyForClipboard(message.content);
  }
  return message.content;
}

function formatToolUseBodyForClipboard(content: string): string {
  const parsed = parseToolInvocationPayload(content);
  if (!parsed) {
    return formatJsonIfParsable(content);
  }

  const sections: string[] = [];
  if (parsed.prettyName) {
    sections.push(`Tool: ${parsed.prettyName}`);
  }

  const targetPath = asNonEmptyString(
    parsed.inputRecord?.file_path ?? parsed.inputRecord?.path ?? parsed.inputRecord?.file,
  );
  if (targetPath) {
    sections.push(`Path: ${targetPath}`);
  }

  const command = asNonEmptyString(parsed.inputRecord?.cmd ?? parsed.inputRecord?.command);
  if (command) {
    sections.push(`Command:\n${command}`);
  }

  if (parsed.inputRecord) {
    sections.push(`Arguments:\n${JSON.stringify(parsed.inputRecord, null, 2)}`);
  } else {
    sections.push(`Payload:\n${JSON.stringify(parsed.record, null, 2)}`);
  }

  return sections.join("\n\n");
}

function formatToolEditBodyForClipboard(content: string): string {
  const parsed = parseToolEditPayload(content);
  if (!parsed) {
    return formatJsonIfParsable(content);
  }

  if (parsed.diff) {
    return parsed.diff;
  }

  if (parsed.oldText !== null && parsed.newText !== null) {
    return buildUnifiedDiffFromTextPair({
      oldText: parsed.oldText,
      newText: parsed.newText,
      filePath: parsed.filePath,
    });
  }

  if (parsed.newText !== null) {
    return parsed.newText;
  }

  return formatJsonIfParsable(content);
}

function formatToolResultBodyForClipboard(content: string): string {
  const parsed = tryParseJsonRecord(content);
  if (!parsed) {
    return formatJsonIfParsable(content);
  }

  const metadata = asObject(parsed.metadata);
  const output = asString(parsed.output);
  const sections: string[] = [];

  if (metadata) {
    sections.push(`Metadata:\n${JSON.stringify(metadata, null, 2)}`);
  }

  if (output) {
    const outputJson = tryParseJsonRecord(output);
    sections.push(outputJson ? `Output:\n${JSON.stringify(outputJson, null, 2)}` : `Output:\n${output}`);
  } else {
    sections.push(JSON.stringify(parsed, null, 2));
  }

  return sections.join("\n\n");
}

function formatJsonIfParsable(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

async function copyTextToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = value;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.left = "-9999px";
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand("copy");
    document.body.removeChild(fallback);
  }
}
