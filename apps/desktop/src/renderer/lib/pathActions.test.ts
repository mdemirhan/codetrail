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

  it("normalizes failed open responses with fallback text", async () => {
    const client = createMockCodetrailClient();
    client.invoke.mockResolvedValue({ ok: false, error: null });

    const result = await openPath("/workspace/missing", client);

    expect(result).toEqual({ ok: false, error: "Failed to open /workspace/missing" });
  });
});
