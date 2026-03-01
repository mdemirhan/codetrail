import { describe, expect, it } from "vitest";

import { discoverSessionFiles } from "../discovery/discoverSessionFiles";
import { createInMemoryDatabase, withInMemoryDatabase } from "./inMemoryDb";
import { CoreTestFs, listDirectoryEntries, readFileTextFromCoreTestFs } from "./inMemoryFs";

describe("core testing helpers", () => {
  it("creates an in-memory sqlite schema", () => {
    const db = createInMemoryDatabase();
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN ('projects', 'sessions', 'messages', 'bookmarks')
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>;
    db.close();

    expect(tables.map((row) => row.name)).toEqual([
      "bookmarks",
      "messages",
      "projects",
      "sessions",
    ]);
  });

  it("runs callback with in-memory db and closes automatically", () => {
    const result = withInMemoryDatabase((db) => {
      db.prepare(
        `INSERT INTO projects (id, provider, name, path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        "p1",
        "claude",
        "Project 1",
        "/workspace/p1",
        "2026-03-01T00:00:00.000Z",
        "2026-03-01T00:00:00.000Z",
      );

      return (
        db.prepare("SELECT COUNT(*) as count FROM projects").get() as {
          count: number;
        }
      ).count;
    });

    expect(result).toBe(1);
  });

  it("provides in-memory filesystem adapters for discovery and file reads", () => {
    const fs = new CoreTestFs();
    fs.writeFile(
      "/fixtures/.claude/projects/project-a/session-1.jsonl",
      `${JSON.stringify({
        type: "user",
        uuid: "m1",
        timestamp: "2026-03-01T10:00:00.000Z",
        message: { role: "user", content: [{ type: "text", text: "hello" }] },
      })}\n`,
      1000,
    );

    const discovery = discoverSessionFiles(
      {
        claudeRoot: "/fixtures/.claude/projects",
        codexRoot: "/fixtures/.codex/sessions",
        geminiRoot: "/fixtures/.gemini/tmp",
        geminiHistoryRoot: "/fixtures/.gemini/history",
        geminiProjectsPath: "/fixtures/.gemini/projects.json",
        includeClaudeSubagents: false,
      },
      { fs: fs.toDiscoveryFileSystem() },
    );

    expect(discovery).toHaveLength(1);
    expect(discovery[0]?.provider).toBe("claude");
    expect(discovery[0]?.sessionIdentity).toBe("session-1");
    expect(discovery[0]?.projectName).toBe("a");

    const readText = readFileTextFromCoreTestFs(fs);
    expect(readText("/fixtures/.claude/projects/project-a/session-1.jsonl")).toContain("hello");
    expect(listDirectoryEntries(fs, "/fixtures/.claude/projects/project-a")).toEqual([
      "session-1.jsonl",
    ]);
  });
});
