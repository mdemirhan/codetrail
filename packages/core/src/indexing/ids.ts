import { createHash } from "node:crypto";

import type { Provider } from "../contracts/canonical";

export function makeProjectId(provider: Provider, projectPath: string): string {
  return `project_${hash([provider, projectPath])}`;
}

export function makeSessionId(provider: Provider, sessionIdentity: string): string {
  return `session_${hash([provider, sessionIdentity])}`;
}

export function makeFileKey(
  provider: Provider,
  projectPath: string,
  sessionIdentity: string,
): string {
  return `file_${hash([provider, projectPath, sessionIdentity])}`;
}

export function makeMessageId(sessionId: string, sourceMessageId: string): string {
  return `msg_${hash([sessionId, sourceMessageId])}`;
}

export function makeToolCallId(messageId: string, index: number): string {
  return `tool_${hash([messageId, String(index)])}`;
}

function hash(parts: string[]): string {
  return createHash("sha1").update(parts.join("|"), "utf8").digest("hex");
}
