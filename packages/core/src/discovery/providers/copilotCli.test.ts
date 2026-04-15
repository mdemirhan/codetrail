import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDiscoveryConfig } from "../discoverSessionFiles";
import { resolveDiscoveryDependencies } from "../shared";
import {
  discoverCopilotCliFiles,
  discoverSingleCopilotCliFile,
  parseWorkspaceYaml,
} from "./copilotCli";

describe("parseWorkspaceYaml", () => {
  it("parses all fields from a well-formed yaml", () => {
    const content = [
      "id: session-abc-123",
      "cwd: /home/user/projects/myapp",
      "repository: owner/myapp",
      "branch: main",
      "summary: Fix login bug",
    ].join("\n");

    expect(parseWorkspaceYaml(content)).toEqual({
      id: "session-abc-123",
      cwd: "/home/user/projects/myapp",
      repository: "owner/myapp",
      branch: "main",
      summary: "Fix login bug",
    });
  });

  it("handles values with colons (e.g. cwd paths on Windows or URLs)", () => {
    const content = [
      "id: session-001",
      "cwd: C:/Users/user/projects/myapp",
      "repository: owner/myapp",
      "branch: feat/some-feature",
      "summary: Add feature: support colons in paths",
    ].join("\n");

    const result = parseWorkspaceYaml(content);
    expect(result.cwd).toBe("C:/Users/user/projects/myapp");
    expect(result.branch).toBe("feat/some-feature");
    expect(result.summary).toBe("Add feature: support colons in paths");
  });

  it("handles CRLF line endings", () => {
    const content = "id: session-001\r\ncwd: /home/user/project\r\nbranch: main\r\n";
    const result = parseWorkspaceYaml(content);
    expect(result.id).toBe("session-001");
    expect(result.cwd).toBe("/home/user/project");
    expect(result.branch).toBe("main");
  });

  it("returns nulls for empty input", () => {
    expect(parseWorkspaceYaml("")).toEqual({
      id: null,
      cwd: null,
      repository: null,
      branch: null,
      summary: null,
    });
  });

  it("returns nulls for whitespace-only input", () => {
    expect(parseWorkspaceYaml("   \n  \n")).toEqual({
      id: null,
      cwd: null,
      repository: null,
      branch: null,
      summary: null,
    });
  });

  it("skips lines without colons", () => {
    const content = "id: session-001\nno colon here\ncwd: /home/user\n";
    const result = parseWorkspaceYaml(content);
    expect(result.id).toBe("session-001");
    expect(result.cwd).toBe("/home/user");
  });

  it("skips keys with empty values", () => {
    const content = "id: session-001\ncwd: \nbranch: main\n";
    const result = parseWorkspaceYaml(content);
    expect(result.id).toBe("session-001");
    expect(result.cwd).toBeNull();
    expect(result.branch).toBe("main");
  });

  it("ignores unknown keys", () => {
    const content = "id: session-001\nunknown_key: some_value\ncwd: /home/user\n";
    const result = parseWorkspaceYaml(content);
    expect(result.id).toBe("session-001");
    expect(result.cwd).toBe("/home/user");
  });

  it("trims whitespace from keys and values", () => {
    const content = "  id  :  session-001  \n  cwd  :  /home/user  \n";
    const result = parseWorkspaceYaml(content);
    expect(result.id).toBe("session-001");
    expect(result.cwd).toBe("/home/user");
  });

  it("strips surrounding double quotes from values", () => {
    const content = [
      'id: "session-001"',
      'cwd: "/home/user/projects/myapp"',
      'summary: "Fix bug: handle edge case"',
    ].join("\n");
    const result = parseWorkspaceYaml(content);
    expect(result.id).toBe("session-001");
    expect(result.cwd).toBe("/home/user/projects/myapp");
    expect(result.summary).toBe("Fix bug: handle edge case");
  });

  it("strips surrounding single quotes from values", () => {
    const content = ["id: 'session-002'", "cwd: '/home/user/project'"].join("\n");
    const result = parseWorkspaceYaml(content);
    expect(result.id).toBe("session-002");
    expect(result.cwd).toBe("/home/user/project");
  });
});

describe("discoverCopilotCliFiles", () => {
  it("discovers session files from workspace.yaml", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-copilot-cli-"));
    const sessionDir = join(dir, "session-abc-123");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "workspace.yaml"),
      [
        "id: session-abc-123",
        "cwd: /workspace/myapp",
        "repository: owner/myapp",
        "branch: main",
        "summary: Fix login bug",
      ].join("\n"),
    );
    writeFileSync(join(sessionDir, "events.jsonl"), '{"type":"message"}\n');

    const config = resolveDiscoveryConfig({ copilotCliRoot: dir });
    const deps = resolveDiscoveryDependencies();
    const results = discoverCopilotCliFiles(config, deps);

    expect(results).toHaveLength(1);
    const file = results[0]!;
    expect(file.provider).toBe("copilot_cli");
    expect(file.sourceSessionId).toBe("session-abc-123");
    expect(file.projectPath).toBe("/workspace/myapp");
    expect(file.projectName).toBe("myapp");
    expect(file.metadata.unresolvedProject).toBe(false);
    expect(file.metadata.resolutionSource).toBe("cwd");
    expect(file.metadata.gitBranch).toBe("main");
    expect(file.metadata.repositoryUrl).toBeNull();
    expect(file.metadata.sessionMetadata).toEqual({
      repository: "owner/myapp",
      summary: "Fix login bug",
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("sets unresolvedProject=true and resolutionSource='unresolved' when cwd is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-copilot-cli-unresolved-"));
    const sessionDir = join(dir, "session-no-cwd");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "workspace.yaml"),
      ["id: session-no-cwd", "repository: owner/repo", "branch: main"].join("\n"),
    );
    writeFileSync(join(sessionDir, "events.jsonl"), '{"type":"message"}\n');

    const config = resolveDiscoveryConfig({ copilotCliRoot: dir });
    const deps = resolveDiscoveryDependencies();
    const results = discoverCopilotCliFiles(config, deps);

    expect(results).toHaveLength(1);
    const file = results[0]!;
    expect(file.projectPath).toBe("");
    expect(file.metadata.unresolvedProject).toBe(true);
    expect(file.metadata.resolutionSource).toBe("unresolved");
    expect(file.metadata.cwd).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to session.start in events.jsonl when workspace.yaml is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-copilot-cli-fallback-"));
    const sessionDir = join(dir, "fallback-session");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "events.jsonl"),
      `${JSON.stringify({
        type: "session.start",
        data: {
          sessionId: "fallback-id",
          context: { cwd: "/workspace/fallback", branch: "dev", repository: "owner/fallback" },
        },
      })}\n`,
    );

    const config = resolveDiscoveryConfig({ copilotCliRoot: dir });
    const deps = resolveDiscoveryDependencies();
    const results = discoverCopilotCliFiles(config, deps);

    expect(results).toHaveLength(1);
    const file = results[0]!;
    expect(file.sourceSessionId).toBe("fallback-id");
    expect(file.projectPath).toBe("/workspace/fallback");
    expect(file.metadata.gitBranch).toBe("dev");
    expect(file.metadata.unresolvedProject).toBe(false);
    expect(file.metadata.resolutionSource).toBe("cwd");

    rmSync(dir, { recursive: true, force: true });
  });

  it("skips empty events.jsonl files", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-copilot-cli-empty-"));
    const sessionDir = join(dir, "empty-session");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, "workspace.yaml"), "id: empty-session\ncwd: /workspace\n");
    writeFileSync(join(sessionDir, "events.jsonl"), "");

    const config = resolveDiscoveryConfig({ copilotCliRoot: dir });
    const deps = resolveDiscoveryDependencies();
    const results = discoverCopilotCliFiles(config, deps);

    expect(results).toHaveLength(0);

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns [] when copilotCliRoot does not exist", () => {
    const config = resolveDiscoveryConfig({ copilotCliRoot: "/nonexistent/copilot-cli-root" });
    const deps = resolveDiscoveryDependencies();
    expect(discoverCopilotCliFiles(config, deps)).toEqual([]);
  });

  it("uses directory name as sourceSessionId when workspace.yaml has no id", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-copilot-cli-dirid-"));
    const sessionDir = join(dir, "dir-name-as-id");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, "workspace.yaml"), "cwd: /workspace/app\n");
    writeFileSync(join(sessionDir, "events.jsonl"), '{"type":"message"}\n');

    const config = resolveDiscoveryConfig({ copilotCliRoot: dir });
    const deps = resolveDiscoveryDependencies();
    const results = discoverCopilotCliFiles(config, deps);

    expect(results).toHaveLength(1);
    expect(results[0]!.sourceSessionId).toBe("dir-name-as-id");

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("discoverSingleCopilotCliFile", () => {
  it("returns null for a file outside the copilotCliRoot", () => {
    const config = resolveDiscoveryConfig({ copilotCliRoot: "/some/copilot-root" });
    const deps = resolveDiscoveryDependencies();
    const result = discoverSingleCopilotCliFile(
      "/other/location/session/events.jsonl",
      config,
      deps,
    );
    expect(result).toBeNull();
  });

  it("discovers a single events.jsonl inside the root", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-copilot-cli-single-"));
    const sessionDir = join(dir, "single-session");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "workspace.yaml"),
      ["id: single-session", "cwd: /workspace/single", "branch: feat"].join("\n"),
    );
    writeFileSync(join(sessionDir, "events.jsonl"), '{"type":"message"}\n');

    const config = resolveDiscoveryConfig({ copilotCliRoot: dir });
    const deps = resolveDiscoveryDependencies();
    const result = discoverSingleCopilotCliFile(join(sessionDir, "events.jsonl"), config, deps);

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("copilot_cli");
    expect(result?.sourceSessionId).toBe("single-session");
    expect(result?.projectPath).toBe("/workspace/single");
    expect(result?.metadata.gitBranch).toBe("feat");

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for a non-events.jsonl file inside the root", () => {
    const dir = mkdtempSync(join(tmpdir(), "codetrail-copilot-cli-nonjsonl-"));
    const sessionDir = join(dir, "session-x");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, "other.jsonl"), '{"type":"message"}\n');

    const config = resolveDiscoveryConfig({ copilotCliRoot: dir });
    const deps = resolveDiscoveryDependencies();
    const result = discoverSingleCopilotCliFile(join(sessionDir, "other.jsonl"), config, deps);

    expect(result).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });
});
