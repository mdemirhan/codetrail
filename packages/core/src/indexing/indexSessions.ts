import { readFileSync } from "node:fs";

import type { Provider } from "../contracts/canonical";
import {
  type SqliteDatabase,
  clearIndexedData,
  ensureDatabaseSchema,
  openDatabase,
} from "../db/bootstrap";
import { DEFAULT_DISCOVERY_CONFIG, type DiscoveryConfig, discoverSessionFiles } from "../discovery";
import { parseSession } from "../parsing";
import { asArray, asRecord, readString } from "../parsing/helpers";

import { makeMessageId, makeProjectId, makeSessionId, makeToolCallId } from "./ids";

export type IndexingConfig = {
  dbPath: string;
  forceReindex?: boolean;
  discoveryConfig?: Partial<DiscoveryConfig>;
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

type IndexedFileRow = {
  file_path: string;
  provider: Provider;
  session_identity: string;
  file_size: number;
  file_mtime_ms: number;
};

type SessionFileRow = {
  id: string;
  file_path: string;
};

export function runIncrementalIndexing(config: IndexingConfig): IndexingResult {
  const discoveryConfig = resolveDiscoveryConfig(config.discoveryConfig);
  const discoveredFiles = discoverSessionFiles(discoveryConfig);
  const discoveredByFilePath = new Map(discoveredFiles.map((file) => [file.filePath, file]));

  const db = openDatabase(config.dbPath);
  try {
    const schema = ensureDatabaseSchema(db);

    if (config.forceReindex) {
      clearIndexedData(db);
    }

    const existingRows = listIndexedFiles(db);
    const existingByFilePath = new Map(existingRows.map((row) => [row.file_path, row]));
    const existingSessionRows = listSessionFiles(db);
    const existingSessionByFilePath = new Map(
      existingSessionRows.map((row) => [row.file_path, row.id]),
    );

    let indexedFiles = 0;
    let skippedFiles = 0;
    let removedFiles = 0;
    const diagnostics = { warnings: 0, errors: 0 };

    if (!config.forceReindex) {
      for (const existing of existingRows) {
        if (discoveredByFilePath.has(existing.file_path)) {
          continue;
        }

        deleteSessionDataForFilePath(db, existing.file_path);
        db.prepare("DELETE FROM indexed_files WHERE file_path = ?").run(existing.file_path);
        existingSessionByFilePath.delete(existing.file_path);
        removedFiles += 1;
      }
    }

    const upsertProject = db.prepare(
      `INSERT INTO projects (id, provider, name, path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         path = excluded.path,
         updated_at = excluded.updated_at`,
    );

    const upsertSession = db.prepare(
      `INSERT INTO sessions (
         id,
         project_id,
         provider,
         file_path,
         model_names,
         started_at,
         ended_at,
         duration_ms,
         git_branch,
         cwd,
         message_count,
         token_input_total,
         token_output_total
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id,
         provider = excluded.provider,
         file_path = excluded.file_path,
         model_names = excluded.model_names,
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         duration_ms = excluded.duration_ms,
         git_branch = excluded.git_branch,
         cwd = excluded.cwd,
         message_count = excluded.message_count,
         token_input_total = excluded.token_input_total,
         token_output_total = excluded.token_output_total`,
    );

    const insertMessage = db.prepare(
      `INSERT INTO messages (
        id,
        source_id,
        session_id,
        provider,
        category,
        content,
        created_at,
        token_input,
        token_output
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const insertMessageFts = db.prepare(
      `INSERT INTO message_fts (message_id, session_id, provider, category, content)
       VALUES (?, ?, ?, ?, ?)`,
    );

    const insertToolCall = db.prepare(
      `INSERT INTO tool_calls (
        id,
        message_id,
        tool_name,
        args_json,
        result_json,
        started_at,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const upsertIndexedFile = db.prepare(
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
    );

    const nowIso = new Date().toISOString();

    for (const discovered of discoveredFiles) {
      const existing = existingByFilePath.get(discovered.filePath);
      const sessionDbId = makeSessionId(discovered.provider, discovered.sessionIdentity);
      const existingSessionId = existingSessionByFilePath.get(discovered.filePath);
      const unchanged =
        !config.forceReindex &&
        !!existing &&
        existing.file_size === discovered.fileSize &&
        existing.file_mtime_ms === discovered.fileMtimeMs &&
        existingSessionId === sessionDbId;

      if (unchanged) {
        skippedFiles += 1;
        continue;
      }

      const source = readProviderSource(discovered.provider, discovered.filePath);
      if (source === null) {
        diagnostics.errors += 1;
        continue;
      }

      let parsed: ReturnType<typeof parseSession>;
      try {
        parsed = parseSession({
          provider: discovered.provider,
          sessionId: discovered.sourceSessionId,
          payload: source.parsePayload,
        });
      } catch {
        diagnostics.errors += 1;
        continue;
      }

      for (const diagnostic of parsed.diagnostics) {
        if (diagnostic.severity === "error") {
          diagnostics.errors += 1;
        } else {
          diagnostics.warnings += 1;
        }
      }

      const projectId = makeProjectId(discovered.provider, discovered.projectPath);
      const sourceMeta = extractSourceMetadata(discovered.provider, source.rawPayload);
      const aggregate = buildSessionAggregate(
        parsed.messages.map((message) => ({
          ...message,
          id: makeMessageId(sessionDbId, message.id),
        })),
      );

      const persist = db.transaction(() => {
        deleteSessionDataForFilePath(db, discovered.filePath);
        deleteSessionData(db, sessionDbId);

        upsertProject.run(
          projectId,
          discovered.provider,
          discovered.projectName,
          discovered.projectPath,
          nowIso,
          nowIso,
        );

        upsertSession.run(
          sessionDbId,
          projectId,
          discovered.provider,
          discovered.filePath,
          sourceMeta.models.join(","),
          aggregate.startedAt,
          aggregate.endedAt,
          aggregate.durationMs,
          sourceMeta.gitBranch ?? discovered.metadata.gitBranch,
          sourceMeta.cwd ?? discovered.metadata.cwd,
          aggregate.messageCount,
          aggregate.tokenInputTotal,
          aggregate.tokenOutputTotal,
        );

        for (const message of parsed.messages) {
          const messageId = makeMessageId(sessionDbId, message.id);

          insertMessage.run(
            messageId,
            message.id,
            sessionDbId,
            message.provider,
            message.category,
            message.content,
            message.createdAt,
            message.tokenInput,
            message.tokenOutput,
          );

          insertMessageFts.run(
            messageId,
            sessionDbId,
            message.provider,
            message.category,
            message.content,
          );

          if (message.category !== "tool_use" && message.category !== "tool_edit") {
            continue;
          }

          const toolCall = parseToolCallContent(message.content);
          insertToolCall.run(
            makeToolCallId(messageId, 0),
            messageId,
            toolCall.toolName,
            toolCall.argsJson,
            toolCall.resultJson,
            message.createdAt,
            null,
          );
        }

        upsertIndexedFile.run(
          discovered.filePath,
          discovered.provider,
          discovered.projectPath,
          discovered.sessionIdentity,
          discovered.fileSize,
          discovered.fileMtimeMs,
          nowIso,
        );
      });

      persist();
      existingSessionByFilePath.set(discovered.filePath, sessionDbId);
      indexedFiles += 1;
    }

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

function resolveDiscoveryConfig(config?: Partial<DiscoveryConfig>): DiscoveryConfig {
  return {
    ...DEFAULT_DISCOVERY_CONFIG,
    ...config,
  };
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
): {
  rawPayload: unknown[] | Record<string, unknown>;
  parsePayload: unknown[] | Record<string, unknown>;
} | null {
  try {
    if (provider === "gemini") {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
      return {
        rawPayload: parsed,
        parsePayload: parsed,
      };
    }

    const lines = readFileSync(filePath, "utf8")
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

  return {
    models: [...models].sort(),
    gitBranch,
    cwd,
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
    .filter((value) => Number.isFinite(value));

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

function parseToolCallContent(content: string): {
  toolName: string;
  argsJson: string;
  resultJson: string | null;
} {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const toolName = readString(parsed.name) ?? readString(parsed.tool_name) ?? "unknown";

    const args = parsed.args ?? parsed.input ?? parsed.arguments ?? parsed;
    const result = parsed.result ?? parsed.output ?? null;

    return {
      toolName,
      argsJson: JSON.stringify(args),
      resultJson: result ? JSON.stringify(result) : null,
    };
  } catch {
    return {
      toolName: "unknown",
      argsJson: JSON.stringify({ raw: content }),
      resultJson: null,
    };
  }
}
