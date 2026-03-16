import { existsSync } from "node:fs";

import Database from "better-sqlite3";

import { setOpenCodeDbReader, setOpenCodeMessagePartReader } from "@codetrail/core";

function openReadonlyDb(dbPath: string): InstanceType<typeof Database> | null {
  if (!existsSync(dbPath)) {
    return null;
  }
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    db.pragma("journal_mode = WAL");
    return db;
  } catch {
    return null;
  }
}

export function initializeOpenCodeReaders(): void {
  setOpenCodeDbReader({
    readSessions: (dbPath) => {
      const db = openReadonlyDb(dbPath);
      if (!db) {
        return [];
      }
      try {
        return db
          .prepare(
            `SELECT id, project_id, parent_id, title, directory,
                    time_created, time_updated
             FROM session
             ORDER BY time_updated DESC`,
          )
          .all() as Array<{
          id: string;
          project_id: string;
          parent_id: string | null;
          title: string;
          directory: string;
          time_created: number;
          time_updated: number;
        }>;
      } finally {
        db.close();
      }
    },
    readProjects: (dbPath) => {
      const db = openReadonlyDb(dbPath);
      if (!db) {
        return [];
      }
      try {
        return db.prepare("SELECT id, worktree, name FROM project").all() as Array<{
          id: string;
          worktree: string;
          name: string | null;
        }>;
      } finally {
        db.close();
      }
    },
  });

  setOpenCodeMessagePartReader({
    readSessionMessagesWithParts: (dbPath, sessionId) => {
      const db = openReadonlyDb(dbPath);
      if (!db) {
        return [];
      }
      try {
        const messages = db
          .prepare(
            `SELECT id, session_id, time_created, data
             FROM message
             WHERE session_id = ?
             ORDER BY time_created ASC, id ASC`,
          )
          .all(sessionId) as Array<{
          id: string;
          session_id: string;
          time_created: number;
          data: string;
        }>;

        const parts = db
          .prepare(
            `SELECT id, message_id, data
             FROM part
             WHERE session_id = ?
             ORDER BY message_id, id`,
          )
          .all(sessionId) as Array<{
          id: string;
          message_id: string;
          data: string;
        }>;

        const partsByMessage = new Map<string, typeof parts>();
        for (const part of parts) {
          const existing = partsByMessage.get(part.message_id) ?? [];
          existing.push(part);
          partsByMessage.set(part.message_id, existing);
        }

        return messages.map((msg) => {
          let msgData: Record<string, unknown> = {};
          try {
            msgData = JSON.parse(msg.data) as Record<string, unknown>;
          } catch {
            // ignore
          }

          const time = msgData.time as Record<string, unknown> | undefined;
          const tokens = msgData.tokens as Record<string, unknown> | undefined;
          const path = msgData.path as Record<string, unknown> | undefined;
          const nestedModel = msgData.model as Record<string, unknown> | undefined;

          const messageParts = partsByMessage.get(msg.id) ?? [];
          return {
            messageId: msg.id,
            role: (msgData.role as string) ?? "user",
            timeCreated: msg.time_created,
            timeCompleted:
              typeof time?.completed === "number" ? (time.completed as number) : null,
            modelId:
              (msgData.modelID as string) ??
              (nestedModel?.modelID as string) ??
              null,
            providerId:
              (msgData.providerID as string) ??
              (nestedModel?.providerID as string) ??
              null,
            cwd: (path?.cwd as string) ?? null,
            tokenInput: typeof tokens?.input === "number" ? (tokens.input as number) : null,
            tokenOutput: typeof tokens?.output === "number" ? (tokens.output as number) : null,
            parts: messageParts.map((p) => {
              let partData: Record<string, unknown> = {};
              try {
                partData = JSON.parse(p.data) as Record<string, unknown>;
              } catch {
                // ignore
              }
              return {
                id: p.id,
                type: (partData.type as string) ?? "unknown",
                data: p.data,
              };
            }),
          };
        });
      } finally {
        db.close();
      }
    },
  });
}
