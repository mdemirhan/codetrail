import type { Provider } from "@codetrail/core/browser";
import { PROVIDER_VALUES } from "@codetrail/core/browser";

/** Maps child providers to their UI display parent (grouped under one chip). */
export const PROVIDER_GROUP_PARENT: Partial<Record<Provider, Provider>> = {
  copilot_cli: "copilot",
};

/**
 * Returns all members of a provider group (the given provider and any of its
 * children) that are present in the given available provider list.
 * The given provider itself is included only when it appears in allProviders.
 */
export function getProviderWithChildren(provider: Provider, allProviders: Provider[]): Provider[] {
  return [provider, ...PROVIDER_VALUES.filter((p) => PROVIDER_GROUP_PARENT[p] === provider)].filter(
    (p) => allProviders.includes(p),
  );
}

/**
 * Returns the list of providers to render as filter chips.
 * Child providers are excluded when their parent is also in the list.
 */
export function getChipProviders(providers: Provider[]): Provider[] {
  const childProviders = new Set(Object.keys(PROVIDER_GROUP_PARENT) as Provider[]);
  return providers.filter((p) => {
    if (!childProviders.has(p)) return true;
    const parent = PROVIDER_GROUP_PARENT[p];
    return parent === undefined || !providers.includes(parent);
  });
}

/**
 * Toggles all providers in a group (parent + children) together.
 * If any associated provider is active, all are removed. Otherwise all are added.
 */
export function toggleGroupProviders(
  provider: Provider,
  current: Provider[],
  allProviders: Provider[],
): Provider[] {
  const associated = getProviderWithChildren(provider, allProviders);
  const anyActive = associated.some((p) => current.includes(p));
  if (anyActive) {
    return current.filter((p) => !associated.includes(p));
  }
  return [...current, ...associated.filter((p) => !current.includes(p))];
}
