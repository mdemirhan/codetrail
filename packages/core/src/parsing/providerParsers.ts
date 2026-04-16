import { parseClaudeEvent, parseClaudePayload } from "../providers/claude/parser";
import { parseCodexEvent, parseCodexPayload } from "../providers/codex/parser";
import { parseCopilotEvent, parseCopilotPayload } from "../providers/copilot/parser";
import { parseCopilotCliEvent, parseCopilotCliPayload } from "../providers/copilotCli/parser";
import { parseCursorEvent, parseCursorPayload } from "../providers/cursor/parser";
import { parseGeminiEvent, parseGeminiPayload } from "../providers/gemini/parser";
import { parseOpenCodeEvent, parseOpenCodePayload } from "../providers/opencode/parser";

export type {
  ParsedProviderMessage,
  ParseProviderPayloadArgs,
  ParseProviderEventArgs,
  ParseProviderEventResult,
} from "./providerParserShared";

export {
  parseClaudeEvent,
  parseClaudePayload,
  parseCodexEvent,
  parseCodexPayload,
  parseCopilotEvent,
  parseCopilotPayload,
  parseCopilotCliEvent,
  parseCopilotCliPayload,
  parseCursorEvent,
  parseCursorPayload,
  parseGeminiEvent,
  parseGeminiPayload,
  parseOpenCodeEvent,
  parseOpenCodePayload,
};

import type {
  ParseProviderEventArgs,
  ParseProviderEventResult,
  ParseProviderPayloadArgs,
  ParsedProviderMessage,
} from "./providerParserShared";

export function parseProviderPayload(args: ParseProviderPayloadArgs): ParsedProviderMessage[] {
  switch (args.provider) {
    case "claude":
      return parseClaudePayload(args);
    case "codex":
      return parseCodexPayload(args);
    case "gemini":
      return parseGeminiPayload(args);
    case "cursor":
      return parseCursorPayload(args);
    case "copilot":
      return parseCopilotPayload(args);
    case "copilot_cli":
      return parseCopilotCliPayload(args);
    case "opencode":
      return parseOpenCodePayload(args);
  }
}

export function parseProviderEvent(args: ParseProviderEventArgs): ParseProviderEventResult {
  switch (args.provider) {
    case "claude":
      return parseClaudeEvent(args);
    case "codex":
      return parseCodexEvent(args);
    case "gemini":
      return parseGeminiEvent(args);
    case "cursor":
      return parseCursorEvent(args);
    case "copilot":
      return parseCopilotEvent(args);
    case "copilot_cli":
      return parseCopilotCliEvent(args);
    case "opencode":
      return parseOpenCodeEvent(args);
  }
}
