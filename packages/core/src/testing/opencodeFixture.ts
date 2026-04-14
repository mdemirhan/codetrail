import { mkdirSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";

export type OpenCodeFixtureMessage = {
  id: string;
  timeCreated: number;
  timeUpdated?: number;
  data: Record<string, unknown>;
  parts?: Array<Record<string, unknown>>;
};

export type OpenCodeFixtureSession = {
  id: string;
  projectId?: string;
  parentId?: string | null;
  directory: string;
  title: string;
  version?: string;
  timeCreated: number;
  timeUpdated?: number;
  messages: OpenCodeFixtureMessage[];
};

export function createOpenCodeFixtureDatabase(input: {
  rootDir: string;
  projectId?: string;
  projectName?: string | null;
  sessions: OpenCodeFixtureSession[];
}): { dbPath: string } {
  mkdirSync(input.rootDir, { recursive: true });
  const dbPath = join(input.rootDir, "opencode.db");
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE project (
      id TEXT PRIMARY KEY,
      worktree TEXT NOT NULL,
      vcs TEXT,
      name TEXT,
      icon_url TEXT,
      icon_color TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      time_initialized INTEGER,
      sandboxes TEXT NOT NULL,
      commands TEXT
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      share_url TEXT,
      summary_additions INTEGER,
      summary_deletions INTEGER,
      summary_files INTEGER,
      summary_diffs TEXT,
      revert TEXT,
      permission TEXT,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      time_compacting INTEGER,
      time_archived INTEGER,
      workspace_id TEXT
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);

  const projectId = input.projectId ?? "project-1";
  const createdAt = input.sessions[0]?.timeCreated ?? Date.now();
  const updatedAt =
    input.sessions.at(-1)?.timeUpdated ?? input.sessions.at(-1)?.timeCreated ?? createdAt;
  db.prepare(
    `INSERT INTO project (
      id, worktree, vcs, name, icon_url, icon_color, time_created, time_updated, time_initialized, sandboxes, commands
    ) VALUES (?, ?, NULL, ?, NULL, NULL, ?, ?, NULL, '[]', NULL)`,
  ).run(
    projectId,
    input.sessions[0]?.directory ?? "/workspace",
    input.projectName ?? null,
    createdAt,
    updatedAt,
  );

  const insertSession = db.prepare(
    `INSERT INTO session (
      id, project_id, parent_id, slug, directory, title, version, share_url, summary_additions, summary_deletions,
      summary_files, summary_diffs, revert, permission, time_created, time_updated, time_compacting, time_archived, workspace_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL)`,
  );
  const insertMessage = db.prepare(
    "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
  );
  const insertPart = db.prepare(
    "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
  );

  for (const session of input.sessions) {
    insertSession.run(
      session.id,
      session.projectId ?? projectId,
      session.parentId ?? null,
      session.id,
      session.directory,
      session.title,
      session.version ?? "1.0.0",
      session.timeCreated,
      session.timeUpdated ?? session.timeCreated,
    );

    for (const message of session.messages) {
      insertMessage.run(
        message.id,
        session.id,
        message.timeCreated,
        message.timeUpdated ?? message.timeCreated,
        JSON.stringify(message.data),
      );

      for (const [index, part] of (message.parts ?? []).entries()) {
        insertPart.run(
          `${message.id}:part:${index}`,
          message.id,
          session.id,
          message.timeCreated + index,
          message.timeUpdated ?? message.timeCreated + index,
          JSON.stringify(part),
        );
      }
    }
  }

  db.close();
  return { dbPath };
}
