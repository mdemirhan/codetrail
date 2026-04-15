import type { IpcResponse } from "../contracts/ipc";
import { CLAUDE_HOOK_EVENT_NAME_VALUES } from "../live/types";

export function createClaudeHookStateFixture(
  input: Partial<IpcResponse<"watcher:getLiveStatus">["claudeHookState"]> & {
    installed?: boolean;
  } = {},
): IpcResponse<"watcher:getLiveStatus">["claudeHookState"] {
  const installed = input.installed ?? false;
  return {
    settingsPath: input.settingsPath ?? "/Users/test/.claude/settings.json",
    logPath:
      input.logPath ??
      "/Users/test/Library/Application Support/@codetrail/desktop/live-status/claude-hooks.jsonl",
    installed,
    managed: input.managed ?? installed,
    managedEventNames:
      input.managedEventNames ?? (installed ? [...CLAUDE_HOOK_EVENT_NAME_VALUES] : []),
    missingEventNames:
      input.missingEventNames ?? (installed ? [] : [...CLAUDE_HOOK_EVENT_NAME_VALUES]),
    lastError: input.lastError ?? null,
  };
}

export function createLiveStatusFixture(
  input: Partial<IpcResponse<"watcher:getLiveStatus">> = {},
): IpcResponse<"watcher:getLiveStatus"> {
  return {
    enabled: input.enabled ?? false,
    instrumentationEnabled: input.instrumentationEnabled ?? false,
    revision: input.revision ?? 0,
    updatedAt: input.updatedAt ?? "2026-03-24T10:00:00.000Z",
    providerCounts: input.providerCounts ?? {
      claude: 0,
      codex: 0,
      gemini: 0,
      cursor: 0,
      copilot: 0,
      copilot_cli: 0,
    },
    sessions: input.sessions ?? [],
    claudeHookState: input.claudeHookState ?? createClaudeHookStateFixture(),
  };
}
