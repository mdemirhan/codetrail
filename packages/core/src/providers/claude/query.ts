import type { ProviderResolveTurnFamilySessionIdsArgs } from "../types";

export function resolveClaudeTurnFamilySessionIds(
  args: ProviderResolveTurnFamilySessionIdsArgs,
): string[] {
  const sessionIds = new Set<string>([args.session.id]);
  const rootProviderSessionId =
    args.session.providerSessionId ?? args.session.sessionIdentity ?? args.session.id;
  const rootLineageIds = Array.from(
    new Set(
      [rootProviderSessionId, args.session.sessionIdentity].filter((value): value is string =>
        Boolean(value),
      ),
    ),
  );

  if (rootLineageIds.length > 0) {
    const lineageRows = args.db
      .prepare(
        `SELECT id
         FROM sessions
         WHERE project_id = ?
           AND lineage_parent_id IN (${rootLineageIds.map(() => "?").join(",")})`,
      )
      .all(args.projectId, ...rootLineageIds) as Array<{ id: string }>;
    for (const row of lineageRows) {
      sessionIds.add(row.id);
    }
  }

  const providerRows = args.db
    .prepare(
      `SELECT id, session_kind, file_path
       FROM sessions
       WHERE project_id = ?
         AND provider = 'claude'
         AND provider_session_id = ?`,
    )
    .all(args.projectId, rootProviderSessionId) as Array<{
    id: string;
    session_kind: string | null;
    file_path: string;
  }>;

  for (const row of providerRows) {
    if (
      row.id === args.session.id ||
      row.session_kind === "subagent" ||
      isClaudeSubagentTranscriptPath(row.file_path)
    ) {
      sessionIds.add(row.id);
    }
  }

  return [...sessionIds];
}

function isClaudeSubagentTranscriptPath(filePath: string): boolean {
  return filePath.replace(/\\/g, "/").includes("/subagents/");
}
