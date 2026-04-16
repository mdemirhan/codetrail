import { getConfigDiscoveryPath } from "../../discovery/shared";
import { buildOpenCodeSessionSourcePrefix, normalizeOpenCodeDatabasePath } from "./discovery";

import type { ProviderCleanupMissingSessionsArgs } from "../types";

export function cleanupMissingOpenCodeSessions(args: ProviderCleanupMissingSessionsArgs): number {
  const opencodeRoot = getConfigDiscoveryPath(args.discoveryConfig, "opencodeRoot");
  if (!opencodeRoot) {
    return 0;
  }

  let removedFiles = 0;
  const discoveredPathSet = new Set(args.discoveredFiles.map((file) => file.filePath));
  for (const changedPath of args.changedFilePaths) {
    const dbPath = normalizeOpenCodeDatabasePath(changedPath, opencodeRoot);
    if (!dbPath) {
      continue;
    }

    const indexedRows = args.listIndexedFilesByPrefix(
      `${buildOpenCodeSessionSourcePrefix(dbPath)}%`,
    );
    for (const indexedRow of indexedRows) {
      if (discoveredPathSet.has(indexedRow.filePath)) {
        continue;
      }
      if (!args.matchesProjectScope(indexedRow.provider, indexedRow.projectPath)) {
        continue;
      }
      if (
        args.enabledProviderSet.has(indexedRow.provider) &&
        !args.removeMissingSessionsDuringIncrementalIndexing
      ) {
        continue;
      }
      if (!args.hasSessionForFile(indexedRow.filePath)) {
        continue;
      }

      args.deleteSessionDataForFilePath(indexedRow.filePath);
      args.deleteIndexedFileByFilePath(indexedRow.filePath);
      args.deleteCheckpointByFilePath(indexedRow.filePath);
      removedFiles += 1;
    }
  }

  return removedFiles;
}
