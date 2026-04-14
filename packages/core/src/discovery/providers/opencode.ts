import { basename, join } from "node:path";

import Database from "better-sqlite3";

import { compactMetadata } from "../../metadata";
import { asRecord, readString } from "../../parsing/helpers";
import type { ProviderReadSourceResult, ProviderSource, ReadFileText } from "../../providers/types";
import {
  type ResolvedDiscoveryDependencies,
  getDiscoveryPath,
  projectNameFromPath,
  providerSessionIdentity,
} from "../shared";
import type { DiscoveredSessionFile, ResolvedDiscoveryConfig } from "../types";

const OPENCODE_DB_FILENAME = "opencode.db";
const OPENCODE_SOURCE_PREFIX = "opencode:";

type OpenCodeDiscoveryRow = {
  session_id: string;
  project_id: string;
  parent_id: string | null;
  directory: string;
  title: string;
  version: string;
  time_created: number;
  time_updated: number;
  project_name: string | null;
  payload_bytes: number | null;
};

type OpenCodeSessionRow = {
  session_id: string;
  project_id: string;
  parent_id: string | null;
  slug: string;
  directory: string;
  title: string;
  version: string;
  time_created: number;
  time_updated: number;
  time_archived: number | null;
  project_name: string | null;
};

type OpenCodeMessageRow = {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
};

type OpenCodePartRow = {
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
};

function openReadOnlyDatabase(dbPath: string): InstanceType<typeof Database> {
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

export function buildOpenCodeDatabasePath(root: string): string {
  return join(root, OPENCODE_DB_FILENAME);
}

export function buildOpenCodeSessionSourceKey(dbPath: string, sessionId: string): string {
  return `${OPENCODE_SOURCE_PREFIX}${dbPath}:${sessionId}`;
}

export function buildOpenCodeSessionSourcePrefix(dbPath: string): string {
  return `${OPENCODE_SOURCE_PREFIX}${dbPath}:`;
}

export function parseOpenCodeSessionSourceKey(sourceKey: string): {
  dbPath: string;
  sessionId: string;
} | null {
  if (!sourceKey.startsWith(OPENCODE_SOURCE_PREFIX)) {
    return null;
  }

  const remainder = sourceKey.slice(OPENCODE_SOURCE_PREFIX.length);
  const separator = remainder.lastIndexOf(":");
  if (separator <= 0 || separator === remainder.length - 1) {
    return null;
  }

  return {
    dbPath: remainder.slice(0, separator),
    sessionId: remainder.slice(separator + 1),
  };
}

export function normalizeOpenCodeDatabasePath(
  changedPath: string,
  opencodeRoot: string,
): string | null {
  const dbPath = buildOpenCodeDatabasePath(opencodeRoot);
  if (
    changedPath === dbPath ||
    changedPath === `${dbPath}-wal` ||
    changedPath === `${dbPath}-shm`
  ) {
    return dbPath;
  }
  return null;
}

function readDiscoveryRows(
  dbPath: string,
  dependencies: ResolvedDiscoveryDependencies,
  sessionId?: string,
): OpenCodeDiscoveryRow[] {
  let db: InstanceType<typeof Database> | null = null;
  try {
    db = openReadOnlyDatabase(dbPath);
    return db
      .prepare(
        `SELECT
           s.id AS session_id,
           s.project_id AS project_id,
           s.parent_id AS parent_id,
           s.directory AS directory,
           s.title AS title,
           s.version AS version,
           s.time_created AS time_created,
           s.time_updated AS time_updated,
           p.name AS project_name,
           COALESCE((SELECT SUM(LENGTH(m.data)) FROM message m WHERE m.session_id = s.id), 0) +
           COALESCE((SELECT SUM(LENGTH(prt.data)) FROM part prt WHERE prt.session_id = s.id), 0) AS payload_bytes
         FROM session s
         LEFT JOIN project p ON p.id = s.project_id
         WHERE (? IS NULL OR s.id = ?)
         ORDER BY s.time_updated DESC, s.id DESC`,
      )
      .all(sessionId ?? null, sessionId ?? null) as OpenCodeDiscoveryRow[];
  } catch (error) {
    dependencies.onDiscoveryIssue({ operation: "readFile", path: dbPath, error });
    return [];
  } finally {
    db?.close();
  }
}

function toDiscoveredSession(row: OpenCodeDiscoveryRow, dbPath: string): DiscoveredSessionFile {
  const projectPath = row.directory || "";
  const unresolvedProject = projectPath.length === 0;
  const filePath = buildOpenCodeSessionSourceKey(dbPath, row.session_id);

  return {
    provider: "opencode",
    projectPath,
    canonicalProjectPath: projectPath,
    projectName: unresolvedProject
      ? row.project_name || basename(row.directory) || "Unknown"
      : projectNameFromPath(projectPath),
    sessionIdentity: providerSessionIdentity("opencode", row.session_id, filePath),
    sourceSessionId: row.session_id,
    filePath,
    backingFilePath: dbPath,
    fileSize: Math.max(0, Number(row.payload_bytes ?? 0)),
    fileMtimeMs: Math.max(0, Number(row.time_updated ?? row.time_created ?? 0)),
    metadata: {
      includeInHistory: true,
      isSubagent: false,
      unresolvedProject,
      gitBranch: null,
      cwd: row.directory || null,
      worktreeLabel: null,
      worktreeSource: null,
      repositoryUrl: null,
      forkedFromSessionId: row.parent_id,
      parentSessionCwd: null,
      providerProjectKey: row.project_id,
      providerSessionId: row.session_id,
      sessionKind: row.parent_id ? "forked" : "regular",
      gitCommitHash: null,
      providerClient: "OpenCode",
      providerSource: null,
      providerClientVersion: row.version || null,
      lineageParentId: row.parent_id,
      resolutionSource: row.directory ? "session_directory" : "unresolved",
      projectMetadata: null,
      sessionMetadata: compactMetadata({ title: row.title || undefined }),
    },
  };
}

function discoverSessionsFromDb(
  dbPath: string,
  dependencies: ResolvedDiscoveryDependencies,
  sessionId?: string,
): DiscoveredSessionFile[] {
  if (!dependencies.fs.existsSync(dbPath)) {
    return [];
  }
  return readDiscoveryRows(dbPath, dependencies, sessionId).map((row) =>
    toDiscoveredSession(row, dbPath),
  );
}

export function discoverOpenCodeFiles(
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  const root = getDiscoveryPath(config, "opencode", "opencodeRoot");
  return root ? discoverSessionsFromDb(buildOpenCodeDatabasePath(root), dependencies) : [];
}

export function discoverSingleOpenCodeFile(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile | null {
  const parsed = parseOpenCodeSessionSourceKey(filePath);
  const root = getDiscoveryPath(config, "opencode", "opencodeRoot");
  const configuredDbPath = root ? buildOpenCodeDatabasePath(root) : null;
  if (!parsed || !configuredDbPath || parsed.dbPath !== configuredDbPath) {
    return null;
  }

  return discoverSessionsFromDb(parsed.dbPath, dependencies, parsed.sessionId)[0] ?? null;
}

export function discoverChangedOpenCodeFiles(
  filePath: string,
  config: ResolvedDiscoveryConfig,
  dependencies: ResolvedDiscoveryDependencies,
): DiscoveredSessionFile[] {
  const parsed = parseOpenCodeSessionSourceKey(filePath);
  if (parsed) {
    return discoverSessionsFromDb(parsed.dbPath, dependencies, parsed.sessionId);
  }

  const root = getDiscoveryPath(config, "opencode", "opencodeRoot");
  if (!root) {
    return [];
  }

  const dbPath = normalizeOpenCodeDatabasePath(filePath, root);
  return dbPath ? discoverSessionsFromDb(dbPath, dependencies) : [];
}

export function readOpenCodeSource(
  discovered: DiscoveredSessionFile,
  _readFileText: ReadFileText,
): ProviderReadSourceResult | null {
  const parsed = parseOpenCodeSessionSourceKey(discovered.filePath);
  const dbPath = parsed?.dbPath ?? discovered.backingFilePath;
  const sessionId = parsed?.sessionId ?? discovered.sourceSessionId;
  if (!dbPath) {
    return null;
  }

  let db: InstanceType<typeof Database> | null = null;
  try {
    db = openReadOnlyDatabase(dbPath);
    const sessionRow = db
      .prepare(
        `SELECT
           s.id AS session_id,
           s.project_id AS project_id,
           s.parent_id AS parent_id,
           s.slug AS slug,
           s.directory AS directory,
           s.title AS title,
           s.version AS version,
           s.time_created AS time_created,
           s.time_updated AS time_updated,
           s.time_archived AS time_archived,
           p.name AS project_name
         FROM session s
         LEFT JOIN project p ON p.id = s.project_id
         WHERE s.id = ?`,
      )
      .get(sessionId) as OpenCodeSessionRow | undefined;

    if (!sessionRow) {
      return null;
    }

    const messageRows = db
      .prepare(
        `SELECT id, session_id, time_created, time_updated, data
         FROM message
         WHERE session_id = ?
         ORDER BY time_created ASC, id ASC`,
      )
      .all(sessionId) as OpenCodeMessageRow[];
    const partRows = db
      .prepare(
        `SELECT id, message_id, session_id, time_created, time_updated, data
         FROM part
         WHERE session_id = ?
         ORDER BY time_created ASC, id ASC`,
      )
      .all(sessionId) as OpenCodePartRow[];

    const partsByMessageId = new Map<string, Array<Record<string, unknown>>>();
    for (const row of partRows) {
      const parts = partsByMessageId.get(row.message_id) ?? [];
      parts.push({
        id: row.id,
        messageId: row.message_id,
        sessionId: row.session_id,
        timeCreated: row.time_created,
        timeUpdated: row.time_updated,
        data: parseJsonObject(row.data) ?? {},
      });
      partsByMessageId.set(row.message_id, parts);
    }

    return {
      payload: {
        session: {
          id: sessionRow.session_id,
          projectId: sessionRow.project_id,
          parentId: sessionRow.parent_id,
          slug: sessionRow.slug,
          directory: sessionRow.directory,
          title: sessionRow.title,
          version: sessionRow.version,
          timeCreated: sessionRow.time_created,
          timeUpdated: sessionRow.time_updated,
          timeArchived: sessionRow.time_archived,
        },
        project: {
          id: sessionRow.project_id,
          name: sessionRow.project_name,
        },
        messages: messageRows.map((row) => ({
          id: row.id,
          sessionId: row.session_id,
          timeCreated: row.time_created,
          timeUpdated: row.time_updated,
          data: parseJsonObject(row.data) ?? {},
          parts: partsByMessageId.get(row.id) ?? [],
        })),
      } as ProviderSource,
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
