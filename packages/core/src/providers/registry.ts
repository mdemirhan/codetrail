import { PROVIDER_VALUES, type Provider } from "../contracts/canonical";

import { claudeAdapter } from "./adapters/claude";
import { claudeSakaAdapter } from "./adapters/claudeSaka";
import { codexAdapter } from "./adapters/codex";
import { copilotAdapter } from "./adapters/copilot";
import { cursorAdapter } from "./adapters/cursor";
import { geminiAdapter } from "./adapters/gemini";
import type { ProviderAdapter } from "./types";

export const PROVIDER_ADAPTERS: Record<Provider, ProviderAdapter> = {
  claude: claudeAdapter,
  "claude-saka": claudeSakaAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  cursor: cursorAdapter,
  copilot: copilotAdapter,
};

export const PROVIDER_ADAPTER_LIST: ProviderAdapter[] = PROVIDER_VALUES.map(
  (provider) => PROVIDER_ADAPTERS[provider],
);

export function getProviderAdapter(provider: Provider): ProviderAdapter {
  return PROVIDER_ADAPTERS[provider];
}
