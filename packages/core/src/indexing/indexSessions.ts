import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { z } from "zod";

import {
  type MessageCategory,
  PROVIDER_VALUES,
  type Provider,
  type TurnAnchorKind,
  type TurnGroupingMode,
  canonicalMessageSchema,
} from "../contracts/canonical";
import { createProviderRecord } from "../contracts/providerMetadata";
import {
  type SqliteDatabase,
  clearIndexedData,
  ensureDatabaseSchema,
  openDatabase,
} from "../db/bootstrap";
import {
  DEFAULT_DISCOVERY_CONFIG,
  type DiscoveryConfig,
  type WorktreeSource,
  discoverChangedFiles,
  discoverSessionFiles,
  discoverSingleFile,
} from "../discovery";
import {
  buildOpenCodeSessionSourcePrefix,
  normalizeOpenCodeDatabasePath,
} from "../discovery/providers/opencode";
import { projectNameFromPath } from "../discovery/shared";
import { stringifyCompactMetadata } from "../metadata";
import { type ParserDiagnostic, parseSession, parseSessionEvent } from "../parsing";
import { asArray, asRecord, lowerString, readString } from "../parsing/helpers";
import {
  type ProviderReadSourceResult,
  type ProviderSourceMetadata,
  type ProviderSourceMetadataAccumulator,
  type ReadFileText,
  getProviderAdapter,
} from "../providers";
import { summarizeOversizedSanitization } from "../providers/oversized/shared";
import { buildUnifiedDiffFromTextPair, countUnifiedDiffLines } from "../tooling/unifiedDiff";

import { makeMessageId, makeProjectId, makeSessionId, makeToolCallId } from "./ids";
import {
  type SystemMessageRegexRuleOverrides,
  resolveSystemMessageRegexRules,
} from "./systemMessageRules";

export type IndexingConfig = {
  dbPath: string;
  forceReindex?: boolean;
  discoveryConfig?: Partial<DiscoveryConfig>;
  enabledProviders?: Provider[];
  projectScope?: ProjectIndexingScope;
  removeMissingSessionsDuringIncrementalIndexing?: boolean;
  systemMessageRegexRules?: SystemMessageRegexRuleOverrides;
};

export type ProjectIndexingScope = {
  provider: Provider;
  projectPath: string;
};

export type IndexingResult = {
  discoveredFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  removedFiles: number;
  schemaRebuilt: boolean;
  diagnostics: {
    warnings: number;
    errors: number;
  };
};

export type IndexingDependencies = {
  discoverSessionFiles?: typeof discoverSessionFiles;
  discoverSingleFile?: typeof discoverSingleFile;
  discoverChangedFiles?: typeof discoverChangedFiles;
  openDatabase?: typeof openDatabase;
  ensureDatabaseSchema?: typeof ensureDatabaseSchema;
  clearIndexedData?: typeof clearIndexedData;
  readFileText?: ReadFileText;
  prefetchedJsonlChunks?: PrefetchedJsonlChunk[];
  now?: () => Date;
  onFileIssue?: (issue: IndexingFileIssue) => void;
  onNotice?: (notice: IndexingNotice) => void;
};

type ResolvedIndexingDependencies = {
  discoverSessionFiles: typeof discoverSessionFiles;
  discoverSingleFile: typeof discoverSingleFile;
  discoverChangedFiles: typeof discoverChangedFiles;
  openDatabase: typeof openDatabase;
  ensureDatabaseSchema: typeof ensureDatabaseSchema;
  clearIndexedData: typeof clearIndexedData;
  readFileText: ReadFileText;
  prefetchedJsonlChunkByPath: Map<string, PrefetchedJsonlChunk>;
  now: () => Date;
  onFileIssue: (issue: IndexingFileIssue) => void;
  onNotice: (notice: IndexingNotice) => void;
};

export type PrefetchedJsonlChunk = {
  filePath: string;
  fileSize: number;
  fileMtimeMs: number;
  startOffsetBytes: number;
  bytes: Uint8Array;
};

type IndexedFileRow = {
  file_path: string;
  provider: Provider;
  project_path: string;
  session_identity: string;
  file_size: number;
  file_mtime_ms: number;
};

type IndexCheckpointRow = {
  file_path: string;
  provider: Provider;
  session_id: string;
  session_identity: string;
  file_size: number;
  file_mtime_ms: number;
  last_offset_bytes: number;
  last_line_number: number;
  last_event_index: number;
  next_message_sequence: number;
  processing_state_json: string;
  source_metadata_json: string;
  head_hash: string;
  tail_hash: string;
};

type DeletedSessionRow = {
  file_path: string;
  provider: Provider;
  project_path: string;
  session_identity: string;
  session_id: string;
  deleted_at_ms: number;
  file_size: number;
  file_mtime_ms: number;
  last_offset_bytes: number | null;
  last_line_number: number | null;
  last_event_index: number | null;
  next_message_sequence: number | null;
  processing_state_json: string | null;
  source_metadata_json: string | null;
  head_hash: string | null;
  tail_hash: string | null;
};

type DeletedProjectRow = {
  provider: Provider;
  project_path: string;
  deleted_at_ms: number;
};

type SessionFileRow = {
  id: string;
  file_path: string;
};

type ExistingProjectCandidateRow = {
  provider: Provider;
  path: string;
  name: string;
  repository_url: string | null;
};

type IndexedMessage = ReturnType<typeof parseSession>["messages"][number];
type SerializedSourceMetadataAccumulator = {
  models: string[];
  gitBranch: string | null;
  cwd: string | null;
};
type SessionAggregateState = {
  messageCount: number;
  tokenInputTotal: number;
  tokenOutputTotal: number;
  startedAtMs: number | null;
  endedAtMs: number | null;
  title: string;
  titleRank: number | null;
};
type MessageProcessingState = {
  provider: Provider;
  fileMtimeMs: number;
  systemMessageRules: RegExp[];
  previousMessage: IndexedMessage | null;
  previousTimestampMs: number;
  assistantThinkingRunRoot: string | null;
  assistantThinkingRunBaseline: IndexedMessage | null;
  currentTurnGroupId: string | null;
  currentNativeTurnId: string | null;
  claudeTurnRootByEventId: Record<string, string>;
  claudeTurnRootEventIds: string[];
  pendingCodexUserMessages: PendingCodexUserMessage[];
  aggregate: SessionAggregateState;
};
type SerializableMessageProcessingState = {
  previousMessage: IndexedMessage | null;
  previousTimestampMs: number;
  previousCursorTimestampMs?: number;
  assistantThinkingRunRoot: string | null;
  assistantThinkingRunBaseline: IndexedMessage | null;
  currentTurnGroupId: string | null;
  currentNativeTurnId: string | null;
  claudeTurnRootByEventId: Record<string, string>;
  claudeTurnRootEventIds?: string[];
  pendingCodexUserMessages: SerializablePendingCodexUserMessage[];
  aggregate: SessionAggregateState;
};
type MessageNormalizationSnapshot = {
  previousMessage: IndexedMessage | null;
  previousTimestampMs: number;
  assistantThinkingRunRoot: string | null;
  assistantThinkingRunBaseline: IndexedMessage | null;
  aggregate: SessionAggregateState;
};
type PendingCodexUserMessage = {
  message: IndexedMessage;
  nativeTurnId: string | null;
};
type SerializablePendingCodexUserMessage = {
  message: IndexedMessage | null;
  nativeTurnId: string | null;
};
type StreamCheckpointState = {
  filePath: string;
  provider: Provider;
  sessionDbId: string;
  sessionIdentity: string;
  fileSize: number;
  fileMtimeMs: number;
  lastOffsetBytes: number;
  lastLineNumber: number;
  lastEventIndex: number;
  nextMessageSequence: number;
  processingState: SerializableMessageProcessingState;
  sourceMetadata: SerializedSourceMetadataAccumulator;
  headHash: string;
  tailHash: string;
};
type ResumeCheckpoint = {
  lastOffsetBytes: number;
  lastLineNumber: number;
  lastEventIndex: number;
  nextMessageSequence: number;
  processingState: SerializableMessageProcessingState;
  sourceMetadata: SerializedSourceMetadataAccumulator;
};

type ExistingDeletedSessionDecision =
  | { action: "proceed" }
  | { action: "skip_deleted_project" }
  | { action: "skip_same_identity"; warning: IndexingNotice | null }
  | { action: "ingest_new"; warning: IndexingNotice | null }
  | { action: "resume_from_deleted"; resumeCheckpoint: ResumeCheckpoint };
type StreamJsonlResult = {
  nextOffsetBytes: number;
  nextLineNumber: number;
  nextEventIndex: number;
};
const CLAUDE_TURN_ROOT_EVENT_ID_LIMIT = 2048;
type JsonlRescueNotice = {
  severity: "info" | "warning";
  message: string;
  details?: Record<string, unknown>;
};
type OmittedJsonlLine = {
  lineNumber: number;
  lineBytes: number;
  limitBytes: number;
};

export type IndexingFileIssue = {
  provider: Provider;
  sessionId: string;
  filePath: string;
  stage: "read" | "parse" | "persist";
  error: unknown;
};

export type IndexingNotice = {
  provider: Provider;
  sessionId: string;
  filePath: string;
  stage: "read" | "parse" | "persist";
  severity: "info" | "warning";
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

type ToolEditExactness = "exact" | "best_effort";
type ToolEditChangeType = "add" | "update" | "delete" | "move";
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
  toolName: "Edit" | "Write";
  input: Record<string, unknown>;
};
type ClaudeTurnNormalizationState = {
  fileHistoryDirectory: string | null;
  previousSnapshotByPath: Map<string, ClaudeSnapshotFileEntry>;
  pendingBySourceId: Map<string, ClaudePendingToolEdit[]>;
  backupTextByName: Map<string, string | null>;
  currentTextByPath: Map<string, string>;
};

type IndexingStatements = {
  upsertProject: PreparedStatement<
    [
      string,
      Provider,
      string,
      string,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string,
      string,
    ]
  >;
  upsertSession: PreparedStatement<
    [
      string,
      string,
      Provider,
      string,
      string,
      string,
      string,
      string,
      number | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      string | null,
      WorktreeSource | null,
      number,
      number,
      number,
    ]
  >;
  insertMessage: PreparedStatement<
    [
      string,
      string,
      string,
      Provider,
      MessageCategory,
      string,
      string,
      number | null,
      number | null,
      number | null,
      "native" | "derived" | null,
      "high" | "low" | null,
      string | null,
      TurnGroupingMode,
      TurnAnchorKind | null,
      string | null,
    ]
  >;
  getMessageById: PreparedQuery<
    [string],
    | {
        id: string;
        source_id: string;
        session_id: string;
        provider: Provider;
        category: MessageCategory;
        content: string;
        created_at: string;
        token_input: number | null;
        token_output: number | null;
        operation_duration_ms: number | null;
        operation_duration_source: "native" | "derived" | null;
        operation_duration_confidence: "high" | "low" | null;
        turn_group_id: string | null;
        turn_grouping_mode: TurnGroupingMode;
        turn_anchor_kind: TurnAnchorKind | null;
        native_turn_id: string | null;
      }
    | undefined
  >;
  insertMessageFts: PreparedStatement<[string, string, Provider, MessageCategory, string]>;
  insertToolCall: PreparedStatement<
    [string, string, string, string, string | null, string | null, string | null]
  >;
  upsertMessageToolEditFile: PreparedStatement<
    [
      string,
      string,
      number,
      string,
      string | null,
      ToolEditChangeType,
      string | null,
      number,
      number,
      ToolEditExactness,
      string | null,
      string | null,
    ]
  >;
  upsertIndexedFile: PreparedStatement<[string, Provider, string, string, number, number, string]>;
  deleteIndexedFileByFilePath: PreparedStatement<[string]>;
  upsertCheckpoint: PreparedStatement<
    [
      string,
      Provider,
      string,
      string,
      number,
      number,
      number,
      number,
      number,
      number,
      string,
      string,
      string,
      string,
      string,
    ]
  >;
  deleteCheckpointByFilePath: PreparedStatement<[string]>;
  listSessionIdsByFilePath: PreparedManyQuery<[string], Array<{ id: string }>>;
  deleteToolCallsBySessionId: PreparedStatement<[string]>;
  deleteMessageToolEditFilesBySessionId: PreparedStatement<[string]>;
  deleteMessageFtsBySessionId: PreparedStatement<[string]>;
  deleteMessagesBySessionId: PreparedStatement<[string]>;
  deleteSessionById: PreparedStatement<[string]>;
};

type PreparedStatement<TArgs extends unknown[]> = {
  run: (...args: TArgs) => unknown;
};

type PreparedQuery<TArgs extends unknown[], TResult> = {
  get: (...args: TArgs) => TResult;
};

type PreparedManyQuery<TArgs extends unknown[], TResult> = {
  all: (...args: TArgs) => TResult;
};

class IndexingFileProcessingError extends Error {
  readonly issue: IndexingFileIssue;

  constructor(issue: IndexingFileIssue) {
    super(
      `[codetrail] failed indexing ${issue.provider} session ${issue.filePath} during ${issue.stage}`,
    );
    this.name = "IndexingFileProcessingError";
    this.issue = issue;
  }
}

const MAX_DERIVED_DURATION_MS = 15 * 60 * 1000;
const JSONL_READ_BUFFER_BYTES = 64 * 1024;
const JSONL_FINGERPRINT_WINDOW_BYTES = 64 * 1024;
const MAX_JSONL_LINE_BYTES = 8 * 1024 * 1024;
const MAX_JSONL_RESCUE_LINE_BYTES = 32 * 1024 * 1024;
const MAX_MATERIALIZED_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_INDEXED_MESSAGE_CONTENT_BYTES = 256 * 1024;
const MAX_INDEXED_FTS_CONTENT_BYTES = 32 * 1024;
const MAX_TOOL_CALL_JSON_BYTES = 64 * 1024;
// Reused within one process to avoid per-call allocation churn when fingerprinting file slices.
// Each worker process gets its own module instance, so there is no cross-process sharing.
const HASH_FILE_SLICE_BUFFER = Buffer.allocUnsafe(JSONL_FINGERPRINT_WINDOW_BYTES);
const SESSION_TITLE_CATEGORY_PREFERENCE: MessageCategory[] = [
  "user",
  "assistant",
  "thinking",
  "system",
  "tool_result",
  "tool_use",
  "tool_edit",
];
const DEFAULT_SESSION_AGGREGATE_STATE = {
  messageCount: 0,
  tokenInputTotal: 0,
  tokenOutputTotal: 0,
  startedAtMs: null,
  endedAtMs: null,
  title: "",
  titleRank: null,
} satisfies SessionAggregateState;
const checkpointAggregateSchema = z
  .object({
    messageCount: z.number().catch(0),
    tokenInputTotal: z.number().catch(0),
    tokenOutputTotal: z.number().catch(0),
    startedAtMs: z.number().nullable().catch(null),
    endedAtMs: z.number().nullable().catch(null),
    title: z.string().catch(""),
    titleRank: z.number().nullable().catch(null),
  })
  .passthrough();

// Incremental indexing treats the filesystem as source of truth and the SQLite database as a
// cacheable projection of normalized session history.
export function runIncrementalIndexing(
  config: IndexingConfig,
  dependencies: IndexingDependencies = {},
): IndexingResult {
  const resolvedDependencies = resolveIndexingDependencies(dependencies);
  const discoveryConfig = resolveIndexingDiscoveryConfig(config);
  const initiallyDiscoveredFiles = resolvedDependencies.discoverSessionFiles(discoveryConfig);

  const db = resolvedDependencies.openDatabase(config.dbPath);
  try {
    const schema = resolvedDependencies.ensureDatabaseSchema(db);
    const discoveredFiles = filterDiscoveredFilesByProjectScope(
      normalizeDiscoveredProjectPaths(db, initiallyDiscoveredFiles, config.projectScope),
      config.projectScope,
    );
    const discoveredByFilePath = new Map(discoveredFiles.map((file) => [file.filePath, file]));

    if (config.forceReindex) {
      if (config.projectScope) {
        clearProjectIndexedData(db, config.projectScope);
      } else {
        // Force reindex intentionally drops delete tombstones too so this pass fully trusts disk
        // and rebuilds the indexed cache from scratch.
        resolvedDependencies.clearIndexedData(db);
      }
    }

    const existingRows = listIndexedFiles(db, config.projectScope);
    const existingByFilePath = new Map(existingRows.map((row) => [row.file_path, row]));
    const existingCheckpointRows = listIndexCheckpoints(db, config.projectScope);
    const existingCheckpointByFilePath = new Map(
      existingCheckpointRows.map((row) => [row.file_path, row]),
    );
    const existingSessionRows = listSessionFiles(db, config.projectScope);
    const existingSessionByFilePath = new Map(
      existingSessionRows.map((row) => [row.file_path, row.id]),
    );
    const deletedSessionRows = listDeletedSessions(db, config.projectScope);
    const deletedSessionByFilePath = new Map(deletedSessionRows.map((row) => [row.file_path, row]));
    const deletedProjectRows = listDeletedProjects(db, config.projectScope);
    const deletedProjectByKey = new Map(
      deletedProjectRows.map((row) => [deletedProjectKey(row.provider, row.project_path), row]),
    );

    let indexedFiles = 0;
    let skippedFiles = 0;
    let removedFiles = 0;
    const diagnostics = { warnings: 0, errors: 0 };
    const compiledSystemMessageRules = compileSystemMessageRules(config.systemMessageRegexRules);
    diagnostics.warnings += compiledSystemMessageRules.invalidCount;
    const statements = createIndexingStatements(db);

    if (!config.forceReindex) {
      const enabledProviderSet = new Set(discoveryConfig.enabledProviders);
      for (const existing of existingRows) {
        if (!matchesProjectScope(existing.provider, existing.project_path, config.projectScope)) {
          continue;
        }
        if (discoveredByFilePath.has(existing.file_path)) {
          continue;
        }

        // Disabled providers are always removed during incremental indexing. The pruning toggle
        // only controls whether still-enabled providers lose indexed sessions when source files
        // disappear from disk.
        if (
          enabledProviderSet.has(existing.provider) &&
          !config.removeMissingSessionsDuringIncrementalIndexing
        ) {
          continue;
        }

        deleteSessionDataForFilePath(statements, existing.file_path);
        statements.deleteIndexedFileByFilePath.run(existing.file_path);
        statements.deleteCheckpointByFilePath.run(existing.file_path);
        existingCheckpointByFilePath.delete(existing.file_path);
        existingSessionByFilePath.delete(existing.file_path);
        removedFiles += 1;
      }
    }

    const nowIso = resolvedDependencies.now().toISOString();
    const lookupExisting = (filePath: string) => ({
      indexed: existingByFilePath.get(filePath),
      checkpoint: existingCheckpointByFilePath.get(filePath),
      sessionId: existingSessionByFilePath.get(filePath),
      deletedSession: deletedSessionByFilePath.get(filePath),
    });

    const result = processDiscoveredFiles({
      db,
      discoveredFiles,
      forceSkipUnchanged: !config.forceReindex,
      lookupExisting,
      nowIso,
      compiledSystemMessageRules,
      statements,
      resolvedDependencies,
      diagnostics,
      deletedProjectByKey,
    });
    indexedFiles += result.indexedFiles;
    skippedFiles += result.skippedFiles;
    db.exec("DELETE FROM projects WHERE id NOT IN (SELECT DISTINCT project_id FROM sessions)");

    return {
      discoveredFiles: discoveredFiles.length,
      indexedFiles,
      skippedFiles,
      removedFiles,
      schemaRebuilt: schema.schemaRebuilt,
      diagnostics,
    };
  } finally {
    db.close();
  }
}

/**
 * Indexes only the given file paths instead of running a full discovery walk. Files that are not
 * recognisable as provider session files and were previously indexed are cleaned up. No orphan
 * project pruning is performed.
 */
export function indexChangedFiles(
  config: IndexingConfig,
  changedFilePaths: string[],
  dependencies: IndexingDependencies = {},
): IndexingResult {
  const resolvedDependencies = resolveIndexingDependencies(dependencies);
  const discoveryConfig = resolveIndexingDiscoveryConfig(config);

  const initiallyDiscoveredFiles = changedFilePaths.flatMap((filePath) =>
    resolvedDependencies.discoverChangedFiles(filePath, discoveryConfig),
  );

  const db = resolvedDependencies.openDatabase(config.dbPath);
  try {
    const schema = resolvedDependencies.ensureDatabaseSchema(db);
    const discoveredFiles = filterDiscoveredFilesByProjectScope(
      normalizeDiscoveredProjectPaths(db, initiallyDiscoveredFiles, config.projectScope),
      config.projectScope,
    );

    // Query only the specific rows for the targeted files — no full table scans.
    const getIndexedFile = db.prepare(
      `SELECT
         file_path,
         provider,
         project_path,
         session_identity,
         file_size,
         file_mtime_ms
       FROM indexed_files
       WHERE file_path = ?`,
    );
    const getCheckpoint = db.prepare(
      `SELECT file_path, provider, session_id, session_identity, file_size, file_mtime_ms,
              last_offset_bytes, last_line_number, last_event_index, next_message_sequence,
              processing_state_json, source_metadata_json, head_hash, tail_hash
       FROM index_checkpoints WHERE file_path = ?`,
    );
    const getSessionByFile = db.prepare("SELECT id, file_path FROM sessions WHERE file_path = ?");
    const listIndexedFilesByPrefix = db.prepare(
      `SELECT
         file_path,
         provider,
         project_path,
         session_identity,
         file_size,
         file_mtime_ms
       FROM indexed_files
       WHERE provider = ? AND file_path LIKE ?`,
    );
    const getDeletedSession = db.prepare(
      `SELECT
         file_path,
         provider,
         project_path,
         session_identity,
         session_id,
         deleted_at_ms,
         file_size,
         file_mtime_ms,
         last_offset_bytes,
         last_line_number,
         last_event_index,
         next_message_sequence,
         processing_state_json,
         source_metadata_json,
         head_hash,
         tail_hash
       FROM deleted_sessions
       WHERE file_path = ?`,
    );
    const deletedProjectRows = listDeletedProjects(db);
    const deletedProjectByKey = new Map(
      deletedProjectRows.map((row) => [deletedProjectKey(row.provider, row.project_path), row]),
    );

    let indexedFiles = 0;
    let skippedFiles = 0;
    let removedFiles = 0;
    const diagnostics = { warnings: 0, errors: 0 };
    const compiledSystemMessageRules = compileSystemMessageRules(config.systemMessageRegexRules);
    diagnostics.warnings += compiledSystemMessageRules.invalidCount;
    const statements = createIndexingStatements(db);

    // Handle deleted/renamed files — clean up indexed data for paths that can no longer be discovered
    // for disabled providers immediately, or for enabled providers only when the pruning toggle is
    // on. This mirrors the full incremental path, just scoped to the changed file set.
    const discoveredPathSet = new Set(discoveredFiles.map((f) => f.filePath));
    const enabledProviderSet = new Set(discoveryConfig.enabledProviders);
    removeMissingOpenCodeSessionsForChangedPaths({
      changedFilePaths,
      discoveredFiles,
      discoveryConfig,
      listIndexedFilesByPrefix: listIndexedFilesByPrefix as {
        all: (provider: Provider, prefix: string) => IndexedFileRow[];
      },
      getSessionByFile: getSessionByFile as {
        get: (filePath: string) => SessionFileRow | undefined;
      },
      statements,
      enabledProviderSet,
      removeMissingSessionsDuringIncrementalIndexing:
        config.removeMissingSessionsDuringIncrementalIndexing ?? false,
      ...(config.projectScope ? { projectScope: config.projectScope } : {}),
    });
    for (const filePath of changedFilePaths) {
      if (discoveredPathSet.has(filePath)) continue;
      const existingSession = getSessionByFile.get(filePath) as SessionFileRow | undefined;
      if (existingSession) {
        const existingIndexedFile = getIndexedFile.get(filePath) as IndexedFileRow | undefined;
        if (
          existingIndexedFile &&
          !matchesProjectScope(
            existingIndexedFile.provider,
            existingIndexedFile.project_path,
            config.projectScope,
          )
        ) {
          continue;
        }
        if (
          existingIndexedFile &&
          enabledProviderSet.has(existingIndexedFile.provider) &&
          !config.removeMissingSessionsDuringIncrementalIndexing
        ) {
          continue;
        }
        deleteSessionDataForFilePath(statements, filePath);
        statements.deleteIndexedFileByFilePath.run(filePath);
        statements.deleteCheckpointByFilePath.run(filePath);
        removedFiles += 1;
      }
    }

    const nowIso = resolvedDependencies.now().toISOString();
    const lookupExisting = (filePath: string) => ({
      indexed: getIndexedFile.get(filePath) as IndexedFileRow | undefined,
      checkpoint: getCheckpoint.get(filePath) as IndexCheckpointRow | undefined,
      sessionId: (getSessionByFile.get(filePath) as SessionFileRow | undefined)?.id,
      deletedSession: getDeletedSession.get(filePath) as DeletedSessionRow | undefined,
    });

    const result = processDiscoveredFiles({
      db,
      discoveredFiles,
      forceSkipUnchanged: true,
      lookupExisting,
      nowIso,
      compiledSystemMessageRules,
      statements,
      resolvedDependencies,
      diagnostics,
      deletedProjectByKey,
    });
    indexedFiles += result.indexedFiles;
    skippedFiles += result.skippedFiles;
    return {
      discoveredFiles: discoveredFiles.length,
      indexedFiles,
      skippedFiles,
      removedFiles,
      schemaRebuilt: schema.schemaRebuilt,
      diagnostics,
    };
  } finally {
    db.close();
  }
}

function removeMissingOpenCodeSessionsForChangedPaths(args: {
  changedFilePaths: string[];
  discoveredFiles: ReturnType<typeof discoverSessionFiles>;
  discoveryConfig: DiscoveryConfig;
  listIndexedFilesByPrefix: { all: (provider: Provider, prefix: string) => IndexedFileRow[] };
  getSessionByFile: { get: (filePath: string) => SessionFileRow | undefined };
  statements: IndexingStatements;
  enabledProviderSet: Set<Provider>;
  removeMissingSessionsDuringIncrementalIndexing: boolean;
  projectScope?: ProjectIndexingScope;
}): void {
  const opencodeRoot = args.discoveryConfig.opencodeRoot;
  if (!opencodeRoot) {
    return;
  }

  const discoveredPathSet = new Set(args.discoveredFiles.map((file) => file.filePath));
  for (const changedPath of args.changedFilePaths) {
    const dbPath = normalizeOpenCodeDatabasePath(changedPath, opencodeRoot);
    if (!dbPath) {
      continue;
    }

    const indexedRows = args.listIndexedFilesByPrefix.all(
      "opencode",
      `${buildOpenCodeSessionSourcePrefix(dbPath)}%`,
    );
    for (const indexedRow of indexedRows) {
      if (discoveredPathSet.has(indexedRow.file_path)) {
        continue;
      }
      if (!matchesProjectScope(indexedRow.provider, indexedRow.project_path, args.projectScope)) {
        continue;
      }
      if (
        args.enabledProviderSet.has(indexedRow.provider) &&
        !args.removeMissingSessionsDuringIncrementalIndexing
      ) {
        continue;
      }

      const existingSession = args.getSessionByFile.get(indexedRow.file_path);
      if (!existingSession) {
        continue;
      }

      deleteSessionDataForFilePath(args.statements, indexedRow.file_path);
      args.statements.deleteIndexedFileByFilePath.run(indexedRow.file_path);
      args.statements.deleteCheckpointByFilePath.run(indexedRow.file_path);
    }
  }
}

function filterDiscoveredFilesByProjectScope(
  discoveredFiles: ReturnType<typeof discoverSessionFiles>,
  projectScope: ProjectIndexingScope | undefined,
): ReturnType<typeof discoverSessionFiles> {
  if (!projectScope) {
    return discoveredFiles;
  }
  return discoveredFiles.filter((discovered) =>
    matchesProjectScope(
      discovered.provider,
      discovered.canonicalProjectPath || discovered.projectPath,
      projectScope,
    ),
  );
}

function matchesProjectScope(
  provider: Provider,
  projectPath: string,
  projectScope: ProjectIndexingScope | undefined,
): boolean {
  if (!projectScope) {
    return true;
  }
  return provider === projectScope.provider && projectPath === projectScope.projectPath;
}

function normalizeDiscoveredProjectPaths(
  db: SqliteDatabase,
  discoveredFiles: ReturnType<typeof discoverSessionFiles>,
  projectScope?: ProjectIndexingScope,
): ReturnType<typeof discoverSessionFiles> {
  if (discoveredFiles.length === 0) {
    return discoveredFiles;
  }

  const existingProjects = db
    .prepare(
      projectScope
        ? `SELECT provider, path, name
      , repository_url
       FROM projects
       WHERE provider = ? AND path = ?`
        : `SELECT provider, path, name
      , repository_url
       FROM projects`,
    )
    .all(
      ...(projectScope ? ([projectScope.provider, projectScope.projectPath] as const) : []),
    ) as ExistingProjectCandidateRow[];
  const codexCandidateProjects = buildCodexCandidateProjects(discoveredFiles, existingProjects);

  return discoveredFiles.map((discovered) => {
    const canonicalProjectPath = discovered.canonicalProjectPath || discovered.projectPath;
    if (discovered.provider !== "codex") {
      return canonicalProjectPath === discovered.projectPath
        ? discovered
        : {
            ...discovered,
            projectPath: canonicalProjectPath,
            canonicalProjectPath,
            projectName: projectNameFromPath(canonicalProjectPath),
          };
    }

    const normalized = normalizeCodexDiscoveredProjectPath(discovered, codexCandidateProjects);
    return {
      ...normalized,
      projectName: projectNameFromPath(normalized.canonicalProjectPath),
      projectPath: normalized.canonicalProjectPath,
    };
  });
}

function normalizeCodexDiscoveredProjectPath(
  discovered: ReturnType<typeof discoverSessionFiles>[number],
  candidates: CodexCandidateProject[],
): ReturnType<typeof discoverSessionFiles>[number] {
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

type CodexCandidateProject = {
  path: string;
  repositoryUrl: string | null;
};

function buildCodexCandidateProjects(
  discoveredFiles: ReturnType<typeof discoverSessionFiles>,
  existingProjects: ExistingProjectCandidateRow[],
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
      repositoryUrl: project.repository_url,
    });
  }

  return [...candidates.values()];
}

function createIndexingStatements(db: SqliteDatabase): IndexingStatements {
  return {
    upsertProject: db.prepare(
      `INSERT INTO projects (
         id,
         provider,
         name,
         path,
         provider_project_key,
         repository_url,
         resolution_state,
         resolution_source,
         metadata_json,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         path = excluded.path,
         provider_project_key = excluded.provider_project_key,
         repository_url = excluded.repository_url,
         resolution_state = excluded.resolution_state,
         resolution_source = excluded.resolution_source,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
    ),
    upsertSession: db.prepare(
      `INSERT INTO sessions (
         id,
         project_id,
         provider,
         file_path,
         title,
         model_names,
         started_at,
         ended_at,
         duration_ms,
         git_branch,
         cwd,
         session_identity,
         provider_session_id,
         session_kind,
         canonical_project_path,
         repository_url,
         git_commit_hash,
         lineage_parent_id,
         provider_client,
         provider_source,
         provider_client_version,
         resolution_source,
         metadata_json,
         worktree_label,
         worktree_source,
         message_count,
         token_input_total,
         token_output_total
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id,
         provider = excluded.provider,
         file_path = excluded.file_path,
         title = excluded.title,
         model_names = excluded.model_names,
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         duration_ms = excluded.duration_ms,
         git_branch = excluded.git_branch,
         cwd = excluded.cwd,
         session_identity = excluded.session_identity,
         provider_session_id = excluded.provider_session_id,
         session_kind = excluded.session_kind,
         canonical_project_path = excluded.canonical_project_path,
         repository_url = excluded.repository_url,
         git_commit_hash = excluded.git_commit_hash,
         lineage_parent_id = excluded.lineage_parent_id,
         provider_client = excluded.provider_client,
         provider_source = excluded.provider_source,
         provider_client_version = excluded.provider_client_version,
         resolution_source = excluded.resolution_source,
         metadata_json = excluded.metadata_json,
         worktree_label = excluded.worktree_label,
         worktree_source = excluded.worktree_source,
         message_count = excluded.message_count,
         token_input_total = excluded.token_input_total,
         token_output_total = excluded.token_output_total`,
    ),
    insertMessage: db.prepare(
      `INSERT INTO messages (
        id,
        source_id,
        session_id,
        provider,
        category,
        content,
        created_at,
        token_input,
        token_output,
        operation_duration_ms,
        operation_duration_source,
        operation_duration_confidence,
        turn_group_id,
        turn_grouping_mode,
        turn_anchor_kind,
        native_turn_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    getMessageById: db.prepare(
      `SELECT
         id,
         source_id,
         session_id,
         provider,
         category,
         content,
         created_at,
         token_input,
         token_output,
         operation_duration_ms,
         operation_duration_source,
         operation_duration_confidence,
         turn_group_id,
         turn_grouping_mode,
         turn_anchor_kind,
         native_turn_id
       FROM messages
       WHERE id = ?`,
    ),
    insertMessageFts: db.prepare(
      `INSERT INTO message_fts (message_id, session_id, provider, category, content)
       VALUES (?, ?, ?, ?, ?)`,
    ),
    insertToolCall: db.prepare(
      `INSERT INTO tool_calls (
        id,
        message_id,
        tool_name,
        args_json,
        result_json,
        started_at,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    upsertMessageToolEditFile: db.prepare(
      `INSERT INTO message_tool_edit_files (
         id,
         message_id,
         file_ordinal,
         file_path,
         previous_file_path,
         change_type,
         unified_diff,
         added_line_count,
         removed_line_count,
         exactness,
         before_hash,
         after_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(message_id, file_ordinal) DO UPDATE SET
         file_path = excluded.file_path,
         previous_file_path = excluded.previous_file_path,
         change_type = excluded.change_type,
         unified_diff = excluded.unified_diff,
         added_line_count = excluded.added_line_count,
         removed_line_count = excluded.removed_line_count,
         exactness = excluded.exactness,
         before_hash = excluded.before_hash,
         after_hash = excluded.after_hash`,
    ),
    upsertIndexedFile: db.prepare(
      `INSERT INTO indexed_files (
         file_path,
         provider,
         project_path,
         session_identity,
         file_size,
         file_mtime_ms,
         indexed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET
         provider = excluded.provider,
         project_path = excluded.project_path,
         session_identity = excluded.session_identity,
         file_size = excluded.file_size,
         file_mtime_ms = excluded.file_mtime_ms,
         indexed_at = excluded.indexed_at`,
    ),
    deleteIndexedFileByFilePath: db.prepare("DELETE FROM indexed_files WHERE file_path = ?"),
    upsertCheckpoint: db.prepare(
      `INSERT INTO index_checkpoints (
         file_path,
         provider,
         session_id,
         session_identity,
         file_size,
         file_mtime_ms,
         last_offset_bytes,
         last_line_number,
         last_event_index,
         next_message_sequence,
         processing_state_json,
         source_metadata_json,
         head_hash,
         tail_hash,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(file_path) DO UPDATE SET
         provider = excluded.provider,
         session_id = excluded.session_id,
         session_identity = excluded.session_identity,
         file_size = excluded.file_size,
         file_mtime_ms = excluded.file_mtime_ms,
         last_offset_bytes = excluded.last_offset_bytes,
         last_line_number = excluded.last_line_number,
         last_event_index = excluded.last_event_index,
         next_message_sequence = excluded.next_message_sequence,
         processing_state_json = excluded.processing_state_json,
         source_metadata_json = excluded.source_metadata_json,
         head_hash = excluded.head_hash,
         tail_hash = excluded.tail_hash,
         updated_at = excluded.updated_at`,
    ),
    deleteCheckpointByFilePath: db.prepare("DELETE FROM index_checkpoints WHERE file_path = ?"),
    listSessionIdsByFilePath: db.prepare("SELECT id FROM sessions WHERE file_path = ?"),
    deleteToolCallsBySessionId: db.prepare(
      "DELETE FROM tool_calls WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)",
    ),
    deleteMessageToolEditFilesBySessionId: db.prepare(
      "DELETE FROM message_tool_edit_files WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)",
    ),
    deleteMessageFtsBySessionId: db.prepare("DELETE FROM message_fts WHERE session_id = ?"),
    deleteMessagesBySessionId: db.prepare("DELETE FROM messages WHERE session_id = ?"),
    deleteSessionById: db.prepare("DELETE FROM sessions WHERE id = ?"),
  };
}

type ExistingFileLookup = (filePath: string) => {
  indexed: IndexedFileRow | undefined;
  checkpoint: IndexCheckpointRow | undefined;
  sessionId: string | undefined;
  deletedSession: DeletedSessionRow | undefined;
};

function processDiscoveredFiles(args: {
  db: SqliteDatabase;
  discoveredFiles: ReturnType<typeof discoverSessionFiles>;
  forceSkipUnchanged: boolean;
  lookupExisting: ExistingFileLookup;
  nowIso: string;
  compiledSystemMessageRules: { compiledByProvider: Record<Provider, RegExp[]> };
  statements: IndexingStatements;
  resolvedDependencies: ResolvedIndexingDependencies;
  diagnostics: { warnings: number; errors: number };
  deletedProjectByKey: Map<string, DeletedProjectRow>;
}): { indexedFiles: number; skippedFiles: number } {
  let indexedFiles = 0;
  let skippedFiles = 0;

  for (const discovered of args.discoveredFiles) {
    const existing = args.lookupExisting(discovered.filePath);
    const sessionDbId = makeSessionId(discovered.provider, discovered.sessionIdentity);
    const deletedProject = args.deletedProjectByKey.get(
      deletedProjectKey(discovered.provider, discovered.canonicalProjectPath),
    );
    const unchanged =
      args.forceSkipUnchanged &&
      !!existing.indexed &&
      existing.indexed.file_size === discovered.fileSize &&
      existing.indexed.file_mtime_ms === discovered.fileMtimeMs &&
      existing.sessionId === sessionDbId;

    if (unchanged) {
      skippedFiles += 1;
      continue;
    }

    const canResumeFromCheckpoint = shouldResumeFromCheckpoint({
      discovered,
      existing: existing.indexed,
      checkpoint: existing.checkpoint,
      expectedSessionDbId: sessionDbId,
      existingSessionId: existing.sessionId,
    });
    let resumeCheckpoint =
      canResumeFromCheckpoint && existing.checkpoint
        ? deserializeResumeCheckpoint(existing.checkpoint)
        : null;

    const deletedSessionDecision = resolveDeletedSessionDecision({
      discovered,
      deletedProject,
      deletedSession: existing.deletedSession,
      activeCanResume: canResumeFromCheckpoint,
      activeIndexed: existing.indexed,
    });
    if (deletedSessionDecision.action === "skip_deleted_project") {
      skippedFiles += 1;
      continue;
    }
    if (deletedSessionDecision.action === "proceed") {
      // Keep the normal active indexing path.
    }
    if ("warning" in deletedSessionDecision && deletedSessionDecision.warning) {
      args.resolvedDependencies.onNotice(deletedSessionDecision.warning);
    }
    if (deletedSessionDecision.action === "skip_same_identity") {
      skippedFiles += 1;
      continue;
    }
    if (deletedSessionDecision.action === "ingest_new") {
      removeDeletedSessionTombstone(args.db, discovered.filePath);
      deleteSessionDataForFilePath(args.statements, discovered.filePath);
      deleteSessionData(args.statements, sessionDbId);
      args.statements.deleteIndexedFileByFilePath.run(discovered.filePath);
      args.statements.deleteCheckpointByFilePath.run(discovered.filePath);
      resumeCheckpoint = null;
    }
    if (deletedSessionDecision.action === "resume_from_deleted") {
      resumeCheckpoint = deletedSessionDecision.resumeCheckpoint;
    }

    try {
      const adapter = getProviderAdapter(discovered.provider);
      const fileDiagnostics =
        adapter.sourceFormat === "materialized_json"
          ? indexMaterializedSessionFile({
              db: args.db,
              discovered,
              sessionDbId,
              nowIso: args.nowIso,
              readFileText: args.resolvedDependencies.readFileText,
              systemMessageRules:
                args.compiledSystemMessageRules.compiledByProvider[discovered.provider],
              statements: args.statements,
              onNotice: args.resolvedDependencies.onNotice,
            })
          : indexStreamedJsonlSessionFile({
              db: args.db,
              discovered,
              sessionDbId,
              nowIso: args.nowIso,
              systemMessageRules:
                args.compiledSystemMessageRules.compiledByProvider[discovered.provider],
              statements: args.statements,
              resumeCheckpoint,
              prefetchedJsonlChunk:
                args.resolvedDependencies.prefetchedJsonlChunkByPath.get(discovered.filePath) ??
                null,
              onNotice: args.resolvedDependencies.onNotice,
            });
      accumulateParserDiagnostics(args.diagnostics, fileDiagnostics);
    } catch (error) {
      args.diagnostics.errors += 1;
      args.resolvedDependencies.onFileIssue(resolveIndexingFileIssue(error, discovered));
      continue;
    }

    indexedFiles += 1;
  }

  return { indexedFiles, skippedFiles };
}

function resolveIndexingDependencies(
  dependencies: IndexingDependencies = {},
): ResolvedIndexingDependencies {
  return {
    discoverSessionFiles: dependencies.discoverSessionFiles ?? discoverSessionFiles,
    discoverSingleFile: dependencies.discoverSingleFile ?? discoverSingleFile,
    discoverChangedFiles: dependencies.discoverChangedFiles ?? discoverChangedFiles,
    openDatabase: dependencies.openDatabase ?? openDatabase,
    ensureDatabaseSchema: dependencies.ensureDatabaseSchema ?? ensureDatabaseSchema,
    clearIndexedData: dependencies.clearIndexedData ?? clearIndexedData,
    readFileText: dependencies.readFileText ?? ((filePath) => readFileSync(filePath, "utf8")),
    prefetchedJsonlChunkByPath: new Map(
      (dependencies.prefetchedJsonlChunks ?? []).map((chunk) => [chunk.filePath, chunk]),
    ),
    now: dependencies.now ?? (() => new Date()),
    onFileIssue: dependencies.onFileIssue ?? defaultOnFileIssue,
    onNotice: dependencies.onNotice ?? defaultOnNotice,
  };
}

function deletedProjectKey(provider: Provider, projectPath: string): string {
  return `${provider}:${projectPath}`;
}

function resolveDeletedSessionDecision(args: {
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  deletedProject: DeletedProjectRow | undefined;
  deletedSession: DeletedSessionRow | undefined;
  activeCanResume: boolean;
  activeIndexed: IndexedFileRow | undefined;
}): ExistingDeletedSessionDecision {
  if (!args.deletedSession) {
    if (
      args.deletedProject &&
      args.discovered.fileMtimeMs <= args.deletedProject.deleted_at_ms &&
      !args.activeIndexed
    ) {
      return { action: "skip_deleted_project" };
    }
    return { action: "proceed" };
  }

  if (args.deletedSession.session_identity !== args.discovered.sessionIdentity) {
    return {
      action: "ingest_new",
      warning: {
        provider: args.discovered.provider,
        sessionId: args.discovered.sourceSessionId,
        filePath: args.discovered.filePath,
        stage: "persist",
        severity: "warning",
        code: "index.deleted_session_replaced",
        message:
          "A deleted session file now resolves to a different session identity and will be indexed as a new session.",
        details: {
          deletedSessionIdentity: args.deletedSession.session_identity,
          discoveredSessionIdentity: args.discovered.sessionIdentity,
        },
      },
    };
  }

  if (
    !args.activeIndexed &&
    args.discovered.fileSize === args.deletedSession.file_size &&
    args.discovered.fileMtimeMs === args.deletedSession.file_mtime_ms
  ) {
    return { action: "skip_same_identity", warning: null };
  }

  if (args.activeCanResume) {
    return { action: "proceed" };
  }

  const deletedResumeCheckpoint = shouldResumeFromDeletedSession({
    discovered: args.discovered,
    deletedSession: args.deletedSession,
  })
    ? deserializeDeletedResumeCheckpoint(args.deletedSession)
    : null;
  if (deletedResumeCheckpoint) {
    return {
      action: "resume_from_deleted",
      resumeCheckpoint: deletedResumeCheckpoint,
    };
  }

  return {
    action: "skip_same_identity",
    warning: {
      provider: args.discovered.provider,
      sessionId: args.discovered.sourceSessionId,
      filePath: args.discovered.filePath,
      stage: "persist",
      severity: "warning",
      code: "index.deleted_session_rewrite_ignored",
      message:
        "A deleted session file changed in a non-append-only way but still resolves to the same session identity, so it remains deleted.",
      details: {
        sessionIdentity: args.discovered.sessionIdentity,
      },
    },
  };
}

function resolveIndexingDiscoveryConfig(config: IndexingConfig): DiscoveryConfig {
  return {
    ...DEFAULT_DISCOVERY_CONFIG,
    ...config.discoveryConfig,
    ...(config.projectScope
      ? { enabledProviders: [config.projectScope.provider] }
      : config.enabledProviders
        ? { enabledProviders: config.enabledProviders }
        : {}),
  };
}

function indexMaterializedSessionFile(args: {
  db: SqliteDatabase;
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  sessionDbId: string;
  nowIso: string;
  readFileText: ReadFileText;
  systemMessageRules: RegExp[];
  statements: IndexingStatements;
  onNotice: (notice: IndexingNotice) => void;
}): ParserDiagnostic[] {
  const adapter = getProviderAdapter(args.discovered.provider);
  if (adapter.sourceFormat !== "materialized_json") {
    throw new Error(`Expected materialized adapter for provider ${args.discovered.provider}.`);
  }
  if (args.discovered.fileSize > MAX_MATERIALIZED_SOURCE_BYTES) {
    return persistOversizedMaterializedSessionFile(args);
  }

  let source: ProviderReadSourceResult;
  try {
    const loaded = adapter.readSource(args.discovered, args.readFileText);
    if (!loaded) {
      throw new Error("Unable to read provider source.");
    }
    source = loaded;
  } catch (error) {
    throw new IndexingFileProcessingError({
      provider: args.discovered.provider,
      sessionId: args.discovered.sourceSessionId,
      filePath: args.discovered.filePath,
      stage: "read",
      error,
    });
  }

  let parsed: ReturnType<typeof parseSession>;
  try {
    parsed = parseSession({
      provider: args.discovered.provider,
      sessionId: args.discovered.sourceSessionId,
      payload: source.payload,
    });
  } catch (error) {
    throw new IndexingFileProcessingError({
      provider: args.discovered.provider,
      sessionId: args.discovered.sourceSessionId,
      filePath: args.discovered.filePath,
      stage: "parse",
      error,
    });
  }

  const projectId = makeProjectId(args.discovered.provider, args.discovered.canonicalProjectPath);
  const sourceMeta = adapter.extractSourceMetadata(source.payload);
  const normalizedMessages = reclassifySystemMessages(parsed.messages, args.systemMessageRules);
  const messagesWithDuration = deriveOperationDurations(normalizedMessages);
  const preparedMessages = prepareMaterializedMessagesForPersistence(
    messagesWithDuration,
    adapter,
    args.discovered.fileMtimeMs,
    args.sessionDbId,
  );
  const modelNames = sourceMeta.models.join(",");

  persistMaterializedMessages({
    db: args.db,
    discovered: args.discovered,
    sessionDbId: args.sessionDbId,
    nowIso: args.nowIso,
    statements: args.statements,
    onNotice: args.onNotice,
    projectId,
    sessionTitle: preparedMessages.sessionTitle || modelNames,
    modelNames,
    gitBranch: sourceMeta.gitBranch ?? args.discovered.metadata.gitBranch,
    cwd: sourceMeta.cwd ?? args.discovered.metadata.cwd,
    aggregate: preparedMessages.aggregate,
    messages: preparedMessages.messages,
  });

  return parsed.diagnostics;
}

function indexStreamedJsonlSessionFile(args: {
  db: SqliteDatabase;
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  sessionDbId: string;
  nowIso: string;
  systemMessageRules: RegExp[];
  statements: IndexingStatements;
  resumeCheckpoint: ResumeCheckpoint | null;
  prefetchedJsonlChunk: PrefetchedJsonlChunk | null;
  onNotice: (notice: IndexingNotice) => void;
}): ParserDiagnostic[] {
  const adapter = getProviderAdapter(args.discovered.provider);
  const parserDiagnostics: ParserDiagnostic[] = [];
  const sourceMetaAccumulator = createSourceMetadataAccumulator(
    args.resumeCheckpoint?.sourceMetadata,
  );
  const processingState = createMessageProcessingState(
    args.discovered.provider,
    args.discovered.fileMtimeMs,
    args.systemMessageRules,
    args.resumeCheckpoint?.processingState,
  );
  const projectId = makeProjectId(args.discovered.provider, args.discovered.canonicalProjectPath);
  const shouldResume = args.resumeCheckpoint !== null;

  try {
    const persist = args.db.transaction(() => {
      prepareStreamedSessionPersistence(
        args,
        shouldResume,
        projectId,
        sourceMetaAccumulator,
        processingState,
      );

      const streamed = streamAndPersistJsonlEvents({
        db: args.db,
        adapter,
        discovered: args.discovered,
        parserDiagnostics,
        processingState,
        sessionDbId: args.sessionDbId,
        sourceMetaAccumulator,
        statements: args.statements,
        resumeCheckpoint: args.resumeCheckpoint,
        prefetchedJsonlChunk: args.prefetchedJsonlChunk,
        onNotice: args.onNotice,
      });

      if (streamed.emittedEvents === 0 && !shouldResume) {
        parserDiagnostics.push({
          severity: "warning",
          code: "parser.no_events_found",
          provider: args.discovered.provider,
          sessionId: args.discovered.sourceSessionId,
          eventIndex: null,
          message: "No events were discovered in payload; returning empty message list.",
        });
      }

      const sourceMeta = finalizeSourceMetadata(sourceMetaAccumulator);
      const aggregate = finalizeSessionAggregate(processingState.aggregate);
      const modelNames = sourceMeta.models.join(",");

      upsertSessionSummary(args.statements, {
        sessionDbId: args.sessionDbId,
        projectId,
        provider: args.discovered.provider,
        filePath: args.discovered.filePath,
        title: processingState.aggregate.title || modelNames,
        modelNames,
        aggregate,
        messageCount: processingState.aggregate.messageCount,
        tokenInputTotal: processingState.aggregate.tokenInputTotal,
        tokenOutputTotal: processingState.aggregate.tokenOutputTotal,
        fileMtimeMs: args.discovered.fileMtimeMs,
        gitBranch: sourceMeta.gitBranch ?? args.discovered.metadata.gitBranch,
        cwd: sourceMeta.cwd ?? args.discovered.metadata.cwd,
        sessionIdentity: args.discovered.sessionIdentity,
        providerSessionId:
          args.discovered.metadata.providerSessionId ?? args.discovered.sourceSessionId,
        sessionKind: args.discovered.metadata.sessionKind ?? "regular",
        canonicalProjectPath: args.discovered.canonicalProjectPath,
        repositoryUrl: args.discovered.metadata.repositoryUrl,
        gitCommitHash: args.discovered.metadata.gitCommitHash ?? null,
        lineageParentId: args.discovered.metadata.lineageParentId ?? null,
        providerClient: args.discovered.metadata.providerClient ?? null,
        providerSource: args.discovered.metadata.providerSource ?? null,
        providerClientVersion: args.discovered.metadata.providerClientVersion ?? null,
        resolutionSource: args.discovered.metadata.resolutionSource ?? null,
        metadataJson: stringifyCompactMetadata(args.discovered.metadata.sessionMetadata),
        worktreeLabel: args.discovered.metadata.worktreeLabel,
        worktreeSource: args.discovered.metadata.worktreeSource,
      });

      args.statements.upsertIndexedFile.run(
        args.discovered.filePath,
        args.discovered.provider,
        args.discovered.canonicalProjectPath,
        args.discovered.sessionIdentity,
        args.discovered.fileSize,
        args.discovered.fileMtimeMs,
        args.nowIso,
      );
      persistStreamCheckpoint({
        discovered: args.discovered,
        nowIso: args.nowIso,
        resumeCheckpoint: args.resumeCheckpoint,
        sequence: streamed.sequence,
        sessionDbId: args.sessionDbId,
        processingState,
        sourceMetaAccumulator,
        statements: args.statements,
        streamResult: streamed.streamResult,
      });
    });
    persist();
  } catch (error) {
    if (error instanceof IndexingFileProcessingError) {
      throw error;
    }
    throw new IndexingFileProcessingError({
      provider: args.discovered.provider,
      sessionId: args.discovered.sourceSessionId,
      filePath: args.discovered.filePath,
      stage: "persist",
      error,
    });
  }

  return parserDiagnostics;
}

function persistOversizedMaterializedSessionFile(args: {
  db: SqliteDatabase;
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  sessionDbId: string;
  nowIso: string;
  statements: IndexingStatements;
  onNotice: (notice: IndexingNotice) => void;
}): ParserDiagnostic[] {
  const message = `Transcript file exceeded the ${formatByteLimit(
    MAX_MATERIALIZED_SOURCE_BYTES,
  )} hard ceiling and was omitted.`;
  const tombstoneContent = [
    "Oversized transcript file omitted.",
    `bytes=${args.discovered.fileSize}`,
    `hard_limit_bytes=${MAX_MATERIALIZED_SOURCE_BYTES}`,
  ].join(" ");
  const diagnostics: ParserDiagnostic[] = [
    {
      severity: "warning",
      code: "parser.oversized_source_file_omitted",
      provider: args.discovered.provider,
      sessionId: args.discovered.sourceSessionId,
      eventIndex: null,
      message,
    },
  ];
  args.onNotice({
    provider: args.discovered.provider,
    sessionId: args.discovered.sourceSessionId,
    filePath: args.discovered.filePath,
    stage: "read",
    severity: "warning",
    code: "parser.oversized_source_file_omitted",
    message,
    details: {
      fileBytes: args.discovered.fileSize,
      hardLimitBytes: MAX_MATERIALIZED_SOURCE_BYTES,
    },
  });

  persistMaterializedMessages({
    db: args.db,
    discovered: args.discovered,
    sessionDbId: args.sessionDbId,
    nowIso: args.nowIso,
    statements: args.statements,
    onNotice: args.onNotice,
    projectId: makeProjectId(args.discovered.provider, args.discovered.canonicalProjectPath),
    sessionTitle: "Oversized transcript omitted",
    modelNames: "",
    gitBranch: args.discovered.metadata.gitBranch,
    cwd: args.discovered.metadata.cwd,
    aggregate: buildSessionAggregate([
      {
        ...buildSyntheticSystemMessage(
          args.discovered.provider,
          args.discovered.sourceSessionId,
          "oversized-source-file",
          tombstoneContent,
          new Date(args.discovered.fileMtimeMs).toISOString(),
        ),
        id: makeMessageId(args.sessionDbId, "oversized-source-file"),
      },
    ]),
    messages: [
      buildSyntheticSystemMessage(
        args.discovered.provider,
        args.discovered.sourceSessionId,
        "oversized-source-file",
        tombstoneContent,
        new Date(args.discovered.fileMtimeMs).toISOString(),
      ),
    ],
  });

  return diagnostics;
}

function persistMaterializedMessages(args: {
  db: SqliteDatabase;
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  sessionDbId: string;
  nowIso: string;
  statements: IndexingStatements;
  onNotice: (notice: IndexingNotice) => void;
  projectId: string;
  sessionTitle: string;
  modelNames: string;
  gitBranch: string | null;
  cwd: string | null;
  aggregate: ReturnType<typeof buildSessionAggregate>;
  messages: IndexedMessage[];
}): void {
  try {
    const persist = args.db.transaction(() => {
      deleteSessionDataForFilePath(args.statements, args.discovered.filePath);
      deleteSessionData(args.statements, args.sessionDbId);
      args.statements.deleteCheckpointByFilePath.run(args.discovered.filePath);
      args.statements.upsertProject.run(
        args.projectId,
        args.discovered.provider,
        args.discovered.projectName,
        args.discovered.canonicalProjectPath,
        args.discovered.metadata.providerProjectKey ?? null,
        args.discovered.metadata.repositoryUrl,
        deriveResolutionState(args.discovered),
        args.discovered.metadata.resolutionSource ?? null,
        stringifyCompactMetadata(args.discovered.metadata.projectMetadata),
        args.nowIso,
        args.nowIso,
      );
      args.statements.upsertSession.run(
        args.sessionDbId,
        args.projectId,
        args.discovered.provider,
        args.discovered.filePath,
        args.sessionTitle,
        args.modelNames,
        args.aggregate.startedAt ?? new Date(args.discovered.fileMtimeMs).toISOString(),
        args.aggregate.endedAt ?? new Date(args.discovered.fileMtimeMs).toISOString(),
        args.aggregate.durationMs,
        args.gitBranch,
        args.cwd,
        args.discovered.sessionIdentity,
        args.discovered.metadata.providerSessionId ?? args.discovered.sourceSessionId,
        args.discovered.metadata.sessionKind ?? "regular",
        args.discovered.canonicalProjectPath,
        args.discovered.metadata.repositoryUrl,
        args.discovered.metadata.gitCommitHash ?? null,
        args.discovered.metadata.lineageParentId ?? null,
        args.discovered.metadata.providerClient ?? null,
        args.discovered.metadata.providerSource ?? null,
        args.discovered.metadata.providerClientVersion ?? null,
        args.discovered.metadata.resolutionSource ?? null,
        stringifyCompactMetadata(args.discovered.metadata.sessionMetadata),
        args.discovered.metadata.worktreeLabel,
        args.discovered.metadata.worktreeSource,
        args.aggregate.messageCount,
        args.aggregate.tokenInputTotal,
        args.aggregate.tokenOutputTotal,
      );

      for (const message of args.messages) {
        insertIndexedMessage(args.statements, args.sessionDbId, message, {
          provider: args.discovered.provider,
          sessionId: args.discovered.sourceSessionId,
          filePath: args.discovered.filePath,
          onNotice: args.onNotice,
        });
        registerGenericToolEditFiles({
          statements: args.statements,
          discovered: args.discovered,
          message,
          persistedMessageId: makeMessageId(args.sessionDbId, message.id),
        });
      }

      args.statements.upsertIndexedFile.run(
        args.discovered.filePath,
        args.discovered.provider,
        args.discovered.canonicalProjectPath,
        args.discovered.sessionIdentity,
        args.discovered.fileSize,
        args.discovered.fileMtimeMs,
        args.nowIso,
      );
    });
    persist();
  } catch (error) {
    throw new IndexingFileProcessingError({
      provider: args.discovered.provider,
      sessionId: args.discovered.sourceSessionId,
      filePath: args.discovered.filePath,
      stage: "persist",
      error,
    });
  }
}

function prepareStreamedSessionPersistence(
  args: Pick<
    Parameters<typeof indexStreamedJsonlSessionFile>[0],
    "db" | "discovered" | "sessionDbId" | "nowIso" | "statements"
  >,
  shouldResume: boolean,
  projectId: string,
  sourceMetaAccumulator: ProviderSourceMetadataAccumulator,
  processingState: MessageProcessingState,
): void {
  if (!shouldResume) {
    deleteSessionDataForFilePath(args.statements, args.discovered.filePath);
    deleteSessionData(args.statements, args.sessionDbId);
  }
  args.statements.deleteCheckpointByFilePath.run(args.discovered.filePath);
  args.statements.upsertProject.run(
    projectId,
    args.discovered.provider,
    args.discovered.projectName,
    args.discovered.canonicalProjectPath,
    args.discovered.metadata.providerProjectKey ?? null,
    args.discovered.metadata.repositoryUrl,
    deriveResolutionState(args.discovered),
    args.discovered.metadata.resolutionSource ?? null,
    stringifyCompactMetadata(args.discovered.metadata.projectMetadata),
    args.nowIso,
    args.nowIso,
  );
  upsertSessionSummary(args.statements, {
    sessionDbId: args.sessionDbId,
    projectId,
    provider: args.discovered.provider,
    filePath: args.discovered.filePath,
    title: processingState.aggregate.title,
    modelNames:
      sourceMetaAccumulator.models.size > 0
        ? [...sourceMetaAccumulator.models].sort().join(",")
        : "",
    aggregate: finalizeSessionAggregate(processingState.aggregate),
    messageCount: processingState.aggregate.messageCount,
    tokenInputTotal: processingState.aggregate.tokenInputTotal,
    tokenOutputTotal: processingState.aggregate.tokenOutputTotal,
    fileMtimeMs: args.discovered.fileMtimeMs,
    gitBranch: sourceMetaAccumulator.gitBranch ?? args.discovered.metadata.gitBranch,
    cwd: sourceMetaAccumulator.cwd ?? args.discovered.metadata.cwd,
    sessionIdentity: args.discovered.sessionIdentity,
    providerSessionId:
      args.discovered.metadata.providerSessionId ?? args.discovered.sourceSessionId,
    sessionKind: args.discovered.metadata.sessionKind ?? "regular",
    canonicalProjectPath: args.discovered.canonicalProjectPath,
    repositoryUrl: args.discovered.metadata.repositoryUrl,
    gitCommitHash: args.discovered.metadata.gitCommitHash ?? null,
    lineageParentId: args.discovered.metadata.lineageParentId ?? null,
    providerClient: args.discovered.metadata.providerClient ?? null,
    providerSource: args.discovered.metadata.providerSource ?? null,
    providerClientVersion: args.discovered.metadata.providerClientVersion ?? null,
    resolutionSource: args.discovered.metadata.resolutionSource ?? null,
    metadataJson: stringifyCompactMetadata(args.discovered.metadata.sessionMetadata),
    worktreeLabel: args.discovered.metadata.worktreeLabel,
    worktreeSource: args.discovered.metadata.worktreeSource,
  });
}

function streamAndPersistJsonlEvents(args: {
  db: SqliteDatabase;
  adapter: ReturnType<typeof getProviderAdapter>;
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  parserDiagnostics: ParserDiagnostic[];
  processingState: MessageProcessingState;
  sessionDbId: string;
  sourceMetaAccumulator: ProviderSourceMetadataAccumulator;
  statements: IndexingStatements;
  resumeCheckpoint: ResumeCheckpoint | null;
  prefetchedJsonlChunk: PrefetchedJsonlChunk | null;
  onNotice: (notice: IndexingNotice) => void;
}): { sequence: number; emittedEvents: number; streamResult: StreamJsonlResult } {
  let sequence = args.resumeCheckpoint?.nextMessageSequence ?? 0;
  let emittedEvents = 0;
  const claudeNormalizationState =
    args.discovered.provider === "claude"
      ? createClaudeTurnNormalizationState(args.discovered)
      : null;
  try {
    const streamResult = streamJsonlEvents(args.discovered.filePath, {
      adapter: args.adapter,
      startOffsetBytes: args.resumeCheckpoint?.lastOffsetBytes ?? 0,
      startLineNumber: args.resumeCheckpoint?.lastLineNumber ?? 0,
      startEventIndex: args.resumeCheckpoint?.lastEventIndex ?? 0,
      prefetchedJsonlChunk:
        args.prefetchedJsonlChunk &&
        args.prefetchedJsonlChunk.startOffsetBytes ===
          (args.resumeCheckpoint?.lastOffsetBytes ?? 0) &&
        args.prefetchedJsonlChunk.fileSize === args.discovered.fileSize &&
        args.prefetchedJsonlChunk.fileMtimeMs === args.discovered.fileMtimeMs
          ? args.prefetchedJsonlChunk
          : null,
      onEvent: (event, eventIndex, rescueNotice) => {
        emittedEvents += 1;
        if (rescueNotice) {
          recordRescuedOversizedJsonlLine(args.parserDiagnostics, args.discovered, rescueNotice);
          args.onNotice({
            provider: args.discovered.provider,
            sessionId: args.discovered.sourceSessionId,
            filePath: args.discovered.filePath,
            stage: "parse",
            severity: rescueNotice.severity,
            code: "parser.oversized_jsonl_line_rescued",
            message: rescueNotice.message,
            ...(rescueNotice.details ? { details: rescueNotice.details } : {}),
          });
        }
        args.adapter.updateSourceMetadataFromEvent?.(event, args.sourceMetaAccumulator);
        sequence = parseAndPersistStreamEvent({
          db: args.db,
          discovered: args.discovered,
          event,
          eventIndex,
          parserDiagnostics: args.parserDiagnostics,
          processingState: args.processingState,
          sequence,
          sessionDbId: args.sessionDbId,
          statements: args.statements,
          onNotice: args.onNotice,
          claudeNormalizationState,
        });
      },
      onOmittedLine: (omitted) => {
        emittedEvents += 1;
        flushPendingCodexUserMessages({
          discovered: args.discovered,
          processingState: args.processingState,
          sessionDbId: args.sessionDbId,
          statements: args.statements,
          onNotice: args.onNotice,
          claudeNormalizationState,
          classification: "user_prompt",
        });
        persistStreamMessage({
          discovered: args.discovered,
          processingState: args.processingState,
          sessionDbId: args.sessionDbId,
          statements: args.statements,
          onNotice: args.onNotice,
          claudeNormalizationState,
          message: buildOversizedJsonlOmissionMessage(
            args.discovered,
            args.processingState,
            omitted,
            sequence,
          ),
        });
        sequence += 1;
        recordOversizedJsonlLineOmitted(
          args.parserDiagnostics,
          args.discovered,
          omitted,
          args.onNotice,
        );
      },
      onInvalidLine: (lineNumber, error) => {
        recordInvalidJsonlLine(
          args.parserDiagnostics,
          args.discovered,
          lineNumber,
          error,
          args.onNotice,
        );
      },
    });
    flushPendingCodexUserMessages({
      discovered: args.discovered,
      processingState: args.processingState,
      sessionDbId: args.sessionDbId,
      statements: args.statements,
      onNotice: args.onNotice,
      claudeNormalizationState,
      classification: "user_prompt",
    });
    return { sequence, emittedEvents, streamResult };
  } catch (error) {
    if (error instanceof IndexingFileProcessingError) {
      throw error;
    }
    throw new IndexingFileProcessingError({
      provider: args.discovered.provider,
      sessionId: args.discovered.sourceSessionId,
      filePath: args.discovered.filePath,
      stage: "read",
      error,
    });
  }
}

function parseAndPersistStreamEvent(args: {
  db: SqliteDatabase;
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  event: unknown;
  eventIndex: number;
  parserDiagnostics: ParserDiagnostic[];
  processingState: MessageProcessingState;
  sequence: number;
  sessionDbId: string;
  statements: IndexingStatements;
  onNotice: (notice: IndexingNotice) => void;
  claudeNormalizationState: ClaudeTurnNormalizationState | null;
}): number {
  const eventRecord = asRecord(args.event);
  updateProviderTurnGroupingStateBeforeEvent(
    args.processingState,
    args.discovered.provider,
    eventRecord,
  );
  maybeFlushPendingCodexUserMessagesBeforeEvent({
    discovered: args.discovered,
    processingState: args.processingState,
    sessionDbId: args.sessionDbId,
    statements: args.statements,
    onNotice: args.onNotice,
    claudeNormalizationState: args.claudeNormalizationState,
    eventRecord,
  });

  let parsedEvent: ReturnType<typeof parseSessionEvent>;
  try {
    parsedEvent = parseSessionEvent({
      provider: args.discovered.provider,
      sessionId: args.discovered.sourceSessionId,
      eventIndex: args.eventIndex,
      event: args.event,
      diagnostics: args.parserDiagnostics,
      sequence: args.sequence,
    });
  } catch (error) {
    throw new IndexingFileProcessingError({
      provider: args.discovered.provider,
      sessionId: args.discovered.sourceSessionId,
      filePath: args.discovered.filePath,
      stage: "parse",
      error,
    });
  }

  if (shouldSkipDuplicateClaudeCompactBoundaryEvent(args, parsedEvent.messages)) {
    return parsedEvent.nextSequence;
  }

  const preparedMessages = prepareMessagesForPersistence({
    provider: args.discovered.provider,
    event: args.event,
    eventRecord,
    processingState: args.processingState,
    messages: parsedEvent.messages,
  });

  for (const message of preparedMessages.immediateMessages) {
    if (!message) {
      continue;
    }
    persistStreamMessage({
      discovered: args.discovered,
      processingState: args.processingState,
      sessionDbId: args.sessionDbId,
      statements: args.statements,
      onNotice: args.onNotice,
      claudeNormalizationState: args.claudeNormalizationState,
      message,
    });
  }

  args.processingState.pendingCodexUserMessages.push(...preparedMessages.deferredCodexUserMessages);

  processClaudeSnapshotEvent({
    db: args.db,
    discovered: args.discovered,
    event: args.event,
    sessionDbId: args.sessionDbId,
    statements: args.statements,
    claudeNormalizationState: args.claudeNormalizationState,
  });

  updateProviderTurnGroupingStateAfterEvent(
    args.processingState,
    args.discovered.provider,
    eventRecord,
  );

  return parsedEvent.nextSequence;
}

function prepareMessagesForPersistence(args: {
  provider: Provider;
  event: unknown;
  eventRecord: Record<string, unknown> | null;
  processingState: MessageProcessingState;
  messages: IndexedMessage[];
}): {
  immediateMessages: IndexedMessage[];
  deferredCodexUserMessages: PendingCodexUserMessage[];
} {
  if (args.provider === "claude") {
    return {
      immediateMessages: annotateClaudeMessagesForEvent(
        args.processingState,
        args.eventRecord,
        args.messages,
      ),
      deferredCodexUserMessages: [],
    };
  }

  if (args.provider === "codex") {
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

  return {
    immediateMessages: args.messages,
    deferredCodexUserMessages: [],
  };
}

function annotateClaudeMessagesForEvent(
  state: MessageProcessingState,
  eventRecord: Record<string, unknown> | null,
  messages: IndexedMessage[],
): IndexedMessage[] {
  if (messages.length === 0) {
    return messages;
  }

  const messageRecord = asRecord(eventRecord?.message);
  const normalized = messageRecord ?? eventRecord;
  const eventId =
    readString(eventRecord?.uuid) ??
    readString(eventRecord?.id) ??
    readString(normalized?.uuid) ??
    readString(normalized?.id) ??
    null;
  const parentEventId =
    readString(eventRecord?.parentUuid) ??
    readString(eventRecord?.parent_uuid) ??
    readString(normalized?.parentUuid) ??
    readString(normalized?.parent_uuid) ??
    null;
  const userAnchorId = messages.find((message) => message.category === "user")?.id ?? null;
  const eventTurnGroupId =
    userAnchorId ??
    (parentEventId ? (state.claudeTurnRootByEventId[parentEventId] ?? null) : null) ??
    state.currentTurnGroupId;

  if (eventId && eventTurnGroupId) {
    trackClaudeTurnRootEvent(state, eventId, eventTurnGroupId);
  }
  if (eventTurnGroupId) {
    state.currentTurnGroupId = eventTurnGroupId;
    state.currentNativeTurnId = eventTurnGroupId;
  }

  return messages.map((message) => ({
    ...message,
    turnGroupId: eventTurnGroupId,
    turnGroupingMode: "native",
    turnAnchorKind: message.id === userAnchorId ? "user_prompt" : null,
    nativeTurnId: eventTurnGroupId,
  }));
}

function annotateCodexImmediateMessage(
  state: MessageProcessingState,
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

function updateProviderTurnGroupingStateBeforeEvent(
  state: MessageProcessingState,
  provider: Provider,
  eventRecord: Record<string, unknown> | null,
): void {
  if (provider !== "codex" || !eventRecord) {
    return;
  }
  const nextNativeTurnId = extractCodexNativeTurnId(eventRecord);
  if (nextNativeTurnId) {
    state.currentNativeTurnId = nextNativeTurnId;
  }
}

function updateProviderTurnGroupingStateAfterEvent(
  state: MessageProcessingState,
  provider: Provider,
  eventRecord: Record<string, unknown> | null,
): void {
  if (provider !== "codex" || !eventRecord) {
    return;
  }
  const payloadRecord = asRecord(eventRecord.payload);
  const payloadType = lowerString(payloadRecord?.type);
  if (
    readString(eventRecord.type) === "event_msg" &&
    (payloadType === "task_complete" || payloadType === "turn_aborted")
  ) {
    state.currentNativeTurnId = null;
    state.currentTurnGroupId = null;
  }
}

function maybeFlushPendingCodexUserMessagesBeforeEvent(args: {
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  processingState: MessageProcessingState;
  sessionDbId: string;
  statements: IndexingStatements;
  onNotice: (notice: IndexingNotice) => void;
  claudeNormalizationState: ClaudeTurnNormalizationState | null;
  eventRecord: Record<string, unknown> | null;
}): void {
  if (
    args.discovered.provider !== "codex" ||
    args.processingState.pendingCodexUserMessages.length === 0
  ) {
    return;
  }

  const classification = classifyPendingCodexUserMessages(args.eventRecord);
  if (classification === "wait") {
    return;
  }

  flushPendingCodexUserMessages({
    discovered: args.discovered,
    processingState: args.processingState,
    sessionDbId: args.sessionDbId,
    statements: args.statements,
    onNotice: args.onNotice,
    claudeNormalizationState: args.claudeNormalizationState,
    classification: classification ?? "user_prompt",
  });
}

function classifyPendingCodexUserMessages(
  eventRecord: Record<string, unknown> | null,
): TurnAnchorKind | "wait" | null {
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

function flushPendingCodexUserMessages(args: {
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  processingState: MessageProcessingState;
  sessionDbId: string;
  statements: IndexingStatements;
  onNotice: (notice: IndexingNotice) => void;
  claudeNormalizationState: ClaudeTurnNormalizationState | null;
  classification: TurnAnchorKind;
}): void {
  if (args.processingState.pendingCodexUserMessages.length === 0) {
    return;
  }

  const pending = args.processingState.pendingCodexUserMessages.splice(0);
  for (const entry of pending) {
    const annotated = annotateFlushedCodexUserMessage(
      args.processingState,
      entry,
      args.classification,
    );
    persistStreamMessage({
      discovered: args.discovered,
      processingState: args.processingState,
      sessionDbId: args.sessionDbId,
      statements: args.statements,
      onNotice: args.onNotice,
      claudeNormalizationState: args.claudeNormalizationState,
      message: annotated,
    });
  }
}

function annotateFlushedCodexUserMessage(
  state: MessageProcessingState,
  entry: PendingCodexUserMessage,
  classification: TurnAnchorKind,
): IndexedMessage {
  const nativeTurnId = entry.nativeTurnId ?? state.currentNativeTurnId;
  const shouldStartNewDisplayedTurn =
    classification === "user_prompt" &&
    (!state.currentTurnGroupId ||
      !nativeTurnId ||
      !state.currentNativeTurnId ||
      nativeTurnId !== state.currentNativeTurnId);
  const turnGroupId =
    classification === "user_prompt"
      ? shouldStartNewDisplayedTurn
        ? entry.message.id
        : (state.currentTurnGroupId ?? entry.message.id)
      : state.currentTurnGroupId;

  if (classification === "user_prompt") {
    state.currentTurnGroupId = turnGroupId ?? entry.message.id;
    state.currentNativeTurnId = nativeTurnId;
  }

  return {
    ...entry.message,
    turnGroupId: turnGroupId ?? null,
    turnGroupingMode: "hybrid",
    turnAnchorKind: classification,
    nativeTurnId,
  };
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

function persistStreamMessage(args: {
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  processingState: MessageProcessingState;
  sessionDbId: string;
  statements: IndexingStatements;
  onNotice: (notice: IndexingNotice) => void;
  claudeNormalizationState: ClaudeTurnNormalizationState | null;
  message: IndexedMessage;
}): void {
  const stateSnapshot = snapshotMessageNormalizationState(args.processingState);
  const normalizedMessage = normalizeIndexedMessage(args.processingState, args.message);
  const duplicateResolution = resolveStreamDuplicateMessage({
    statements: args.statements,
    sessionDbId: args.sessionDbId,
    message: normalizedMessage,
  });

  if (duplicateResolution.kind === "skip") {
    restoreMessageNormalizationState(args.processingState, stateSnapshot);
    args.onNotice({
      provider: args.discovered.provider,
      sessionId: args.discovered.sourceSessionId,
      filePath: args.discovered.filePath,
      stage: "persist",
      severity: "warning",
      code: "index.duplicate_message_skipped",
      message: `Skipped duplicate streamed message ${args.message.id}.`,
      details: {
        messageId: args.message.id,
        duplicateOf: duplicateResolution.existingSourceId,
      },
    });
    return;
  }

  const messageToPersist =
    duplicateResolution.sourceId === normalizedMessage.id
      ? normalizedMessage
      : normalizeDuplicateStreamMessage(args, stateSnapshot, duplicateResolution.sourceId);

  if (duplicateResolution.sourceId !== normalizedMessage.id) {
    args.onNotice({
      provider: args.discovered.provider,
      sessionId: args.discovered.sourceSessionId,
      filePath: args.discovered.filePath,
      stage: "persist",
      severity: "warning",
      code: "index.duplicate_message_rewritten",
      message: `Rewrote duplicate streamed message ${args.message.id} to ${duplicateResolution.sourceId}.`,
      details: {
        messageId: args.message.id,
        rewrittenMessageId: duplicateResolution.sourceId,
      },
    });
  }

  const persistedMessageId = makeMessageId(args.sessionDbId, messageToPersist.id);
  try {
    insertIndexedMessage(args.statements, args.sessionDbId, messageToPersist, {
      provider: args.discovered.provider,
      sessionId: args.discovered.sourceSessionId,
      filePath: args.discovered.filePath,
      onNotice: args.onNotice,
    });
  } catch (error) {
    throw new IndexingFileProcessingError({
      provider: args.discovered.provider,
      sessionId: args.discovered.sourceSessionId,
      filePath: args.discovered.filePath,
      stage: "persist",
      error,
    });
  }

  registerClaudeToolEditCandidate({
    statements: args.statements,
    discovered: args.discovered,
    claudeNormalizationState: args.claudeNormalizationState,
    message: messageToPersist,
    persistedMessageId,
  });
  registerGenericToolEditFiles({
    statements: args.statements,
    discovered: args.discovered,
    message: messageToPersist,
    persistedMessageId,
  });
}

function registerGenericToolEditFiles(args: {
  statements: IndexingStatements;
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  message: IndexedMessage;
  persistedMessageId: string;
}): void {
  if (args.discovered.provider === "claude" || args.message.category !== "tool_edit") {
    return;
  }

  const files = parseGenericToolEditFiles(args.message.content);
  for (const [index, file] of files.entries()) {
    upsertMessageToolEditFile(args.statements, {
      id: makeToolCallId(args.persistedMessageId, 1000 + index),
      messageId: args.persistedMessageId,
      fileOrdinal: index,
      filePath: file.filePath,
      previousFilePath: file.previousFilePath,
      changeType: file.changeType,
      unifiedDiff: file.unifiedDiff,
      addedLineCount: file.addedLineCount,
      removedLineCount: file.removedLineCount,
      exactness: file.exactness,
      beforeHash: file.beforeHash,
      afterHash: file.afterHash,
    });
  }
}

function parseGenericToolEditFiles(content: string): Array<{
  filePath: string;
  previousFilePath: string | null;
  changeType: ToolEditChangeType;
  unifiedDiff: string | null;
  addedLineCount: number;
  removedLineCount: number;
  exactness: ToolEditExactness;
  beforeHash: string | null;
  afterHash: string | null;
}> {
  const record = tryParseJsonRecord(content);
  if (!record) {
    return [];
  }

  const payload = asRecord(record.input) ?? asRecord(record.args) ?? record;
  const toolName =
    readString(record.name) ??
    readString(record.tool_name) ??
    readString(record.tool) ??
    readString(record.operation) ??
    "";
  const filePath =
    readString(payload?.filePath) ??
    readString(payload?.file_path) ??
    readString(payload?.path) ??
    readString(payload?.file) ??
    null;
  if (!filePath) {
    return [];
  }

  const previousFilePath =
    readString(payload?.previousFilePath) ??
    readString(payload?.previous_file_path) ??
    readString(payload?.oldPath) ??
    readString(payload?.old_path) ??
    null;
  const oldText =
    readString(payload?.oldString) ??
    readString(payload?.old_string) ??
    readString(payload?.oldText) ??
    readString(payload?.before) ??
    null;
  const newText =
    readString(payload?.newString) ??
    readString(payload?.new_string) ??
    readString(payload?.newText) ??
    readString(payload?.content) ??
    readString(payload?.text) ??
    readString(payload?.after) ??
    null;
  const unifiedDiff =
    readString(payload?.unifiedDiff) ??
    readString(payload?.unified_diff) ??
    readString(payload?.diff) ??
    readString(payload?.patch) ??
    null;
  const changeType = inferGenericToolEditChangeType({
    toolName,
    filePath,
    previousFilePath,
    oldText,
    newText,
  });
  const lineCounts = summarizeGenericToolEditLineCounts({
    filePath,
    changeType,
    oldText,
    newText,
    unifiedDiff,
  });

  return [
    {
      filePath,
      previousFilePath,
      changeType,
      unifiedDiff,
      addedLineCount: lineCounts.addedLineCount,
      removedLineCount: lineCounts.removedLineCount,
      exactness: "best_effort",
      beforeHash: oldText === null ? null : hashText(oldText),
      afterHash: newText === null ? null : hashText(newText),
    },
  ];
}

function inferGenericToolEditChangeType(args: {
  toolName: string;
  filePath: string;
  previousFilePath: string | null;
  oldText: string | null;
  newText: string | null;
}): ToolEditChangeType {
  const toolName = args.toolName.trim().toLowerCase();
  if (args.previousFilePath && args.previousFilePath !== args.filePath) {
    return "move";
  }
  if (toolName.includes("delete") || toolName.includes("remove")) {
    return "delete";
  }
  if (toolName.includes("move") || toolName.includes("rename")) {
    return "move";
  }
  if (args.oldText === null && args.newText !== null) {
    return toolName.includes("edit") ? "update" : "add";
  }
  if (args.oldText !== null && args.newText === null) {
    return "delete";
  }
  return "update";
}

function summarizeGenericToolEditLineCounts(args: {
  filePath: string;
  changeType: ToolEditChangeType;
  oldText: string | null;
  newText: string | null;
  unifiedDiff: string | null;
}): {
  addedLineCount: number;
  removedLineCount: number;
} {
  if (args.unifiedDiff) {
    return countUnifiedDiffLines(args.unifiedDiff);
  }
  if (args.oldText !== null && args.newText !== null) {
    return countUnifiedDiffLines(
      buildUnifiedDiffFromTextPair({
        oldText: args.oldText,
        newText: args.newText,
        filePath: args.filePath,
      }),
    );
  }
  if (args.changeType === "add" && args.newText !== null) {
    return { addedLineCount: countTextLines(args.newText), removedLineCount: 0 };
  }
  if (args.changeType === "delete" && args.oldText !== null) {
    return { addedLineCount: 0, removedLineCount: countTextLines(args.oldText) };
  }
  return { addedLineCount: 0, removedLineCount: 0 };
}

function countTextLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const normalized = text.replace(/\r\n/g, "\n");
  let lineCount = 1;
  for (const char of normalized) {
    if (char === "\n") {
      lineCount += 1;
    }
  }
  if (normalized.endsWith("\n")) {
    lineCount -= 1;
  }
  return Math.max(lineCount, 0);
}

function createClaudeTurnNormalizationState(
  discovered: ReturnType<typeof discoverSessionFiles>[number],
): ClaudeTurnNormalizationState {
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

function resolveClaudeFileHistoryDirectory(filePath: string, sessionId: string): string | null {
  const projectsDirectory = dirname(filePath);
  const claudeRoot = dirname(dirname(projectsDirectory));
  if (basename(claudeRoot) !== ".claude") {
    return null;
  }
  return join(claudeRoot, "file-history", sessionId);
}

function registerClaudeToolEditCandidate(args: {
  statements: IndexingStatements;
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  claudeNormalizationState: ClaudeTurnNormalizationState | null;
  message: IndexedMessage;
  persistedMessageId: string;
}): void {
  if (args.discovered.provider !== "claude" || !args.claudeNormalizationState) {
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
    args.claudeNormalizationState.pendingBySourceId.get(sourceId) ??
    args.claudeNormalizationState.pendingBySourceId.get(sourceId.split("#")[0] ?? sourceId) ??
    [];
  pending.push(candidate);
  args.claudeNormalizationState.pendingBySourceId.set(sourceId.split("#")[0] ?? sourceId, pending);

  const provisional = buildBestEffortClaudeToolEditFile({
    candidate,
    fileHistoryDirectory: args.claudeNormalizationState.fileHistoryDirectory,
    previousSnapshotByPath: args.claudeNormalizationState.previousSnapshotByPath,
    backupTextByName: args.claudeNormalizationState.backupTextByName,
    currentTextByPath: args.claudeNormalizationState.currentTextByPath,
  });
  if (!provisional) {
    return;
  }
  rememberClaudeCurrentText(
    args.claudeNormalizationState.currentTextByPath,
    candidate,
    provisional.currentText,
  );
  upsertMessageToolEditFile(args.statements, {
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

function processClaudeSnapshotEvent(args: {
  db: SqliteDatabase;
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  event: unknown;
  sessionDbId: string;
  statements: IndexingStatements;
  claudeNormalizationState: ClaudeTurnNormalizationState | null;
}): void {
  if (args.discovered.provider !== "claude" || !args.claudeNormalizationState) {
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
    const previous = args.claudeNormalizationState.previousSnapshotByPath.get(filePath);
    if (!previous || !isSameClaudeSnapshotEntry(previous, entry)) {
      changedPaths.push(filePath);
    }
  }
  args.claudeNormalizationState.previousSnapshotByPath = currentSnapshotByPath;

  const pending =
    args.claudeNormalizationState.pendingBySourceId.get(sourceId) ??
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
      fileHistoryDirectory: args.claudeNormalizationState.fileHistoryDirectory,
      backupTextByName: args.claudeNormalizationState.backupTextByName,
    });
    if (normalized) {
      rememberClaudeCurrentText(
        args.claudeNormalizationState.currentTextByPath,
        candidate,
        normalized.currentText,
      );
      upsertMessageToolEditFile(args.statements, {
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
    args.claudeNormalizationState.pendingBySourceId.delete(sourceId);
  }
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
  changeType: ToolEditChangeType;
  unifiedDiff: string | null;
  addedLineCount: number;
  removedLineCount: number;
  exactness: ToolEditExactness;
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
  discovered: ReturnType<typeof discoverSessionFiles>[number];
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
  const output: ClaudePendingToolEdit[] = [];
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
    output.push({
      messageDbId: row.id,
      sourceId: row.source_id,
      fileOrdinal: 0,
      filePath,
      comparisonPath: normalizeClaudeComparisonPath(filePath, args.discovered.metadata.cwd),
      toolName,
      input: input ?? {},
    });
  }
  return output;
}

function buildExactClaudeToolEditFile(args: {
  candidate: ClaudePendingToolEdit;
  snapshotEntry: ClaudeSnapshotFileEntry;
  fileHistoryDirectory: string | null;
  backupTextByName: Map<string, string | null>;
}): {
  filePath: string;
  previousFilePath: string | null;
  changeType: ToolEditChangeType;
  unifiedDiff: string | null;
  addedLineCount: number;
  removedLineCount: number;
  exactness: ToolEditExactness;
  beforeHash: string | null;
  afterHash: string | null;
  currentText: string | null;
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
  cache: Map<string, string | null>,
): string | null {
  if (!fileHistoryDirectory || !backupFileName) {
    return null;
  }
  if (cache.has(backupFileName)) {
    return cache.get(backupFileName) ?? null;
  }
  try {
    const text = readFileSync(join(fileHistoryDirectory, backupFileName), "utf8");
    cache.set(backupFileName, text);
    return text;
  } catch {
    cache.set(backupFileName, null);
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

function upsertMessageToolEditFile(
  statements: IndexingStatements,
  row: {
    id: string;
    messageId: string;
    fileOrdinal: number;
    filePath: string;
    previousFilePath: string | null;
    changeType: ToolEditChangeType;
    unifiedDiff: string | null;
    addedLineCount: number;
    removedLineCount: number;
    exactness: ToolEditExactness;
    beforeHash: string | null;
    afterHash: string | null;
  },
): void {
  statements.upsertMessageToolEditFile.run(
    row.id,
    row.messageId,
    row.fileOrdinal,
    row.filePath,
    row.previousFilePath,
    row.changeType,
    row.unifiedDiff,
    row.addedLineCount,
    row.removedLineCount,
    row.exactness,
    row.beforeHash,
    row.afterHash,
  );
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

function recordInvalidJsonlLine(
  parserDiagnostics: ParserDiagnostic[],
  discovered: ReturnType<typeof discoverSessionFiles>[number],
  lineNumber: number,
  error: unknown,
  onNotice: (notice: IndexingNotice) => void,
): void {
  const noticeMessage = error instanceof Error ? error.message : String(error);
  parserDiagnostics.push({
    severity: "warning",
    code: "parser.invalid_jsonl_line",
    provider: discovered.provider,
    sessionId: discovered.sourceSessionId,
    eventIndex: lineNumber - 1,
    message: noticeMessage,
  });
  onNotice({
    provider: discovered.provider,
    sessionId: discovered.sourceSessionId,
    filePath: discovered.filePath,
    stage: "parse",
    severity: "warning",
    code: "parser.invalid_jsonl_line",
    message: noticeMessage,
    details: { lineNumber },
  });
}

function recordOversizedJsonlLineOmitted(
  parserDiagnostics: ParserDiagnostic[],
  discovered: ReturnType<typeof discoverSessionFiles>[number],
  omitted: OmittedJsonlLine,
  onNotice: (notice: IndexingNotice) => void,
): void {
  const message = `JSONL line ${omitted.lineNumber} exceeded the ${formatByteLimit(omitted.limitBytes)} rescue ceiling and was omitted.`;
  parserDiagnostics.push({
    severity: "warning",
    code: "parser.oversized_jsonl_line_omitted",
    provider: discovered.provider,
    sessionId: discovered.sourceSessionId,
    eventIndex: omitted.lineNumber - 1,
    message,
  });
  onNotice({
    provider: discovered.provider,
    sessionId: discovered.sourceSessionId,
    filePath: discovered.filePath,
    stage: "parse",
    severity: "warning",
    code: "parser.oversized_jsonl_line_omitted",
    message,
    details: {
      lineNumber: omitted.lineNumber,
      lineBytes: omitted.lineBytes,
      rescueLimitBytes: omitted.limitBytes,
    },
  });
}

function recordRescuedOversizedJsonlLine(
  parserDiagnostics: ParserDiagnostic[],
  discovered: ReturnType<typeof discoverSessionFiles>[number],
  rescueNotice: JsonlRescueNotice,
): void {
  const lineNumber =
    typeof rescueNotice.details?.lineNumber === "number" ? rescueNotice.details.lineNumber : null;
  parserDiagnostics.push({
    severity: "warning",
    code: "parser.oversized_jsonl_line_rescued",
    provider: discovered.provider,
    sessionId: discovered.sourceSessionId,
    eventIndex: lineNumber === null ? null : lineNumber - 1,
    message: rescueNotice.message,
  });
}

function buildOversizedJsonlOmissionMessage(
  discovered: ReturnType<typeof discoverSessionFiles>[number],
  processingState: MessageProcessingState,
  omitted: OmittedJsonlLine,
  sequence: number,
): IndexedMessage {
  // Leave createdAt unresolved when there is no reliable prior event timestamp. The shared
  // normalizer will fall back to the file mtime in that case.
  const createdAt =
    Number.isFinite(processingState.previousTimestampMs) && processingState.previousTimestampMs > 0
      ? new Date(processingState.previousTimestampMs + 1000).toISOString()
      : "";
  return buildSyntheticSystemMessage(
    discovered.provider,
    discovered.sourceSessionId,
    `oversized-jsonl-line-${omitted.lineNumber}-${sequence}`,
    [
      "Oversized JSONL line omitted.",
      `line=${omitted.lineNumber}`,
      `bytes=${omitted.lineBytes}`,
      `rescue_limit_bytes=${omitted.limitBytes}`,
    ].join(" "),
    createdAt,
  );
}

function persistStreamCheckpoint(args: {
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  nowIso: string;
  resumeCheckpoint: ResumeCheckpoint | null;
  sequence: number;
  sessionDbId: string;
  processingState: MessageProcessingState;
  sourceMetaAccumulator: ProviderSourceMetadataAccumulator;
  statements: IndexingStatements;
  streamResult: StreamJsonlResult | null;
}): void {
  const hashes = computeFileHashes(args.discovered.filePath, args.discovered.fileSize);
  const checkpoint = buildStreamCheckpointState({
    discovered: args.discovered,
    sessionDbId: args.sessionDbId,
    sequence: args.sequence,
    processingState: args.processingState,
    sourceMetaAccumulator: args.sourceMetaAccumulator,
    streamResult:
      args.streamResult ??
      ({
        nextOffsetBytes: args.resumeCheckpoint?.lastOffsetBytes ?? 0,
        nextLineNumber: args.resumeCheckpoint?.lastLineNumber ?? 0,
        nextEventIndex: args.resumeCheckpoint?.lastEventIndex ?? 0,
      } satisfies StreamJsonlResult),
    hashes,
  });
  args.statements.upsertCheckpoint.run(
    checkpoint.filePath,
    checkpoint.provider,
    checkpoint.sessionDbId,
    checkpoint.sessionIdentity,
    checkpoint.fileSize,
    checkpoint.fileMtimeMs,
    checkpoint.lastOffsetBytes,
    checkpoint.lastLineNumber,
    checkpoint.lastEventIndex,
    checkpoint.nextMessageSequence,
    JSON.stringify(checkpoint.processingState),
    JSON.stringify(checkpoint.sourceMetadata),
    checkpoint.headHash,
    checkpoint.tailHash,
    args.nowIso,
  );
}

function createMessageProcessingState(
  provider: Provider,
  fileMtimeMs: number,
  systemMessageRules: RegExp[],
  checkpoint?: SerializableMessageProcessingState,
): MessageProcessingState {
  const claudeTurnRootByEventId = checkpoint?.claudeTurnRootByEventId ?? {};
  const claudeTurnRootEventIds = (
    checkpoint?.claudeTurnRootEventIds?.filter((eventId) => eventId in claudeTurnRootByEventId) ??
    Object.keys(claudeTurnRootByEventId)
  ).slice(-CLAUDE_TURN_ROOT_EVENT_ID_LIMIT);
  const limitedClaudeTurnRootByEventId = Object.fromEntries(
    claudeTurnRootEventIds.flatMap((eventId) => {
      const turnRootId = claudeTurnRootByEventId[eventId];
      return turnRootId ? [[eventId, turnRootId]] : [];
    }),
  );
  return {
    provider,
    fileMtimeMs,
    systemMessageRules,
    previousMessage: checkpoint?.previousMessage ?? null,
    previousTimestampMs:
      checkpoint?.previousTimestampMs ??
      checkpoint?.previousCursorTimestampMs ??
      Number.NEGATIVE_INFINITY,
    assistantThinkingRunRoot: checkpoint?.assistantThinkingRunRoot ?? null,
    assistantThinkingRunBaseline: checkpoint?.assistantThinkingRunBaseline ?? null,
    currentTurnGroupId: checkpoint?.currentTurnGroupId ?? null,
    currentNativeTurnId: checkpoint?.currentNativeTurnId ?? null,
    claudeTurnRootByEventId: limitedClaudeTurnRootByEventId,
    claudeTurnRootEventIds,
    pendingCodexUserMessages:
      checkpoint?.pendingCodexUserMessages
        ?.map((entry) =>
          entry.message
            ? {
                message: entry.message,
                nativeTurnId: entry.nativeTurnId,
              }
            : null,
        )
        .filter((entry): entry is PendingCodexUserMessage => entry !== null) ?? [],
    aggregate: checkpoint?.aggregate ?? { ...DEFAULT_SESSION_AGGREGATE_STATE },
  };
}

function snapshotMessageProcessingState(
  state: MessageProcessingState,
): SerializableMessageProcessingState {
  return {
    previousMessage: state.previousMessage,
    previousTimestampMs: state.previousTimestampMs,
    assistantThinkingRunRoot: state.assistantThinkingRunRoot,
    assistantThinkingRunBaseline: state.assistantThinkingRunBaseline,
    currentTurnGroupId: state.currentTurnGroupId,
    currentNativeTurnId: state.currentNativeTurnId,
    claudeTurnRootByEventId: state.claudeTurnRootByEventId,
    claudeTurnRootEventIds: state.claudeTurnRootEventIds,
    pendingCodexUserMessages: state.pendingCodexUserMessages.map((entry) => ({
      message: entry.message,
      nativeTurnId: entry.nativeTurnId,
    })),
    aggregate: { ...state.aggregate },
  };
}

function snapshotMessageNormalizationState(
  state: MessageProcessingState,
): MessageNormalizationSnapshot {
  return {
    previousMessage: state.previousMessage,
    previousTimestampMs: state.previousTimestampMs,
    assistantThinkingRunRoot: state.assistantThinkingRunRoot,
    assistantThinkingRunBaseline: state.assistantThinkingRunBaseline,
    aggregate: { ...state.aggregate },
  };
}

function restoreMessageProcessingState(
  state: MessageProcessingState,
  snapshot: SerializableMessageProcessingState,
): void {
  state.previousMessage = snapshot.previousMessage;
  state.previousTimestampMs = snapshot.previousTimestampMs;
  state.assistantThinkingRunRoot = snapshot.assistantThinkingRunRoot;
  state.assistantThinkingRunBaseline = snapshot.assistantThinkingRunBaseline;
  state.currentTurnGroupId = snapshot.currentTurnGroupId;
  state.currentNativeTurnId = snapshot.currentNativeTurnId;
  state.claudeTurnRootByEventId = snapshot.claudeTurnRootByEventId;
  state.claudeTurnRootEventIds =
    snapshot.claudeTurnRootEventIds?.filter(
      (eventId) => eventId in snapshot.claudeTurnRootByEventId,
    ) ?? Object.keys(snapshot.claudeTurnRootByEventId);
  state.pendingCodexUserMessages = snapshot.pendingCodexUserMessages
    .map((entry) =>
      entry.message
        ? {
            message: entry.message,
            nativeTurnId: entry.nativeTurnId,
          }
        : null,
    )
    .filter((entry): entry is PendingCodexUserMessage => entry !== null);
  state.aggregate = { ...snapshot.aggregate };
}

function restoreMessageNormalizationState(
  state: MessageProcessingState,
  snapshot: MessageNormalizationSnapshot,
): void {
  state.previousMessage = snapshot.previousMessage;
  state.previousTimestampMs = snapshot.previousTimestampMs;
  state.assistantThinkingRunRoot = snapshot.assistantThinkingRunRoot;
  state.assistantThinkingRunBaseline = snapshot.assistantThinkingRunBaseline;
  state.aggregate = { ...snapshot.aggregate };
}

function trackClaudeTurnRootEvent(
  state: MessageProcessingState,
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

function normalizeIndexedMessage(
  state: MessageProcessingState,
  message: IndexedMessage,
): IndexedMessage {
  const reclassified = reclassifySystemMessage(message, state.systemMessageRules);
  const timestamped = normalizeMessageTimestamp(reclassified, state);
  const withDuration = deriveOperationDuration(timestamped, state);
  const limited = applyIndexingContentLimits(withDuration);
  updateSessionAggregateState(state.aggregate, limited);
  state.previousMessage = limited;
  return limited;
}

function reclassifySystemMessage(message: IndexedMessage, rules: RegExp[]): IndexedMessage {
  if (message.category === "system" || rules.length === 0) {
    return message;
  }
  if (!rules.some((rule) => rule.test(message.content))) {
    return message;
  }
  return {
    ...message,
    category: "system",
  };
}

function normalizeMessageTimestamp(
  message: IndexedMessage,
  state: MessageProcessingState,
): IndexedMessage {
  const normalized = getProviderAdapter(state.provider).normalizeMessageTimestamp(message, {
    fileMtimeMs: state.fileMtimeMs,
    previousTimestampMs: state.previousTimestampMs,
  });
  state.previousTimestampMs = normalized.previousTimestampMs;
  return normalized.message;
}

function deriveOperationDuration(
  message: IndexedMessage,
  state: MessageProcessingState,
): IndexedMessage {
  if (message.operationDurationMs !== null) {
    updateAssistantThinkingRunState(state, message);
    return message;
  }

  const nextMessage = withDerivedOperationDuration(
    message,
    selectDerivedBaselineForStream(state, message),
  );

  updateAssistantThinkingRunState(state, nextMessage);
  return nextMessage;
}

function selectDerivedBaselineForStream(
  state: MessageProcessingState,
  message: IndexedMessage,
): IndexedMessage | null {
  if (!state.previousMessage) {
    return null;
  }

  if (message.category === "assistant" || message.category === "thinking") {
    const messageRoot = splitMessageRoot(message.id);
    const previous = state.previousMessage;
    const previousRoot = splitMessageRoot(previous.id);
    const isSameAssistantThinkingRun =
      (previous.category === "assistant" || previous.category === "thinking") &&
      previousRoot === messageRoot &&
      state.assistantThinkingRunRoot === messageRoot;
    return isSameAssistantThinkingRun ? state.assistantThinkingRunBaseline : previous;
  }

  if (message.category === "tool_result") {
    return state.previousMessage;
  }

  return null;
}

function updateAssistantThinkingRunState(
  state: MessageProcessingState,
  message: IndexedMessage,
): void {
  if (message.category !== "assistant" && message.category !== "thinking") {
    state.assistantThinkingRunRoot = null;
    state.assistantThinkingRunBaseline = null;
    return;
  }

  const messageRoot = splitMessageRoot(message.id);
  const previous = state.previousMessage;
  const previousRoot = previous ? splitMessageRoot(previous.id) : null;
  const isSameAssistantThinkingRun =
    previous &&
    (previous.category === "assistant" || previous.category === "thinking") &&
    previousRoot === messageRoot;

  if (!isSameAssistantThinkingRun) {
    state.assistantThinkingRunBaseline = previous;
    state.assistantThinkingRunRoot = messageRoot;
    return;
  }

  state.assistantThinkingRunRoot = messageRoot;
}

function updateSessionAggregateState(state: SessionAggregateState, message: IndexedMessage): void {
  state.messageCount += 1;
  state.tokenInputTotal += message.tokenInput ?? 0;
  state.tokenOutputTotal += message.tokenOutput ?? 0;

  const timestampMs = Date.parse(message.createdAt);
  if (Number.isFinite(timestampMs) && timestampMs > 0) {
    state.startedAtMs =
      state.startedAtMs === null || timestampMs < state.startedAtMs
        ? timestampMs
        : state.startedAtMs;
    state.endedAtMs =
      state.endedAtMs === null || timestampMs > state.endedAtMs ? timestampMs : state.endedAtMs;
  }

  const title = normalizeSessionTitleText(message.content);
  if (title.length === 0) {
    return;
  }
  const rank = sessionTitleCategoryRank(message.category);
  if (state.titleRank === null || rank < state.titleRank) {
    state.title = title;
    state.titleRank = rank;
  }
}

function sessionTitleCategoryRank(category: MessageCategory): number {
  const rank = SESSION_TITLE_CATEGORY_PREFERENCE.indexOf(category);
  return rank >= 0 ? rank : SESSION_TITLE_CATEGORY_PREFERENCE.length;
}

function finalizeSessionAggregate(state: SessionAggregateState): {
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
} {
  if (state.startedAtMs === null || state.endedAtMs === null) {
    return {
      startedAt: null,
      endedAt: null,
      durationMs: null,
    };
  }

  return {
    startedAt: new Date(state.startedAtMs).toISOString(),
    endedAt: new Date(state.endedAtMs).toISOString(),
    durationMs: state.endedAtMs - state.startedAtMs,
  };
}

function createSourceMetadataAccumulator(
  checkpoint?: SerializedSourceMetadataAccumulator,
): ProviderSourceMetadataAccumulator {
  return {
    models: new Set<string>(checkpoint?.models ?? []),
    gitBranch: checkpoint?.gitBranch ?? null,
    cwd: checkpoint?.cwd ?? null,
  };
}

function finalizeSourceMetadata(
  accumulator: ProviderSourceMetadataAccumulator,
): ProviderSourceMetadata {
  return {
    models: [...accumulator.models].sort(),
    gitBranch: accumulator.gitBranch,
    cwd: accumulator.cwd,
  };
}

function serializeSourceMetadataAccumulator(
  accumulator: ProviderSourceMetadataAccumulator,
): SerializedSourceMetadataAccumulator {
  return {
    models: [...accumulator.models].sort(),
    gitBranch: accumulator.gitBranch,
    cwd: accumulator.cwd,
  };
}

function serializeProcessingState(
  state: MessageProcessingState,
): SerializableMessageProcessingState {
  return {
    previousMessage: state.previousMessage,
    previousTimestampMs: state.previousTimestampMs,
    assistantThinkingRunRoot: state.assistantThinkingRunRoot,
    assistantThinkingRunBaseline: state.assistantThinkingRunBaseline,
    currentTurnGroupId: state.currentTurnGroupId,
    currentNativeTurnId: state.currentNativeTurnId,
    claudeTurnRootByEventId: state.claudeTurnRootByEventId,
    claudeTurnRootEventIds: state.claudeTurnRootEventIds,
    pendingCodexUserMessages: state.pendingCodexUserMessages.map((entry) => ({
      message: entry.message,
      nativeTurnId: entry.nativeTurnId,
    })),
    aggregate: { ...state.aggregate },
  };
}

function normalizeDuplicateStreamMessage(
  args: {
    discovered: ReturnType<typeof discoverSessionFiles>[number];
    processingState: MessageProcessingState;
    message: IndexedMessage;
  },
  stateSnapshot: MessageNormalizationSnapshot,
  sourceId: string,
): IndexedMessage {
  restoreMessageNormalizationState(args.processingState, stateSnapshot);
  return normalizeIndexedMessage(args.processingState, {
    ...args.message,
    id: sourceId,
  });
}

function resolveStreamDuplicateMessage(args: {
  statements: IndexingStatements;
  sessionDbId: string;
  message: IndexedMessage;
}):
  | {
      kind: "skip";
      existingSourceId: string;
    }
  | {
      kind: "insert";
      sourceId: string;
    } {
  const MAX_DUPLICATE_MESSAGE_SUFFIX = 100;
  let duplicateIndex = 1;
  while (duplicateIndex <= MAX_DUPLICATE_MESSAGE_SUFFIX) {
    const sourceId =
      duplicateIndex === 1 ? args.message.id : `${args.message.id}~dup${duplicateIndex}`;
    const existing = args.statements.getMessageById.get(makeMessageId(args.sessionDbId, sourceId));
    if (!existing) {
      return {
        kind: "insert",
        sourceId,
      };
    }
    if (isEquivalentPersistedMessage(existing, args.message)) {
      return {
        kind: "skip",
        existingSourceId: sourceId,
      };
    }
    duplicateIndex += 1;
  }
  return {
    kind: "insert",
    sourceId: `${args.message.id}~dup${Date.now().toString(36)}`,
  };
}

function isEquivalentPersistedMessage(
  existing: {
    provider: Provider;
    category: MessageCategory;
    content: string;
    created_at: string;
    token_input: number | null;
    token_output: number | null;
    operation_duration_ms: number | null;
    operation_duration_source: "native" | "derived" | null;
    operation_duration_confidence: "high" | "low" | null;
    turn_group_id: string | null;
    turn_grouping_mode: TurnGroupingMode;
    turn_anchor_kind: TurnAnchorKind | null;
    native_turn_id: string | null;
  },
  message: IndexedMessage,
): boolean {
  return (
    existing.provider === message.provider &&
    existing.category === message.category &&
    existing.content === message.content &&
    existing.created_at === message.createdAt &&
    existing.token_input === message.tokenInput &&
    existing.token_output === message.tokenOutput &&
    existing.operation_duration_ms === message.operationDurationMs &&
    existing.operation_duration_source === message.operationDurationSource &&
    existing.operation_duration_confidence === message.operationDurationConfidence &&
    existing.turn_group_id === message.turnGroupId &&
    existing.turn_grouping_mode === message.turnGroupingMode &&
    existing.turn_anchor_kind === message.turnAnchorKind &&
    existing.native_turn_id === message.nativeTurnId
  );
}

function shouldSkipDuplicateClaudeCompactBoundaryEvent(
  args: {
    discovered: ReturnType<typeof discoverSessionFiles>[number];
    event: unknown;
    sessionDbId: string;
    statements: IndexingStatements;
    onNotice: (notice: IndexingNotice) => void;
  },
  messages: IndexedMessage[],
): boolean {
  if (args.discovered.provider !== "claude" || messages.length !== 1) {
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
  const message = messages[0];
  if (!message) {
    return false;
  }
  const existing = args.statements.getMessageById.get(makeMessageId(args.sessionDbId, message.id));
  if (!existing) {
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

function buildStreamCheckpointState(args: {
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  sessionDbId: string;
  sequence: number;
  processingState: MessageProcessingState;
  sourceMetaAccumulator: ProviderSourceMetadataAccumulator;
  streamResult: StreamJsonlResult;
  hashes: { headHash: string; tailHash: string };
}): StreamCheckpointState {
  return {
    filePath: args.discovered.filePath,
    provider: args.discovered.provider,
    sessionDbId: args.sessionDbId,
    sessionIdentity: args.discovered.sessionIdentity,
    fileSize: args.discovered.fileSize,
    fileMtimeMs: args.discovered.fileMtimeMs,
    lastOffsetBytes: args.streamResult.nextOffsetBytes,
    lastLineNumber: args.streamResult.nextLineNumber,
    lastEventIndex: args.streamResult.nextEventIndex,
    nextMessageSequence: args.sequence,
    processingState: serializeProcessingState(args.processingState),
    sourceMetadata: serializeSourceMetadataAccumulator(args.sourceMetaAccumulator),
    headHash: args.hashes.headHash,
    tailHash: args.hashes.tailHash,
  };
}

function upsertSessionSummary(
  statements: IndexingStatements,
  args: {
    sessionDbId: string;
    projectId: string;
    provider: Provider;
    filePath: string;
    title: string;
    modelNames: string;
    aggregate: ReturnType<typeof finalizeSessionAggregate>;
    messageCount: number;
    tokenInputTotal: number;
    tokenOutputTotal: number;
    fileMtimeMs: number;
    gitBranch: string | null;
    cwd: string | null;
    sessionIdentity: string;
    providerSessionId: string;
    sessionKind: string | null;
    canonicalProjectPath: string;
    repositoryUrl: string | null;
    gitCommitHash: string | null;
    lineageParentId: string | null;
    providerClient: string | null;
    providerSource: string | null;
    providerClientVersion: string | null;
    resolutionSource: string | null;
    metadataJson: string | null;
    worktreeLabel: string | null;
    worktreeSource: WorktreeSource | null;
  },
): void {
  statements.upsertSession.run(
    args.sessionDbId,
    args.projectId,
    args.provider,
    args.filePath,
    args.title || args.modelNames,
    args.modelNames,
    args.aggregate.startedAt ?? new Date(args.fileMtimeMs).toISOString(),
    args.aggregate.endedAt ?? new Date(args.fileMtimeMs).toISOString(),
    args.aggregate.durationMs,
    args.gitBranch,
    args.cwd,
    args.sessionIdentity,
    args.providerSessionId,
    args.sessionKind,
    args.canonicalProjectPath,
    args.repositoryUrl,
    args.gitCommitHash,
    args.lineageParentId,
    args.providerClient,
    args.providerSource,
    args.providerClientVersion,
    args.resolutionSource,
    args.metadataJson,
    args.worktreeLabel,
    args.worktreeSource,
    args.messageCount,
    args.tokenInputTotal,
    args.tokenOutputTotal,
  );
}

function deriveResolutionState(
  discovered: ReturnType<typeof discoverSessionFiles>[number],
): "resolved" | "heuristic" | "unresolved" {
  if (discovered.metadata.unresolvedProject || !discovered.canonicalProjectPath) {
    return "unresolved";
  }

  if (
    discovered.metadata.resolutionSource === "project_id" ||
    discovered.metadata.resolutionSource === "folder_decode" ||
    discovered.metadata.resolutionSource === "repo_url_match" ||
    discovered.metadata.resolutionSource === "basename_match"
  ) {
    return "heuristic";
  }

  return "resolved";
}

function applyIndexingContentLimits(message: IndexedMessage): IndexedMessage {
  const nextContent = truncateTextForIndexing(message.content, MAX_INDEXED_MESSAGE_CONTENT_BYTES);
  if (nextContent === message.content) {
    return message;
  }
  return {
    ...message,
    content: nextContent,
  };
}

function truncateTextForIndexing(value: string, maxBytes: number): string {
  const valueBytes = Buffer.byteLength(value, "utf8");
  if (valueBytes <= maxBytes) {
    return value;
  }

  const marker = `[truncated from ${valueBytes} bytes]`;
  const markerBytes = Buffer.byteLength(marker, "utf8");
  if (markerBytes >= maxBytes) {
    return marker.slice(0, Math.max(1, maxBytes));
  }

  const availableBytes = maxBytes - markerBytes;
  const headBytes = Math.max(1, Math.floor(availableBytes * 0.75));
  const tailBytes = Math.max(0, availableBytes - headBytes);
  const head = sliceUtf8ByBytes(value, headBytes, "head");
  const tail = tailBytes > 0 ? sliceUtf8ByBytes(value, tailBytes, "tail") : "";
  return tail.length > 0 ? `${head}${marker}${tail}` : `${head}${marker}`;
}

function sliceUtf8ByBytes(value: string, byteLimit: number, mode: "head" | "tail"): string {
  if (byteLimit <= 0 || value.length === 0) {
    return "";
  }

  if (mode === "head") {
    return value.slice(0, findUtf8PrefixEnd(value, byteLimit));
  }

  return value.slice(findUtf8TailStart(value, byteLimit));
}

function findUtf8PrefixEnd(value: string, byteLimit: number): number {
  let index = 0;
  let consumedBytes = 0;
  while (index < value.length) {
    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    const nextBytes = consumedBytes + utf8ByteLength(codePoint);
    if (nextBytes > byteLimit) {
      break;
    }
    consumedBytes = nextBytes;
    index += codePoint > 0xffff ? 2 : 1;
  }
  return index;
}

function findUtf8TailStart(value: string, byteLimit: number): number {
  let index = value.length;
  let consumedBytes = 0;
  while (index > 0) {
    const nextIndex = previousCodePointStart(value, index);
    const codePoint = value.codePointAt(nextIndex);
    if (codePoint === undefined) {
      break;
    }
    const nextBytes = consumedBytes + utf8ByteLength(codePoint);
    if (nextBytes > byteLimit) {
      break;
    }
    consumedBytes = nextBytes;
    index = nextIndex;
  }
  return index;
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
}

function previousCodePointStart(value: string, endExclusive: number): number {
  const lastCodeUnit = value.charCodeAt(endExclusive - 1);
  if (endExclusive >= 2 && lastCodeUnit >= 0xdc00 && lastCodeUnit <= 0xdfff) {
    const previousCodeUnit = value.charCodeAt(endExclusive - 2);
    if (previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff) {
      return endExclusive - 2;
    }
  }
  return endExclusive - 1;
}

function streamJsonlEvents(
  filePath: string,
  callbacks: {
    adapter: ReturnType<typeof getProviderAdapter>;
    startOffsetBytes?: number;
    startLineNumber?: number;
    startEventIndex?: number;
    prefetchedJsonlChunk?: PrefetchedJsonlChunk | null;
    onEvent: (event: unknown, eventIndex: number, rescueNotice: JsonlRescueNotice | null) => void;
    onOmittedLine: (omitted: OmittedJsonlLine) => void;
    onInvalidLine: (lineNumber: number, error: unknown) => void;
  },
): StreamJsonlResult {
  const buffer = Buffer.allocUnsafe(JSONL_READ_BUFFER_BYTES);
  let fd: number | null = null;
  const streamState = {
    lineChunks: [] as Buffer[],
    pendingLineBytes: 0,
    discardingHardOmittedLine: false,
    lineNumber: callbacks.startLineNumber ?? 0,
    eventIndex: callbacks.startEventIndex ?? 0,
  };
  let consumedOffset = callbacks.startOffsetBytes ?? 0;
  let readOffset = callbacks.startOffsetBytes ?? 0;

  try {
    if (callbacks.prefetchedJsonlChunk) {
      readOffset = callbacks.startOffsetBytes ?? 0;
      const prefetchedBuffer = Buffer.from(callbacks.prefetchedJsonlChunk.bytes);
      const bytesRead = prefetchedBuffer.length;
      readOffset += bytesRead;
      processJsonlReadChunk(prefetchedBuffer, bytesRead, streamState, {
        onFlushLine: () => {
          consumedOffset += streamState.pendingLineBytes + 1;
          flushStreamJsonlLine(streamState, callbacks);
        },
      });
    } else {
      fd = openSync(filePath, "r");
      while (true) {
        const bytesRead = readSync(fd, buffer, 0, buffer.length, readOffset);
        if (bytesRead <= 0) {
          break;
        }
        readOffset += bytesRead;
        processJsonlReadChunk(buffer, bytesRead, streamState, {
          onFlushLine: () => {
            consumedOffset += streamState.pendingLineBytes + 1;
            flushStreamJsonlLine(streamState, callbacks);
          },
        });
      }
    }
    if (
      streamState.pendingLineBytes > 0 ||
      streamState.lineChunks.length > 0 ||
      streamState.discardingHardOmittedLine
    ) {
      const finalizedTrailingLine = tryConsumeTrailingJsonlLine({
        adapter: callbacks.adapter,
        lineChunks: streamState.lineChunks,
        discardingHardOmittedLine: streamState.discardingHardOmittedLine,
        pendingLineBytes: streamState.pendingLineBytes,
        lineNumber: streamState.lineNumber,
        eventIndex: streamState.eventIndex,
        callbacks,
      });
      if (finalizedTrailingLine) {
        consumedOffset = readOffset;
        streamState.lineNumber += 1;
        streamState.eventIndex = finalizedTrailingLine.nextEventIndex;
      }
    }
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }

  return {
    nextOffsetBytes: consumedOffset,
    nextLineNumber: streamState.lineNumber,
    nextEventIndex: streamState.eventIndex,
  };
}

function processJsonlReadChunk(
  buffer: Buffer,
  bytesRead: number,
  state: {
    lineChunks: Buffer[];
    pendingLineBytes: number;
    discardingHardOmittedLine: boolean;
    lineNumber: number;
    eventIndex: number;
  },
  handlers: {
    onFlushLine: () => void;
  },
): void {
  let cursor = 0;
  while (cursor < bytesRead) {
    const newlineIndex = buffer.indexOf(0x0a, cursor);
    const segmentEnd = newlineIndex >= 0 ? newlineIndex : bytesRead;
    const segment = buffer.subarray(cursor, segmentEnd);
    if (!state.discardingHardOmittedLine) {
      const nextLineBytes = state.pendingLineBytes + segment.length;
      if (nextLineBytes > MAX_JSONL_RESCUE_LINE_BYTES) {
        state.discardingHardOmittedLine = true;
        state.lineChunks = [];
      } else if (segment.length > 0) {
        state.lineChunks.push(Buffer.from(segment));
      }
    }
    state.pendingLineBytes += segment.length;

    if (newlineIndex >= 0) {
      handlers.onFlushLine();
      cursor = newlineIndex + 1;
      continue;
    }

    cursor = bytesRead;
  }
}

function flushStreamJsonlLine(
  state: {
    lineChunks: Buffer[];
    pendingLineBytes: number;
    discardingHardOmittedLine: boolean;
    lineNumber: number;
    eventIndex: number;
  },
  callbacks: {
    adapter: ReturnType<typeof getProviderAdapter>;
    onEvent: (event: unknown, eventIndex: number, rescueNotice: JsonlRescueNotice | null) => void;
    onOmittedLine: (omitted: OmittedJsonlLine) => void;
    onInvalidLine: (lineNumber: number, error: unknown) => void;
  },
): void {
  if (state.discardingHardOmittedLine) {
    callbacks.onOmittedLine({
      lineNumber: state.lineNumber + 1,
      lineBytes: state.pendingLineBytes,
      limitBytes: MAX_JSONL_RESCUE_LINE_BYTES,
    });
    state.eventIndex += 1;
  } else if (state.lineChunks.length > 0) {
    const line = Buffer.concat(state.lineChunks).toString("utf8");
    state.eventIndex = handleJsonlLine(
      line,
      state.pendingLineBytes,
      state.lineNumber,
      state.eventIndex,
      callbacks,
    );
  }

  state.lineChunks = [];
  state.pendingLineBytes = 0;
  state.discardingHardOmittedLine = false;
  state.lineNumber += 1;
}

function tryConsumeTrailingJsonlLine(args: {
  adapter: ReturnType<typeof getProviderAdapter>;
  lineChunks: Buffer[];
  discardingHardOmittedLine: boolean;
  pendingLineBytes: number;
  lineNumber: number;
  eventIndex: number;
  callbacks: {
    onEvent: (event: unknown, eventIndex: number, rescueNotice: JsonlRescueNotice | null) => void;
    onOmittedLine: (omitted: OmittedJsonlLine) => void;
    onInvalidLine: (lineNumber: number, error: unknown) => void;
  };
}): { nextEventIndex: number } | null {
  if (args.discardingHardOmittedLine) {
    // Leave the checkpoint at the start of the line until a newline arrives so we do not resume in
    // the middle of an oversized JSON object and permanently desynchronize the stream.
    return null;
  }
  if (args.lineChunks.length === 0) {
    return null;
  }

  const line = Buffer.concat(args.lineChunks).toString("utf8");
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { nextEventIndex: args.eventIndex };
  }

  let event: unknown;
  try {
    event = JSON.parse(trimmed) as unknown;
  } catch {
    // An unterminated trailing line is normal for actively-written JSONL transcripts. Keep the
    // checkpoint before the partial line so the next append can complete it.
    return null;
  }

  return {
    nextEventIndex: handleJsonlEvent(
      event,
      args.pendingLineBytes,
      args.lineNumber,
      args.eventIndex,
      {
        adapter: args.adapter,
        onEvent: args.callbacks.onEvent,
      },
    ),
  };
}

function handleJsonlLine(
  line: string,
  lineBytes: number,
  lineNumber: number,
  eventIndex: number,
  callbacks: {
    adapter: ReturnType<typeof getProviderAdapter>;
    onEvent: (event: unknown, eventIndex: number, rescueNotice: JsonlRescueNotice | null) => void;
    onInvalidLine: (lineNumber: number, error: unknown) => void;
  },
): number {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return eventIndex;
  }

  let event: unknown;
  try {
    event = JSON.parse(trimmed) as unknown;
  } catch (error) {
    callbacks.onInvalidLine(lineNumber + 1, error);
    return eventIndex;
  }

  return handleJsonlEvent(event, lineBytes, lineNumber, eventIndex, callbacks);
}

function handleJsonlEvent(
  event: unknown,
  lineBytes: number,
  lineNumber: number,
  eventIndex: number,
  callbacks: {
    adapter: ReturnType<typeof getProviderAdapter>;
    onEvent: (event: unknown, eventIndex: number, rescueNotice: JsonlRescueNotice | null) => void;
  },
): number {
  let rescueNotice: JsonlRescueNotice | null = null;
  let nextEvent = event;
  if (lineBytes > MAX_JSONL_LINE_BYTES) {
    const sanitized = callbacks.adapter.sanitizeOversizedJsonlEvent?.(event, {
      lineBytes,
      primaryByteLimit: MAX_JSONL_LINE_BYTES,
      rescueByteLimit: MAX_JSONL_RESCUE_LINE_BYTES,
    });
    nextEvent = sanitized?.event ?? event;
    const sanitizationDetails = summarizeOversizedSanitization(sanitized?.sanitization ?? null);
    rescueNotice = {
      severity: sanitized?.sanitization ? "warning" : "info",
      message: sanitized?.sanitization
        ? `Rescued oversized JSONL line ${lineNumber + 1} and omitted inline media payloads.`
        : `Rescued oversized JSONL line ${lineNumber + 1} within the hard ceiling.`,
      details: {
        lineNumber: lineNumber + 1,
        lineBytes,
        primaryLimitBytes: MAX_JSONL_LINE_BYTES,
        rescueLimitBytes: MAX_JSONL_RESCUE_LINE_BYTES,
        ...(sanitizationDetails ?? {}),
      },
    };
  }

  callbacks.onEvent(nextEvent, eventIndex, rescueNotice);
  return eventIndex + 1;
}

function insertIndexedMessage(
  statements: IndexingStatements,
  sessionDbId: string,
  message: IndexedMessage,
  context?: {
    provider: Provider;
    sessionId: string;
    filePath: string;
    onNotice: (notice: IndexingNotice) => void;
  },
): void {
  const messageId = makeMessageId(sessionDbId, message.id);
  const persistedContent = message.content;
  const ftsContent = truncateTextForIndexing(persistedContent, MAX_INDEXED_FTS_CONTENT_BYTES);
  const ftsContentWasTruncated = ftsContent !== persistedContent;
  if (context && ftsContentWasTruncated) {
    context.onNotice({
      provider: context.provider,
      sessionId: context.sessionId,
      filePath: context.filePath,
      stage: "persist",
      severity: "info",
      code: "index.message_fts_truncated",
      message: `Stored preview-only FTS content for ${message.id}.`,
      details: {
        messageId: message.id,
        originalBytes: Buffer.byteLength(persistedContent, "utf8"),
        indexedBytes: Buffer.byteLength(ftsContent, "utf8"),
      },
    });
  }
  statements.insertMessage.run(
    messageId,
    message.id,
    sessionDbId,
    message.provider,
    message.category,
    persistedContent,
    message.createdAt,
    message.tokenInput,
    message.tokenOutput,
    message.operationDurationMs,
    message.operationDurationSource,
    message.operationDurationConfidence,
    message.turnGroupId,
    message.turnGroupingMode,
    message.turnAnchorKind,
    message.nativeTurnId,
  );
  statements.insertMessageFts.run(
    messageId,
    sessionDbId,
    message.provider,
    message.category,
    ftsContent,
  );

  if (message.category !== "tool_use" && message.category !== "tool_edit") {
    return;
  }

  const toolCall = parseToolCallContent(persistedContent, {
    provider: context?.provider ?? message.provider,
    sessionId: context?.sessionId ?? message.sessionId,
    filePath: context?.filePath ?? "",
    messageId: message.id,
    ...(context?.onNotice ? { onNotice: context.onNotice } : {}),
  });
  statements.insertToolCall.run(
    makeToolCallId(messageId, 0),
    messageId,
    toolCall.toolName,
    toolCall.argsJson,
    toolCall.resultJson,
    message.createdAt,
    null,
  );
}

function accumulateParserDiagnostics(
  totals: { warnings: number; errors: number },
  parserDiagnostics: ParserDiagnostic[],
): void {
  for (const diagnostic of parserDiagnostics) {
    if (diagnostic.severity === "error") {
      totals.errors += 1;
    } else {
      totals.warnings += 1;
    }
  }
}

function resolveIndexingFileIssue(
  error: unknown,
  discovered: ReturnType<typeof discoverSessionFiles>[number],
): IndexingFileIssue {
  if (error instanceof IndexingFileProcessingError) {
    return error.issue;
  }
  return {
    provider: discovered.provider,
    sessionId: discovered.sourceSessionId,
    filePath: discovered.filePath,
    stage: "persist",
    error,
  };
}

function defaultOnFileIssue(issue: IndexingFileIssue): void {
  console.error(
    `[codetrail] failed indexing ${issue.provider} session ${issue.filePath} during ${issue.stage}`,
    issue.error,
  );
}

function defaultOnNotice(notice: IndexingNotice): void {
  const details = notice.details ? ` ${JSON.stringify(notice.details)}` : "";
  const method = notice.severity === "warning" ? console.warn : console.info;
  method(
    `[codetrail] indexing ${notice.severity} ${notice.code} ${notice.filePath}: ${notice.message}${details}`,
  );
}

function buildSyntheticSystemMessage(
  provider: Provider,
  sessionId: string,
  id: string,
  content: string,
  createdAt = "",
): IndexedMessage {
  return {
    id,
    sessionId,
    provider,
    category: "system",
    content,
    createdAt,
    tokenInput: null,
    tokenOutput: null,
    operationDurationMs: null,
    operationDurationSource: null,
    operationDurationConfidence: null,
    turnGroupId: null,
    turnGroupingMode: "heuristic",
    turnAnchorKind: null,
    nativeTurnId: null,
  };
}

function formatByteLimit(bytes: number): string {
  if (bytes % (1024 * 1024) === 0) {
    return `${bytes / (1024 * 1024)} MiB`;
  }
  return `${bytes} bytes`;
}

function shouldResumeFromCheckpoint(args: {
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  existing: IndexedFileRow | undefined;
  checkpoint: IndexCheckpointRow | undefined;
  expectedSessionDbId: string;
  existingSessionId: string | undefined;
}): args is {
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  existing: IndexedFileRow;
  checkpoint: IndexCheckpointRow;
  expectedSessionDbId: string;
  existingSessionId: string;
} {
  const adapter = getProviderAdapter(args.discovered.provider);
  if (!args.existing || !args.checkpoint || !args.existingSessionId) {
    return false;
  }
  if (!adapter.supportsIncrementalCheckpoints) {
    return false;
  }
  if (args.existingSessionId !== args.expectedSessionDbId) {
    return false;
  }
  if (args.checkpoint.session_id !== args.expectedSessionDbId) {
    return false;
  }
  if (args.checkpoint.session_identity !== args.discovered.sessionIdentity) {
    return false;
  }
  if (args.checkpoint.file_size !== args.existing.file_size) {
    return false;
  }
  if (args.checkpoint.file_mtime_ms !== args.existing.file_mtime_ms) {
    return false;
  }
  if (args.discovered.fileSize <= args.existing.file_size) {
    return false;
  }

  try {
    return verifyAppendOnlyFingerprint(
      args.discovered.filePath,
      args.existing.file_size,
      args.checkpoint.head_hash,
      args.checkpoint.tail_hash,
    );
  } catch {
    return false;
  }
}

function shouldResumeFromDeletedSession(args: {
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  deletedSession: DeletedSessionRow;
}): boolean {
  const adapter = getProviderAdapter(args.discovered.provider);
  if (!adapter.supportsIncrementalCheckpoints) {
    return false;
  }
  const resumeFields = readDeletedResumeFields(args.deletedSession);
  if (!resumeFields || !args.deletedSession.head_hash || !args.deletedSession.tail_hash) {
    return false;
  }
  if (args.discovered.fileSize <= args.deletedSession.file_size) {
    return false;
  }

  try {
    return verifyAppendOnlyFingerprint(
      args.discovered.filePath,
      args.deletedSession.file_size,
      args.deletedSession.head_hash,
      args.deletedSession.tail_hash,
    );
  } catch {
    return false;
  }
}

function readDeletedResumeFields(deletedSession: DeletedSessionRow): {
  lastOffsetBytes: number;
  lastLineNumber: number;
  lastEventIndex: number;
  nextMessageSequence: number;
  processingStateJson: string;
  sourceMetadataJson: string;
} | null {
  if (
    deletedSession.last_offset_bytes === null ||
    deletedSession.last_line_number === null ||
    deletedSession.last_event_index === null ||
    deletedSession.next_message_sequence === null ||
    deletedSession.processing_state_json === null ||
    deletedSession.source_metadata_json === null
  ) {
    return null;
  }

  return {
    lastOffsetBytes: deletedSession.last_offset_bytes,
    lastLineNumber: deletedSession.last_line_number,
    lastEventIndex: deletedSession.last_event_index,
    nextMessageSequence: deletedSession.next_message_sequence,
    processingStateJson: deletedSession.processing_state_json,
    sourceMetadataJson: deletedSession.source_metadata_json,
  };
}

function deserializeResumeCheckpoint(checkpoint: IndexCheckpointRow): ResumeCheckpoint | null {
  try {
    const processingRecord = asRecord(JSON.parse(checkpoint.processing_state_json));
    const sourceRecord = asRecord(JSON.parse(checkpoint.source_metadata_json));
    const models = asArray(sourceRecord?.models)
      .map((value) => readString(value))
      .filter((value): value is string => Boolean(value));

    return {
      lastOffsetBytes: checkpoint.last_offset_bytes,
      lastLineNumber: checkpoint.last_line_number,
      lastEventIndex: checkpoint.last_event_index,
      nextMessageSequence: checkpoint.next_message_sequence,
      processingState: {
        previousMessage: parseCheckpointMessage(processingRecord?.previousMessage),
        previousTimestampMs:
          typeof processingRecord?.previousTimestampMs === "number"
            ? processingRecord.previousTimestampMs
            : typeof processingRecord?.previousCursorTimestampMs === "number"
              ? processingRecord.previousCursorTimestampMs
              : Number.NEGATIVE_INFINITY,
        assistantThinkingRunRoot: readString(processingRecord?.assistantThinkingRunRoot) ?? null,
        assistantThinkingRunBaseline: parseCheckpointMessage(
          processingRecord?.assistantThinkingRunBaseline,
        ),
        currentTurnGroupId: readString(processingRecord?.currentTurnGroupId) ?? null,
        currentNativeTurnId: readString(processingRecord?.currentNativeTurnId) ?? null,
        claudeTurnRootByEventId: Object.fromEntries(
          Object.entries(asRecord(processingRecord?.claudeTurnRootByEventId) ?? {}).flatMap(
            ([key, value]) => {
              const rootId = readString(value);
              return rootId ? [[key, rootId]] : [];
            },
          ),
        ),
        claudeTurnRootEventIds: asArray(processingRecord?.claudeTurnRootEventIds)
          .map((value) => readString(value))
          .filter((value): value is string => value !== null),
        pendingCodexUserMessages: asArray(processingRecord?.pendingCodexUserMessages)
          .map((value) => {
            const record = asRecord(value);
            const message = parseCheckpointMessage(record?.message);
            return message
              ? {
                  message,
                  nativeTurnId: readString(record?.nativeTurnId) ?? null,
                }
              : null;
          })
          .filter((entry): entry is PendingCodexUserMessage => entry !== null),
        aggregate: parseAggregateState(processingRecord?.aggregate),
      },
      sourceMetadata: {
        models,
        gitBranch: readString(sourceRecord?.gitBranch) ?? null,
        cwd: readString(sourceRecord?.cwd) ?? null,
      },
    };
  } catch {
    return null;
  }
}

function deserializeDeletedResumeCheckpoint(
  deletedSession: DeletedSessionRow,
): ResumeCheckpoint | null {
  const resumeFields = readDeletedResumeFields(deletedSession);
  if (!resumeFields) {
    return null;
  }

  const checkpoint = deserializeResumeCheckpoint({
    file_path: deletedSession.file_path,
    provider: deletedSession.provider,
    session_id: deletedSession.session_id,
    session_identity: deletedSession.session_identity,
    file_size: deletedSession.file_size,
    file_mtime_ms: deletedSession.file_mtime_ms,
    last_offset_bytes: resumeFields.lastOffsetBytes,
    last_line_number: resumeFields.lastLineNumber,
    last_event_index: resumeFields.lastEventIndex,
    next_message_sequence: resumeFields.nextMessageSequence,
    processing_state_json: resumeFields.processingStateJson,
    source_metadata_json: resumeFields.sourceMetadataJson,
    head_hash: deletedSession.head_hash ?? "",
    tail_hash: deletedSession.tail_hash ?? "",
  });
  if (!checkpoint) {
    return null;
  }

  return {
    ...checkpoint,
    processingState: {
      ...checkpoint.processingState,
      aggregate: { ...DEFAULT_SESSION_AGGREGATE_STATE },
    },
  };
}

function parseCheckpointMessage(value: unknown): IndexedMessage | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const id = readString(record.id);
  const sessionId = readString(record.sessionId);
  const provider = readString(record.provider);
  const category = readString(record.category);
  const content = readString(record.content);
  const createdAt = readString(record.createdAt);
  if (!id || !sessionId || !provider || !category || content === null || !createdAt) {
    return null;
  }
  const parsed = canonicalMessageSchema.safeParse({
    id,
    sessionId,
    provider,
    category,
    content,
    createdAt,
    tokenInput: typeof record.tokenInput === "number" ? record.tokenInput : null,
    tokenOutput: typeof record.tokenOutput === "number" ? record.tokenOutput : null,
    operationDurationMs:
      typeof record.operationDurationMs === "number" ? record.operationDurationMs : null,
    operationDurationSource:
      record.operationDurationSource === "native" || record.operationDurationSource === "derived"
        ? record.operationDurationSource
        : null,
    operationDurationConfidence:
      record.operationDurationConfidence === "high" || record.operationDurationConfidence === "low"
        ? record.operationDurationConfidence
        : null,
    turnGroupId: readString(record.turnGroupId) ?? null,
    turnGroupingMode:
      record.turnGroupingMode === "native" ||
      record.turnGroupingMode === "hybrid" ||
      record.turnGroupingMode === "heuristic"
        ? record.turnGroupingMode
        : "heuristic",
    turnAnchorKind:
      record.turnAnchorKind === "user_prompt" || record.turnAnchorKind === "synthetic_control"
        ? record.turnAnchorKind
        : null,
    nativeTurnId: readString(record.nativeTurnId) ?? null,
  });
  return parsed.success ? parsed.data : null;
}

function parseAggregateState(value: unknown): SessionAggregateState {
  const parsed = checkpointAggregateSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...DEFAULT_SESSION_AGGREGATE_STATE };
}

function listIndexCheckpoints(
  db: SqliteDatabase,
  projectScope?: ProjectIndexingScope,
): IndexCheckpointRow[] {
  return db
    .prepare(
      projectScope
        ? `SELECT
         c.file_path,
         c.provider,
         c.session_id,
         c.session_identity,
         c.file_size,
         c.file_mtime_ms,
         c.last_offset_bytes,
         c.last_line_number,
         c.last_event_index,
         c.next_message_sequence,
         c.processing_state_json,
         c.source_metadata_json,
         c.head_hash,
         c.tail_hash
       FROM index_checkpoints c
       JOIN indexed_files f ON f.file_path = c.file_path
       WHERE f.provider = ? AND f.project_path = ?`
        : `SELECT
         file_path,
         provider,
         session_id,
         session_identity,
         file_size,
         file_mtime_ms,
         last_offset_bytes,
         last_line_number,
         last_event_index,
         next_message_sequence,
         processing_state_json,
         source_metadata_json,
         head_hash,
         tail_hash
       FROM index_checkpoints`,
    )
    .all(
      ...(projectScope ? ([projectScope.provider, projectScope.projectPath] as const) : []),
    ) as IndexCheckpointRow[];
}

function listDeletedSessions(
  db: SqliteDatabase,
  projectScope?: ProjectIndexingScope,
): DeletedSessionRow[] {
  return db
    .prepare(
      projectScope
        ? `SELECT
         file_path,
         provider,
         project_path,
         session_identity,
         session_id,
         deleted_at_ms,
         file_size,
         file_mtime_ms,
         last_offset_bytes,
         last_line_number,
         last_event_index,
         next_message_sequence,
         processing_state_json,
         source_metadata_json,
         head_hash,
         tail_hash
       FROM deleted_sessions
       WHERE provider = ? AND project_path = ?`
        : `SELECT
         file_path,
         provider,
         project_path,
         session_identity,
         session_id,
         deleted_at_ms,
         file_size,
         file_mtime_ms,
         last_offset_bytes,
         last_line_number,
         last_event_index,
         next_message_sequence,
         processing_state_json,
         source_metadata_json,
         head_hash,
         tail_hash
       FROM deleted_sessions`,
    )
    .all(
      ...(projectScope ? ([projectScope.provider, projectScope.projectPath] as const) : []),
    ) as DeletedSessionRow[];
}

function listDeletedProjects(
  db: SqliteDatabase,
  projectScope?: ProjectIndexingScope,
): DeletedProjectRow[] {
  return db
    .prepare(
      projectScope
        ? `SELECT
         provider,
         project_path,
         deleted_at_ms
       FROM deleted_projects
       WHERE provider = ? AND project_path = ?`
        : `SELECT
         provider,
         project_path,
         deleted_at_ms
       FROM deleted_projects`,
    )
    .all(
      ...(projectScope ? ([projectScope.provider, projectScope.projectPath] as const) : []),
    ) as DeletedProjectRow[];
}

function computeFileHashes(
  filePath: string,
  fileSize: number,
): {
  headHash: string;
  tailHash: string;
} {
  return {
    headHash: hashFileSlice(filePath, 0, Math.min(fileSize, JSONL_FINGERPRINT_WINDOW_BYTES)),
    tailHash: hashFileSlice(
      filePath,
      Math.max(0, fileSize - JSONL_FINGERPRINT_WINDOW_BYTES),
      Math.min(fileSize, JSONL_FINGERPRINT_WINDOW_BYTES),
    ),
  };
}

function verifyAppendOnlyFingerprint(
  filePath: string,
  previousFileSize: number,
  expectedHeadHash: string,
  expectedTailHash: string,
): boolean {
  return (
    hashFileSlice(filePath, 0, Math.min(previousFileSize, JSONL_FINGERPRINT_WINDOW_BYTES)) ===
      expectedHeadHash &&
    hashFileSlice(
      filePath,
      Math.max(0, previousFileSize - JSONL_FINGERPRINT_WINDOW_BYTES),
      Math.min(previousFileSize, JSONL_FINGERPRINT_WINDOW_BYTES),
    ) === expectedTailHash
  );
}

function hashFileSlice(filePath: string, start: number, length: number): string {
  const hash = createHash("sha256");
  if (length <= 0) {
    return hash.digest("hex");
  }

  const buffer = HASH_FILE_SLICE_BUFFER.subarray(
    0,
    Math.min(length, JSONL_FINGERPRINT_WINDOW_BYTES),
  );
  let fd: number | null = null;
  let remaining = length;
  let position = start;

  try {
    fd = openSync(filePath, "r");
    while (remaining > 0) {
      const bytesToRead = Math.min(remaining, buffer.length);
      const bytesRead = readSync(fd, buffer, 0, bytesToRead, position);
      if (bytesRead <= 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
      remaining -= bytesRead;
    }
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }

  return hash.digest("hex");
}

function listIndexedFiles(
  db: SqliteDatabase,
  projectScope?: ProjectIndexingScope,
): IndexedFileRow[] {
  return db
    .prepare(
      projectScope
        ? `SELECT file_path, provider, project_path, session_identity, file_size, file_mtime_ms
       FROM indexed_files
       WHERE provider = ? AND project_path = ?`
        : `SELECT file_path, provider, project_path, session_identity, file_size, file_mtime_ms
       FROM indexed_files`,
    )
    .all(
      ...(projectScope ? ([projectScope.provider, projectScope.projectPath] as const) : []),
    ) as IndexedFileRow[];
}

function listSessionFiles(
  db: SqliteDatabase,
  projectScope?: ProjectIndexingScope,
): SessionFileRow[] {
  return db
    .prepare(
      projectScope
        ? `SELECT sessions.id, sessions.file_path
           FROM sessions
           JOIN projects ON projects.id = sessions.project_id
           WHERE projects.provider = ? AND projects.path = ?`
        : "SELECT id, file_path FROM sessions",
    )
    .all(
      ...(projectScope ? ([projectScope.provider, projectScope.projectPath] as const) : []),
    ) as SessionFileRow[];
}

function deleteSessionData(statements: IndexingStatements, sessionId: string): void {
  statements.deleteToolCallsBySessionId.run(sessionId);
  statements.deleteMessageToolEditFilesBySessionId.run(sessionId);
  statements.deleteMessageFtsBySessionId.run(sessionId);
  statements.deleteMessagesBySessionId.run(sessionId);
  statements.deleteSessionById.run(sessionId);
}

function deleteSessionDataForFilePath(statements: IndexingStatements, filePath: string): void {
  const rows = statements.listSessionIdsByFilePath.all(filePath);
  for (const row of rows) {
    deleteSessionData(statements, row.id);
  }
}

function clearProjectIndexedData(db: SqliteDatabase, projectScope: ProjectIndexingScope): void {
  const listFilePathsForProject = db.prepare(
    `SELECT file_path
     FROM indexed_files
     WHERE provider = ? AND project_path = ?
     UNION
     SELECT sessions.file_path
     FROM sessions
     JOIN projects ON projects.id = sessions.project_id
     WHERE projects.provider = ? AND projects.path = ?`,
  );
  const deleteToolCallsForProject = db.prepare(
    `DELETE FROM tool_calls
     WHERE message_id IN (
       SELECT messages.id
       FROM messages
       JOIN sessions ON sessions.id = messages.session_id
       JOIN projects ON projects.id = sessions.project_id
       WHERE projects.provider = ? AND projects.path = ?
     )`,
  );
  const deleteMessageToolEditFilesForProject = db.prepare(
    `DELETE FROM message_tool_edit_files
     WHERE message_id IN (
       SELECT messages.id
       FROM messages
       JOIN sessions ON sessions.id = messages.session_id
       JOIN projects ON projects.id = sessions.project_id
       WHERE projects.provider = ? AND projects.path = ?
     )`,
  );
  const deleteMessageFtsForProject = db.prepare(
    `DELETE FROM message_fts
     WHERE session_id IN (
       SELECT sessions.id
       FROM sessions
       JOIN projects ON projects.id = sessions.project_id
       WHERE projects.provider = ? AND projects.path = ?
     )`,
  );
  const deleteMessagesForProject = db.prepare(
    `DELETE FROM messages
     WHERE session_id IN (
       SELECT sessions.id
       FROM sessions
       JOIN projects ON projects.id = sessions.project_id
       WHERE projects.provider = ? AND projects.path = ?
     )`,
  );
  const deleteSessionsForProject = db.prepare(
    `DELETE FROM sessions
     WHERE project_id IN (
       SELECT id
       FROM projects
       WHERE provider = ? AND path = ?
     )`,
  );
  const deleteProjectStatsForProject = db.prepare(
    `DELETE FROM project_stats
     WHERE project_id IN (
       SELECT id
       FROM projects
       WHERE provider = ? AND path = ?
     )`,
  );
  const deleteDeletedSessionsForProject = db.prepare(
    "DELETE FROM deleted_sessions WHERE provider = ? AND project_path = ?",
  );
  const deleteDeletedProjectsForProject = db.prepare(
    "DELETE FROM deleted_projects WHERE provider = ? AND project_path = ?",
  );
  const deleteProjectsForProject = db.prepare(
    "DELETE FROM projects WHERE provider = ? AND path = ?",
  );
  const deleteIndexedFile = db.prepare("DELETE FROM indexed_files WHERE file_path = ?");
  const deleteIndexCheckpoint = db.prepare("DELETE FROM index_checkpoints WHERE file_path = ?");
  const clear = db.transaction(() => {
    const fileRows = listFilePathsForProject.all(
      projectScope.provider,
      projectScope.projectPath,
      projectScope.provider,
      projectScope.projectPath,
    ) as Array<{ file_path: string }>;

    deleteToolCallsForProject.run(projectScope.provider, projectScope.projectPath);
    deleteMessageToolEditFilesForProject.run(projectScope.provider, projectScope.projectPath);
    deleteMessageFtsForProject.run(projectScope.provider, projectScope.projectPath);
    deleteMessagesForProject.run(projectScope.provider, projectScope.projectPath);
    deleteSessionsForProject.run(projectScope.provider, projectScope.projectPath);

    for (const { file_path: filePath } of fileRows) {
      deleteIndexedFile.run(filePath);
      deleteIndexCheckpoint.run(filePath);
    }

    deleteDeletedSessionsForProject.run(projectScope.provider, projectScope.projectPath);
    deleteDeletedProjectsForProject.run(projectScope.provider, projectScope.projectPath);
    deleteProjectStatsForProject.run(projectScope.provider, projectScope.projectPath);
    deleteProjectsForProject.run(projectScope.provider, projectScope.projectPath);
  });

  clear();
}

function removeDeletedSessionTombstone(db: SqliteDatabase, filePath: string): void {
  db.prepare("DELETE FROM deleted_sessions WHERE file_path = ?").run(filePath);
}

function deriveOperationDurations(messages: IndexedMessage[]): IndexedMessage[] {
  return messages.map((message, index) =>
    withDerivedOperationDuration(message, selectDerivedBaseline(messages, index, message.category)),
  );
}

function normalizeMessageTimestamps(
  messages: IndexedMessage[],
  adapter: ReturnType<typeof getProviderAdapter>,
  fileMtimeMs: number,
): IndexedMessage[] {
  let previousMs = Number.NEGATIVE_INFINITY;
  return messages.map((message) => {
    const normalized = adapter.normalizeMessageTimestamp(message, {
      fileMtimeMs,
      previousTimestampMs: previousMs,
    });
    previousMs = normalized.previousTimestampMs;
    return normalized.message;
  });
}

function prepareMaterializedMessagesForPersistence(
  messages: IndexedMessage[],
  adapter: ReturnType<typeof getProviderAdapter>,
  fileMtimeMs: number,
  sessionDbId: string,
): {
  messages: IndexedMessage[];
  sessionTitle: string;
  aggregate: {
    messageCount: number;
    tokenInputTotal: number;
    tokenOutputTotal: number;
    startedAt: string | null;
    endedAt: string | null;
    durationMs: number | null;
  };
} {
  let previousMs = Number.NEGATIVE_INFINITY;
  const aggregateState: SessionAggregateState = { ...DEFAULT_SESSION_AGGREGATE_STATE };
  const preparedMessages: IndexedMessage[] = [];

  for (const message of messages) {
    const limitedMessage = applyIndexingContentLimits(message);
    const normalized = adapter.normalizeMessageTimestamp(limitedMessage, {
      fileMtimeMs,
      previousTimestampMs: previousMs,
    });
    previousMs = normalized.previousTimestampMs;
    preparedMessages.push(normalized.message);
    updateSessionAggregateState(aggregateState, {
      ...normalized.message,
      id: makeMessageId(sessionDbId, normalized.message.id),
    });
  }

  return {
    messages: preparedMessages,
    sessionTitle: aggregateState.title,
    aggregate: {
      messageCount: aggregateState.messageCount,
      tokenInputTotal: aggregateState.tokenInputTotal,
      tokenOutputTotal: aggregateState.tokenOutputTotal,
      ...finalizeSessionAggregate(aggregateState),
    },
  };
}

function isHighConfidenceDerivedPair(
  previousCategory: MessageCategory,
  currentCategory: MessageCategory,
): boolean {
  if (
    (currentCategory === "assistant" || currentCategory === "thinking") &&
    previousCategory === "user"
  ) {
    return true;
  }

  if (currentCategory === "tool_result") {
    return previousCategory === "tool_use" || previousCategory === "tool_edit";
  }

  return false;
}

function selectDerivedBaseline(
  messages: IndexedMessage[],
  currentIndex: number,
  currentCategory: MessageCategory,
): IndexedMessage | null {
  if (currentIndex <= 0) {
    return null;
  }

  if (currentCategory === "assistant" || currentCategory === "thinking") {
    // Split assistant/thinking segments often share the same source id. Skip backwards past those
    // siblings so we measure from the user/tool message that actually triggered them.
    const currentRoot = splitMessageRoot(messages[currentIndex]?.id ?? "");
    let pointer = currentIndex - 1;
    while (pointer >= 0) {
      const candidate = messages[pointer];
      if (!candidate) {
        return null;
      }

      const candidateRoot = splitMessageRoot(candidate.id);
      const isSameLogicalMessage =
        candidateRoot === currentRoot &&
        (candidate.category === "assistant" || candidate.category === "thinking");
      if (!isSameLogicalMessage) {
        return candidate;
      }

      pointer -= 1;
    }

    return null;
  }

  return messages[currentIndex - 1] ?? null;
}

function splitMessageRoot(id: string): string {
  return id.replace(/#\d+$/, "");
}

function deriveSessionTitle(messages: IndexedMessage[]): string {
  let bestTitle = "";
  let bestRank = Number.POSITIVE_INFINITY;

  for (const message of messages) {
    const title = normalizeSessionTitleText(message.content);
    if (title.length === 0) {
      continue;
    }
    const rank = sessionTitleCategoryRank(message.category);
    if (rank < bestRank) {
      bestTitle = title;
      bestRank = rank;
      if (rank === 0) {
        break;
      }
    }
  }

  return bestTitle;
}

function normalizeSessionTitleText(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length === 0) {
    return "";
  }
  const maxLength = 180;
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 1)}…`;
}

function compileSystemMessageRules(overrides?: SystemMessageRegexRuleOverrides): {
  compiledByProvider: Record<Provider, RegExp[]>;
  invalidCount: number;
} {
  const resolved = resolveSystemMessageRegexRules(overrides);
  const compiledByProvider = createProviderRecord<RegExp[]>(() => []);

  let invalidCount = 0;
  for (const provider of PROVIDER_VALUES) {
    const compiled: RegExp[] = [];
    // Invalid user-supplied regexes are counted and ignored instead of failing indexing.
    for (const pattern of resolved[provider]) {
      const normalized = pattern.trim();
      if (normalized.length === 0) {
        continue;
      }
      try {
        compiled.push(new RegExp(normalized, "u"));
      } catch {
        invalidCount += 1;
      }
    }
    compiledByProvider[provider] = compiled;
  }

  return { compiledByProvider, invalidCount };
}

function reclassifySystemMessages(messages: IndexedMessage[], rules: RegExp[]): IndexedMessage[] {
  if (rules.length === 0) {
    return messages;
  }

  return messages.map((message) => reclassifySystemMessage(message, rules));
}

function withDerivedOperationDuration(
  message: IndexedMessage,
  baseline: IndexedMessage | null,
): IndexedMessage {
  if (message.operationDurationMs !== null || !baseline) {
    return message;
  }
  if (!isHighConfidenceDerivedPair(baseline.category, message.category)) {
    return message;
  }

  const currentMs = Date.parse(message.createdAt);
  const previousMs = Date.parse(baseline.createdAt);
  if (!Number.isFinite(currentMs) || !Number.isFinite(previousMs)) {
    return message;
  }

  const durationMs = currentMs - previousMs;
  if (durationMs <= 0 || durationMs > MAX_DERIVED_DURATION_MS) {
    return message;
  }

  return {
    ...message,
    operationDurationMs: durationMs,
    operationDurationSource: "derived",
    operationDurationConfidence: "high",
  };
}

function buildSessionAggregate(
  messages: Array<{
    id: string;
    createdAt: string;
    tokenInput: number | null;
    tokenOutput: number | null;
  }>,
): {
  messageCount: number;
  tokenInputTotal: number;
  tokenOutputTotal: number;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
} {
  const messageCount = messages.length;
  const tokenInputTotal = messages.reduce((sum, message) => sum + (message.tokenInput ?? 0), 0);
  const tokenOutputTotal = messages.reduce((sum, message) => sum + (message.tokenOutput ?? 0), 0);

  const timestamps = messages
    .map((message) => Date.parse(message.createdAt))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (timestamps.length === 0) {
    return {
      messageCount,
      tokenInputTotal,
      tokenOutputTotal,
      startedAt: null,
      endedAt: null,
      durationMs: null,
    };
  }

  let started = timestamps[0] ?? 0;
  let ended = started;
  for (let index = 1; index < timestamps.length; index += 1) {
    const value = timestamps[index];
    if (value === undefined) {
      continue;
    }
    if (value < started) {
      started = value;
    }
    if (value > ended) {
      ended = value;
    }
  }

  return {
    messageCount,
    tokenInputTotal,
    tokenOutputTotal,
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(ended).toISOString(),
    durationMs: ended - started,
  };
}

function parseToolCallContent(
  content: string,
  context?: {
    provider: Provider;
    sessionId: string;
    filePath: string;
    messageId: string;
    onNotice?: (notice: IndexingNotice) => void;
  },
): {
  toolName: string;
  argsJson: string;
  resultJson: string | null;
} {
  if (Buffer.byteLength(content, "utf8") > MAX_TOOL_CALL_JSON_BYTES) {
    context?.onNotice?.({
      provider: context.provider,
      sessionId: context.sessionId,
      filePath: context.filePath,
      stage: "persist",
      severity: "warning",
      code: "index.tool_call_raw_truncated",
      message: `Tool payload preview was truncated for ${context.messageId}.`,
      details: {
        messageId: context.messageId,
        originalBytes: Buffer.byteLength(content, "utf8"),
        storedBytes: MAX_TOOL_CALL_JSON_BYTES,
      },
    });
    return {
      toolName: "unknown",
      argsJson: JSON.stringify({
        raw: truncateTextForIndexing(content, MAX_TOOL_CALL_JSON_BYTES),
      }),
      resultJson: null,
    };
  }

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const toolName = readString(parsed.name) ?? readString(parsed.tool_name) ?? "unknown";

    const args = parsed.args ?? parsed.input ?? parsed.arguments ?? parsed;
    const result = parsed.result ?? parsed.output ?? null;
    const argsJson = JSON.stringify(args);
    const resultJson = result === undefined || result === null ? null : JSON.stringify(result);
    const boundedArgsJson = truncateTextForIndexing(argsJson, MAX_TOOL_CALL_JSON_BYTES);
    const boundedResultJson =
      resultJson === null ? null : truncateTextForIndexing(resultJson, MAX_TOOL_CALL_JSON_BYTES);
    if (context?.onNotice && boundedArgsJson !== argsJson) {
      context.onNotice({
        provider: context.provider,
        sessionId: context.sessionId,
        filePath: context.filePath,
        stage: "persist",
        severity: "warning",
        code: "index.tool_call_args_truncated",
        message: `Tool args were truncated for ${context.messageId}.`,
        details: {
          messageId: context.messageId,
          originalBytes: Buffer.byteLength(argsJson, "utf8"),
          storedBytes: Buffer.byteLength(boundedArgsJson, "utf8"),
        },
      });
    }
    if (context?.onNotice && resultJson !== null && boundedResultJson !== resultJson) {
      context.onNotice({
        provider: context.provider,
        sessionId: context.sessionId,
        filePath: context.filePath,
        stage: "persist",
        severity: "warning",
        code: "index.tool_call_result_truncated",
        message: `Tool result was truncated for ${context.messageId}.`,
        details: {
          messageId: context.messageId,
          originalBytes: Buffer.byteLength(resultJson, "utf8"),
          storedBytes: Buffer.byteLength(boundedResultJson ?? "", "utf8"),
        },
      });
    }

    return {
      toolName,
      argsJson: boundedArgsJson,
      resultJson: boundedResultJson,
    };
  } catch {
    return {
      toolName: "unknown",
      argsJson: JSON.stringify({ raw: truncateTextForIndexing(content, MAX_TOOL_CALL_JSON_BYTES) }),
      resultJson: null,
    };
  }
}
