import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  clearIndexedData,
  clearProvidersData,
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
    const ftsSql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'message_fts'")
      .get() as { sql: string } | undefined;
    db.close();

    expect(result.schemaVersion).toBe(DATABASE_SCHEMA_VERSION);
    expect(result.schemaRebuilt).toBe(false);
    expect(result.tables).toEqual(
      expect.arrayContaining([
        "index_checkpoints",
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
    expect(ftsSql?.sql).toContain("prefix='2 3 4'");

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

  it("clears indexed data for generated tables", () => {
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
    db.exec(`INSERT INTO indexed_files (
               file_path, provider, project_path, session_identity, file_size, file_mtime_ms, indexed_at
             ) VALUES (
               '/tmp/p/session.jsonl', 'claude', '/tmp/p', 's1', 10, 10, '2026-01-01T00:00:01.000Z'
             )`);
    db.exec(`INSERT INTO index_checkpoints (
               file_path, provider, session_id, session_identity, file_size, file_mtime_ms,
               last_offset_bytes, last_line_number, last_event_index, next_message_sequence,
               processing_state_json, source_metadata_json, head_hash, tail_hash, updated_at
             ) VALUES (
               '/tmp/p/session.jsonl', 'claude', 's1', 's1', 10, 10, 10, 1, 1, 1,
               '{}', '{}', 'head', 'tail', '2026-01-01T00:00:01.000Z'
             )`);

    expect(() => clearIndexedData(db)).not.toThrow();
    const counts = {
      messages: (db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number }).c,
      sessions: (db.prepare("SELECT COUNT(*) as c FROM sessions").get() as { c: number }).c,
      projects: (db.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number }).c,
      indexedFiles: (db.prepare("SELECT COUNT(*) as c FROM indexed_files").get() as { c: number })
        .c,
      checkpoints: (
        db.prepare("SELECT COUNT(*) as c FROM index_checkpoints").get() as { c: number }
      ).c,
    };
    db.close();

    expect(counts).toEqual({
      messages: 0,
      sessions: 0,
      projects: 0,
      indexedFiles: 0,
      checkpoints: 0,
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("clears only the requested providers", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-db-provider-clear-"));
    const dbPath = join(dir, "test-provider-clear.db");
    initializeDatabase(dbPath);
    const db = openDatabase(dbPath);

    db.exec(`INSERT INTO projects (id, provider, name, path, created_at, updated_at) VALUES
      ('p1', 'claude', 'Claude Project', '/tmp/claude', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('p2', 'codex', 'Codex Project', '/tmp/codex', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`);
    db.exec(`INSERT INTO sessions (
      id, project_id, provider, file_path, model_names, started_at, ended_at, duration_ms,
      git_branch, cwd, message_count, token_input_total, token_output_total
    ) VALUES
      ('s1', 'p1', 'claude', '/tmp/claude/session.jsonl', 'claude-opus', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z', 1000, 'main', '/tmp/claude', 1, 0, 0),
      ('s2', 'p2', 'codex', '/tmp/codex/session.jsonl', 'gpt-5-codex', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z', 1000, 'main', '/tmp/codex', 1, 0, 0)`);
    db.exec(`INSERT INTO messages (
      id, source_id, session_id, provider, category, content, created_at
    ) VALUES
      ('m1', 'src-1', 's1', 'claude', 'assistant', 'claude content', '2026-01-01T00:00:01.000Z'),
      ('m2', 'src-2', 's2', 'codex', 'assistant', 'codex content', '2026-01-01T00:00:01.000Z')`);
    db.exec(`INSERT INTO tool_calls (
      id, message_id, tool_name, args_json, result_json, started_at, completed_at
    ) VALUES
      ('t1', 'm1', 'bash', '{}', null, null, null),
      ('t2', 'm2', 'read_file', '{}', null, null, null)`);
    db.exec(`INSERT INTO indexed_files (
      file_path, provider, project_path, session_identity, file_size, file_mtime_ms, indexed_at
    ) VALUES
      ('/tmp/claude/session.jsonl', 'claude', '/tmp/claude', 'sid-1', 10, 10, '2026-01-01T00:00:01.000Z'),
      ('/tmp/codex/session.jsonl', 'codex', '/tmp/codex', 'sid-2', 10, 10, '2026-01-01T00:00:01.000Z')`);
    db.exec(`INSERT INTO index_checkpoints (
      file_path, provider, session_id, session_identity, file_size, file_mtime_ms,
      last_offset_bytes, last_line_number, last_event_index, next_message_sequence,
      processing_state_json, source_metadata_json, head_hash, tail_hash, updated_at
    ) VALUES
      ('/tmp/claude/session.jsonl', 'claude', 's1', 'sid-1', 10, 10, 10, 1, 1, 1, '{}', '{}', 'head', 'tail', '2026-01-01T00:00:01.000Z'),
      ('/tmp/codex/session.jsonl', 'codex', 's2', 'sid-2', 10, 10, 10, 1, 1, 1, '{}', '{}', 'head', 'tail', '2026-01-01T00:00:01.000Z')`);
    db.exec(
      `INSERT INTO message_fts (message_id, session_id, provider, category, content) VALUES
        ('m1', 's1', 'claude', 'assistant', 'claude content'),
        ('m2', 's2', 'codex', 'assistant', 'codex content')`,
    );

    clearProvidersData(db, ["codex"]);

    const counts = {
      claudeProjects: (
        db.prepare("SELECT COUNT(*) as c FROM projects WHERE provider = 'claude'").get() as {
          c: number;
        }
      ).c,
      codexProjects: (
        db.prepare("SELECT COUNT(*) as c FROM projects WHERE provider = 'codex'").get() as {
          c: number;
        }
      ).c,
      claudeMessages: (
        db.prepare("SELECT COUNT(*) as c FROM messages WHERE provider = 'claude'").get() as {
          c: number;
        }
      ).c,
      codexMessages: (
        db.prepare("SELECT COUNT(*) as c FROM messages WHERE provider = 'codex'").get() as {
          c: number;
        }
      ).c,
      codexToolCalls: (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM tool_calls WHERE message_id IN (SELECT id FROM messages WHERE provider = 'codex')",
          )
          .get() as { c: number }
      ).c,
      codexIndexedFiles: (
        db.prepare("SELECT COUNT(*) as c FROM indexed_files WHERE provider = 'codex'").get() as {
          c: number;
        }
      ).c,
      codexCheckpoints: (
        db
          .prepare("SELECT COUNT(*) as c FROM index_checkpoints WHERE provider = 'codex'")
          .get() as {
          c: number;
        }
      ).c,
      codexFts: (
        db.prepare("SELECT COUNT(*) as c FROM message_fts WHERE provider = 'codex'").get() as {
          c: number;
        }
      ).c,
      claudeProjectStats: (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM project_stats WHERE project_id IN (SELECT id FROM projects WHERE provider = 'claude')",
          )
          .get() as { c: number }
      ).c,
      codexProjectStats: (
        db.prepare("SELECT COUNT(*) as c FROM project_stats WHERE project_id = 'p2'").get() as {
          c: number;
        }
      ).c,
    };
    db.close();

    expect(counts).toEqual({
      claudeProjects: 1,
      codexProjects: 0,
      claudeMessages: 1,
      codexMessages: 0,
      codexToolCalls: 0,
      codexIndexedFiles: 0,
      codexCheckpoints: 0,
      codexFts: 0,
      claudeProjectStats: 1,
      codexProjectStats: 0,
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("upgrades existing message_fts tables to include prefix indexes", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-db-fts-upgrade-"));
    const dbPath = join(dir, "test-fts-upgrade.db");
    const db = openDatabase(dbPath);
    db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.exec(
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
         created_at_ms INTEGER GENERATED ALWAYS AS (
           CASE
             WHEN unixepoch(created_at) IS NOT NULL THEN CAST(unixepoch(created_at) AS INTEGER) * 1000
             ELSE -9223372036854775808
           END
         ) STORED
       )`,
    );
    db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
         message_id UNINDEXED,
         session_id UNINDEXED,
         provider,
         category,
         content
       )`,
    );
    db.prepare(
      "INSERT INTO messages (id, source_id, session_id, provider, category, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "m1",
      "src1",
      "s1",
      "claude",
      "assistant",
      "prefix upgrade check",
      "2026-03-05T00:00:00Z",
    );
    db.prepare(
      "INSERT INTO message_fts (message_id, session_id, provider, category, content) VALUES (?, ?, ?, ?, ?)",
    ).run("m1", "s1", "claude", "assistant", "prefix upgrade check");
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(
      String(DATABASE_SCHEMA_VERSION),
    );

    expect(() => ensureDatabaseSchema(db)).not.toThrow();

    const upgradedFtsSql = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'message_fts'")
      .get() as { sql: string } | undefined;
    const upgradedCount = db.prepare("SELECT COUNT(*) as c FROM message_fts").get() as {
      c: number;
    };
    db.close();

    expect(upgradedFtsSql?.sql).toContain("prefix='2 3 4'");
    expect(upgradedCount.c).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });
});
