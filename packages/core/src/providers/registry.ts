import { PROVIDER_VALUES, type Provider } from "../contracts/canonical";

import { claudeAdapter } from "./adapters/claude";
import { codexAdapter } from "./adapters/codex";
import { copilotAdapter } from "./adapters/copilot";
import { copilotCliAdapter } from "./adapters/copilotCli";
import { cursorAdapter } from "./adapters/cursor";
import { geminiAdapter } from "./adapters/gemini";
import type { ProviderAdapter } from "./types";

export const PROVIDER_ADAPTERS: Record<Provider, ProviderAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  cursor: cursorAdapter,
  copilot: copilotAdapter,
  copilot_cli: copilotCliAdapter,
};

export const PROVIDER_ADAPTER_LIST: ProviderAdapter[] = PROVIDER_VALUES.map(
  (provider) => PROVIDER_ADAPTERS[provider],
);

export function getProviderAdapter(provider: Provider): ProviderAdapter {
  return PROVIDER_ADAPTERS[provider];
}
