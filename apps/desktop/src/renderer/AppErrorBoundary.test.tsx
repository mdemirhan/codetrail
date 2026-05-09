// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppErrorBoundary } from "./AppErrorBoundary";

function CrashingChild(): ReactNode {
  throw new Error("render boom");
}

describe("AppErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children while no render error has occurred", () => {
    render(
      <AppErrorBoundary>
        <div>Healthy renderer</div>
      </AppErrorBoundary>,
    );

    expect(screen.getByText("Healthy renderer")).toBeInTheDocument();
  });

  it("shows a fallback and logs render-time errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <AppErrorBoundary>
        <CrashingChild />
      </AppErrorBoundary>,
    );

    expect(await screen.findByRole("heading", { name: "Renderer Error" })).toBeInTheDocument();
    expect(screen.getByText("Code Trail encountered a render-time error.")).toBeInTheDocument();
    expect(screen.getByText(/render boom/)).toBeInTheDocument();

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        "[codetrail] renderer crashed",
        expect.any(Error),
        expect.objectContaining({ componentStack: expect.any(String) }),
      );
    });
  });
});
