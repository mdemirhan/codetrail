import type { MessageCategory } from "@codetrail/core/browser";
import { type KeyboardEvent, type MouseEvent, type Ref, memo, useMemo } from "react";

import { copyTextToClipboard } from "../../lib/clipboard";
import { compactPath, formatDate, prettyCategory } from "../../lib/viewUtils";

import { MessageContent } from "./MessageContent";
import { parseMessageToolPayload } from "./messageToolPayload";
import {
  asNonEmptyString,
  asObject,
  asString,
  buildUnifiedDiffFromTextPair,
  tryParseJsonRecord,
} from "./toolParsing";
import type { SessionMessage } from "./types";

type MessageCardProps = {
  message: SessionMessage;
  query: string;
  highlightPatterns?: string[];
  pathRoots: string[];
  isFocused: boolean;
  isBookmarked?: boolean;
  isOrphaned?: boolean;
  isExpanded: boolean;
  onToggleExpanded: (messageId: string, category: MessageCategory) => void;
  onToggleCategoryExpanded?: (category: MessageCategory) => void;
  onToggleBookmark?: (message: SessionMessage) => void;
  onRevealInSession?: (messageId: string, sourceId: string) => void;
  cardRef?: Ref<HTMLDivElement> | null;
};

function MessageCardComponent({
  message,
  query,
  highlightPatterns = [],
  pathRoots,
  isFocused,
  isBookmarked = false,
  isOrphaned = false,
  isExpanded,
  onToggleExpanded,
  onToggleCategoryExpanded,
  onToggleBookmark,
  onRevealInSession,
  cardRef,
}: MessageCardProps) {
  const parsedToolPayload = useMemo(
    () => parseMessageToolPayload(message.category, message.content),
    [message.category, message.content],
  );
  const typeLabel = useMemo(
    () => formatMessageTypeLabel(message.category, parsedToolPayload),
    [message.category, parsedToolPayload],
  );
  const previewLabel = useMemo(
    () => formatMessagePreview(message.category, message.content, parsedToolPayload),
    [message.category, message.content, parsedToolPayload],
  );
  const operationDurationLabel = useMemo(
    () =>
      formatOperationDurationLabel(
        message.operationDurationMs,
        message.operationDurationConfidence,
      ),
    [message.operationDurationConfidence, message.operationDurationMs],
  );
  const toggleExpanded = () => onToggleExpanded(message.id, message.category);
  const toggleCategoryExpanded = () => onToggleCategoryExpanded?.(message.category);

  const handleExpansionToggleClick = (event: MouseEvent<HTMLElement>) => {
    if (event.metaKey && onToggleCategoryExpanded) {
      toggleCategoryExpanded();
      return;
    }
    toggleExpanded();
  };

  const handleHeaderClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".message-header-actions")) {
      return;
    }
    if (target?.closest(".message-toggle-button")) {
      return;
    }
    handleExpansionToggleClick(event);
  };

  const handleCopyRawButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void copyTextToClipboard(JSON.stringify(message, null, 2));
  };

  const handleCopyBodyButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void copyTextToClipboard(formatMessageBodyForClipboard(message, parsedToolPayload));
  };

  const handleRevealButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onRevealInSession?.(message.id, message.sourceId);
  };

  const handleBookmarkButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleBookmark?.(message);
  };

  const handleHeaderKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    toggleExpanded();
  };

  return (
    <article
      className={`message category-${message.category}${isFocused ? " focused" : ""}${
        isExpanded ? " expanded" : " collapsed"
      }${isBookmarked ? " is-bookmarked" : ""}`}
      data-history-message-id={message.id}
      ref={cardRef ?? null}
    >
      <header
        className="message-header"
        onClick={handleHeaderClick}
        onKeyDown={handleHeaderKeyDown}
      >
        <button
          type="button"
          className="message-toggle-button"
          onClick={(event) => {
            event.stopPropagation();
            handleExpansionToggleClick(event);
          }}
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
            {isOrphaned ? (
              <>
                <span className="msg-separator" aria-hidden="true">
                  ·
                </span>
                <span className="msg-orphaned-badge">Orphaned</span>
              </>
            ) : null}
          </div>
          {!isExpanded ? <span className="message-preview">{previewLabel}</span> : null}
        </button>
        <div className="message-header-actions">
          <button
            type="button"
            className="message-action-button"
            onClick={handleCopyBodyButtonClick}
            aria-label="Copy formatted message body"
            title="Copy message"
          >
            Copy
          </button>
          <button
            type="button"
            className="message-action-button"
            onClick={handleCopyRawButtonClick}
            aria-label="Copy raw message data"
            title="Copy raw message"
          >
            Copy Raw
          </button>
          {onRevealInSession ? (
            <button
              type="button"
              className="message-action-button message-reveal-button"
              onClick={handleRevealButtonClick}
              aria-label="Reveal this message in session"
              title="Reveal in Session"
            >
              Reveal in Session
            </button>
          ) : null}
          {onToggleBookmark ? (
            <button
              type="button"
              className={`message-action-button message-bookmark-button${
                isBookmarked ? " is-active" : ""
              }`}
              onClick={handleBookmarkButtonClick}
              aria-label={
                isBookmarked ? "Remove bookmark from this message" : "Bookmark this message"
              }
              title={isBookmarked ? "Remove bookmark" : "Bookmark message"}
            >
              <BookmarkIcon filled={isBookmarked} />
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
              highlightPatterns={highlightPatterns}
              pathRoots={pathRoots}
              parsedToolPayload={parsedToolPayload}
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}

export const MessageCard = memo(MessageCardComponent);
MessageCard.displayName = "MessageCard";

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="message-bookmark-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function formatMessageTypeLabel(
  category: MessageCategory,
  parsedToolPayload: ReturnType<typeof parseMessageToolPayload>,
): string {
  if (category !== "tool_use" && category !== "tool_edit") {
    return prettyCategory(category);
  }

  const parsed = parsedToolPayload.toolInvocation;
  if (!parsed?.prettyName) {
    return prettyCategory(category);
  }
  return `${prettyCategory(category)}: ${parsed.prettyName}`;
}

function formatMessagePreview(
  category: MessageCategory,
  content: string,
  parsedToolPayload: ReturnType<typeof parseMessageToolPayload>,
): string {
  if (category === "tool_use") {
    const parsed = parsedToolPayload.toolInvocation;
    if (parsed) {
      const targetPath = asNonEmptyString(
        parsed.inputRecord?.file_path ?? parsed.inputRecord?.path ?? parsed.inputRecord?.file,
      );
      const command = asNonEmptyString(parsed.inputRecord?.cmd ?? parsed.inputRecord?.command);
      if (targetPath && parsed.prettyName) {
        return `${parsed.prettyName} ${compactPath(targetPath)}`;
      }
      if (command) {
        return compactInlineText(command);
      }
      if (parsed.prettyName) {
        return parsed.prettyName;
      }
    }
  }

  if (category === "tool_edit") {
    const parsed = parsedToolPayload.toolEdit;
    if (parsed?.filePath) {
      return `${prettyCategory(category)} ${compactPath(parsed.filePath)}`;
    }
    if (parsed?.newText) {
      return compactInlineText(parsed.newText);
    }
  }

  if (category === "tool_result") {
    const parsed = parsedToolPayload.toolResult;
    const output = asString(parsed?.output);
    if (output) {
      return compactInlineText(output);
    }
  }

  return compactInlineText(content);
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

function formatMessageBodyForClipboard(
  message: SessionMessage,
  parsedToolPayload: ReturnType<typeof parseMessageToolPayload>,
): string {
  if (message.category === "tool_use") {
    return formatToolUseBodyForClipboard(message.content, parsedToolPayload);
  }
  if (message.category === "tool_edit") {
    return formatToolEditBodyForClipboard(message.content, parsedToolPayload);
  }
  if (message.category === "tool_result") {
    return formatToolResultBodyForClipboard(message.content, parsedToolPayload);
  }
  return message.content;
}

function formatToolUseBodyForClipboard(
  content: string,
  parsedToolPayload: ReturnType<typeof parseMessageToolPayload>,
): string {
  const parsed = parsedToolPayload.toolInvocation;
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

function formatToolEditBodyForClipboard(
  content: string,
  parsedToolPayload: ReturnType<typeof parseMessageToolPayload>,
): string {
  const parsed = parsedToolPayload.toolEdit;
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

function formatToolResultBodyForClipboard(
  content: string,
  parsedToolPayload: ReturnType<typeof parseMessageToolPayload>,
): string {
  const parsed = parsedToolPayload.toolResult;
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
    sections.push(
      outputJson ? `Output:\n${JSON.stringify(outputJson, null, 2)}` : `Output:\n${output}`,
    );
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

function compactInlineText(value: string, maxLength = 120): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "Empty message";
  }
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1)}…`;
}
