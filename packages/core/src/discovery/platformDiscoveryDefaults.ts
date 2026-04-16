import { homedir } from "node:os";

import { PROVIDER_VALUES } from "../contracts/canonical";
import {
  type DiscoveryPlatform,
  type DiscoveryPlatformEnvironment,
  PROVIDER_LIST,
  type ProviderDiscoveryPathKey,
} from "../contracts/providerMetadata";

export function getCurrentDiscoveryPlatform(): DiscoveryPlatform {
  if (process.platform === "win32") {
    return "win32";
  }
  if (process.platform === "darwin") {
    return "darwin";
  }
  return "linux";
}

export function createDefaultDiscoveryConfig(
  platform: DiscoveryPlatform,
  environment: Partial<DiscoveryPlatformEnvironment> = {},
): {
  providerPaths: Record<ProviderDiscoveryPathKey, string>;
  providerOptions: { claude: { includeSubagents: boolean } };
  enabledProviders: typeof PROVIDER_VALUES;
  includeClaudeSubagents: boolean;
} & Record<ProviderDiscoveryPathKey, string> {
  const normalizedEnvironment = {
    ...environment,
    homeDir: environment.homeDir ?? homedir(),
  } satisfies DiscoveryPlatformEnvironment;
  const providerPaths = Object.fromEntries(
    PROVIDER_LIST.flatMap((provider) =>
      provider.discoveryPaths.map((pathDef) => [
        pathDef.key,
        pathDef.defaultPath(platform, normalizedEnvironment),
      ]),
    ),
  ) as Record<ProviderDiscoveryPathKey, string>;
  return {
    providerPaths,
    providerOptions: {
      claude: {
        includeSubagents: false,
      },
    },
    ...providerPaths,
    includeClaudeSubagents: false,
    enabledProviders: [...PROVIDER_VALUES],
  };
}
