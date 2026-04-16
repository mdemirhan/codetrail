import { basename } from "node:path";

import type { DiscoveredSessionFile } from "../../discovery/types";
import { asRecord, lowerString, readString } from "../../parsing/helpers";

import type {
  ExistingProjectCandidate,
  IndexedMessage,
  PendingCodexUserMessage,
  ProviderIndexingProcessingState,
  ProviderMessagePreparationResult,
} from "../types";

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
  const codexUserResponse = isCodexResponseItemUserEvent(args.event);

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

function isCodexResponseItemUserEvent(event: unknown): boolean {
  const eventRecord = asRecord(event);
  if (readString(eventRecord?.type) !== "response_item") {
    return false;
  }
  const payloadRecord = asRecord(eventRecord?.payload);
  return (
    lowerString(payloadRecord?.type) === "message" && lowerString(payloadRecord?.role) === "user"
  );
}

function extractCodexNativeTurnId(eventRecord: Record<string, unknown>): string | null {
  const payloadRecord = asRecord(eventRecord.payload);
  return readString(payloadRecord?.turn_id) ?? readString(eventRecord.turn_id) ?? null;
}
