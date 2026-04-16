import { PROVIDER_VALUES, type Provider } from "../contracts/canonical";
import {
  PROVIDER_METADATA,
  type ProviderDiscoveryPathKey,
  createProviderRecord,
} from "../contracts/providerMetadata";
import { PROVIDER_ADAPTER_LIST } from "../providers";
import {
  createDefaultDiscoveryConfig,
  getCurrentDiscoveryPlatform,
} from "./platformDiscoveryDefaults";
import {
  type DiscoveryDependencies,
  getConfigDiscoveryPath,
  getDiscoveryPath,
  resolveDiscoveryDependencies,
} from "./shared";
import type {
  DiscoveredSessionFile,
  DiscoveryConfig,
  ProviderDiscoveryOptions,
  ResolvedDiscoveryConfig,
} from "./types";

export type { DiscoveryDependencies, DiscoveryFileSystem } from "./shared";

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  ...createDefaultDiscoveryConfig(getCurrentDiscoveryPlatform(), {
    appDataDir: process.env.APPDATA ?? null,
    localAppDataDir: process.env.LOCALAPPDATA ?? null,
  }),
};

export function resolveDiscoveryConfig(
  config: Partial<DiscoveryConfig> = {},
): ResolvedDiscoveryConfig {
  const mergedProviderPaths = {
    ...(DEFAULT_DISCOVERY_CONFIG.providerPaths ?? {}),
  } as Partial<Record<ProviderDiscoveryPathKey, string>>;
  for (const provider of PROVIDER_VALUES) {
    for (const { key } of PROVIDER_METADATA[provider].discoveryPaths) {
      const configuredValue = getConfigDiscoveryPath(config, key);
      if (configuredValue) {
        mergedProviderPaths[key] = configuredValue;
      }
    }
  }
  const mergedProviderOptions = createProviderRecord<ProviderDiscoveryOptions>((provider) => ({
    ...((DEFAULT_DISCOVERY_CONFIG.providerOptions?.[provider] ?? {}) as ProviderDiscoveryOptions),
    ...((config.providerOptions?.[provider] ?? {}) as ProviderDiscoveryOptions),
  }));
  if (config.includeClaudeSubagents !== undefined) {
    mergedProviderOptions.claude.includeSubagents = config.includeClaudeSubagents;
  }
  const merged: DiscoveryConfig = {
    ...DEFAULT_DISCOVERY_CONFIG,
    ...config,
    providerPaths: mergedProviderPaths,
    providerOptions: mergedProviderOptions,
  };

  return {
    providers: createProviderRecord((provider) => ({
      paths: resolveProviderPaths(provider, merged),
      options: merged.providerOptions?.[provider] ?? {},
    })),
    enabledProviders: resolveEnabledProviders(merged.enabledProviders),
  };
}

export function resolveEnabledProviders(enabledProviders: Provider[] | undefined): Provider[] {
  if (!enabledProviders) {
    return [...PROVIDER_VALUES];
  }

  const next: Provider[] = [];
  for (const provider of enabledProviders) {
    if (!PROVIDER_VALUES.includes(provider) || next.includes(provider)) {
      continue;
    }
    next.push(provider);
  }
  return next;
}

function resolveProviderPaths(
  provider: Provider,
  config: DiscoveryConfig,
): Partial<Record<ProviderDiscoveryPathKey, string>> {
  const paths: Partial<Record<ProviderDiscoveryPathKey, string>> = {};

  for (const { key } of PROVIDER_METADATA[provider].discoveryPaths) {
    const value = getConfigDiscoveryPath(config, key);
    if (typeof value === "string" && value.length > 0) {
      paths[key] = value;
    }
  }

  return paths;
}

export type DiscoverySettingsPath = {
  provider: Provider;
  providerLabel: string;
  key: ProviderDiscoveryPathKey;
  label: string;
  value: string;
  watch: boolean;
};

// Discovery stays deliberately tolerant: missing roots, unreadable files, and provider-specific
// oddities should reduce coverage, not abort a full indexing run.
export function discoverSessionFiles(
  config: DiscoveryConfig = DEFAULT_DISCOVERY_CONFIG,
  dependencies: DiscoveryDependencies = {},
): DiscoveredSessionFile[] {
  const resolvedDependencies = resolveDiscoveryDependencies(dependencies);
  const resolvedConfig = resolveDiscoveryConfig(config);

  return PROVIDER_ADAPTER_LIST.filter((provider) =>
    resolvedConfig.enabledProviders.includes(provider.id),
  )
    .flatMap((provider) => provider.discoverAll(resolvedConfig, resolvedDependencies))
    .sort((left, right) => {
      const byMtime = right.fileMtimeMs - left.fileMtimeMs;
      if (byMtime !== 0) {
        return byMtime;
      }

      return left.filePath.localeCompare(right.filePath);
    });
}

/**
 * Determines which provider a single file belongs to and constructs a {@link DiscoveredSessionFile}
 * using the same rules as the per-provider discover functions. Returns `null` if the file is
 * unrecognised, not statable, or is a Claude subagent transcript while subagent discovery is
 * disabled.
 */
export function discoverSingleFile(
  filePath: string,
  config: DiscoveryConfig,
  dependencies: DiscoveryDependencies = {},
): DiscoveredSessionFile | null {
  const resolvedDependencies = resolveDiscoveryDependencies(dependencies);
  const resolvedConfig = resolveDiscoveryConfig(config);
  if (
    /[\\/]subagents[\\/]/.test(filePath) &&
    !resolvedConfig.providers.claude.options.includeSubagents
  ) {
    return null;
  }

  for (const provider of PROVIDER_ADAPTER_LIST) {
    if (!resolvedConfig.enabledProviders.includes(provider.id)) {
      continue;
    }
    const discovered = provider.discoverOne(filePath, resolvedConfig, resolvedDependencies);
    if (discovered) {
      return discovered;
    }
  }

  return null;
}

export function discoverChangedFiles(
  filePath: string,
  config: DiscoveryConfig,
  dependencies: DiscoveryDependencies = {},
): DiscoveredSessionFile[] {
  const resolvedDependencies = resolveDiscoveryDependencies(dependencies);
  const resolvedConfig = resolveDiscoveryConfig(config);
  const discovered: DiscoveredSessionFile[] = [];
  const seen = new Set<string>();

  for (const provider of PROVIDER_ADAPTER_LIST) {
    if (!resolvedConfig.enabledProviders.includes(provider.id)) {
      continue;
    }

    const providerResults = provider.discoverChanged
      ? provider.discoverChanged(filePath, resolvedConfig, resolvedDependencies)
      : (() => {
          const one = provider.discoverOne(filePath, resolvedConfig, resolvedDependencies);
          return one ? [one] : [];
        })();

    for (const entry of providerResults) {
      if (seen.has(entry.filePath)) {
        continue;
      }
      seen.add(entry.filePath);
      discovered.push(entry);
    }
  }

  return discovered;
}

export function listDiscoverySettingsPaths(
  config: DiscoveryConfig = DEFAULT_DISCOVERY_CONFIG,
): DiscoverySettingsPath[] {
  const resolvedConfig = resolveDiscoveryConfig(config);
  return PROVIDER_ADAPTER_LIST.flatMap((provider) =>
    provider.discoveryPaths.flatMap((pathDef) => {
      const value = getDiscoveryPath(resolvedConfig, provider.id, pathDef.key);
      if (!value) {
        return [];
      }
      return [
        {
          provider: provider.id,
          providerLabel: provider.label,
          key: pathDef.key,
          label: pathDef.label,
          value,
          watch: pathDef.watch,
        },
      ];
    }),
  );
}

export function listDiscoveryWatchRoots(
  config: DiscoveryConfig = DEFAULT_DISCOVERY_CONFIG,
): string[] {
  const roots = new Set<string>();
  const enabledProviders = new Set(resolveDiscoveryConfig(config).enabledProviders);
  for (const path of listDiscoverySettingsPaths(config)) {
    if (!enabledProviders.has(path.provider)) {
      continue;
    }
    if (path.watch) {
      roots.add(path.value);
    }
  }
  return [...roots];
}
