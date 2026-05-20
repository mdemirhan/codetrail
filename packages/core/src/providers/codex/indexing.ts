import { basename } from "node:path";

import type { DiscoveredSessionFile } from "../../discovery/types";
import { makeToolCallId } from "../../indexing/ids";
import { asArray, asRecord, lowerString, readString } from "../../parsing/helpers";
import { extractDurationSeconds } from "../../parsing/providerParserShared";
import { countUnifiedDiffLines } from "../../tooling/unifiedDiff";

import type {
  ExistingProjectCandidate,
  IndexedMessage,
  PendingCodexUserMessage,
  ProviderIndexingProcessingState,
  ProviderMessagePreparationResult,
  ProviderProcessIndexedEventArgs,
  ProviderToolEditFileRecord,
} from "../types";

type CodexCommandEndEvent = {
  callId: string;
  resultJson: string;
  durationMs: number | null;
  completedAt: string | null;
};

type CodexPatchApplyEndEvent = {
  callId: string;
  files: ProviderToolEditFileRecord[];
};

export type CodexIndexingState = {
  pendingCommandEndByCallId: Map<string, CodexCommandEndEvent>;
  pendingPatchApplyByCallId: Map<string, CodexPatchApplyEndEvent>;
};

export function createCodexIndexingState(): CodexIndexingState {
  return {
    pendingCommandEndByCallId: new Map(),
    pendingPatchApplyByCallId: new Map(),
  };
}

export function normalizeCodexProjectPaths(args: {
  discoveredFiles: DiscoveredSessionFile[];
  existingProjects: ExistingProjectCandidate[];
}): DiscoveredSessionFile[] {
  const candidates = buildCodexCandidateProjects(args.discoveredFiles, args.existingProjects);
  return args.discoveredFiles.map((discovered) =>
    discovered.provider === "codex"
      ? normalizeCodexDiscoveredProjectPath(discovered, candidates)
      : discovered,
  );
}

export function prepareCodexMessagesForPersistence(args: {
  event: unknown;
  processingState: ProviderIndexingProcessingState;
  messages: IndexedMessage[];
}): ProviderMessagePreparationResult {
  const immediateMessages: IndexedMessage[] = [];
  const deferredCodexUserMessages: PendingCodexUserMessage[] = [];
  const codexUserResponse = isCodexResponseItemUserPromptEvent(args.event);

  for (const message of args.messages) {
    if (codexUserResponse && message.category === "user") {
      deferredCodexUserMessages.push({
        message,
        nativeTurnId: args.processingState.currentNativeTurnId,
      });
      continue;
    }
    immediateMessages.push(annotateCodexImmediateMessage(args.processingState, message));
  }

  return {
    immediateMessages,
    deferredCodexUserMessages,
  };
}

export function updateCodexTurnGroupingStateBeforeEvent(args: {
  processingState: ProviderIndexingProcessingState;
  eventRecord: Record<string, unknown> | null;
}): void {
  if (!args.eventRecord) {
    return;
  }
  const nextNativeTurnId = extractCodexNativeTurnId(args.eventRecord);
  if (nextNativeTurnId) {
    args.processingState.currentNativeTurnId = nextNativeTurnId;
  }
}

export function updateCodexTurnGroupingStateAfterEvent(args: {
  processingState: ProviderIndexingProcessingState;
  eventRecord: Record<string, unknown> | null;
}): void {
  if (!args.eventRecord) {
    return;
  }
  const payloadRecord = asRecord(args.eventRecord.payload);
  const payloadType = lowerString(payloadRecord?.type);
  if (
    readString(args.eventRecord.type) === "event_msg" &&
    (payloadType === "task_complete" || payloadType === "turn_aborted")
  ) {
    args.processingState.currentNativeTurnId = null;
    args.processingState.currentTurnGroupId = null;
  }
}

export function flushCodexPendingMessagesBeforeEvent(args: {
  eventRecord: Record<string, unknown> | null;
  processingState: ProviderIndexingProcessingState;
  flushPending: (classification: "user_prompt" | "synthetic_control") => void;
}): void {
  if (args.processingState.pendingCodexUserMessages.length === 0) {
    return;
  }
  const classification = classifyPendingCodexUserMessages(args.eventRecord);
  if (classification === "wait" || classification === null) {
    return;
  }
  args.flushPending(classification);
}

export function annotateFlushedCodexPendingMessage(args: {
  processingState: ProviderIndexingProcessingState;
  pendingMessage: PendingCodexUserMessage;
  classification: "user_prompt" | "synthetic_control";
}): IndexedMessage {
  const nativeTurnId = args.pendingMessage.nativeTurnId ?? args.processingState.currentNativeTurnId;
  const shouldStartNewDisplayedTurn =
    args.classification === "user_prompt" &&
    (!args.processingState.currentTurnGroupId ||
      !nativeTurnId ||
      !args.processingState.currentNativeTurnId ||
      nativeTurnId !== args.processingState.currentNativeTurnId);
  const turnGroupId =
    args.classification === "user_prompt"
      ? shouldStartNewDisplayedTurn
        ? args.pendingMessage.message.id
        : (args.processingState.currentTurnGroupId ?? args.pendingMessage.message.id)
      : args.processingState.currentTurnGroupId;

  if (args.classification === "user_prompt") {
    args.processingState.currentTurnGroupId = turnGroupId ?? args.pendingMessage.message.id;
    args.processingState.currentNativeTurnId = nativeTurnId;
  }

  return {
    ...args.pendingMessage.message,
    turnGroupId: turnGroupId ?? null,
    turnGroupingMode: "hybrid",
    turnAnchorKind: args.classification,
    nativeTurnId,
  };
}

export function processCodexIndexedEvent(args: ProviderProcessIndexedEventArgs): void {
  const codexIndexingState = asCodexIndexingState(args.providerIndexingState);
  if (!codexIndexingState) {
    return;
  }

  const eventRecord = asRecord(args.event);
  const payloadRecord = asRecord(eventRecord?.payload);
  const eventType = readString(eventRecord?.type);
  const payloadType = lowerString(payloadRecord?.type);
  if (!eventRecord || !eventType || !payloadType || !payloadRecord) {
    return;
  }

  if (eventType === "response_item") {
    const callId = readString(payloadRecord.call_id);
    const responseType = lowerString(payloadRecord.type);
    if (!callId) {
      return;
    }
    if (responseType === "function_call" || responseType === "custom_tool_call") {
      flushPendingCodexPatchApply(args, codexIndexingState, callId);
      return;
    }
    if (responseType === "function_call_output" || responseType === "custom_tool_call_output") {
      if (!flushPendingCodexCommandEnd(args, codexIndexingState, callId)) {
        applyStoredCodexCommandEnd(args, callId);
      }
    }
    return;
  }

  if (eventType !== "event_msg") {
    return;
  }

  if (payloadType === "exec_command_end") {
    const commandEnd = parseCodexCommandEndEvent(eventRecord, payloadRecord);
    if (!commandEnd) {
      return;
    }
    if (!applyCodexCommandEnd(args, commandEnd)) {
      codexIndexingState.pendingCommandEndByCallId.set(commandEnd.callId, commandEnd);
    }
    return;
  }

  if (payloadType === "patch_apply_end") {
    const patchApply = parseCodexPatchApplyEndEvent(payloadRecord);
    if (!patchApply) {
      return;
    }
    if (!applyCodexPatchApply(args, patchApply)) {
      codexIndexingState.pendingPatchApplyByCallId.set(patchApply.callId, patchApply);
    }
  }
}

type CodexCandidateProject = {
  path: string;
  repositoryUrl: string | null;
};

function normalizeCodexDiscoveredProjectPath(
  discovered: DiscoveredSessionFile,
  candidates: CodexCandidateProject[],
): DiscoveredSessionFile {
  const currentCanonicalPath = discovered.canonicalProjectPath || discovered.projectPath;
  const currentCwd = discovered.metadata.cwd;
  if (
    currentCanonicalPath &&
    currentCwd &&
    currentCanonicalPath !== currentCwd &&
    discovered.metadata.worktreeSource
  ) {
    return discovered;
  }

  const currentRepoName = currentCwd ? basename(currentCwd) : "";
  const repositoryUrl = discovered.metadata.repositoryUrl;
  const repoUrlMatches =
    repositoryUrl && currentRepoName
      ? candidates.filter(
          (candidate) =>
            candidate.repositoryUrl === repositoryUrl &&
            basename(candidate.path) === currentRepoName,
        )
      : [];
  const repoUrlMatch = repoUrlMatches[0];
  if (repoUrlMatches.length === 1 && repoUrlMatch) {
    return {
      ...discovered,
      canonicalProjectPath: repoUrlMatch.path,
      metadata: {
        ...discovered.metadata,
        worktreeLabel: discovered.metadata.worktreeLabel,
        worktreeSource: discovered.metadata.worktreeLabel ? "repo_url_match" : null,
        resolutionSource: "repo_url_match",
      },
    };
  }

  const basenameMatches = currentRepoName
    ? candidates.filter((candidate) => basename(candidate.path) === currentRepoName)
    : [];
  const basenameMatch = basenameMatches[0];
  if (basenameMatches.length === 1 && basenameMatch) {
    return {
      ...discovered,
      canonicalProjectPath: basenameMatch.path,
      metadata: {
        ...discovered.metadata,
        worktreeLabel: discovered.metadata.worktreeLabel,
        worktreeSource: discovered.metadata.worktreeLabel ? "basename_match" : null,
        resolutionSource: "basename_match",
      },
    };
  }

  return {
    ...discovered,
    canonicalProjectPath: currentCanonicalPath,
    metadata: {
      ...discovered.metadata,
      worktreeLabel:
        currentCanonicalPath && currentCwd && currentCanonicalPath !== currentCwd
          ? discovered.metadata.worktreeLabel
          : null,
      worktreeSource:
        currentCanonicalPath && currentCwd && currentCanonicalPath !== currentCwd
          ? discovered.metadata.worktreeSource
          : null,
      resolutionSource:
        currentCanonicalPath && currentCwd && currentCanonicalPath !== currentCwd
          ? (discovered.metadata.resolutionSource ?? null)
          : null,
    },
  };
}

function buildCodexCandidateProjects(
  discoveredFiles: DiscoveredSessionFile[],
  existingProjects: ExistingProjectCandidate[],
): CodexCandidateProject[] {
  const candidates = new Map<string, CodexCandidateProject>();

  for (const discovered of discoveredFiles) {
    if (discovered.provider !== "codex") {
      continue;
    }
    const cwd = discovered.metadata.cwd;
    if (!cwd || cwd !== discovered.canonicalProjectPath || discovered.metadata.worktreeLabel) {
      continue;
    }
    candidates.set(discovered.canonicalProjectPath, {
      path: discovered.canonicalProjectPath,
      repositoryUrl: discovered.metadata.repositoryUrl,
    });
  }

  for (const project of existingProjects) {
    if (project.provider !== "codex") {
      continue;
    }
    candidates.set(project.path, {
      path: project.path,
      repositoryUrl: project.repositoryUrl,
    });
  }

  return [...candidates.values()];
}

function asCodexIndexingState(state: unknown): CodexIndexingState | null {
  if (!state || typeof state !== "object") {
    return null;
  }
  return state as CodexIndexingState;
}

function flushPendingCodexCommandEnd(
  args: ProviderProcessIndexedEventArgs,
  state: CodexIndexingState,
  callId: string,
): boolean {
  const pending = state.pendingCommandEndByCallId.get(callId);
  if (!pending) {
    return false;
  }
  if (applyCodexCommandEnd(args, pending)) {
    state.pendingCommandEndByCallId.delete(callId);
    return true;
  }
  return false;
}

function flushPendingCodexPatchApply(
  args: ProviderProcessIndexedEventArgs,
  state: CodexIndexingState,
  callId: string,
): void {
  const pending = state.pendingPatchApplyByCallId.get(callId);
  if (!pending) {
    return;
  }
  if (applyCodexPatchApply(args, pending)) {
    state.pendingPatchApplyByCallId.delete(callId);
  }
}

function parseCodexCommandEndEvent(
  eventRecord: Record<string, unknown>,
  payloadRecord: Record<string, unknown>,
): CodexCommandEndEvent | null {
  const callId = readString(payloadRecord.call_id);
  if (!callId) {
    return null;
  }

  const durationSeconds = extractDurationSeconds(payloadRecord.duration);
  const durationMs =
    durationSeconds === null ? null : Math.max(0, Math.trunc(durationSeconds * 1000));
  const completedAt = readString(eventRecord.timestamp) ?? null;
  const result = compactJsonObject({
    status: readString(payloadRecord.status),
    exitCode: readNumber(payloadRecord.exit_code),
    cwd: readString(payloadRecord.cwd),
    command: payloadRecord.command,
    parsedCommand: payloadRecord.parsed_cmd,
    processId: readString(payloadRecord.process_id),
    source: readString(payloadRecord.source),
    durationMs,
  });

  return {
    callId,
    resultJson: JSON.stringify(result),
    durationMs,
    completedAt,
  };
}

function parseCodexPatchApplyEndEvent(
  payloadRecord: Record<string, unknown>,
): CodexPatchApplyEndEvent | null {
  const callId = readString(payloadRecord.call_id);
  const changes = asRecord(payloadRecord.changes);
  if (!callId || !changes) {
    return null;
  }

  const files: ProviderToolEditFileRecord[] = [];
  for (const [filePath, changeValue] of Object.entries(changes)) {
    const change = asRecord(changeValue);
    if (!change) {
      continue;
    }
    const unifiedDiff = readString(change.unified_diff) ?? readString(change.unifiedDiff);
    const stats = unifiedDiff
      ? countUnifiedDiffLines(unifiedDiff)
      : { addedLineCount: 0, removedLineCount: 0 };
    const changeType = normalizeCodexPatchChangeType(readString(change.type));
    files.push({
      id: "",
      messageId: "",
      fileOrdinal: files.length,
      filePath,
      previousFilePath: changeType === "move" ? readString(change.move_path) : null,
      changeType,
      unifiedDiff,
      addedLineCount: stats.addedLineCount,
      removedLineCount: stats.removedLineCount,
      exactness: "exact",
      beforeHash: null,
      afterHash: null,
    });
  }

  return files.length > 0 ? { callId, files } : null;
}

function applyCodexCommandEnd(
  args: ProviderProcessIndexedEventArgs,
  event: CodexCommandEndEvent,
): boolean {
  const toolMessageId = findCodexToolMessageId(args, event.callId);
  const outputMessageId = findCodexToolOutputMessageId(args, event.callId);
  const hasTarget = toolMessageId !== null || outputMessageId !== null;

  if (toolMessageId) {
    args.db
      .prepare("UPDATE tool_calls SET result_json = ?, completed_at = ? WHERE message_id = ?")
      .run(event.resultJson, event.completedAt, toolMessageId);
  }

  if (outputMessageId && event.durationMs !== null) {
    args.db
      .prepare(
        `UPDATE messages
         SET operation_duration_ms = ?,
             operation_duration_source = 'native',
             operation_duration_confidence = 'high'
         WHERE id = ?`,
      )
      .run(event.durationMs, outputMessageId);
  }

  return hasTarget && (event.durationMs === null || outputMessageId !== null);
}

function applyStoredCodexCommandEnd(
  args: ProviderProcessIndexedEventArgs,
  callId: string,
): boolean {
  const outputMessageId = findCodexToolOutputMessageId(args, callId);
  if (!outputMessageId) {
    return false;
  }

  const row = args.db
    .prepare(
      `SELECT tc.result_json as result_json,
              tc.completed_at as completed_at
       FROM tool_calls tc
       JOIN messages m ON m.id = tc.message_id
       WHERE m.session_id = ?
         AND m.source_id IN (?, ?)
       ORDER BY m.created_at_ms ASC, m.created_at ASC, m.id ASC
       LIMIT 1`,
    )
    .get(args.sessionDbId, `${callId}:function_call`, `${callId}:custom_tool_call`) as
    | { result_json: string | null; completed_at: string | null }
    | undefined;
  const result = parseJsonRecord(row?.result_json);
  const durationMs = readNumber(result?.durationMs);
  if (durationMs === null) {
    return false;
  }

  args.db
    .prepare(
      `UPDATE messages
       SET operation_duration_ms = ?,
           operation_duration_source = 'native',
           operation_duration_confidence = 'high'
       WHERE id = ?`,
    )
    .run(durationMs, outputMessageId);
  return true;
}

function applyCodexPatchApply(
  args: ProviderProcessIndexedEventArgs,
  event: CodexPatchApplyEndEvent,
): boolean {
  const messageId = findCodexToolMessageId(args, event.callId);
  if (!messageId) {
    return false;
  }

  args.db.prepare("DELETE FROM message_tool_edit_files WHERE message_id = ?").run(messageId);

  for (const file of event.files) {
    args.upsertToolEditFile({
      ...file,
      id: makeToolCallId(messageId, 1000 + file.fileOrdinal),
      messageId,
    });
  }

  return true;
}

function findCodexToolMessageId(
  args: ProviderProcessIndexedEventArgs,
  callId: string,
): string | null {
  const row = args.db
    .prepare(
      `SELECT id
       FROM messages
       WHERE session_id = ?
         AND source_id IN (?, ?)
         AND category IN ('tool_use', 'tool_edit')
       ORDER BY created_at_ms ASC, created_at ASC, id ASC
       LIMIT 1`,
    )
    .get(args.sessionDbId, `${callId}:function_call`, `${callId}:custom_tool_call`) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

function findCodexToolOutputMessageId(
  args: ProviderProcessIndexedEventArgs,
  callId: string,
): string | null {
  const row = args.db
    .prepare(
      `SELECT id
       FROM messages
       WHERE session_id = ?
         AND source_id IN (?, ?)
         AND category = 'tool_result'
       ORDER BY created_at_ms ASC, created_at ASC, id ASC
       LIMIT 1`,
    )
    .get(args.sessionDbId, `${callId}:function_call_output`, `${callId}:custom_tool_call_output`) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

function normalizeCodexPatchChangeType(
  value: string | null,
): ProviderToolEditFileRecord["changeType"] {
  if (value === "add" || value === "update" || value === "delete" || value === "move") {
    return value;
  }
  return "update";
}

function compactJsonObject(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== null && value !== undefined),
  );
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function annotateCodexImmediateMessage(
  state: ProviderIndexingProcessingState,
  message: IndexedMessage,
): IndexedMessage {
  return {
    ...message,
    turnGroupId: state.currentTurnGroupId,
    turnGroupingMode: "hybrid",
    turnAnchorKind: null,
    nativeTurnId: state.currentNativeTurnId,
  };
}

function classifyPendingCodexUserMessages(
  eventRecord: Record<string, unknown> | null,
): "user_prompt" | "synthetic_control" | "wait" | null {
  if (!eventRecord) {
    return null;
  }
  if (readString(eventRecord.type) !== "event_msg") {
    return null;
  }
  const payloadRecord = asRecord(eventRecord.payload);
  const payloadType = lowerString(payloadRecord?.type);
  if (payloadType === "user_message") {
    return "user_prompt";
  }
  if (payloadType === "turn_aborted") {
    return "synthetic_control";
  }
  return "wait";
}

function isCodexResponseItemUserPromptEvent(event: unknown): boolean {
  const eventRecord = asRecord(event);
  if (readString(eventRecord?.type) !== "response_item") {
    return false;
  }
  const payloadRecord = asRecord(eventRecord?.payload);
  return (
    lowerString(payloadRecord?.type) === "message" &&
    lowerString(payloadRecord?.role) === "user" &&
    !isCodexSyntheticUserContext(payloadRecord?.content)
  );
}

function isCodexSyntheticUserContext(content: unknown): boolean {
  const text = asArray(content)
    .map((block) => {
      const blockRecord = asRecord(block);
      return readString(blockRecord?.text) ?? "";
    })
    .join("\n")
    .trim();
  return text.startsWith("<environment_context>") && text.includes("</environment_context>");
}

function extractCodexNativeTurnId(eventRecord: Record<string, unknown>): string | null {
  const payloadRecord = asRecord(eventRecord.payload);
  return readString(payloadRecord?.turn_id) ?? readString(eventRecord.turn_id) ?? null;
}
