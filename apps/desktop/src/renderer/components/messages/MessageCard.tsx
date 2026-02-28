import type { MessageCategory } from "@codetrail/core";
import type { Ref } from "react";

import { formatDate, prettyCategory, prettyProvider } from "../../lib/viewUtils";

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
  onJumpToMessage,
  cardRef,
}: {
  message: SessionMessage;
  query: string;
  isFocused: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onToggleFocused: () => void;
  onJumpToMessage?: () => void;
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
          >
            {typeLabel}
          </button>
          <button type="button" className="message-select-button" onClick={onToggleFocused}>
            <span className={`msg-provider provider-label provider-${message.provider}`}>
              {prettyProvider(message.provider)}
            </span>
            <span className="msg-time">{formatDate(message.createdAt)}</span>
          </button>
        </div>
        {onJumpToMessage ? (
          <div className="message-header-actions">
            <button type="button" className="message-jump-button" onClick={onJumpToMessage}>
              Jump to Message
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
