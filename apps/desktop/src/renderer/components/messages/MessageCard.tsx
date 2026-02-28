import type { MessageCategory } from "@codetrail/core";
import type { KeyboardEvent, MouseEvent, Ref } from "react";

import { formatDate, prettyCategory } from "../../lib/viewUtils";

import { MessageContent } from "./MessageContent";
import { parseToolInvocationPayload } from "./toolParsing";
import type { SessionMessage } from "./types";

export function MessageCard({
  message,
  query,
  isFocused,
  isExpanded,
  onToggleExpanded,
  onToggleFocused,
  onRevealInSession,
  cardRef,
}: {
  message: SessionMessage;
  query: string;
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
            <MessageContent text={message.content} category={message.category} query={query} />
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
