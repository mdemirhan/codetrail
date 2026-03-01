import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const coreIndexPath = fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url));
const coreDirPath = fileURLToPath(new URL("./packages/core/src/", import.meta.url));

export default defineConfig({
  test: {
    include: [
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
    ],
    environment: "node",
    globals: true,
    setupFiles: ["./apps/desktop/src/renderer/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["apps/desktop/src/**/*.{ts,tsx}", "packages/core/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.d.ts",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/test/**",
        "apps/desktop/src/main/main.ts",
        "apps/desktop/src/main/indexingWorker.ts",
        "apps/desktop/src/preload/**",
        "apps/desktop/src/renderer/main.tsx",
        "apps/desktop/forge.config.ts",
        "apps/desktop/out/**",
        "**/node_modules/**",
        "coverage/**",
      ],
      thresholds: {
        statements: 85,
        lines: 85,
        functions: 85,
        branches: 75,
      },
    },
  },
  resolve: {
    alias: [
      {
        find: /^@codetrail\/core\/(.*)$/,
        replacement: `${coreDirPath}$1`,
      },
      {
        find: "@codetrail/core",
        replacement: coreIndexPath,
      },
    ],
  },
});
