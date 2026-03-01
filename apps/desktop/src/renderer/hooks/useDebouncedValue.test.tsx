// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDebouncedValue } from "./useDebouncedValue";

function Harness({ value, delayMs }: { value: string; delayMs: number }) {
  const debounced = useDebouncedValue(value, delayMs);
  return <div data-testid="value">{debounced}</div>;
}

describe("useDebouncedValue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates only after the debounce duration", () => {
    vi.useFakeTimers();

    const view = render(<Harness value="first" delayMs={200} />);
    expect(screen.getByTestId("value").textContent).toBe("first");

    view.rerender(<Harness value="second" delayMs={200} />);
    expect(screen.getByTestId("value").textContent).toBe("first");

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(screen.getByTestId("value").textContent).toBe("first");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("value").textContent).toBe("second");
  });
});
