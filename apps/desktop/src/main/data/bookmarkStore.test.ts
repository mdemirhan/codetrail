import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "@codetrail/core";
import { describe, expect, it } from "vitest";

import { createBookmarkStore, resolveBookmarksDbPath } from "./bookmarkStore";

function seedIndexedDb(dbPath: string): void {
  const db = openDatabase(dbPath);
  db.exec(
    `CREATE TABLE IF NOT EXISTS projects (
       id TEXT PRIMARY KEY,
       provider TEXT NOT NULL,
       name TEXT NOT NULL,
       path TEXT NOT NULL,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS sessions (
       id TEXT PRIMARY KEY,
       project_id TEXT NOT NULL,
       provider TEXT NOT NULL,
       file_path TEXT NOT NULL,
       model_names TEXT NOT NULL,
       started_at TEXT,
       ended_at TEXT,
       duration_ms INTEGER,
       git_branch TEXT,
       cwd TEXT,
       message_count INTEGER NOT NULL DEFAULT 0,
       token_input_total INTEGER NOT NULL DEFAULT 0,
       token_output_total INTEGER NOT NULL DEFAULT 0
     )`,
  );
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
       operation_duration_confidence TEXT
     )`,
  );

  db.exec(`INSERT INTO projects (id, provider, name, path, created_at, updated_at)
           VALUES ('p1', 'claude', 'Project One', '/workspace/p1', '2026-03-01T10:00:00.000Z', '2026-03-01T10:00:00.000Z')`);
  db.exec(`INSERT INTO sessions (
             id, project_id, provider, file_path, model_names, started_at, ended_at, duration_ms,
             git_branch, cwd, message_count, token_input_total, token_output_total
           ) VALUES (
             's1', 'p1', 'claude', '/workspace/p1/session-1.jsonl', 'claude-opus-4-6',
             '2026-03-01T10:00:00.000Z', '2026-03-01T10:00:05.000Z', 5000,
             'main', '/workspace/p1', 1, 10, 12
           )`);
  db.exec(`INSERT INTO messages (
             id, source_id, session_id, provider, category, content, created_at,
             token_input, token_output, operation_duration_ms, operation_duration_source, operation_duration_confidence
           ) VALUES (
             'm1', 'src1', 's1', 'claude', 'assistant', 'hello', '2026-03-01T10:00:05.000Z',
             10, 12, 5000, 'native', 'high'
           )`);
  db.close();
}

describe("bookmarkStore", () => {
  it("creates schema and supports upsert/list/remove", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-bookmark-store-"));
    const indexedDbPath = join(dir, "indexed.sqlite");
    seedIndexedDb(indexedDbPath);

    const store = createBookmarkStore(resolveBookmarksDbPath(indexedDbPath));
    store.upsertBookmark({
      projectId: "p1",
      sessionId: "s1",
      messageId: "m1",
      messageSourceId: "src1",
      provider: "claude",
      sessionTitle: "Project intro",
      messageCategory: "assistant",
      messageContent: "hello",
      messageCreatedAt: "2026-03-01T10:00:05.000Z",
      bookmarkedAt: "2026-03-01T10:01:00.000Z",
    });

    const rows = store.listProjectBookmarks("p1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message_id).toBe("m1");
    expect(rows[0]?.snapshot_version).toBe(1);
    expect(rows[0]?.is_orphaned).toBe(0);

    expect(store.removeBookmark("p1", "m1")).toBe(true);
    expect(store.removeBookmark("p1", "m1")).toBe(false);
    expect(store.listProjectBookmarks("p1")).toEqual([]);

    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("filters bookmarks by query using database-side matching", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-bookmark-query-"));
    const indexedDbPath = join(dir, "indexed.sqlite");
    seedIndexedDb(indexedDbPath);

    const store = createBookmarkStore(resolveBookmarksDbPath(indexedDbPath));
    store.upsertBookmark({
      projectId: "p1",
      sessionId: "s1",
      messageId: "m1",
      messageSourceId: "src1",
      provider: "claude",
      sessionTitle: "Project intro",
      messageCategory: "assistant",
      messageContent: "Parser bug is fixed",
      messageCreatedAt: "2026-03-01T10:00:05.000Z",
      bookmarkedAt: "2026-03-01T10:01:00.000Z",
    });

    store.upsertBookmark({
      projectId: "p1",
      sessionId: "s1",
      messageId: "m2",
      messageSourceId: "src2",
      provider: "claude",
      sessionTitle: "Project intro",
      messageCategory: "assistant",
      messageContent: "Formatting looks clean",
      messageCreatedAt: "2026-03-01T10:00:06.000Z",
      bookmarkedAt: "2026-03-01T10:01:01.000Z",
    });

    const all = store.listProjectBookmarks("p1");
    expect(all).toHaveLength(2);

    const parserMatches = store.listProjectBookmarks("p1", "parser");
    expect(parserMatches).toHaveLength(1);
    expect(parserMatches[0]?.message_id).toBe("m1");

    const uppercaseMatches = store.listProjectBookmarks("p1", "FORMATTING");
    expect(uppercaseMatches).toHaveLength(1);
    expect(uppercaseMatches[0]?.message_id).toBe("m2");

    const noMatches = store.listProjectBookmarks("p1", "does-not-exist");
    expect(noMatches).toEqual([]);

    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies additive schema changes for existing bookmark databases on open", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-bookmark-migrate-"));
    const indexedDbPath = join(dir, "indexed.sqlite");
    const bookmarksDbPath = resolveBookmarksDbPath(indexedDbPath);

    const db = openDatabase(bookmarksDbPath);
    db.exec(
      `CREATE TABLE IF NOT EXISTS meta (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL
       )`,
    );
    db.exec(
      `CREATE TABLE IF NOT EXISTS bookmarks (
         project_id TEXT NOT NULL,
         session_id TEXT NOT NULL,
         message_id TEXT NOT NULL,
         message_source_id TEXT NOT NULL,
         provider TEXT NOT NULL,
         session_title TEXT NOT NULL,
         message_category TEXT NOT NULL,
         message_content TEXT NOT NULL,
         message_created_at TEXT NOT NULL,
         bookmarked_at TEXT NOT NULL,
         is_orphaned INTEGER NOT NULL DEFAULT 0,
         orphaned_at TEXT,
         snapshot_version INTEGER NOT NULL,
         snapshot_json TEXT NOT NULL,
         PRIMARY KEY (project_id, message_id)
       )`,
    );
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '1')").run();
    db.exec(
      `INSERT INTO bookmarks (
         project_id,
         session_id,
         message_id,
         message_source_id,
         provider,
         session_title,
         message_category,
         message_content,
         message_created_at,
         bookmarked_at,
         is_orphaned,
         orphaned_at,
         snapshot_version,
         snapshot_json
       ) VALUES (
         'p1',
         's1',
         'm1',
         'src1',
         'claude',
         'Project intro',
         'assistant',
         'existing schema row',
         '2026-03-01T10:00:05.000Z',
         '2026-03-01T10:01:00.000Z',
         0,
         NULL,
         1,
         '{}'
       )`,
    );
    db.close();

    const store = createBookmarkStore(bookmarksDbPath);
    const rows = store.listProjectBookmarks("p1", "existing");
    expect(rows).toHaveLength(1);

    const metaDb = openDatabase(bookmarksDbPath);
    const schemaVersion = metaDb
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    const indexes = metaDb.prepare("PRAGMA index_list('bookmarks')").all() as Array<{
      name: string;
    }>;
    metaDb.close();

    expect(schemaVersion?.value).toBe("2");
    expect(
      indexes.some((index) => index.name === "idx_bookmarks_project_message_content_lower"),
    ).toBe(true);

    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("marks missing messages as orphaned and restores when they reappear", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-bookmark-reconcile-"));
    const indexedDbPath = join(dir, "indexed.sqlite");
    seedIndexedDb(indexedDbPath);

    const store = createBookmarkStore(resolveBookmarksDbPath(indexedDbPath));
    store.upsertBookmark({
      projectId: "p1",
      sessionId: "s1",
      messageId: "m1",
      messageSourceId: "src1",
      provider: "claude",
      sessionTitle: "Project intro",
      messageCategory: "assistant",
      messageContent: "hello",
      messageCreatedAt: "2026-03-01T10:00:05.000Z",
      bookmarkedAt: "2026-03-01T10:01:00.000Z",
    });

    expect(store.reconcileWithIndexedData(indexedDbPath)).toEqual({
      deletedMissingProjects: 0,
      markedOrphaned: 0,
      restored: 0,
    });

    const indexedDb = openDatabase(indexedDbPath);
    indexedDb.prepare("DELETE FROM messages WHERE id = ?").run("m1");
    indexedDb.close();

    expect(store.reconcileWithIndexedData(indexedDbPath)).toEqual({
      deletedMissingProjects: 0,
      markedOrphaned: 1,
      restored: 0,
    });

    const orphanedRow = store.getBookmark("p1", "m1");
    expect(orphanedRow?.is_orphaned).toBe(1);
    expect(orphanedRow?.orphaned_at).not.toBeNull();

    const indexedDbRestore = openDatabase(indexedDbPath);
    indexedDbRestore.exec(`INSERT INTO messages (
                             id, source_id, session_id, provider, category, content, created_at,
                             token_input, token_output, operation_duration_ms, operation_duration_source, operation_duration_confidence
                           ) VALUES (
                             'm1', 'src1', 's1', 'claude', 'assistant', 'hello', '2026-03-01T10:00:05.000Z',
                             10, 12, 5000, 'native', 'high'
                           )`);
    indexedDbRestore.close();

    expect(store.reconcileWithIndexedData(indexedDbPath)).toEqual({
      deletedMissingProjects: 0,
      markedOrphaned: 0,
      restored: 1,
    });

    const restoredRow = store.getBookmark("p1", "m1");
    expect(restoredRow?.is_orphaned).toBe(0);
    expect(restoredRow?.orphaned_at).toBeNull();

    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("deletes bookmarks for projects that no longer exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-bookmark-prune-"));
    const indexedDbPath = join(dir, "indexed.sqlite");
    seedIndexedDb(indexedDbPath);

    const store = createBookmarkStore(resolveBookmarksDbPath(indexedDbPath));
    store.upsertBookmark({
      projectId: "missing-project",
      sessionId: "missing-session",
      messageId: "missing-message",
      messageSourceId: "missing-source",
      provider: "claude",
      sessionTitle: "Missing session",
      messageCategory: "assistant",
      messageContent: "stale",
      messageCreatedAt: "2026-03-01T10:00:05.000Z",
      bookmarkedAt: "2026-03-01T10:01:00.000Z",
    });

    expect(store.reconcileWithIndexedData(indexedDbPath)).toEqual({
      deletedMissingProjects: 1,
      markedOrphaned: 0,
      restored: 0,
    });
    expect(store.getBookmark("missing-project", "missing-message")).toBeNull();

    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
