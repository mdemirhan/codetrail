import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  clearIndexedData,
  ensureDatabaseSchema,
  initializeDatabase,
  openDatabase,
} from "./bootstrap";
import { DATABASE_SCHEMA_VERSION } from "./constants";

describe("initializeDatabase", () => {
  it("creates schema tables for an empty db", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-db-"));
    const dbPath = join(dir, "test.db");

    const result = initializeDatabase(dbPath);
    const db = openDatabase(dbPath);
    const messageColumns = (
      db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    db.close();

    expect(result.schemaVersion).toBe(DATABASE_SCHEMA_VERSION);
    expect(result.schemaRebuilt).toBe(false);
    expect(result.tables).toEqual(
      expect.arrayContaining([
        "bookmarks",
        "indexed_files",
        "message_fts",
        "messages",
        "meta",
        "projects",
        "sessions",
        "tool_calls",
      ]),
    );
    expect(messageColumns).toEqual(
      expect.arrayContaining([
        "operation_duration_ms",
        "operation_duration_source",
        "operation_duration_confidence",
      ]),
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("rebuilds schema when stored version mismatches", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-db-"));
    const dbPath = join(dir, "test-mismatch.db");

    initializeDatabase(dbPath);
    const db = openDatabase(dbPath);
    db.exec(`INSERT INTO projects (id, provider, name, path, created_at, updated_at)
             VALUES ('p1', 'claude', 'name', '/tmp/p', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
    db.exec(`UPDATE meta SET value = '999' WHERE key = 'schema_version'`);

    const result = ensureDatabaseSchema(db);
    const projectCount = db.prepare("SELECT COUNT(*) as count FROM projects").get() as {
      count: number;
    };
    db.close();

    expect(result.schemaRebuilt).toBe(true);
    expect(result.schemaVersion).toBe(DATABASE_SCHEMA_VERSION);
    expect(projectCount.count).toBe(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("clears indexed data without violating bookmark foreign keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-db-clear-"));
    const dbPath = join(dir, "test-clear.db");
    initializeDatabase(dbPath);
    const db = openDatabase(dbPath);

    db.exec(`INSERT INTO projects (id, provider, name, path, created_at, updated_at)
             VALUES ('p1', 'claude', 'name', '/tmp/p', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
    db.exec(`INSERT INTO sessions (
               id, project_id, provider, file_path, model_names, started_at, ended_at, duration_ms,
               git_branch, cwd, message_count, token_input_total, token_output_total
             ) VALUES (
               's1', 'p1', 'claude', '/tmp/p/session.jsonl', 'claude-opus',
               '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z', 1000,
               'main', '/tmp/p', 1, 0, 0
             )`);
    db.exec(`INSERT INTO messages (
               id, source_id, session_id, provider, category, content, created_at, token_input, token_output,
               operation_duration_ms, operation_duration_source, operation_duration_confidence
             ) VALUES (
               'm1', 'src-1', 's1', 'claude', 'assistant', 'content',
               '2026-01-01T00:00:01.000Z', null, null, null, null, null
             )`);
    db.exec(`INSERT INTO bookmarks (project_id, session_id, message_id, message_source_id, created_at)
             VALUES ('p1', 's1', 'm1', 'src-1', '2026-01-01T00:00:01.000Z')`);
    db.exec(`INSERT INTO indexed_files (
               file_path, provider, project_path, session_identity, file_size, file_mtime_ms, indexed_at
             ) VALUES (
               '/tmp/p/session.jsonl', 'claude', '/tmp/p', 's1', 10, 10, '2026-01-01T00:00:01.000Z'
             )`);

    expect(() => clearIndexedData(db)).not.toThrow();
    const counts = {
      bookmarks: (db.prepare("SELECT COUNT(*) as c FROM bookmarks").get() as { c: number }).c,
      messages: (db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c,
      sessions: (db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c,
      projects: (db.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number }).c,
      indexedFiles: (db.prepare("SELECT COUNT(*) as c FROM indexed_files").get() as { c: number })
        .c,
    };
    db.close();

    expect(counts).toEqual({
      bookmarks: 0,
      messages: 0,
      sessions: 0,
      projects: 0,
      indexedFiles: 0,
    });

    rmSync(dir, { recursive: true, force: true });
  });
});
