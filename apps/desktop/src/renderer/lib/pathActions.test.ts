import { describe, expect, it } from "vitest";

import { createMockCodetrailClient } from "../test/mockCodetrailClient";
import { openInFileManager, openPath } from "./pathActions";

describe("pathActions", () => {
  it("returns a clear error when no selected project exists", async () => {
    const client = createMockCodetrailClient();

    const result = await openInFileManager([{ id: "p1", path: "/workspace/p1" }], "p2", client);

    expect(result).toEqual({ ok: false, error: "No selected project." });
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it("opens selected project path through the codetrail client", async () => {
    const client = createMockCodetrailClient();
    client.invoke.mockResolvedValue({ ok: true, error: null });

    const result = await openInFileManager([{ id: "p1", path: "/workspace/p1" }], "p1", client);

    expect(result).toEqual({ ok: true, error: null });
    expect(client.invoke).toHaveBeenCalledWith("path:openInFileManager", { path: "/workspace/p1" });
  });

  it("returns a clear error when selected project has no location", async () => {
    const client = createMockCodetrailClient();

    const result = await openInFileManager([{ id: "p1", path: "   " }], "p1", client);

    expect(result).toEqual({ ok: false, error: "Selected project has no location." });
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it("normalizes failed open responses with fallback text", async () => {
    const client = createMockCodetrailClient();
    client.invoke.mockResolvedValue({ ok: false, error: null });

    const result = await openPath("/workspace/missing", client);

    expect(result).toEqual({ ok: false, error: "Failed to open /workspace/missing" });
  });

  it("returns a clear error when openPath receives an empty path", async () => {
    const client = createMockCodetrailClient();

    const result = await openPath("   ", client);

    expect(result).toEqual({ ok: false, error: "Path is empty." });
    expect(client.invoke).not.toHaveBeenCalled();
  });
});
