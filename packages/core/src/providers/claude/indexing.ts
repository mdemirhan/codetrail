import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import type { TurnGroupingMode } from "../../contracts/canonical";
import type { SqliteDatabase } from "../../db/bootstrap";
import type { DiscoveredSessionFile } from "../../discovery/types";
import { makeToolCallId } from "../../indexing/ids";
import { asRecord, readString } from "../../parsing/helpers";
import { buildUnifiedDiffFromTextPair, countUnifiedDiffLines } from "../../tooling/unifiedDiff";

import type {
  IndexedMessage,
  ProviderIndexingProcessingState,
  ProviderProcessIndexedEventArgs,
  ProviderRegisterPersistedMessageArgs,
  ProviderSkipDuplicateEventArgs,
  ProviderToolEditFileRecord,
} from "../types";

export const CLAUDE_TURN_ROOT_EVENT_ID_LIMIT = 2048;

type ClaudeSnapshotFileEntry = {
  backupFileName: string | null;
  version: number | null;
  backupTime: string | null;
};

type ClaudePendingToolEdit = {
  messageDbId: string;
  sourceId: string;
  fileOrdinal: number;
  filePath: string;
  comparisonPath: string;
  toolName: string;
  input: Record<string, unknown>;
};

export type ClaudeIndexingState = {
  fileHistoryDirectory: string | null;
  previousSnapshotByPath: Map<string, ClaudeSnapshotFileEntry>;
  pendingBySourceId: Map<string, ClaudePendingToolEdit[]>;
  backupTextByName: Map<string, string | null>;
  currentTextByPath: Map<string, string>;
};

export function createClaudeIndexingState(discovered: DiscoveredSessionFile): ClaudeIndexingState {
  return {
    fileHistoryDirectory: resolveClaudeFileHistoryDirectory(
      discovered.filePath,
      discovered.sourceSessionId,
    ),
    previousSnapshotByPath: new Map(),
    pendingBySourceId: new Map(),
    backupTextByName: new Map(),
    currentTextByPath: new Map(),
  };
}

export function annotateClaudeMessagesForEvent(args: {
  processingState: ProviderIndexingProcessingState;
  eventRecord: Record<string, unknown> | null;
  messages: IndexedMessage[];
}): IndexedMessage[] {
  if (args.messages.length === 0) {
    return args.messages;
  }

  const messageRecord = asRecord(args.eventRecord?.message);
  const normalized = messageRecord ?? args.eventRecord;
  const eventId =
    readString(args.eventRecord?.uuid) ??
    readString(args.eventRecord?.id) ??
    readString(normalized?.uuid) ??
    readString(normalized?.id) ??
    null;
  const parentEventId =
    readString(args.eventRecord?.parentUuid) ??
    readString(args.eventRecord?.parent_uuid) ??
    readString(normalized?.parentUuid) ??
    readString(normalized?.parent_uuid) ??
    null;
  const userAnchorId = args.messages.find((message) => message.category === "user")?.id ?? null;
  const eventTurnGroupId =
    userAnchorId ??
    (parentEventId
      ? (args.processingState.claudeTurnRootByEventId[parentEventId] ?? null)
      : null) ??
    args.processingState.currentTurnGroupId;

  if (eventId && eventTurnGroupId) {
    trackClaudeTurnRootEvent(args.processingState, eventId, eventTurnGroupId);
  }
  if (eventTurnGroupId) {
    args.processingState.currentTurnGroupId = eventTurnGroupId;
    args.processingState.currentNativeTurnId = eventTurnGroupId;
  }

  return args.messages.map((message) => ({
    ...message,
    turnGroupId: eventTurnGroupId,
    turnGroupingMode: "native" satisfies TurnGroupingMode,
    turnAnchorKind: message.id === userAnchorId ? "user_prompt" : null,
    nativeTurnId: eventTurnGroupId,
  }));
}

export function registerClaudePersistedMessage(args: ProviderRegisterPersistedMessageArgs): void {
  const claudeIndexingState = asClaudeIndexingState(args.providerIndexingState);
  if (!claudeIndexingState) {
    return;
  }
  if (args.message.category !== "tool_use" && args.message.category !== "tool_edit") {
    return;
  }

  const record = tryParseJsonRecord(args.message.content);
  const toolName = readString(record?.name);
  if (toolName !== "Edit" && toolName !== "Write") {
    return;
  }
  const input = asRecord(record?.input);
  const filePath = readString(input?.file_path);
  if (!filePath) {
    return;
  }

  const sourceId = args.message.id;
  const fileOrdinal = 0;
  const candidate: ClaudePendingToolEdit = {
    messageDbId: args.persistedMessageId,
    sourceId,
    fileOrdinal,
    filePath,
    comparisonPath: normalizeClaudeComparisonPath(filePath, args.discovered.metadata.cwd),
    toolName,
    input: input ?? {},
  };
  const pending =
    claudeIndexingState.pendingBySourceId.get(sourceId) ??
    claudeIndexingState.pendingBySourceId.get(sourceId.split("#")[0] ?? sourceId) ??
    [];
  pending.push(candidate);
  claudeIndexingState.pendingBySourceId.set(sourceId.split("#")[0] ?? sourceId, pending);

  const provisional = buildBestEffortClaudeToolEditFile({
    candidate,
    fileHistoryDirectory: claudeIndexingState.fileHistoryDirectory,
    previousSnapshotByPath: claudeIndexingState.previousSnapshotByPath,
    backupTextByName: claudeIndexingState.backupTextByName,
    currentTextByPath: claudeIndexingState.currentTextByPath,
  });
  if (!provisional) {
    return;
  }
  rememberClaudeCurrentText(
    claudeIndexingState.currentTextByPath,
    candidate,
    provisional.currentText,
  );
  args.upsertToolEditFile({
    id: makeToolCallId(args.persistedMessageId, 1000 + fileOrdinal),
    messageId: args.persistedMessageId,
    fileOrdinal,
    filePath: provisional.filePath,
    previousFilePath: provisional.previousFilePath,
    changeType: provisional.changeType,
    unifiedDiff: provisional.unifiedDiff,
    addedLineCount: provisional.addedLineCount,
    removedLineCount: provisional.removedLineCount,
    exactness: provisional.exactness,
    beforeHash: provisional.beforeHash,
    afterHash: provisional.afterHash,
  });
}

export function processClaudeIndexedEvent(args: ProviderProcessIndexedEventArgs): void {
  const claudeIndexingState = asClaudeIndexingState(args.providerIndexingState);
  if (!claudeIndexingState) {
    return;
  }
  const eventRecord = asRecord(args.event);
  if (readString(eventRecord?.type) !== "file-history-snapshot") {
    return;
  }
  const sourceId = readString(eventRecord?.messageId);
  if (!sourceId) {
    return;
  }
  const snapshot = asRecord(eventRecord?.snapshot);
  const trackedFileBackups = asRecord(snapshot?.trackedFileBackups);
  if (!trackedFileBackups) {
    return;
  }

  const currentSnapshotByPath = new Map<string, ClaudeSnapshotFileEntry>();
  const changedPaths: string[] = [];
  for (const [filePath, value] of Object.entries(trackedFileBackups)) {
    const entryRecord = asRecord(value);
    const entry: ClaudeSnapshotFileEntry = {
      backupFileName: readString(entryRecord?.backupFileName) ?? null,
      version:
        typeof entryRecord?.version === "number" && Number.isFinite(entryRecord.version)
          ? entryRecord.version
          : null,
      backupTime: readString(entryRecord?.backupTime) ?? null,
    };
    currentSnapshotByPath.set(filePath, entry);
    const previous = claudeIndexingState.previousSnapshotByPath.get(filePath);
    if (!previous || !isSameClaudeSnapshotEntry(previous, entry)) {
      changedPaths.push(filePath);
    }
  }
  claudeIndexingState.previousSnapshotByPath = currentSnapshotByPath;

  const pending =
    claudeIndexingState.pendingBySourceId.get(sourceId) ??
    loadPersistedClaudePendingToolEdits({
      db: args.db,
      sessionDbId: args.sessionDbId,
      discovered: args.discovered,
      sourceId,
    });
  if (!pending || pending.length === 0) {
    return;
  }

  for (const changedPath of changedPaths) {
    const snapshotEntry = currentSnapshotByPath.get(changedPath);
    if (!snapshotEntry) {
      continue;
    }
    const pendingIndex = pending.findIndex(
      (candidate) =>
        candidate.comparisonPath === normalizeClaudeComparisonPath(changedPath, null) ||
        candidate.filePath === changedPath,
    );
    if (pendingIndex === -1) {
      continue;
    }
    const candidate = pending[pendingIndex];
    if (!candidate) {
      continue;
    }
    const normalized = buildExactClaudeToolEditFile({
      candidate,
      snapshotEntry,
      fileHistoryDirectory: claudeIndexingState.fileHistoryDirectory,
      backupTextByName: claudeIndexingState.backupTextByName,
    });
    if (normalized) {
      rememberClaudeCurrentText(
        claudeIndexingState.currentTextByPath,
        candidate,
        normalized.currentText,
      );
      args.upsertToolEditFile({
        id: makeToolCallId(candidate.messageDbId, 1000 + candidate.fileOrdinal),
        messageId: candidate.messageDbId,
        fileOrdinal: candidate.fileOrdinal,
        filePath: normalized.filePath,
        previousFilePath: normalized.previousFilePath,
        changeType: normalized.changeType,
        unifiedDiff: normalized.unifiedDiff,
        addedLineCount: normalized.addedLineCount,
        removedLineCount: normalized.removedLineCount,
        exactness: normalized.exactness,
        beforeHash: normalized.beforeHash,
        afterHash: normalized.afterHash,
      });
    }
    pending.splice(pendingIndex, 1);
  }

  if (pending.length === 0) {
    claudeIndexingState.pendingBySourceId.delete(sourceId);
  }
}

export function shouldSkipDuplicateClaudeEvent(args: ProviderSkipDuplicateEventArgs): boolean {
  if (args.messages.length !== 1) {
    return false;
  }
  const eventRecord = asRecord(args.event);
  if (!eventRecord) {
    return false;
  }
  if (
    readString(eventRecord.type) !== "system" ||
    readString(eventRecord.subtype) !== "compact_boundary"
  ) {
    return false;
  }
  const message = args.messages[0];
  if (!message || !args.hasPersistedMessage(message.id)) {
    return false;
  }
  args.onNotice({
    provider: args.discovered.provider,
    sessionId: args.discovered.sourceSessionId,
    filePath: args.discovered.filePath,
    stage: "parse",
    severity: "warning",
    code: "index.claude_compact_boundary_duplicate_skipped",
    message: `Skipped duplicate Claude compact boundary event ${message.id}.`,
    details: {
      messageId: message.id,
    },
  });
  return true;
}

function asClaudeIndexingState(state: unknown): ClaudeIndexingState | null {
  if (!state || typeof state !== "object") {
    return null;
  }
  return state as ClaudeIndexingState;
}

function trackClaudeTurnRootEvent(
  state: ProviderIndexingProcessingState,
  eventId: string,
  turnGroupId: string,
): void {
  if (state.claudeTurnRootByEventId[eventId] === turnGroupId) {
    return;
  }
  if (!(eventId in state.claudeTurnRootByEventId)) {
    state.claudeTurnRootEventIds.push(eventId);
  }
  state.claudeTurnRootByEventId[eventId] = turnGroupId;
  if (state.claudeTurnRootEventIds.length <= CLAUDE_TURN_ROOT_EVENT_ID_LIMIT) {
    return;
  }
  const evictedEventId = state.claudeTurnRootEventIds.shift();
  if (evictedEventId) {
    delete state.claudeTurnRootByEventId[evictedEventId];
  }
}

function resolveClaudeFileHistoryDirectory(filePath: string, sessionId: string): string | null {
  const projectsDirectory = dirname(filePath);
  const claudeRoot = dirname(dirname(projectsDirectory));
  if (basename(claudeRoot) !== ".claude") {
    return null;
  }
  return join(claudeRoot, "file-history", sessionId);
}

function isSameClaudeSnapshotEntry(
  left: ClaudeSnapshotFileEntry,
  right: ClaudeSnapshotFileEntry,
): boolean {
  return (
    left.backupFileName === right.backupFileName &&
    left.version === right.version &&
    left.backupTime === right.backupTime
  );
}

function normalizeClaudeComparisonPath(filePath: string, cwd: string | null | undefined): string {
  if (cwd && filePath.startsWith(`${cwd}/`)) {
    return relative(cwd, filePath).replace(/\\/g, "/");
  }
  return filePath.replace(/\\/g, "/");
}

function buildBestEffortClaudeToolEditFile(args: {
  candidate: ClaudePendingToolEdit;
  fileHistoryDirectory: string | null;
  previousSnapshotByPath: Map<string, ClaudeSnapshotFileEntry>;
  backupTextByName: Map<string, string | null>;
  currentTextByPath: Map<string, string>;
}): {
  filePath: string;
  previousFilePath: string | null;
  changeType: "add" | "update" | "delete" | "move";
  unifiedDiff: string | null;
  addedLineCount: number;
  removedLineCount: number;
  exactness: "exact" | "best_effort";
  beforeHash: string | null;
  afterHash: string | null;
  currentText: string | null;
} | null {
  const beforeText = readClaudeKnownBeforeText({
    candidate: args.candidate,
    fileHistoryDirectory: args.fileHistoryDirectory,
    previousSnapshotByPath: args.previousSnapshotByPath,
    backupTextByName: args.backupTextByName,
    currentTextByPath: args.currentTextByPath,
  });

  if (args.candidate.toolName === "Write") {
    const afterText = readString(args.candidate.input.content);
    if (afterText === null) {
      return null;
    }
    if (beforeText === null) {
      return {
        filePath: args.candidate.filePath,
        previousFilePath: null,
        changeType: "update",
        unifiedDiff: null,
        addedLineCount: 0,
        removedLineCount: 0,
        exactness: "best_effort",
        beforeHash: null,
        afterHash: hashText(afterText),
        currentText: afterText,
      };
    }
    const diff = buildUnifiedDiffFromTextPair({
      oldText: beforeText,
      newText: afterText,
      filePath: args.candidate.filePath,
    });
    const stats = countUnifiedDiffLines(diff);
    return {
      filePath: args.candidate.filePath,
      previousFilePath: null,
      changeType: "update",
      unifiedDiff: diff,
      addedLineCount: stats.addedLineCount,
      removedLineCount: stats.removedLineCount,
      exactness: "best_effort",
      beforeHash: hashText(beforeText),
      afterHash: hashText(afterText),
      currentText: afterText,
    };
  }

  const oldText = readString(args.candidate.input.old_string);
  const newText = readString(args.candidate.input.new_string);
  if (oldText === null || newText === null) {
    return null;
  }
  if (beforeText !== null) {
    const afterText = applyClaudeEditToText(
      beforeText,
      oldText,
      newText,
      args.candidate.input.replace_all === true,
    );
    if (afterText !== null) {
      const diff = buildUnifiedDiffFromTextPair({
        oldText: beforeText,
        newText: afterText,
        filePath: args.candidate.filePath,
      });
      const stats = countUnifiedDiffLines(diff);
      return {
        filePath: args.candidate.filePath,
        previousFilePath: null,
        changeType: "update",
        unifiedDiff: diff,
        addedLineCount: stats.addedLineCount,
        removedLineCount: stats.removedLineCount,
        exactness: "best_effort",
        beforeHash: hashText(beforeText),
        afterHash: hashText(afterText),
        currentText: afterText,
      };
    }
  }
  const diff = buildUnifiedDiffFromTextPair({
    oldText,
    newText,
    filePath: args.candidate.filePath,
  });
  const stats = countUnifiedDiffLines(diff);
  return {
    filePath: args.candidate.filePath,
    previousFilePath: null,
    changeType: "update",
    unifiedDiff: diff,
    addedLineCount: stats.addedLineCount,
    removedLineCount: stats.removedLineCount,
    exactness: "best_effort",
    beforeHash: null,
    afterHash: null,
    currentText: null,
  };
}

function readClaudeKnownBeforeText(args: {
  candidate: ClaudePendingToolEdit;
  fileHistoryDirectory: string | null;
  previousSnapshotByPath: Map<string, ClaudeSnapshotFileEntry>;
  backupTextByName: Map<string, string | null>;
  currentTextByPath: Map<string, string>;
}): string | null {
  const currentText =
    args.currentTextByPath.get(args.candidate.comparisonPath) ??
    args.currentTextByPath.get(args.candidate.filePath) ??
    null;
  if (currentText !== null) {
    return currentText;
  }
  const snapshotEntry =
    args.previousSnapshotByPath.get(args.candidate.comparisonPath) ??
    args.previousSnapshotByPath.get(args.candidate.filePath);
  if (!snapshotEntry) {
    return null;
  }
  return readClaudeBackupText(
    args.fileHistoryDirectory,
    snapshotEntry.backupFileName,
    args.backupTextByName,
  );
}

function loadPersistedClaudePendingToolEdits(args: {
  db: SqliteDatabase;
  sessionDbId: string;
  discovered: DiscoveredSessionFile;
  sourceId: string;
}): ClaudePendingToolEdit[] {
  const rows = args.db
    .prepare(
      `SELECT id, source_id, content
       FROM messages
       WHERE session_id = ?
         AND (source_id = ? OR source_id LIKE ?)
       ORDER BY created_at_ms ASC, created_at ASC, id ASC`,
    )
    .all(args.sessionDbId, args.sourceId, `${args.sourceId}#%`) as Array<{
    id: string;
    source_id: string;
    content: string;
  }>;

  const pending: ClaudePendingToolEdit[] = [];
  for (const row of rows) {
    const record = tryParseJsonRecord(row.content);
    const toolName = readString(record?.name);
    if (toolName !== "Edit" && toolName !== "Write") {
      continue;
    }
    const input = asRecord(record?.input);
    const filePath = readString(input?.file_path);
    if (!filePath) {
      continue;
    }
    pending.push({
      messageDbId: row.id,
      sourceId: row.source_id,
      fileOrdinal: 0,
      filePath,
      comparisonPath: normalizeClaudeComparisonPath(filePath, args.discovered.metadata.cwd),
      toolName,
      input: input ?? {},
    });
  }
  return pending;
}

function buildExactClaudeToolEditFile(args: {
  candidate: ClaudePendingToolEdit;
  snapshotEntry: ClaudeSnapshotFileEntry;
  fileHistoryDirectory: string | null;
  backupTextByName: Map<string, string | null>;
}): {
  filePath: string;
  previousFilePath: string | null;
  changeType: "add" | "update" | "delete" | "move";
  unifiedDiff: string | null;
  addedLineCount: number;
  removedLineCount: number;
  exactness: "exact" | "best_effort";
  beforeHash: string | null;
  afterHash: string | null;
  currentText: string;
} | null {
  const beforeText = readClaudeBackupText(
    args.fileHistoryDirectory,
    args.snapshotEntry.backupFileName,
    args.backupTextByName,
  );

  if (args.candidate.toolName === "Write") {
    const afterText = readString(args.candidate.input.content);
    if (afterText === null) {
      return null;
    }
    const diff = buildUnifiedDiffFromTextPair({
      oldText: beforeText ?? "",
      newText: afterText,
      filePath: args.candidate.filePath,
    });
    const stats = countUnifiedDiffLines(diff);
    return {
      filePath: args.candidate.filePath,
      previousFilePath: null,
      changeType: beforeText === null ? "add" : "update",
      unifiedDiff: diff,
      addedLineCount: stats.addedLineCount,
      removedLineCount: stats.removedLineCount,
      exactness: "exact",
      beforeHash: beforeText === null ? null : hashText(beforeText),
      afterHash: hashText(afterText),
      currentText: afterText,
    };
  }

  if (beforeText === null) {
    return null;
  }
  const oldString = readString(args.candidate.input.old_string);
  const newString = readString(args.candidate.input.new_string);
  if (oldString === null || newString === null) {
    return null;
  }
  const replaceAll = args.candidate.input.replace_all === true;
  const afterText = applyClaudeEditToText(beforeText, oldString, newString, replaceAll);
  if (afterText === null) {
    return null;
  }
  const diff = buildUnifiedDiffFromTextPair({
    oldText: beforeText,
    newText: afterText,
    filePath: args.candidate.filePath,
  });
  const stats = countUnifiedDiffLines(diff);
  return {
    filePath: args.candidate.filePath,
    previousFilePath: null,
    changeType: "update",
    unifiedDiff: diff,
    addedLineCount: stats.addedLineCount,
    removedLineCount: stats.removedLineCount,
    exactness: "exact",
    beforeHash: hashText(beforeText),
    afterHash: hashText(afterText),
    currentText: afterText,
  };
}

function rememberClaudeCurrentText(
  currentTextByPath: Map<string, string>,
  candidate: ClaudePendingToolEdit,
  currentText: string | null,
): void {
  if (currentText === null) {
    return;
  }
  currentTextByPath.set(candidate.filePath, currentText);
  currentTextByPath.set(candidate.comparisonPath, currentText);
}

function readClaudeBackupText(
  fileHistoryDirectory: string | null,
  backupFileName: string | null,
  backupTextByName: Map<string, string | null>,
): string | null {
  if (!fileHistoryDirectory || !backupFileName) {
    return null;
  }
  if (backupTextByName.has(backupFileName)) {
    return backupTextByName.get(backupFileName) ?? null;
  }

  try {
    const text = readFileSync(join(fileHistoryDirectory, backupFileName), "utf8");
    backupTextByName.set(backupFileName, text);
    return text;
  } catch {
    backupTextByName.set(backupFileName, null);
    return null;
  }
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tryParseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function applyClaudeEditToText(
  beforeText: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string | null {
  if (oldString.length === 0) {
    return null;
  }
  if (replaceAll) {
    return beforeText.includes(oldString) ? beforeText.split(oldString).join(newString) : null;
  }
  const firstIndex = beforeText.indexOf(oldString);
  if (firstIndex === -1) {
    return null;
  }
  const lastIndex = beforeText.lastIndexOf(oldString);
  if (firstIndex !== lastIndex) {
    return null;
  }
  return (
    beforeText.slice(0, firstIndex) + newString + beforeText.slice(firstIndex + oldString.length)
  );
}
