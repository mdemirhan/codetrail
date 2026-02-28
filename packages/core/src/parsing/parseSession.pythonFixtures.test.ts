import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseSession } from "./parseSession";

function readJsonl(path: string): unknown[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

describe("parseSession python fixtures", () => {
  it("parses claude fixture with source-preserving split ids", () => {
    const fixturesRoot = join(process.cwd(), "packages", "core", "test-fixtures", "providers");
    const payload = readJsonl(
      join(
        fixturesRoot,
        "claude",
        "projects",
        "-Users-redacted-workspace-demo-claude",
        "claude-session-redacted-001.jsonl",
      ),
    );

    const parsed = parseSession({
      provider: "claude",
      sessionId: "claude-session-redacted-001",
      payload,
    });

    expect(parsed.diagnostics).toEqual([]);
    expect(new Set(parsed.messages.map((message) => message.category))).toEqual(
      new Set(["user", "assistant", "thinking", "tool_use", "tool_result", "system"]),
    );

    expect(parsed.messages.some((message) => message.id === "c-a-1")).toBe(true);
    expect(parsed.messages.some((message) => message.id === "c-a-1#2")).toBe(true);
    expect(parsed.messages.some((message) => message.id === "c-a-1#3")).toBe(true);

    const assistantSplit = parsed.messages.filter((message) => message.id.startsWith("c-a-1"));
    expect(assistantSplit[0]?.tokenInput).toBe(120);
    expect(assistantSplit[0]?.tokenOutput).toBe(80);
    expect(assistantSplit[1]?.tokenInput).toBeNull();
    expect(assistantSplit[1]?.tokenOutput).toBeNull();
  });

  it("parses codex fixture into canonical categories and preserved ids", () => {
    const fixturesRoot = join(process.cwd(), "packages", "core", "test-fixtures", "providers");
    const payload = readJsonl(
      join(
        fixturesRoot,
        "codex",
        "sessions",
        "2026",
        "02",
        "20",
        "codex-session-redacted-001.jsonl",
      ),
    );

    const parsed = parseSession({
      provider: "codex",
      sessionId: "codex-session-redacted-001",
      payload,
    });

    expect(parsed.diagnostics).toEqual([]);
    expect(new Set(parsed.messages.map((message) => message.category))).toEqual(
      new Set(["user", "assistant", "thinking", "tool_use", "tool_result"]),
    );

    expect(parsed.messages.some((message) => message.id === "codex-msg-user-1")).toBe(true);
    expect(parsed.messages.some((message) => message.id === "codex-msg-assistant-1")).toBe(true);
  });

  it("parses gemini fixture thoughts split with first-message token usage", () => {
    const fixturesRoot = join(process.cwd(), "packages", "core", "test-fixtures", "providers");
    const payload = JSON.parse(
      readFileSync(
        join(
          fixturesRoot,
          "gemini",
          "tmp",
          "2f5846f17316d9a788d405036ac5f4a3f6c4bd93311ce0982dab34ed9152a416",
          "sessions",
          "session-redacted-001",
          "session-0001.json",
        ),
        "utf8",
      ),
    ) as unknown;

    const parsed = parseSession({
      provider: "gemini",
      sessionId: "gemini-session-redacted-001",
      payload,
    });

    expect(parsed.diagnostics).toEqual([]);
    expect(new Set(parsed.messages.map((message) => message.category))).toEqual(
      new Set(["user", "assistant", "thinking", "system"]),
    );

    const split = parsed.messages.filter((message) => message.id.startsWith("g-a-1"));
    expect(split.map((message) => message.id)).toEqual(["g-a-1", "g-a-1#2"]);
    expect(split[0]?.tokenInput).toBe(55);
    expect(split[0]?.tokenOutput).toBe(29);
    expect(split[1]?.tokenInput).toBeNull();
    expect(split[1]?.tokenOutput).toBeNull();
  });
});
