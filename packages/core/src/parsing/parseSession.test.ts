import { afterEach, describe, expect, it, vi } from "vitest";

import * as providers from "../providers";

import { parseSession } from "./parseSession";

describe("parseSession", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops provider messages that fail canonical validation", () => {
    const adapter = {
      id: "claude",
      label: "Claude",
      discoveryPaths: [],
      supportsIncrementalCheckpoints: true,
      sourceFormat: "materialized_json",
      discoverAll: () => [],
      discoverOne: () => null,
      parsePayload: () => [
        {
          id: "bad-message",
          category: "not-a-category",
          content: { unsafe: true },
          createdAt: "2026-03-30T00:00:00.000Z",
        },
      ],
      parseEvent: () => ({ messages: [], nextSequence: 0 }),
      readSource: () => null,
      extractSourceMetadata: () => ({
        models: [],
        gitBranch: null,
        cwd: null,
      }),
      normalizeMessageTimestamp: <T extends { createdAt: string }>(message: T) => ({
        message,
        previousTimestampMs: Date.parse(message.createdAt),
      }),
    } as unknown as providers.ProviderAdapter;

    vi.spyOn(providers, "getProviderAdapter").mockReturnValue(adapter);

    const result = parseSession({
      provider: "claude",
      sessionId: "session-1",
      payload: [],
    });

    expect(result.messages).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "parser.invalid_canonical_message",
          severity: "error",
        }),
      ]),
    );
  });
});
