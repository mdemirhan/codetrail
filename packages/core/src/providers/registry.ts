import { PROVIDER_VALUES, type Provider } from "../contracts/canonical";

import { claudeAdapter } from "./claude/adapter";
import { codexAdapter } from "./codex/adapter";
import { copilotAdapter } from "./copilot/adapter";
import { copilotCliAdapter } from "./copilotCli/adapter";
import { cursorAdapter } from "./cursor/adapter";
import { geminiAdapter } from "./gemini/adapter";
import { opencodeAdapter } from "./opencode/adapter";
import type { ProviderAdapter } from "./types";

export const PROVIDER_ADAPTERS: Record<Provider, ProviderAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  cursor: cursorAdapter,
  copilot: copilotAdapter,
  copilot_cli: copilotCliAdapter,
  opencode: opencodeAdapter,
};

export const PROVIDER_ADAPTER_LIST: ProviderAdapter[] = PROVIDER_VALUES.map(
  (provider) => PROVIDER_ADAPTERS[provider],
);

export function getProviderAdapter(provider: Provider): ProviderAdapter {
  return PROVIDER_ADAPTERS[provider];
}
