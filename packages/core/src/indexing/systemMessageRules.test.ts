import { describe, expect, it } from "vitest";

import {
  DEFAULT_SYSTEM_MESSAGE_REGEX_RULES,
  resolveSystemMessageRegexRules,
} from "./systemMessageRules";

describe("systemMessageRules", () => {
  it("returns default rules when no overrides are provided", () => {
    expect(resolveSystemMessageRegexRules()).toEqual(DEFAULT_SYSTEM_MESSAGE_REGEX_RULES);
    expect(DEFAULT_SYSTEM_MESSAGE_REGEX_RULES.claude).toContain("^<command-name>");
  });

  it("applies per-provider overrides and allows clearing defaults", () => {
    const resolved = resolveSystemMessageRegexRules({
      claude: ["^custom-claude"],
      codex: [],
    });

    expect(resolved).toEqual({
      claude: ["^custom-claude"],
      codex: [],
      gemini: [],
      cursor: [],
    });
  });

  it("matches codex default rules against raw codex boilerplate payload shapes", () => {
    const rules = resolveSystemMessageRegexRules();
    const codexRegexes = rules.codex.map((pattern) => new RegExp(pattern, "u"));

    const agentsPayload =
      "# AGENTS.md instructions for /Users/tcmudemirhan/src/tsproj/codetrail\n\n<INSTRUCTIONS>\n## Skills";
    const environmentPayload =
      "<environment_context>\n  <cwd>/Users/tcmudemirhan/src/tsproj/cch</cwd>\n  <shell>zsh</shell>\n</environment_context>";

    expect(codexRegexes.some((regex) => regex.test(agentsPayload))).toBe(true);
    expect(codexRegexes.some((regex) => regex.test(environmentPayload))).toBe(true);
  });
});
