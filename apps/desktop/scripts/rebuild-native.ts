import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildHome = resolve(appDir, ".home");
const gypDir = resolve(appDir, ".electron-gyp");

type VsInstallation = {
  displayName?: string;
  installationPath?: string;
  installationVersion?: string;
};

function resolveRebuildPath(): string {
  const binDir = resolve(appDir, "node_modules", ".bin");

  if (process.platform === "win32") {
    const winCandidates = ["electron-rebuild.exe", "electron-rebuild.cmd", "electron-rebuild"];
    for (const candidate of winCandidates) {
      const candidatePath = resolve(binDir, candidate);
      if (existsSync(candidatePath)) {
        return candidatePath;
      }
    }
  }

  const fallbackPath = resolve(binDir, "electron-rebuild");
  if (existsSync(fallbackPath)) {
    return fallbackPath;
  }

  throw new Error(`Could not find electron-rebuild in ${binDir}`);
}

function detectInstalledNodeGypMajor(): number | null {
  const bunDirs = [
    resolve(appDir, "node_modules", ".bun"),
    resolve(appDir, "..", "..", "node_modules", ".bun"),
  ];
  const versions = new Set<number>();

  for (const bunDir of bunDirs) {
    if (!existsSync(bunDir)) {
      continue;
    }

    for (const entry of readdirSync(bunDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const match = /^node-gyp@(\d+)/.exec(entry.name);
      const majorVersion = match?.[1];
      if (majorVersion) {
        versions.add(Number.parseInt(majorVersion, 10));
      }
    }
  }

  if (versions.size === 0) {
    return null;
  }

  return Math.max(...versions);
}

function getVisualStudioInstallations(): VsInstallation[] {
  if (process.platform !== "win32") {
    return [];
  }

  const vswherePath = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
  if (!existsSync(vswherePath)) {
    return [];
  }

  const result = spawnSync(vswherePath, ["-all", "-products", "*", "-format", "json"], {
    encoding: "utf8",
    shell: false,
  });

  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  try {
    return JSON.parse(result.stdout) as VsInstallation[];
  } catch {
    return [];
  }
}

const installedNodeGypMajor = detectInstalledNodeGypMajor();
const visualStudioInstallations = getVisualStudioInstallations();
const hasVisualStudio2026OrNewer = visualStudioInstallations.some((installation) => {
  const major = Number.parseInt((installation.installationVersion ?? "").split(".")[0] ?? "", 10);
  return Number.isFinite(major) && major >= 18;
});
const canUseVisualStudio2026 = hasVisualStudio2026OrNewer && (installedNodeGypMajor ?? 0) >= 12;
const shouldDisableMsBuildFileTracking =
  process.platform === "win32" && process.arch === "arm64" && canUseVisualStudio2026;

function failForUnsupportedVisualStudio(): void {
  if (process.platform !== "win32") {
    return;
  }

  const installations = visualStudioInstallations;
  const supportedInstallation = installations.find((installation) => {
    const major = Number.parseInt((installation.installationVersion ?? "").split(".")[0] ?? "", 10);
    return major === 16 || major === 17;
  });
  if (supportedInstallation || canUseVisualStudio2026) {
    return;
  }

  const unsupportedInstallation = installations.find((installation) => {
    const major = Number.parseInt((installation.installationVersion ?? "").split(".")[0] ?? "", 10);
    return Number.isFinite(major) && major >= 18;
  });
  if (!unsupportedInstallation) {
    return;
  }

  const displayName = unsupportedInstallation.displayName ?? "Visual Studio";
  const installPath = unsupportedInstallation.installationPath ?? "unknown path";
  console.error(
    [
      `Unsupported Visual Studio toolchain detected: ${displayName}`,
      `Found at: ${installPath}`,
      "The bundled node-gyp used by electron-rebuild cannot use this Visual Studio version yet.",
      "Upgrade the installed node-gyp to 12+ so VS 2026 can be used, or install Visual Studio Build Tools 2022",
      "with Desktop development with C++, then rerun: bun run --cwd apps/desktop fix:native",
    ].join("\n"),
  );
  process.exit(1);
}

function failForMissingArm64Toolset(): void {
  if (process.platform !== "win32" || process.arch !== "arm64") {
    return;
  }
  if (canUseVisualStudio2026) {
    return;
  }

  const buildToolsRoot = "C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools";
  if (!existsSync(buildToolsRoot)) {
    return;
  }

  const arm64ToolsetPath = resolve(
    buildToolsRoot,
    "MSBuild",
    "Microsoft",
    "VC",
    "v170",
    "Platforms",
    "ARM64",
    "PlatformToolsets",
    "v143",
  );

  if (existsSync(arm64ToolsetPath)) {
    return;
  }

  console.error(
    [
      "Visual Studio Build Tools 2022 is installed, but the ARM64 v143 C++ toolset is missing.",
      `Expected to find: ${arm64ToolsetPath}`,
      "On Windows ARM64, better-sqlite3 must be rebuilt with the VS 2022 ARM64 toolset.",
      "Modify the Build Tools 2022 installation and add the MSVC v143 ARM64 build tools component",
      "(component id: Microsoft.VisualStudio.Component.VC.Tools.ARM64), then rerun:",
      "bun run --cwd apps/desktop fix:native",
    ].join("\n"),
  );
  process.exit(1);
}

const rebuildPath = resolveRebuildPath();
failForUnsupportedVisualStudio();
failForMissingArm64Toolset();

mkdirSync(buildHome, { recursive: true });
mkdirSync(gypDir, { recursive: true });

const result = spawnSync(rebuildPath, ["-f", "-w", "better-sqlite3,@parcel/watcher"], {
  cwd: appDir,
  stdio: "inherit",
  shell: false,
  env: {
    ...process.env,
    HOME: buildHome,
    USERPROFILE: buildHome,
    npm_config_devdir: gypDir,
    ...(canUseVisualStudio2026
      ? {
          npm_config_msvs_version: "2026",
          GYP_MSVS_VERSION: "2026",
          GYP_MSVS_OVERRIDE_PATH:
            visualStudioInstallations.find((installation) => {
              const major = Number.parseInt(
                (installation.installationVersion ?? "").split(".")[0] ?? "",
                10,
              );
              return Number.isFinite(major) && major >= 18;
            })?.installationPath ?? "",
        }
      : {}),
    ...(shouldDisableMsBuildFileTracking
      ? {
          TrackFileAccess: "false",
        }
      : {}),
  },
});

process.exit(result.status ?? 1);
