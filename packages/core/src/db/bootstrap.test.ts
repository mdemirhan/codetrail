import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ensureDatabaseSchema, initializeDatabase, openDatabase } from "./bootstrap";
import { DATABASE_SCHEMA_VERSION } from "./constants";

describe("initializeDatabase", () => {
  it("creates schema tables for an empty db", () => {
    const dir = mkdtempSync(join(tmpdir(), "cch-ts-db-"));
    const dbPath = join(dir, "test.db");

    const result = initializeDatabase(dbPath);

    expect(result.schemaVersion).toBe(DATABASE_SCHEMA_VERSION);
    expect(result.schemaRebuilt).toBe(false);
    expect(result.tables).toEqual(
      expect.arrayContaining([
        "indexed_files",
        "message_fts",
        "messages",
        "meta",
        "projects",
        "sessions",
        "tool_calls",
      ]),
    );

    rmSync(dir, { recursive: true, force: true });
  });

  it("rebuilds schema when stored version mismatches", () => {
    const dir = mkdtempSync(join(tmpdir(), "cch-ts-db-"));
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
});
