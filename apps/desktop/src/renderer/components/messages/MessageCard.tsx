import type { MessageCategory } from "@codetrail/core";
import type { Ref } from "react";

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

  return (
    <article
      className={`message category-${message.category}${isFocused ? " focused" : ""}`}
      ref={cardRef ?? null}
    >
      <header className="message-header">
        <div className="message-header-left">
          <button
            type="button"
            className={`msg-role category-toggle category-${message.category}`}
            onClick={onToggleExpanded}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Collapse message" : "Expand message"}
            title={isExpanded ? "Collapse message" : "Expand message"}
          >
            {typeLabel}
          </button>
          <button
            type="button"
            className="message-select-button"
            onClick={onToggleFocused}
            aria-label={isFocused ? "Clear message focus" : "Focus this message"}
            title={isFocused ? "Unselect message" : "Select message"}
          >
            <span className="message-select-label">{isFocused ? "Unselect" : "Select"}</span>
            <span className="msg-time">{formatDate(message.createdAt)}</span>
          </button>
        </div>
        {onRevealInSession ? (
          <div className="message-header-actions">
            <button
              type="button"
              className="message-reveal-button"
              onClick={onRevealInSession}
              aria-label="Reveal this message in session"
              title="Reveal in session"
            >
              Reveal in Session
            </button>
          </div>
        ) : null}
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
