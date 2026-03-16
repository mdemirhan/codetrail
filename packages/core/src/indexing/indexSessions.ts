import { createHash } from "node:crypto";
import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";

import { type MessageCategory, PROVIDER_VALUES, type Provider } from "../contracts/canonical";
import {
  type SqliteDatabase,
  clearIndexedData,
  ensureDatabaseSchema,
  openDatabase,
} from "../db/bootstrap";
import {
  DEFAULT_DISCOVERY_CONFIG,
  type DiscoveryConfig,
  discoverSessionFiles,
  discoverSingleFile,
  parseOpenCodeVirtualPath,
} from "../discovery";
import { type ParserDiagnostic, parseSession, parseSessionEvent } from "../parsing";
import { asArray, asRecord, readString } from "../parsing/helpers";

import { makeMessageId, makeProjectId, makeSessionId, makeToolCallId } from "./ids";
import {
  type SystemMessageRegexRuleOverrides,
  resolveSystemMessageRegexRules,
} from "./systemMessageRules";

export type IndexingConfig = {
  dbPath: string;
  forceReindex?: boolean;
  discoveryConfig?: Partial<DiscoveryConfig>;
  systemMessageRegexRules?: SystemMessageRegexRuleOverrides;
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

type ReadFileText = (filePath: string) => string;

export type IndexingDependencies = {
  discoverSessionFiles?: typeof discoverSessionFiles;
  openDatabase?: typeof openDatabase;
  ensureDatabaseSchema?: typeof ensureDatabaseSchema;
  clearIndexedData?: typeof clearIndexedData;
  readFileText?: ReadFileText;
  now?: () => Date;
  onFileIssue?: (issue: IndexingFileIssue) => void;
  onNotice?: (notice: IndexingNotice) => void;
};

type ResolvedIndexingDependencies = {
  discoverSessionFiles: typeof discoverSessionFiles;
  openDatabase: typeof openDatabase;
  ensureDatabaseSchema: typeof ensureDatabaseSchema;
  clearIndexedData: typeof clearIndexedData;
  readFileText: ReadFileText;
  now: () => Date;
  onFileIssue: (issue: IndexingFileIssue) => void;
  onNotice: (notice: IndexingNotice) => void;
};

type IndexedFileRow = {
  file_path: string;
  provider: Provider;
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

type SessionFileRow = {
  id: string;
  file_path: string;
};

type IndexedMessage = ReturnType<typeof parseSession>["messages"][number];
type SourceMetadata = {
  models: string[];
  gitBranch: string | null;
  cwd: string | null;
};
type SourceMetadataAccumulator = {
  models: Set<string>;
  gitBranch: string | null;
  cwd: string | null;
};
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
  previousCursorTimestampMs: number;
  assistantThinkingRunRoot: string | null;
  assistantThinkingRunBaseline: IndexedMessage | null;
  aggregate: SessionAggregateState;
};
type SerializableMessageProcessingState = {
  previousMessage: IndexedMessage | null;
  previousCursorTimestampMs: number;
  assistantThinkingRunRoot: string | null;
  assistantThinkingRunBaseline: IndexedMessage | null;
  aggregate: SessionAggregateState;
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
type StreamJsonlResult = {
  nextOffsetBytes: number;
  nextLineNumber: number;
  nextEventIndex: number;
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

type IndexingStatements = {
  upsertProject: { run: (...args: unknown[]) => unknown };
  upsertSession: { run: (...args: unknown[]) => unknown };
  insertMessage: { run: (...args: unknown[]) => unknown };
  insertMessageFts: { run: (...args: unknown[]) => unknown };
  insertToolCall: { run: (...args: unknown[]) => unknown };
  upsertIndexedFile: { run: (...args: unknown[]) => unknown };
  upsertCheckpoint: { run: (...args: unknown[]) => unknown };
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
const MAX_INDEXED_MESSAGE_CONTENT_BYTES = 256 * 1024;
const MAX_INDEXED_FTS_CONTENT_BYTES = 32 * 1024;
const MAX_TOOL_CALL_JSON_BYTES = 64 * 1024;

// Incremental indexing treats the filesystem as source of truth and the SQLite database as a
// cacheable projection of normalized session history.
export function runIncrementalIndexing(
  config: IndexingConfig,
  dependencies: IndexingDependencies = {},
): IndexingResult {
  const resolvedDependencies = resolveIndexingDependencies(dependencies);
  const discoveryConfig = resolveDiscoveryConfig(config.discoveryConfig);
  const discoveredFiles = resolvedDependencies.discoverSessionFiles(discoveryConfig);
  const discoveredByFilePath = new Map(discoveredFiles.map((file) => [file.filePath, file]));

  const db = resolvedDependencies.openDatabase(config.dbPath);
  try {
    const schema = resolvedDependencies.ensureDatabaseSchema(db);

    if (config.forceReindex) {
      resolvedDependencies.clearIndexedData(db);
    }

    const existingRows = listIndexedFiles(db);
    const existingByFilePath = new Map(existingRows.map((row) => [row.file_path, row]));
    const existingCheckpointRows = listIndexCheckpoints(db);
    const existingCheckpointByFilePath = new Map(
      existingCheckpointRows.map((row) => [row.file_path, row]),
    );
    const existingSessionRows = listSessionFiles(db);
    const existingSessionByFilePath = new Map(
      existingSessionRows.map((row) => [row.file_path, row.id]),
    );

    let indexedFiles = 0;
    let skippedFiles = 0;
    let removedFiles = 0;
    const diagnostics = { warnings: 0, errors: 0 };
    const compiledSystemMessageRules = compileSystemMessageRules(config.systemMessageRegexRules);
    diagnostics.warnings += compiledSystemMessageRules.invalidCount;

    if (!config.forceReindex) {
      for (const existing of existingRows) {
        if (discoveredByFilePath.has(existing.file_path)) {
          continue;
        }

        deleteSessionDataForFilePath(db, existing.file_path);
        db.prepare("DELETE FROM indexed_files WHERE file_path = ?").run(existing.file_path);
        db.prepare("DELETE FROM index_checkpoints WHERE file_path = ?").run(existing.file_path);
        existingCheckpointByFilePath.delete(existing.file_path);
        existingSessionByFilePath.delete(existing.file_path);
        removedFiles += 1;
      }
    }

    const nowIso = resolvedDependencies.now().toISOString();
    const statements = createIndexingStatements(db);
    const lookupExisting = (filePath: string) => ({
      indexed: existingByFilePath.get(filePath),
      checkpoint: existingCheckpointByFilePath.get(filePath),
      sessionId: existingSessionByFilePath.get(filePath),
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
  const discoveryConfig = resolveDiscoveryConfig(config.discoveryConfig);

  const discoveredFiles = changedFilePaths
    .map((filePath) => discoverSingleFile(filePath, discoveryConfig))
    .filter((file): file is NonNullable<typeof file> => file !== null);

  const db = resolvedDependencies.openDatabase(config.dbPath);
  try {
    const schema = resolvedDependencies.ensureDatabaseSchema(db);

    // Query only the specific rows for the targeted files — no full table scans.
    const getIndexedFile = db.prepare(
      "SELECT file_path, provider, session_identity, file_size, file_mtime_ms FROM indexed_files WHERE file_path = ?",
    );
    const getCheckpoint = db.prepare(
      `SELECT file_path, provider, session_id, session_identity, file_size, file_mtime_ms,
              last_offset_bytes, last_line_number, last_event_index, next_message_sequence,
              processing_state_json, source_metadata_json, head_hash, tail_hash
       FROM index_checkpoints WHERE file_path = ?`,
    );
    const getSessionByFile = db.prepare("SELECT id, file_path FROM sessions WHERE file_path = ?");

    let indexedFiles = 0;
    let skippedFiles = 0;
    let removedFiles = 0;
    const diagnostics = { warnings: 0, errors: 0 };
    const compiledSystemMessageRules = compileSystemMessageRules(config.systemMessageRegexRules);
    diagnostics.warnings += compiledSystemMessageRules.invalidCount;

    // Handle deleted/renamed files — clean up indexed data for paths that can no longer be discovered
    const discoveredPathSet = new Set(discoveredFiles.map((f) => f.filePath));
    for (const filePath of changedFilePaths) {
      if (discoveredPathSet.has(filePath)) continue;
      const existingSession = getSessionByFile.get(filePath) as SessionFileRow | undefined;
      if (existingSession) {
        deleteSessionDataForFilePath(db, filePath);
        db.prepare("DELETE FROM indexed_files WHERE file_path = ?").run(filePath);
        db.prepare("DELETE FROM index_checkpoints WHERE file_path = ?").run(filePath);
        removedFiles += 1;
      }
    }

    const nowIso = resolvedDependencies.now().toISOString();
    const statements = createIndexingStatements(db);
    const lookupExisting = (filePath: string) => ({
      indexed: getIndexedFile.get(filePath) as IndexedFileRow | undefined,
      checkpoint: getCheckpoint.get(filePath) as IndexCheckpointRow | undefined,
      sessionId: (getSessionByFile.get(filePath) as SessionFileRow | undefined)?.id,
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

function createIndexingStatements(db: SqliteDatabase) {
  return {
    upsertProject: db.prepare(
      `INSERT INTO projects (id, provider, name, path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         path = excluded.path,
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
         message_count,
         token_input_total,
         token_output_total
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        operation_duration_confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  };
}

type ExistingFileLookup = (filePath: string) => {
  indexed: IndexedFileRow | undefined;
  checkpoint: IndexCheckpointRow | undefined;
  sessionId: string | undefined;
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
}): { indexedFiles: number; skippedFiles: number } {
  let indexedFiles = 0;
  let skippedFiles = 0;

  for (const discovered of args.discoveredFiles) {
    const existing = args.lookupExisting(discovered.filePath);
    const sessionDbId = makeSessionId(discovered.provider, discovered.sessionIdentity);
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
    const resumeCheckpoint =
      canResumeFromCheckpoint && existing.checkpoint
        ? deserializeResumeCheckpoint(existing.checkpoint)
        : null;

    try {
      const fileDiagnostics =
        discovered.provider === "gemini" || discovered.provider === "opencode"
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

function resolveDiscoveryConfig(config?: Partial<DiscoveryConfig>): DiscoveryConfig {
  return {
    ...DEFAULT_DISCOVERY_CONFIG,
    ...config,
  };
}

function resolveIndexingDependencies(
  dependencies: IndexingDependencies = {},
): ResolvedIndexingDependencies {
  return {
    discoverSessionFiles: dependencies.discoverSessionFiles ?? discoverSessionFiles,
    openDatabase: dependencies.openDatabase ?? openDatabase,
    ensureDatabaseSchema: dependencies.ensureDatabaseSchema ?? ensureDatabaseSchema,
    clearIndexedData: dependencies.clearIndexedData ?? clearIndexedData,
    readFileText: dependencies.readFileText ?? ((filePath) => readFileSync(filePath, "utf8")),
    now: dependencies.now ?? (() => new Date()),
    onFileIssue: dependencies.onFileIssue ?? defaultOnFileIssue,
    onNotice: dependencies.onNotice ?? defaultOnNotice,
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
  let source: {
    rawPayload: unknown[] | Record<string, unknown>;
    parsePayload: unknown[] | Record<string, unknown>;
  };
  try {
    const loaded = readProviderSource(args.discovered.provider, args.discovered.filePath, args.readFileText);
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
      payload: source.parsePayload,
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

  const projectId = makeProjectId(args.discovered.provider, args.discovered.projectPath);
  const sourceMeta = extractSourceMetadata(args.discovered.provider, source.rawPayload);
  const normalizedMessages = reclassifySystemMessages(parsed.messages, args.systemMessageRules);
  const messagesWithDuration = deriveOperationDurations(normalizedMessages);
  const messagesWithLimits = messagesWithDuration.map(applyIndexingContentLimits);
  const messagesWithTimestamps = normalizeMessageTimestamps(
    messagesWithLimits,
    args.discovered.provider,
    args.discovered.fileMtimeMs,
  );
  const sessionTitle =
    deriveSessionTitle(messagesWithTimestamps) || args.discovered.metadata.title || "";
  const modelNames = sourceMeta.models.join(",");
  const aggregate = buildSessionAggregate(
    messagesWithTimestamps.map((message) => ({
      ...message,
      id: makeMessageId(args.sessionDbId, message.id),
    })),
  );

  try {
    const persist = args.db.transaction(() => {
      deleteSessionDataForFilePath(args.db, args.discovered.filePath);
      deleteSessionData(args.db, args.sessionDbId);
      args.db
        .prepare("DELETE FROM index_checkpoints WHERE file_path = ?")
        .run(args.discovered.filePath);
      args.statements.upsertProject.run(
        projectId,
        args.discovered.provider,
        args.discovered.projectName,
        args.discovered.projectPath,
        args.nowIso,
        args.nowIso,
      );
      args.statements.upsertSession.run(
        args.sessionDbId,
        projectId,
        args.discovered.provider,
        args.discovered.filePath,
        sessionTitle || modelNames,
        modelNames,
        aggregate.startedAt ?? new Date(args.discovered.fileMtimeMs).toISOString(),
        aggregate.endedAt ?? new Date(args.discovered.fileMtimeMs).toISOString(),
        aggregate.durationMs,
        sourceMeta.gitBranch ?? args.discovered.metadata.gitBranch,
        sourceMeta.cwd ?? args.discovered.metadata.cwd,
        aggregate.messageCount,
        aggregate.tokenInputTotal,
        aggregate.tokenOutputTotal,
      );

      for (const message of messagesWithTimestamps) {
        insertIndexedMessage(args.statements, args.sessionDbId, message, {
          provider: args.discovered.provider,
          sessionId: args.discovered.sourceSessionId,
          filePath: args.discovered.filePath,
          onNotice: args.onNotice,
        });
      }

      args.statements.upsertIndexedFile.run(
        args.discovered.filePath,
        args.discovered.provider,
        args.discovered.projectPath,
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
  onNotice: (notice: IndexingNotice) => void;
}): ParserDiagnostic[] {
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
  const projectId = makeProjectId(args.discovered.provider, args.discovered.projectPath);
  const shouldResume = args.resumeCheckpoint !== null;

  try {
    const persist = args.db.transaction(() => {
      if (!shouldResume) {
        deleteSessionDataForFilePath(args.db, args.discovered.filePath);
        deleteSessionData(args.db, args.sessionDbId);
      }
      args.db
        .prepare("DELETE FROM index_checkpoints WHERE file_path = ?")
        .run(args.discovered.filePath);
      args.statements.upsertProject.run(
        projectId,
        args.discovered.provider,
        args.discovered.projectName,
        args.discovered.projectPath,
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
      });

      let sequence = args.resumeCheckpoint?.nextMessageSequence ?? 0;
      let emittedEvents = 0;
      let streamResult: StreamJsonlResult | null = null;
      try {
        streamResult = streamJsonlEvents(args.discovered.filePath, {
          startOffsetBytes: args.resumeCheckpoint?.lastOffsetBytes ?? 0,
          startLineNumber: args.resumeCheckpoint?.lastLineNumber ?? 0,
          startEventIndex: args.resumeCheckpoint?.lastEventIndex ?? 0,
          onEvent: (event, eventIndex) => {
            emittedEvents += 1;
            updateSourceMetadataFromEvent(args.discovered.provider, event, sourceMetaAccumulator);
            let parsedEvent: ReturnType<typeof parseSessionEvent>;
            try {
              parsedEvent = parseSessionEvent({
                provider: args.discovered.provider,
                sessionId: args.discovered.sourceSessionId,
                eventIndex,
                event,
                diagnostics: parserDiagnostics,
                sequence,
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
            sequence = parsedEvent.nextSequence;
            const eventMessages = parsedEvent.messages.slice();
            for (let index = 0; index < eventMessages.length; index += 1) {
              const message = eventMessages[index];
              if (!message) {
                continue;
              }
              const normalizedMessage = normalizeIndexedMessage(processingState, message);
              insertIndexedMessage(args.statements, args.sessionDbId, normalizedMessage, {
                provider: args.discovered.provider,
                sessionId: args.discovered.sourceSessionId,
                filePath: args.discovered.filePath,
                onNotice: args.onNotice,
              });
            }
          },
          onInvalidLine: (lineNumber, error) => {
            const noticeMessage = error instanceof Error ? error.message : String(error);
            parserDiagnostics.push({
              severity: "warning",
              code: "parser.invalid_jsonl_line",
              provider: args.discovered.provider,
              sessionId: args.discovered.sourceSessionId,
              eventIndex: lineNumber - 1,
              message: noticeMessage,
            });
            args.onNotice({
              provider: args.discovered.provider,
              sessionId: args.discovered.sourceSessionId,
              filePath: args.discovered.filePath,
              stage: "parse",
              severity: "warning",
              code: "parser.invalid_jsonl_line",
              message: noticeMessage,
              details: { lineNumber },
            });
          },
        });
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

      if (emittedEvents === 0 && !shouldResume) {
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
      });

      args.statements.upsertIndexedFile.run(
        args.discovered.filePath,
        args.discovered.provider,
        args.discovered.projectPath,
        args.discovered.sessionIdentity,
        args.discovered.fileSize,
        args.discovered.fileMtimeMs,
        args.nowIso,
      );
      const hashes = computeFileHashes(
        args.discovered.filePath,
        args.discovered.fileSize,
      );
      const checkpoint = buildStreamCheckpointState({
        discovered: args.discovered,
        sessionDbId: args.sessionDbId,
        sequence,
        processingState,
        sourceMetaAccumulator,
        streamResult:
          streamResult ??
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

function createMessageProcessingState(
  provider: Provider,
  fileMtimeMs: number,
  systemMessageRules: RegExp[],
  checkpoint?: SerializableMessageProcessingState,
): MessageProcessingState {
  return {
    provider,
    fileMtimeMs,
    systemMessageRules,
    previousMessage: checkpoint?.previousMessage ?? null,
    previousCursorTimestampMs: checkpoint?.previousCursorTimestampMs ?? Number.NEGATIVE_INFINITY,
    assistantThinkingRunRoot: checkpoint?.assistantThinkingRunRoot ?? null,
    assistantThinkingRunBaseline: checkpoint?.assistantThinkingRunBaseline ?? null,
    aggregate: checkpoint?.aggregate ?? {
      messageCount: 0,
      tokenInputTotal: 0,
      tokenOutputTotal: 0,
      startedAtMs: null,
      endedAtMs: null,
      title: "",
      titleRank: null,
    },
  };
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
  const fallbackBaseMs =
    Number.isFinite(state.fileMtimeMs) && state.fileMtimeMs > 0 ? state.fileMtimeMs : Date.now();
  if (state.provider !== "cursor") {
    const createdAtMs = Date.parse(message.createdAt);
    if (Number.isFinite(createdAtMs) && createdAtMs > 0) {
      return message;
    }
    return {
      ...message,
      createdAt: new Date(fallbackBaseMs).toISOString(),
    };
  }

  const parsedMs = Date.parse(message.createdAt);
  let nextMs = Number.isFinite(parsedMs) && parsedMs > 0 ? parsedMs : fallbackBaseMs;
  if (nextMs <= state.previousCursorTimestampMs) {
    nextMs = state.previousCursorTimestampMs + 1;
  }
  state.previousCursorTimestampMs = nextMs;
  return {
    ...message,
    createdAt: new Date(nextMs).toISOString(),
  };
}

function deriveOperationDuration(
  message: IndexedMessage,
  state: MessageProcessingState,
): IndexedMessage {
  if (message.operationDurationMs !== null) {
    updateAssistantThinkingRunState(state, message);
    return message;
  }

  const baseline = selectDerivedBaselineForStream(state, message);
  let nextMessage = message;
  if (baseline && isHighConfidenceDerivedPair(baseline.category, message.category)) {
    const currentMs = Date.parse(message.createdAt);
    const previousMs = Date.parse(baseline.createdAt);
    const durationMs = currentMs - previousMs;
    if (
      Number.isFinite(currentMs) &&
      Number.isFinite(previousMs) &&
      durationMs > 0 &&
      durationMs <= MAX_DERIVED_DURATION_MS
    ) {
      nextMessage = {
        ...message,
        operationDurationMs: durationMs,
        operationDurationSource: "derived",
        operationDurationConfidence: "high",
      };
    }
  }

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
  const preferredCategories: MessageCategory[] = [
    "user",
    "assistant",
    "thinking",
    "system",
    "tool_result",
    "tool_use",
    "tool_edit",
  ];
  const rank = preferredCategories.indexOf(category);
  return rank >= 0 ? rank : preferredCategories.length;
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
): SourceMetadataAccumulator {
  return {
    models: new Set<string>(checkpoint?.models ?? []),
    gitBranch: checkpoint?.gitBranch ?? null,
    cwd: checkpoint?.cwd ?? null,
  };
}

function finalizeSourceMetadata(accumulator: SourceMetadataAccumulator): SourceMetadata {
  return {
    models: [...accumulator.models].sort(),
    gitBranch: accumulator.gitBranch,
    cwd: accumulator.cwd,
  };
}

function serializeSourceMetadataAccumulator(
  accumulator: SourceMetadataAccumulator,
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
    previousCursorTimestampMs: state.previousCursorTimestampMs,
    assistantThinkingRunRoot: state.assistantThinkingRunRoot,
    assistantThinkingRunBaseline: state.assistantThinkingRunBaseline,
    aggregate: state.aggregate,
  };
}

function buildStreamCheckpointState(args: {
  discovered: ReturnType<typeof discoverSessionFiles>[number];
  sessionDbId: string;
  sequence: number;
  processingState: MessageProcessingState;
  sourceMetaAccumulator: SourceMetadataAccumulator;
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
    args.messageCount,
    args.tokenInputTotal,
    args.tokenOutputTotal,
  );
}

function updateSourceMetadataFromEvent(
  provider: Provider,
  event: unknown,
  accumulator: SourceMetadataAccumulator,
): void {
  const record = asRecord(event);
  if (!record) {
    return;
  }

  if (provider === "claude") {
    const message = asRecord(record.message);
    const model = readString(message?.model);
    if (model) {
      accumulator.models.add(model);
    }
    accumulator.gitBranch ??= readString(record.gitBranch);
    accumulator.cwd ??= readString(record.cwd);
    return;
  }

  if (provider === "codex") {
    const payloadRecord = asRecord(record.payload);
    const payloadGit = asRecord(payloadRecord?.git);
    const model =
      readString(payloadRecord?.model) ??
      (readString(record.type) === "turn_context" ? readString(payloadRecord?.model) : null);
    if (model) {
      accumulator.models.add(model);
    }
    accumulator.cwd ??= readString(payloadRecord?.cwd);
    accumulator.gitBranch ??= readString(payloadGit?.branch);
    return;
  }

  const messageRecord = asRecord(record.message);
  const metadataRecord = asRecord(record.metadata);
  const gitRecord = asRecord(record.git) ?? asRecord(metadataRecord?.git);
  const model = readString(messageRecord?.model) ?? readString(record.model);
  if (model) {
    accumulator.models.add(model);
  }
  accumulator.cwd ??=
    readString(record.cwd) ?? readString(messageRecord?.cwd) ?? readString(metadataRecord?.cwd);
  accumulator.gitBranch ??=
    readString(gitRecord?.branch) ?? readString(record.gitBranch) ?? readString(record.branch);
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
    let end = Math.min(value.length, byteLimit);
    while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > byteLimit) {
      end -= 1;
    }
    return value.slice(0, end);
  }

  let start = Math.max(0, value.length - byteLimit);
  while (start < value.length && Buffer.byteLength(value.slice(start), "utf8") > byteLimit) {
    start += 1;
  }
  return value.slice(start);
}

function streamJsonlEvents(
  filePath: string,
  callbacks: {
    startOffsetBytes?: number;
    startLineNumber?: number;
    startEventIndex?: number;
    onEvent: (event: unknown, eventIndex: number) => void;
    onInvalidLine: (lineNumber: number, error: unknown) => void;
  },
): StreamJsonlResult {
  const buffer = Buffer.allocUnsafe(JSONL_READ_BUFFER_BYTES);
  let fd: number | null = null;
  let lineChunks: Buffer[] = [];
  let pendingLineBytes = 0;
  let discardingOversizedLine = false;
  let consumedOffset = callbacks.startOffsetBytes ?? 0;
  let readOffset = callbacks.startOffsetBytes ?? 0;
  let lineNumber = callbacks.startLineNumber ?? 0;
  let eventIndex = callbacks.startEventIndex ?? 0;

  try {
    fd = openSync(filePath, "r");
    const flushLine = (): void => {
      if (discardingOversizedLine) {
        callbacks.onInvalidLine(
          lineNumber + 1,
          new Error(`JSONL line exceeded ${MAX_JSONL_LINE_BYTES} bytes and was skipped.`),
        );
      } else if (lineChunks.length > 0) {
        const line = Buffer.concat(lineChunks).toString("utf8");
        eventIndex = handleJsonlLine(line, lineNumber, eventIndex, callbacks);
      }

      lineChunks = [];
      pendingLineBytes = 0;
      discardingOversizedLine = false;
      lineNumber += 1;
    };

    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, readOffset);
      if (bytesRead <= 0) {
        break;
      }
      readOffset += bytesRead;
      let cursor = 0;
      while (cursor < bytesRead) {
        const newlineIndex = buffer.indexOf(0x0a, cursor);
        const segmentEnd = newlineIndex >= 0 ? newlineIndex : bytesRead;
        const segment = buffer.subarray(cursor, segmentEnd);
        if (!discardingOversizedLine) {
          const nextLineBytes = pendingLineBytes + segment.length;
          if (nextLineBytes > MAX_JSONL_LINE_BYTES) {
            discardingOversizedLine = true;
            lineChunks = [];
          } else if (segment.length > 0) {
            lineChunks.push(Buffer.from(segment));
          }
        }
        pendingLineBytes += segment.length;

        if (newlineIndex >= 0) {
          consumedOffset += pendingLineBytes + 1;
          flushLine();
          cursor = newlineIndex + 1;
          continue;
        }

        cursor = bytesRead;
      }
    }
    if (pendingLineBytes > 0 || lineChunks.length > 0 || discardingOversizedLine) {
      consumedOffset = readOffset;
      flushLine();
    }
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }

  return {
    nextOffsetBytes: consumedOffset,
    nextLineNumber: lineNumber,
    nextEventIndex: eventIndex,
  };
}

function handleJsonlLine(
  line: string,
  lineNumber: number,
  eventIndex: number,
  callbacks: {
    onEvent: (event: unknown, eventIndex: number) => void;
    onInvalidLine: (lineNumber: number, error: unknown) => void;
  },
): number {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return eventIndex;
  }
  try {
    callbacks.onEvent(JSON.parse(trimmed) as unknown, eventIndex);
    return eventIndex + 1;
  } catch (error) {
    callbacks.onInvalidLine(lineNumber + 1, error);
    return eventIndex;
  }
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
  const persistedContent = truncateTextForIndexing(
    message.content,
    MAX_INDEXED_MESSAGE_CONTENT_BYTES,
  );
  const persistedContentWasTruncated = persistedContent !== message.content;
  const ftsContent = truncateTextForIndexing(persistedContent, MAX_INDEXED_FTS_CONTENT_BYTES);
  const ftsContentWasTruncated = ftsContent !== persistedContent;
  if (context && persistedContentWasTruncated) {
    context.onNotice({
      provider: context.provider,
      sessionId: context.sessionId,
      filePath: context.filePath,
      stage: "persist",
      severity: "warning",
      code: "index.message_content_truncated",
      message: `Truncated indexed message content for ${message.id}.`,
      details: {
        messageId: message.id,
        category: message.category,
        originalBytes: Buffer.byteLength(message.content, "utf8"),
        storedBytes: Buffer.byteLength(persistedContent, "utf8"),
      },
    });
  }
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
  if (!args.existing || !args.checkpoint || !args.existingSessionId) {
    return false;
  }
  if (args.discovered.provider === "gemini" || args.discovered.provider === "opencode") {
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
        previousCursorTimestampMs:
          typeof processingRecord?.previousCursorTimestampMs === "number"
            ? processingRecord.previousCursorTimestampMs
            : Number.NEGATIVE_INFINITY,
        assistantThinkingRunRoot: readString(processingRecord?.assistantThinkingRunRoot) ?? null,
        assistantThinkingRunBaseline: parseCheckpointMessage(
          processingRecord?.assistantThinkingRunBaseline,
        ),
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
  return {
    id,
    sessionId,
    provider: provider as Provider,
    category: category as MessageCategory,
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
  };
}

function parseAggregateState(value: unknown): SessionAggregateState {
  const record = asRecord(value);
  return {
    messageCount: typeof record?.messageCount === "number" ? record.messageCount : 0,
    tokenInputTotal: typeof record?.tokenInputTotal === "number" ? record.tokenInputTotal : 0,
    tokenOutputTotal: typeof record?.tokenOutputTotal === "number" ? record.tokenOutputTotal : 0,
    startedAtMs: typeof record?.startedAtMs === "number" ? record.startedAtMs : null,
    endedAtMs: typeof record?.endedAtMs === "number" ? record.endedAtMs : null,
    title: readString(record?.title) ?? "",
    titleRank: typeof record?.titleRank === "number" ? record.titleRank : null,
  };
}

function listIndexCheckpoints(db: SqliteDatabase): IndexCheckpointRow[] {
  return db
    .prepare(
      `SELECT
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
    .all() as IndexCheckpointRow[];
}

function computeFileHashes(
  filePath: string,
  fileSize: number,
): {
  headHash: string;
  tailHash: string;
} {
  return {
    headHash: hashFileSlice(
      filePath,
      0,
      Math.min(fileSize, JSONL_FINGERPRINT_WINDOW_BYTES),
    ),
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
    hashFileSlice(
      filePath,
      0,
      Math.min(previousFileSize, JSONL_FINGERPRINT_WINDOW_BYTES),
    ) === expectedHeadHash &&
    hashFileSlice(
      filePath,
      Math.max(0, previousFileSize - JSONL_FINGERPRINT_WINDOW_BYTES),
      Math.min(previousFileSize, JSONL_FINGERPRINT_WINDOW_BYTES),
    ) === expectedTailHash
  );
}

function hashFileSlice(
  filePath: string,
  start: number,
  length: number,
): string {
  const hash = createHash("sha256");
  if (length <= 0) {
    return hash.digest("hex");
  }

  const buffer = Buffer.allocUnsafe(Math.min(length, JSONL_FINGERPRINT_WINDOW_BYTES));
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

function listIndexedFiles(db: SqliteDatabase): IndexedFileRow[] {
  return db
    .prepare(
      `SELECT file_path, provider, session_identity, file_size, file_mtime_ms
       FROM indexed_files`,
    )
    .all() as IndexedFileRow[];
}

function listSessionFiles(db: SqliteDatabase): SessionFileRow[] {
  return db.prepare("SELECT id, file_path FROM sessions").all() as SessionFileRow[];
}

function deleteSessionData(db: SqliteDatabase, sessionId: string): void {
  db.prepare(
    "DELETE FROM tool_calls WHERE message_id IN (SELECT id FROM messages WHERE session_id = ?)",
  ).run(sessionId);
  db.prepare("DELETE FROM message_fts WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

function deleteSessionDataForFilePath(db: SqliteDatabase, filePath: string): void {
  const rows = db.prepare("SELECT id FROM sessions WHERE file_path = ?").all(filePath) as Array<{
    id: string;
  }>;
  for (const row of rows) {
    deleteSessionData(db, row.id);
  }
}

function readProviderSource(
  provider: Provider,
  filePath: string,
  readFileText: ReadFileText,
): {
  rawPayload: unknown[] | Record<string, unknown>;
  parsePayload: unknown[] | Record<string, unknown>;
} | null {
  try {
    // Gemini stores one JSON document per session, while the other providers currently emit JSONL.
    if (provider === "gemini") {
      const parsed = JSON.parse(readFileText(filePath)) as Record<string, unknown>;
      return {
        rawPayload: parsed,
        parsePayload: parsed,
      };
    }

    // OpenCode stores sessions in its own SQLite DB; read messages+parts and synthesize events.
    if (provider === "opencode") {
      return readOpenCodeSource(filePath);
    }

    const lines = readFileText(filePath)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const parsedLines = lines
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return null;
        }
      })
      .filter((entry) => entry !== null) as unknown[];

    return {
      rawPayload: parsedLines,
      parsePayload: parsedLines,
    };
  } catch {
    return null;
  }
}

export type OpenCodeMessagePartReader = {
  readSessionMessagesWithParts: (
    dbPath: string,
    sessionId: string,
  ) => Array<{
    messageId: string;
    role: string;
    timeCreated: number;
    timeCompleted: number | null;
    modelId: string | null;
    providerId: string | null;
    cwd: string | null;
    tokenInput: number | null;
    tokenOutput: number | null;
    parts: Array<{ id: string; type: string; data: string }>;
  }>;
};

let _opencodeMessagePartReader: OpenCodeMessagePartReader | null = null;

export function setOpenCodeMessagePartReader(reader: OpenCodeMessagePartReader): void {
  _opencodeMessagePartReader = reader;
}

function readOpenCodeSource(filePath: string): {
  rawPayload: unknown[];
  parsePayload: unknown[];
} | null {
  const parsed = parseOpenCodeVirtualPath(filePath);
  if (!parsed) {
    return null;
  }

  const reader = _opencodeMessagePartReader;
  if (!reader) {
    return null;
  }

  try {
    const messages = reader.readSessionMessagesWithParts(parsed.dbPath, parsed.sessionId);
    const events: unknown[] = [];

    for (const message of messages) {
      const parts: unknown[] = [];
      for (const part of message.parts) {
        try {
          parts.push(JSON.parse(part.data));
        } catch {
          parts.push({ type: part.type, text: part.data });
        }
      }

      events.push({
        messageId: message.messageId,
        role: message.role,
        timestamp: new Date(message.timeCreated).toISOString(),
        completedAt: message.timeCompleted
          ? new Date(message.timeCompleted).toISOString()
          : null,
        model: message.modelId,
        providerId: message.providerId,
        cwd: message.cwd,
        usage: {
          input_tokens: message.tokenInput,
          output_tokens: message.tokenOutput,
        },
        parts,
      });
    }

    return { rawPayload: events, parsePayload: events };
  } catch {
    return null;
  }
}

function extractSourceMetadata(
  provider: Provider,
  payload: unknown[] | Record<string, unknown>,
): {
  models: string[];
  gitBranch: string | null;
  cwd: string | null;
} {
  const models = new Set<string>();
  let gitBranch: string | null = null;
  let cwd: string | null = null;

  if (provider === "gemini") {
    const root = asRecord(payload);
    const messages = asArray(root?.messages);

    for (const message of messages) {
      const record = asRecord(message);
      if (!record) {
        continue;
      }

      const model = readString(record.model);
      if (model) {
        models.add(model);
      }
    }
  }

  if (provider === "claude") {
    for (const entry of asArray(payload)) {
      const record = asRecord(entry);
      const message = asRecord(record?.message);
      const model = readString(message?.model);
      if (model) {
        models.add(model);
      }

      gitBranch ??= readString(record?.gitBranch);
      cwd ??= readString(record?.cwd);
    }
  }

  if (provider === "codex") {
    for (const entry of asArray(payload)) {
      const record = asRecord(entry);
      const payloadRecord = asRecord(record?.payload);
      const payloadGit = asRecord(payloadRecord?.git);

      const model =
        readString(payloadRecord?.model) ??
        (readString(record?.type) === "turn_context" ? readString(payloadRecord?.model) : null);
      if (model) {
        models.add(model);
      }

      cwd ??= readString(payloadRecord?.cwd);
      gitBranch ??= readString(payloadGit?.branch);
    }
  }

  if (provider === "cursor") {
    for (const entry of asArray(payload)) {
      const record = asRecord(entry);
      if (!record) {
        continue;
      }
      const messageRecord = asRecord(record.message);
      const metadataRecord = asRecord(record.metadata);
      const gitRecord = asRecord(record.git) ?? asRecord(metadataRecord?.git);
      const model = readString(messageRecord?.model) ?? readString(record.model);
      if (model) {
        models.add(model);
      }
      cwd ??=
        readString(record.cwd) ?? readString(messageRecord?.cwd) ?? readString(metadataRecord?.cwd);
      gitBranch ??=
        readString(gitRecord?.branch) ?? readString(record.gitBranch) ?? readString(record.branch);
    }
  }

  if (provider === "opencode") {
    for (const entry of asArray(payload)) {
      const record = asRecord(entry);
      if (!record) {
        continue;
      }
      const model = readString(record.model);
      if (model) {
        models.add(model);
      }
      cwd ??= readString(record.cwd);
    }
  }

  return {
    models: [...models].sort(),
    gitBranch,
    cwd,
  };
}

function deriveOperationDurations(messages: IndexedMessage[]): IndexedMessage[] {
  return messages.map((message, index) => {
    if (message.operationDurationMs !== null) {
      return message;
    }

    const previous = selectDerivedBaseline(messages, index, message.category);
    if (!previous) {
      return message;
    }

    if (!isHighConfidenceDerivedPair(previous.category, message.category)) {
      return message;
    }

    const currentMs = Date.parse(message.createdAt);
    const previousMs = Date.parse(previous.createdAt);
    if (!Number.isFinite(currentMs) || !Number.isFinite(previousMs)) {
      return message;
    }

    const durationMs = currentMs - previousMs;
    if (durationMs <= 0 || durationMs > MAX_DERIVED_DURATION_MS) {
      return message;
    }

    // Derived durations are only filled when the adjacent message pair is a high-confidence
    // request/response boundary; otherwise leaving null is safer than inventing precision.
    return {
      ...message,
      operationDurationMs: durationMs,
      operationDurationSource: "derived",
      operationDurationConfidence: "high",
    };
  });
}

function normalizeMessageTimestamps(
  messages: IndexedMessage[],
  provider: Provider,
  fileMtimeMs: number,
): IndexedMessage[] {
  const fallbackBaseMs = Number.isFinite(fileMtimeMs) && fileMtimeMs > 0 ? fileMtimeMs : Date.now();
  if (provider !== "cursor") {
    const fallbackIso = new Date(fallbackBaseMs).toISOString();
    return messages.map((message) => {
      const createdAtMs = Date.parse(message.createdAt);
      if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) {
        return { ...message, createdAt: fallbackIso };
      }
      return message;
    });
  }

  let previousMs = Number.NEGATIVE_INFINITY;
  return messages.map((message, index) => {
    // Cursor transcripts can contain duplicate or missing timestamps. Force a monotonic sequence so
    // sort order and pagination stay stable across reloads.
    const parsedMs = Date.parse(message.createdAt);
    let nextMs = Number.isFinite(parsedMs) && parsedMs > 0 ? parsedMs : fallbackBaseMs + index;
    if (!Number.isFinite(nextMs) || nextMs <= 0) {
      nextMs = fallbackBaseMs + index;
    }
    if (nextMs <= previousMs) {
      nextMs = previousMs + 1;
    }
    previousMs = nextMs;
    return { ...message, createdAt: new Date(nextMs).toISOString() };
  });
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
  const preferredCategories: MessageCategory[] = [
    "user",
    "assistant",
    "thinking",
    "system",
    "tool_result",
  ];

  for (const category of preferredCategories) {
    for (const message of messages) {
      if (message.category !== category) {
        continue;
      }
      const title = normalizeSessionTitleText(message.content);
      if (title.length > 0) {
        return title;
      }
    }
  }

  for (const message of messages) {
    const title = normalizeSessionTitleText(message.content);
    if (title.length > 0) {
      return title;
    }
  }

  return "";
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
  const compiledByProvider: Record<Provider, RegExp[]> = {
    claude: [],
    codex: [],
    gemini: [],
    cursor: [],
    opencode: [],
  };

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

  return messages.map((message) => {
    if (message.category === "system") {
      return message;
    }

    const isSystemMatch = rules.some((rule) => rule.test(message.content));
    if (!isSystemMatch) {
      return message;
    }

    return {
      ...message,
      category: "system",
    };
  });
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
