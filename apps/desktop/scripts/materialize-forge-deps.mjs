import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appPackage = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
const runtimeDeps = Object.keys(appPackage.dependencies ?? {});
const visited = new Set();

for (const dep of runtimeDeps) {
  const depPath = join(appDir, "node_modules", dep);
  if (!existsSync(depPath)) {
    continue;
  }
  materializeForPackage(depPath);
}

function materializeForPackage(packagePath) {
  const realPackagePath = resolveRealPath(packagePath);
  if (visited.has(realPackagePath)) {
    return;
  }
  visited.add(realPackagePath);

  const packageJsonPath = join(realPackagePath, "package.json");
  if (!existsSync(packageJsonPath)) {
    return;
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const dependencyNames = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
  ];
  if (dependencyNames.length === 0) {
    return;
  }

  const parentNodeModulesPath = dirname(realPackagePath);
  const nestedNodeModulesPath = join(realPackagePath, "node_modules");
  mkdirSync(nestedNodeModulesPath, { recursive: true });

  for (const depName of dependencyNames) {
    const sourcePath = join(parentNodeModulesPath, depName);
    if (!existsSync(sourcePath)) {
      continue;
    }

    const targetPath = join(nestedNodeModulesPath, depName);
    if (!existsSync(targetPath)) {
      symlinkSync(sourcePath, targetPath);
    }

    materializeForPackage(sourcePath);
  }
}

function resolveRealPath(inputPath) {
  return realpathSync(resolve(inputPath));
}
