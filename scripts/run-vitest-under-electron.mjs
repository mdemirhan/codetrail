import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const electronBinary = resolve(repoRoot, "apps/desktop/node_modules/.bin/electron");
const vitestEntrypoint = resolve(repoRoot, "node_modules/vitest/vitest.mjs");

const forwardedArgs = process.argv.slice(2);
const standaloneSeparatorIndex = forwardedArgs.indexOf("--");
if (standaloneSeparatorIndex >= 0) {
  forwardedArgs.splice(standaloneSeparatorIndex, 1);
}

const child = spawn(electronBinary, [vitestEntrypoint, ...forwardedArgs], {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
  },
});

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => forwardSignal(signal));
}

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
