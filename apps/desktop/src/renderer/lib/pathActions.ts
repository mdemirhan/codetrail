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
  if (selected.path.trim().length === 0) {
    return { ok: false, error: "Selected project has no location." };
  }
  return openPath(selected.path, client);
}

export async function openPath(
  path: string,
  client: CodetrailClient = getCodetrailClient(),
): Promise<{ ok: boolean; error: string | null }> {
  if (path.trim().length === 0) {
    return { ok: false, error: "Path is empty." };
  }
  const result = await client.invoke("path:openInFileManager", { path });
  return result.ok ? result : { ok: false, error: result.error ?? `Failed to open ${path}` };
}
