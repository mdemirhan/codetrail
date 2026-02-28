import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { canonicalMessageSchema } from "../contracts/canonical";

import { parseSessionInputSchema, parserDiagnosticSchema } from "./contracts";
import { parseSession } from "./parseSession";

const fixtureMessageSchema = canonicalMessageSchema.omit({ id: true });

const fixtureSchema = z.object({
  name: z.string().min(1),
  input: parseSessionInputSchema,
  expected: z.object({
    messages: z.array(fixtureMessageSchema),
    diagnostics: z.array(parserDiagnosticSchema),
  }),
});

const fixtureDirectory = join(process.cwd(), "packages", "core", "test-fixtures", "m1");
const fixtureFiles = readdirSync(fixtureDirectory)
  .filter((file) => file.endsWith(".json"))
  .sort();

describe("parseSession fixtures", () => {
  for (const fixtureFile of fixtureFiles) {
    it(`matches golden output: ${fixtureFile}`, () => {
      const fixtureData = JSON.parse(readFileSync(join(fixtureDirectory, fixtureFile), "utf8"));
      const fixture = fixtureSchema.parse(fixtureData);

      const firstRun = parseSession(fixture.input);
      const secondRun = parseSession(fixture.input);

      expect(firstRun).toEqual(secondRun);

      const ids = firstRun.messages.map((message) => message.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
      for (const id of ids) {
        expect(id.length).toBeGreaterThan(0);
      }

      const messagesWithoutIds = firstRun.messages.map((message) => ({
        sessionId: message.sessionId,
        provider: message.provider,
        category: message.category,
        content: message.content,
        createdAt: message.createdAt,
        tokenInput: message.tokenInput,
        tokenOutput: message.tokenOutput,
      }));

      expect(messagesWithoutIds).toEqual(fixture.expected.messages);
      expect(firstRun.diagnostics).toEqual(fixture.expected.diagnostics);
    });
  }
});
