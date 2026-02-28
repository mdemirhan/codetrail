import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DATABASE_SCHEMA_VERSION } from "@codetrail/core";
import { describe, expect, it, vi } from "vitest";

const { mockHandle } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => tmpdir()),
    getVersion: vi.fn(() => "0.1.0"),
  },
  ipcMain: {
    handle: mockHandle,
  },
}));

import { bootstrapMainProcess } from "./bootstrap";

describe("bootstrapMainProcess", () => {
  it("boots services and registers ipc handlers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-main-"));
    const dbPath = join(dir, "app.db");

    const result = await bootstrapMainProcess({ dbPath, runStartupIndexing: false });

    expect(result.schemaVersion).toBe(DATABASE_SCHEMA_VERSION);
    expect(result.tableCount).toBeGreaterThan(0);
    expect(mockHandle).toHaveBeenCalled();

    rmSync(dir, { recursive: true, force: true });
  });
});
