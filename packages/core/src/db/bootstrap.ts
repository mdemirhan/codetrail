import Database from "better-sqlite3";

import type { Provider } from "../contracts/canonical";

import { DATABASE_SCHEMA_VERSION } from "./constants";

export type DatabaseBootstrapResult = {
  schemaVersion: number;
  schemaRebuilt: boolean;
  tables: string[];
};

export const MESSAGE_FTS_CONTENT_COLUMN_INDEX = 4;

export type SqliteDatabase = InstanceType<typeof Database>;

// The schema is intentionally small and append-friendly: raw transcript files stay on disk, while
// SQLite stores the normalized searchable projection plus incremental indexing metadata.
const tableStatements = [
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    provider_project_key TEXT,
    repository_url TEXT,
    resolution_state TEXT,
    resolution_source TEXT,
    metadata_json TEXT,
    name_folded TEXT GENERATED ALWAYS AS (LOWER(name)) STORED,
    path_folded TEXT GENERATED ALWAYS AS (LOWER(path)) STORED,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    model_names TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    duration_ms INTEGER,
    git_branch TEXT,
    cwd TEXT,
    session_identity TEXT,
    provider_session_id TEXT,
    session_kind TEXT,
    canonical_project_path TEXT,
    repository_url TEXT,
    git_commit_hash TEXT,
    lineage_parent_id TEXT,
    provider_client TEXT,
    provider_source TEXT,
    provider_client_version TEXT,
    resolution_source TEXT,
    metadata_json TEXT,
    worktree_label TEXT,
    worktree_source TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    token_input_total INTEGER NOT NULL DEFAULT 0,
    token_output_total INTEGER NOT NULL DEFAULT 0,
    activity_at TEXT GENERATED ALWAYS AS (COALESCE(ended_at, started_at)) STORED,
    activity_at_ms INTEGER GENERATED ALWAYS AS (
      CASE
        WHEN unixepoch(ended_at) IS NOT NULL THEN CAST(unixepoch(ended_at) AS INTEGER) * 1000
        WHEN unixepoch(started_at) IS NOT NULL THEN CAST(unixepoch(started_at) AS INTEGER) * 1000
        ELSE -9223372036854775808
      END
    ) STORED,
    FOREIGN KEY(project_id) REFERENCES projects(id)
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    token_input INTEGER,
    token_output INTEGER,
    operation_duration_ms INTEGER,
    operation_duration_source TEXT,
    operation_duration_confidence TEXT,
    turn_group_id TEXT,
    turn_grouping_mode TEXT NOT NULL DEFAULT 'heuristic',
    turn_anchor_kind TEXT,
    native_turn_id TEXT,
    created_at_ms INTEGER GENERATED ALWAYS AS (
      CASE
        WHEN unixepoch(created_at) IS NOT NULL THEN CAST(unixepoch(created_at) AS INTEGER) * 1000
        ELSE -9223372036854775808
      END
    ) STORED,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
  )`,
  `CREATE TABLE IF NOT EXISTS project_stats (
    project_id TEXT PRIMARY KEY,
    session_count INTEGER NOT NULL DEFAULT 0,
    message_count INTEGER NOT NULL DEFAULT 0,
    last_activity TEXT,
    last_activity_ms INTEGER NOT NULL DEFAULT -9223372036854775808,
    FOREIGN KEY(project_id) REFERENCES projects(id)
  )`,
  `CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    args_json TEXT NOT NULL,
    result_json TEXT,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY(message_id) REFERENCES messages(id)
  )`,
  `CREATE TABLE IF NOT EXISTS message_tool_edit_files (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    file_ordinal INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    previous_file_path TEXT,
    change_type TEXT NOT NULL,
    unified_diff TEXT,
    added_line_count INTEGER NOT NULL DEFAULT 0,
    removed_line_count INTEGER NOT NULL DEFAULT 0,
    exactness TEXT NOT NULL,
    before_hash TEXT,
    after_hash TEXT,
    FOREIGN KEY(message_id) REFERENCES messages(id),
    UNIQUE(message_id, file_ordinal)
  )`,
  `CREATE TABLE IF NOT EXISTS indexed_files (
    file_path TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    project_path TEXT NOT NULL,
    session_identity TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_mtime_ms INTEGER NOT NULL,
    indexed_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS index_checkpoints (
    file_path TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    session_id TEXT NOT NULL,
    session_identity TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_mtime_ms INTEGER NOT NULL,
    last_offset_bytes INTEGER NOT NULL,
    last_line_number INTEGER NOT NULL,
    last_event_index INTEGER NOT NULL,
    next_message_sequence INTEGER NOT NULL,
    processing_state_json TEXT NOT NULL,
    source_metadata_json TEXT NOT NULL,
    head_hash TEXT NOT NULL,
    tail_hash TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS deleted_sessions (
    file_path TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    project_path TEXT NOT NULL,
    session_identity TEXT NOT NULL,
    session_id TEXT NOT NULL,
    deleted_at_ms INTEGER NOT NULL,
    file_size INTEGER NOT NULL,
    file_mtime_ms INTEGER NOT NULL,
    last_offset_bytes INTEGER,
    last_line_number INTEGER,
    last_event_index INTEGER,
    next_message_sequence INTEGER,
    processing_state_json TEXT,
    source_metadata_json TEXT,
    head_hash TEXT,
    tail_hash TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS deleted_projects (
    provider TEXT NOT NULL,
    project_path TEXT NOT NULL,
    deleted_at_ms INTEGER NOT NULL,
    PRIMARY KEY(provider, project_path)
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
    message_id UNINDEXED,
    session_id UNINDEXED,
    provider,
    category,
    content,
    prefix='2 3 4'
  )`,
] as const;

const indexStatements = [
  "CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_project_lineage_parent ON sessions(project_id, lineage_parent_id, id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_project_provider_session ON sessions(project_id, provider, provider_session_id, id)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_activity ON sessions(activity_at_ms DESC, activity_at DESC, id DESC)",
  "CREATE INDEX IF NOT EXISTS idx_sessions_project_activity ON sessions(project_id, activity_at_ms DESC, activity_at DESC, id DESC)",
  "CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at_ms, created_at, id)",
  "CREATE INDEX IF NOT EXISTS idx_messages_session_category_created ON messages(session_id, category, created_at_ms, created_at, id)",
  "CREATE INDEX IF NOT EXISTS idx_messages_session_source_id ON messages(session_id, source_id)",
  "CREATE INDEX IF NOT EXISTS idx_messages_session_turn_group ON messages(session_id, turn_group_id, created_at_ms, created_at, id)",
  "CREATE INDEX IF NOT EXISTS idx_messages_session_turn_anchor ON messages(session_id, turn_anchor_kind, source_id, turn_group_id, created_at_ms, created_at, id)",
  "CREATE INDEX IF NOT EXISTS idx_tool_calls_message_id ON tool_calls(message_id)",
  "CREATE INDEX IF NOT EXISTS idx_message_tool_edit_files_message_id ON message_tool_edit_files(message_id, file_ordinal)",
  "CREATE INDEX IF NOT EXISTS idx_projects_provider_name ON projects(provider, name_folded, id)",
  "CREATE INDEX IF NOT EXISTS idx_project_stats_last_activity ON project_stats(last_activity_ms DESC, project_id)",
  "CREATE INDEX IF NOT EXISTS idx_deleted_sessions_project_path ON deleted_sessions(provider, project_path)",
] as const;

const dataTables = [
  "tool_calls",
  "message_tool_edit_files",
  "messages",
  "sessions",
  "projects",
  "project_stats",
  "indexed_files",
  "index_checkpoints",
  "deleted_sessions",
  "deleted_projects",
] as const;

export function openDatabase(databasePath: string): SqliteDatabase {
  const db = new Database(databasePath);
  // WAL keeps read-heavy UI queries responsive while indexing writes in the background.
  db.pragma("journal_mode = WAL");
  return db;
}

export function ensureDatabaseSchema(db: SqliteDatabase): DatabaseBootstrapResult {
  db.exec(tableStatements[0]);

  const existingSchemaVersion = readSchemaVersion(db);
  const schemaNeedsRebuild =
    existingSchemaVersion !== null &&
    (existingSchemaVersion !== DATABASE_SCHEMA_VERSION || !hasRequiredSchemaColumns(db));
  let schemaRebuilt = false;

  if (schemaNeedsRebuild) {
    // Schema upgrades are coarse-grained for now: rebuild deterministically rather than carrying a
    // long chain of handwritten migrations for a local cache database.
    clearAllSchemaObjects(db);
    recreateSchema(db);
    schemaRebuilt = true;
  } else {
    for (const statement of tableStatements.slice(1)) {
      db.exec(statement);
    }
    for (const statement of indexStatements) {
      db.exec(statement);
    }
  }
  ensureMessageFtsTable(db);
  ensureProjectStatsTriggers(db);

  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(DATABASE_SCHEMA_VERSION));

  return {
    schemaVersion: DATABASE_SCHEMA_VERSION,
    schemaRebuilt,
    tables: listTables(db),
  };
}

export function clearIndexedData(db: SqliteDatabase): void {
  db.exec("DELETE FROM message_fts");
  for (const table of dataTables) {
    db.exec(`DELETE FROM ${table}`);
  }
}

export function clearProvidersData(db: SqliteDatabase, providers: Provider[]): void {
  const uniqueProviders = [...new Set(providers)];
  if (uniqueProviders.length === 0) {
    return;
  }

  const placeholders = uniqueProviders.map(() => "?").join(", ");
  const purgeProviders = db.transaction((providerValues: Provider[]) => {
    const deleteByProvider = (sql: string) => {
      db.prepare(sql).run(...providerValues);
    };

    deleteByProvider(
      `DELETE FROM tool_calls WHERE message_id IN (SELECT id FROM messages WHERE provider IN (${placeholders}))`,
    );
    deleteByProvider(
      `DELETE FROM message_tool_edit_files WHERE message_id IN (SELECT id FROM messages WHERE provider IN (${placeholders}))`,
    );
    deleteByProvider(
      `DELETE FROM project_stats WHERE project_id IN (SELECT id FROM projects WHERE provider IN (${placeholders}))`,
    );
    deleteByProvider(`DELETE FROM message_fts WHERE provider IN (${placeholders})`);
    deleteByProvider(`DELETE FROM messages WHERE provider IN (${placeholders})`);
    deleteByProvider(`DELETE FROM index_checkpoints WHERE provider IN (${placeholders})`);
    deleteByProvider(`DELETE FROM deleted_sessions WHERE provider IN (${placeholders})`);
    deleteByProvider(`DELETE FROM deleted_projects WHERE provider IN (${placeholders})`);
    deleteByProvider(`DELETE FROM indexed_files WHERE provider IN (${placeholders})`);
    deleteByProvider(`DELETE FROM sessions WHERE provider IN (${placeholders})`);
    deleteByProvider(`DELETE FROM projects WHERE provider IN (${placeholders})`);
  });

  purgeProviders(uniqueProviders);
}

export function initializeDatabase(databasePath: string): DatabaseBootstrapResult {
  const db = openDatabase(databasePath);
  const result = ensureDatabaseSchema(db);
  db.close();
  return result;
}

function recreateSchema(db: SqliteDatabase): void {
  for (const statement of tableStatements) {
    db.exec(statement);
  }
  for (const statement of indexStatements) {
    db.exec(statement);
  }
}

function clearAllSchemaObjects(db: SqliteDatabase): void {
  db.exec("DROP TRIGGER IF EXISTS projects_insert_project_stats");
  db.exec("DROP TRIGGER IF EXISTS projects_delete_project_stats");
  db.exec("DROP TRIGGER IF EXISTS sessions_insert_project_stats");
  db.exec("DROP TRIGGER IF EXISTS sessions_update_project_stats");
  db.exec("DROP TRIGGER IF EXISTS sessions_delete_project_stats");
  db.exec("DROP TABLE IF EXISTS message_fts");
  db.exec("DROP TABLE IF EXISTS tool_calls");
  db.exec("DROP TABLE IF EXISTS message_tool_edit_files");
  db.exec("DROP TABLE IF EXISTS messages");
  db.exec("DROP TABLE IF EXISTS sessions");
  db.exec("DROP TABLE IF EXISTS project_stats");
  db.exec("DROP TABLE IF EXISTS projects");
  db.exec("DROP TABLE IF EXISTS indexed_files");
  db.exec("DROP TABLE IF EXISTS index_checkpoints");
  db.exec("DROP TABLE IF EXISTS deleted_sessions");
  db.exec("DROP TABLE IF EXISTS deleted_projects");
  db.exec("DROP TABLE IF EXISTS meta");
}

function ensureMessageFtsTable(db: SqliteDatabase): void {
  const existing = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'message_fts'")
    .get() as { sql: string } | undefined;
  const hasPrefix = existing ? /\bprefix\s*=\s*['"]2 3 4['"]/i.test(existing.sql ?? "") : false;
  if (existing && hasPrefix) {
    return;
  }

  // Rebuild the FTS table in place when its definition changes, then repopulate from canonical
  // messages so search stays a pure derivative of the base tables.
  db.exec("DROP TABLE IF EXISTS message_fts");
  db.exec(
    `CREATE VIRTUAL TABLE message_fts USING fts5(
       message_id UNINDEXED,
       session_id UNINDEXED,
       provider,
       category,
       content,
       prefix='2 3 4'
     )`,
  );
  db.exec(
    `INSERT INTO message_fts (message_id, session_id, provider, category, content)
     SELECT id, session_id, provider, category, content
     FROM messages`,
  );
}

function ensureProjectStatsTriggers(db: SqliteDatabase): void {
  const refreshProjectStatsSql = (projectIdSql: string, guardSql = "1 = 1") => `
    INSERT INTO project_stats (
      project_id,
      session_count,
      message_count,
      last_activity,
      last_activity_ms
    )
    SELECT
      p.id,
      COUNT(s.id),
      COALESCE(SUM(s.message_count), 0),
      MAX(s.activity_at),
      COALESCE(MAX(s.activity_at_ms), -9223372036854775808)
    FROM projects p
    LEFT JOIN sessions s ON s.project_id = p.id
    WHERE p.id = ${projectIdSql}
      AND ${guardSql}
    GROUP BY p.id
    ON CONFLICT(project_id) DO UPDATE SET
      session_count = excluded.session_count,
      message_count = excluded.message_count,
      last_activity = excluded.last_activity,
      last_activity_ms = excluded.last_activity_ms
  `;

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS projects_insert_project_stats
    AFTER INSERT ON projects
    BEGIN
      INSERT INTO project_stats (
        project_id,
        session_count,
        message_count,
        last_activity,
        last_activity_ms
      ) VALUES (NEW.id, 0, 0, NULL, -9223372036854775808)
      ON CONFLICT(project_id) DO NOTHING;
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS projects_delete_project_stats
    AFTER DELETE ON projects
    BEGIN
      DELETE FROM project_stats WHERE project_id = OLD.id;
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS sessions_insert_project_stats
    AFTER INSERT ON sessions
    BEGIN
      INSERT INTO project_stats (
        project_id,
        session_count,
        message_count,
        last_activity,
        last_activity_ms
      ) VALUES (
        NEW.project_id,
        1,
        NEW.message_count,
        NEW.activity_at,
        NEW.activity_at_ms
      )
      ON CONFLICT(project_id) DO UPDATE SET
        session_count = project_stats.session_count + 1,
        message_count = project_stats.message_count + NEW.message_count,
        last_activity = CASE
          WHEN NEW.activity_at_ms > project_stats.last_activity_ms THEN NEW.activity_at
          ELSE project_stats.last_activity
        END,
        last_activity_ms = CASE
          WHEN NEW.activity_at_ms > project_stats.last_activity_ms THEN NEW.activity_at_ms
          ELSE project_stats.last_activity_ms
        END;
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS sessions_update_project_stats
    AFTER UPDATE OF project_id, started_at, ended_at, message_count ON sessions
    BEGIN
      ${refreshProjectStatsSql("NEW.project_id")};
      DELETE FROM project_stats
      WHERE project_id = OLD.project_id
        AND OLD.project_id != NEW.project_id
        AND NOT EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id);
      ${refreshProjectStatsSql("OLD.project_id", "OLD.project_id != NEW.project_id")};
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS sessions_delete_project_stats
    AFTER DELETE ON sessions
    BEGIN
      ${refreshProjectStatsSql("OLD.project_id")};
    END
  `);
  db.exec(`
    INSERT INTO project_stats (
      project_id,
      session_count,
      message_count,
      last_activity,
      last_activity_ms
    )
    SELECT
      p.id,
      COUNT(s.id),
      COALESCE(SUM(s.message_count), 0),
      MAX(s.activity_at),
      COALESCE(MAX(s.activity_at_ms), -9223372036854775808)
    FROM projects p
    LEFT JOIN sessions s ON s.project_id = p.id
    GROUP BY p.id
    ON CONFLICT(project_id) DO UPDATE SET
      session_count = excluded.session_count,
      message_count = excluded.message_count,
      last_activity = excluded.last_activity,
      last_activity_ms = excluded.last_activity_ms
  `);
}

function readSchemaVersion(db: SqliteDatabase): number | null {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as
    | { value: string }
    | undefined;

  if (!row) {
    return null;
  }

  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasRequiredSchemaColumns(db: SqliteDatabase): boolean {
  return (
    tableHasColumnsIfPresent(db, "projects", ["name_folded", "path_folded"]) &&
    tableHasColumnsIfPresent(db, "sessions", ["activity_at", "activity_at_ms"]) &&
    tableHasColumnsIfPresent(db, "messages", [
      "created_at_ms",
      "turn_group_id",
      "turn_grouping_mode",
      "turn_anchor_kind",
      "native_turn_id",
    ])
  );
}

function tableExists(db: SqliteDatabase, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 as found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { found: number } | undefined;
  return row?.found === 1;
}

function tableHasColumns(
  db: SqliteDatabase,
  tableName: string,
  requiredColumns: string[],
): boolean {
  const columns = new Set(
    (
      db.prepare(`PRAGMA table_xinfo(${JSON.stringify(tableName)})`).all() as Array<{
        name: string;
      }>
    ).map((column) => column.name),
  );
  return requiredColumns.every((column) => columns.has(column));
}

function tableHasColumnsIfPresent(
  db: SqliteDatabase,
  tableName: string,
  requiredColumns: string[],
): boolean {
  return !tableExists(db, tableName) || tableHasColumns(db, tableName, requiredColumns);
}

function listTables(db: SqliteDatabase): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master
       WHERE type IN ('table', 'view')
       AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((table) => table.name);
}
