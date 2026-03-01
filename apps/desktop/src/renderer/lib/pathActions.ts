import { type CodetrailClient, getCodetrailClient } from "./codetrailClient";

type ProjectPathLike = {
  id: string;
  path: string;
};

export async function openInFileManager(
  projects: ProjectPathLike[],
  selectedProjectId: string,
  client: CodetrailClient = getCodetrailClient(),
): Promise<{ ok: boolean; error: string | null }> {
  const selected = projects.find((project) => project.id === selectedProjectId);
  if (!selected) {
    return { ok: false, error: "No selected project." };
  }
  return openPath(selected.path, client);
}

export async function openPath(
  path: string,
  client: CodetrailClient = getCodetrailClient(),
): Promise<{ ok: boolean; error: string | null }> {
  const result = await client.invoke("path:openInFileManager", { path });
  return result.ok ? result : { ok: false, error: result.error ?? `Failed to open ${path}` };
}
