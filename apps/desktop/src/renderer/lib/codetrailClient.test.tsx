// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  type CodetrailClient,
  CodetrailClientProvider,
  getCodetrailClient,
  useCodetrailClient,
} from "./codetrailClient";

describe("codetrailClient", () => {
  it("prefers provider value over window fallback", async () => {
    const providedClient: CodetrailClient = {
      invoke: vi.fn(async () => ({ ok: true }) as never),
    };

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CodetrailClientProvider value={providedClient}>{children}</CodetrailClientProvider>
    );

    const { result } = renderHook(() => useCodetrailClient(), { wrapper });
    expect(result.current).toBe(providedClient);
  });

  it("keeps fallback client stable across rerenders", () => {
    Object.defineProperty(window, "codetrail", {
      configurable: true,
      get: () => ({
        invoke: vi.fn(async () => ({ ok: true }) as never),
      }),
    });

    const { result, rerender } = renderHook(() => useCodetrailClient());
    const first = result.current;

    rerender();
    expect(result.current).toBe(first);
  });

  it("returns a descriptive error when preload bridge is unavailable", async () => {
    Object.defineProperty(window, "codetrail", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const client = getCodetrailClient();
    await expect(client.invoke("projects:list", { providers: [], query: "" })).rejects.toThrow(
      "Codetrail preload bridge is unavailable",
    );
  });

  it("falls back safely when codetrail getter throws", async () => {
    Object.defineProperty(window, "codetrail", {
      configurable: true,
      get: () => {
        throw new Error("bridge read failure");
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const client = getCodetrailClient();
      await expect(client.invoke("projects:list", { providers: [], query: "" })).rejects.toThrow(
        "Codetrail preload bridge is unavailable",
      );
      expect(errorSpy).toHaveBeenCalledWith(
        "[codetrail] failed reading preload bridge",
        expect.any(Error),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
