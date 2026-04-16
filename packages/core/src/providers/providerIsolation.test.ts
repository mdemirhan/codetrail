import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("provider isolation guardrails", () => {
  it("keeps search facet aggregation provider-agnostic", () => {
    const source = readSource("../search/searchMessages.ts");
    expect(source).not.toContain("provider = 'claude'");
    expect(source).not.toContain("provider = 'codex'");
    expect(source).not.toContain("provider = 'opencode'");
  });

  it("keeps parser dispatch free of central provider parser registries", () => {
    const source = readSource("../parsing/providerParsers.ts");
    expect(source).not.toContain("PROVIDER_EVENT_PARSERS");
    expect(source).not.toContain("PROVIDER_PAYLOAD_PARSERS");
    expect(source).not.toContain("function parseClaudeEvent(");
    expect(source).not.toContain("function parseCodexEvent(");
    expect(source).not.toContain("function parseGeminiEvent(");
    expect(source).not.toContain("function parseCursorEvent(");
    expect(source).not.toContain("function parseCopilotEvent(");
    expect(source).not.toContain("function parseOpenCodeEvent(");
  });

  it("keeps query turn-family behavior adapter-driven", () => {
    const source = readSource("../../../../apps/desktop/src/main/data/queryService.ts");
    expect(source).not.toContain('session.provider !== "claude"');
    expect(source).not.toContain("provider = 'claude'");
    expect(source).not.toContain("isClaudeSubagentTranscriptPath");
  });

  it("keeps live trace source selection adapter-driven", () => {
    const source = readSource("../../../../apps/desktop/src/main/liveSessionStore.ts");
    expect(source).not.toContain('discovered.provider === "codex"');
    expect(source).not.toContain('"claude_hook"');
    expect(source).not.toContain('"claude_transcript"');
    expect(source).not.toContain('"codex_transcript"');
  });

  it("keeps bootstrap live transcript filtering registry-driven", () => {
    const source = readSource("../../../../apps/desktop/src/main/bootstrap.ts");
    expect(source).not.toContain('getConfigDiscoveryPath(discoveryConfig, "claudeRoot")');
    expect(source).not.toContain('getConfigDiscoveryPath(discoveryConfig, "codexRoot")');
    expect(source).not.toContain('getConfigDiscoveryPath(discoveryConfig, "copilotCliRoot")');
  });

  it("keeps combined turn diff provider selection strategy-driven", () => {
    const source = readSource(
      "../../../../apps/desktop/src/renderer/components/history/turnCombinedDiff.ts",
    );
    expect(source).not.toContain('["codex", "gemini", "cursor", "opencode"]');
    expect(source).not.toContain('providers: ["copilot"]');
  });

  it("keeps inline reconstructed diff collection metadata-driven", () => {
    const source = readSource(
      "../../../../apps/desktop/src/renderer/components/history/claudeTurnEdits.ts",
    );
    expect(source).not.toContain('message.provider !== "claude"');
  });

  it("keeps stream indexing orchestration free of provider-id branching", () => {
    const source = readSource("../indexing/indexSessions.ts");
    expect(source).not.toContain('provider === "claude"');
    expect(source).not.toContain('provider !== "codex"');
    expect(source).not.toContain('provider === "opencode"');
    expect(source).not.toContain('discovered.provider === "claude"');
    expect(source).not.toContain('discovered.provider !== "codex"');
    expect(source).not.toContain('discovered.provider === "opencode"');
  });

  it("registers providers from provider-local adapter modules", () => {
    const source = readSource("./registry.ts");
    expect(source).toContain("./claude/adapter");
    expect(source).toContain("./codex/adapter");
    expect(source).toContain("./opencode/adapter");
    expect(source).not.toContain("./adapters/claude");
    expect(source).not.toContain("./adapters/codex");
    expect(source).not.toContain("./adapters/opencode");
  });
});
