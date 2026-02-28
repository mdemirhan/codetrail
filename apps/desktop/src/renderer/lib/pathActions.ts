type ProjectPathLike = {
  id: string;
  path: string;
};

export async function openInFileManager(
  projects: ProjectPathLike[],
  selectedProjectId: string,
): Promise<{ ok: boolean; error: string | null }> {
  const selected = projects.find((project) => project.id === selectedProjectId);
  if (!selected) {
    return { ok: false, error: "No selected project." };
  }
  return openPath(selected.path);
}

export async function openPath(path: string): Promise<{ ok: boolean; error: string | null }> {
  const result = await window.codetrail.invoke("path:openInFileManager", { path });
  return result.ok ? result : { ok: false, error: result.error ?? `Failed to open ${path}` };
}
