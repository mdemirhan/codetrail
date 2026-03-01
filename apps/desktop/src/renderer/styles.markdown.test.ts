import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const stylesPath = new URL("./styles.css", import.meta.url);

function readStyles(): string {
  return readFileSync(stylesPath, "utf-8");
}

describe("markdown table styles", () => {
  it("defines table grid styling for markdown content", () => {
    const css = readStyles();

    expect(css).toMatch(
      /\.rich-block table\s*\{[^}]*border-collapse:\s*collapse;[^}]*border:\s*1px solid var\(--border\);/s,
    );
    expect(css).toMatch(
      /\.rich-block th,\s*\.rich-block td\s*\{[^}]*border:\s*1px solid var\(--border\);/s,
    );
  });

  it("left-aligns markdown table header cells", () => {
    const css = readStyles();

    expect(css).toMatch(/\.rich-block th\s*\{[^}]*text-align:\s*left;/s);
  });
});
