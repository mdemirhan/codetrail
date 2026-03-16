import { PROVIDER_VALUES, type Provider } from "../contracts/canonical";

export type SystemMessageRegexRules = Record<Provider, string[]>;
export type SystemMessageRegexRuleOverrides = Partial<Record<Provider, string[]>>;

export const DEFAULT_SYSTEM_MESSAGE_REGEX_RULES: SystemMessageRegexRules = {
  claude: ["^<command-name>", "^<local-command-stdout>", "^<local-command-caveat>"],
  codex: [
    "^#?\\s*AGENTS\\.md instructions for [^\\r\\n]+\\r?\\n(?:\\r?\\n)?<INSTRUCTIONS>",
    "^\\s*<environment_context>",
  ],
  gemini: [],
  cursor: [],
  copilot: [],
};

export function resolveSystemMessageRegexRules(
  overrides?: SystemMessageRegexRuleOverrides,
): SystemMessageRegexRules {
  const resolved: SystemMessageRegexRules = {
    claude: [...DEFAULT_SYSTEM_MESSAGE_REGEX_RULES.claude],
    codex: [...DEFAULT_SYSTEM_MESSAGE_REGEX_RULES.codex],
    gemini: [...DEFAULT_SYSTEM_MESSAGE_REGEX_RULES.gemini],
    cursor: [...DEFAULT_SYSTEM_MESSAGE_REGEX_RULES.cursor],
    copilot: [...DEFAULT_SYSTEM_MESSAGE_REGEX_RULES.copilot],
  };

  if (!overrides) {
    return resolved;
  }

  for (const provider of PROVIDER_VALUES) {
    if (!Object.prototype.hasOwnProperty.call(overrides, provider)) {
      continue;
    }
    const override = overrides[provider];
    resolved[provider] = Array.isArray(override) ? [...override] : [];
  }

  return resolved;
}
