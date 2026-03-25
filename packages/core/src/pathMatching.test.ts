import { describe, expect, it } from "vitest";

import {
  hasFileExtension,
  isPathWithinRoot,
  joinPathWithinRoot,
  normalizeAbsolutePath,
  normalizePathForComparison,
  relativePathSegments,
  stripFileExtension,
} from "./pathMatching";

describe("pathMatching", () => {
  it("matches file extensions case-insensitively", () => {
    expect(hasFileExtension("session.JSONL", ".jsonl")).toBe(true);
    expect(hasFileExtension("/tmp/session.Json", ".json")).toBe(true);
    expect(stripFileExtension("session.JSONL", ".jsonl")).toBe("session");
  });

  it("normalizes Windows absolute paths for comparison", () => {
    expect(normalizeAbsolutePath("C:\\Repo\\src\\..\\file.ts")).toBe("C:/Repo/file.ts");
    expect(normalizePathForComparison("C:\\Repo\\FILE.ts")).toBe("c:/repo/file.ts");
  });

  it("treats Windows drive-letter roots as case-insensitive and separator-insensitive", () => {
    expect(isPathWithinRoot("c:\\Repo\\Sessions\\trace.JSONL", "C:/repo")).toBe(true);
    expect(relativePathSegments("c:\\Repo\\Sessions\\trace.JSONL", "C:/repo")).toEqual([
      "Sessions",
      "trace.JSONL",
    ]);
  });

  it("joins relative paths under normalized roots without introducing double separators", () => {
    expect(joinPathWithinRoot("/", "tmp/file.json")).toBe("/tmp/file.json");
    expect(joinPathWithinRoot("C:/", "Repo/file.json")).toBe("C:/Repo/file.json");
  });
});
