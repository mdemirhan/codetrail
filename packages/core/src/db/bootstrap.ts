import Database from "better-sqlite3";

import { DATABASE_SCHEMA_VERSION } from "./constants";

export type DatabaseBootstrapResult = {
  schemaVersion: number;
  schemaRebuilt: boolean;
  tables: string[];
};

export type SqliteDatabase = InstanceType<typeof Database>;

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
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    model_names TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    duration_ms INTEGER,
    git_branch TEXT,
    cwd TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    token_input_total INTEGER NOT NULL DEFAULT 0,
    token_output_total INTEGER NOT NULL DEFAULT 0,
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
    FOREIGN KEY(session_id) REFERENCES sessions(id)
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
  `CREATE TABLE IF NOT EXISTS indexed_files (
    file_path TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    project_path TEXT NOT NULL,
    session_identity TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_mtime_ms INTEGER NOT NULL,
    indexed_at TEXT NOT NULL
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
    message_id UNINDEXED,
    session_id UNINDEXED,
    provider,
    category,
    content
  )`,
] as const;

const dataTables = ["tool_calls", "messages", "sessions", "projects", "indexed_files"] as const;

export function openDatabase(databasePath: string): SqliteDatabase {
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  return db;
}

export function ensureDatabaseSchema(db: SqliteDatabase): DatabaseBootstrapResult {
  db.exec(tableStatements[0]);

  const existingSchemaVersion = readSchemaVersion(db);
  let schemaRebuilt = false;

  if (existingSchemaVersion !== null && existingSchemaVersion !== DATABASE_SCHEMA_VERSION) {
    clearAllSchemaObjects(db);
    recreateSchema(db);
    schemaRebuilt = true;
  } else {
    for (const statement of tableStatements) {
      db.exec(statement);
    }
  }

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
}

function clearAllSchemaObjects(db: SqliteDatabase): void {
  db.exec("DROP TABLE IF EXISTS message_fts");
  db.exec("DROP TABLE IF EXISTS tool_calls");
  db.exec("DROP TABLE IF EXISTS messages");
  db.exec("DROP TABLE IF EXISTS sessions");
  db.exec("DROP TABLE IF EXISTS projects");
  db.exec("DROP TABLE IF EXISTS indexed_files");
  db.exec("DROP TABLE IF EXISTS meta");
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
