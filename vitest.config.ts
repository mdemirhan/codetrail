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
  },
  resolve: {
    alias: {
      "@codetrail/core": coreIndexPath,
      "@codetrail/core/": coreDirPath,
    },
  },
});
