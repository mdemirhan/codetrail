import { describe, expect, it } from "vitest";

import { ipcContractSchemas } from "./ipc";

describe("ipc contracts", () => {
  it("accepts valid health response", () => {
    const parsed = ipcContractSchemas["app:getHealth"].response.safeParse({
      status: "ok",
      version: "0.1.0",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects invalid refresh request", () => {
    const parsed = ipcContractSchemas["indexer:refresh"].request.safeParse({
      force: "yes",
    });

    expect(parsed.success).toBe(false);
  });
});
