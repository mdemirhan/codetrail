// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useResizablePanes } from "./useResizablePanes";

function Harness({ isHistoryLayout }: { isHistoryLayout: boolean }) {
  const panes = useResizablePanes({
    isHistoryLayout,
    projectMin: 230,
    projectMax: 520,
    sessionMin: 250,
    sessionMax: 620,
    initialProjectPaneWidth: 300,
    initialSessionPaneWidth: 320,
  });

  return (
    <div>
      <div data-testid="project-width">{panes.projectPaneWidth}</div>
      <div data-testid="session-width">{panes.sessionPaneWidth}</div>
      <div data-testid="project-handle" onPointerDown={panes.beginResize("project")} />
      <div data-testid="session-handle" onPointerDown={panes.beginResize("session")} />
    </div>
  );
}

describe("useResizablePanes", () => {
  afterEach(() => {
    document.body.classList.remove("resizing-panels");
  });

  it("resizes project and session panes within configured bounds", () => {
    if (!window.PointerEvent) {
      Object.defineProperty(window, "PointerEvent", {
        value: MouseEvent,
        configurable: true,
      });
    }

    render(<Harness isHistoryLayout={true} />);

    act(() => {
      fireEvent.pointerDown(screen.getByTestId("project-handle"), { clientX: 100 });
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 200 }));
    });
    expect(screen.getByTestId("project-width").textContent).toBe("400");
    expect(document.body.classList.contains("resizing-panels")).toBe(true);

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerup"));
    });
    expect(document.body.classList.contains("resizing-panels")).toBe(false);

    act(() => {
      fireEvent.pointerDown(screen.getByTestId("session-handle"), { clientX: 250 });
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 600 }));
    });
    expect(screen.getByTestId("session-width").textContent).toBe("620");
  });

  it("ignores pointer down events outside history layout", () => {
    if (!window.PointerEvent) {
      Object.defineProperty(window, "PointerEvent", {
        value: MouseEvent,
        configurable: true,
      });
    }

    render(<Harness isHistoryLayout={false} />);

    act(() => {
      fireEvent.pointerDown(screen.getByTestId("project-handle"), { clientX: 100 });
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 420 }));
    });

    expect(screen.getByTestId("project-width").textContent).toBe("300");
    expect(document.body.classList.contains("resizing-panels")).toBe(false);
  });
});
