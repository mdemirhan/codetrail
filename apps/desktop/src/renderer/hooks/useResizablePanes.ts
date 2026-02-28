import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { clamp } from "../lib/viewUtils";

type Pane = "project" | "session";

export function useResizablePanes(args: {
  isHistoryLayout: boolean;
  projectMin: number;
  projectMax: number;
  sessionMin: number;
  sessionMax: number;
  initialProjectPaneWidth?: number;
  initialSessionPaneWidth?: number;
}) {
  const {
    isHistoryLayout,
    projectMin,
    projectMax,
    sessionMin,
    sessionMax,
    initialProjectPaneWidth = 300,
    initialSessionPaneWidth = 320,
  } = args;
  const [projectPaneWidth, setProjectPaneWidth] = useState(initialProjectPaneWidth);
  const [sessionPaneWidth, setSessionPaneWidth] = useState(initialSessionPaneWidth);
  const resizeState = useRef<{
    pane: Pane;
    startX: number;
    projectPaneWidth: number;
    sessionPaneWidth: number;
  } | null>(null);

  const beginResize = useCallback(
    (pane: Pane) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isHistoryLayout) {
        return;
      }
      event.preventDefault();
      resizeState.current = {
        pane,
        startX: event.clientX,
        projectPaneWidth,
        sessionPaneWidth,
      };
      document.body.classList.add("resizing-panels");
    },
    [isHistoryLayout, projectPaneWidth, sessionPaneWidth],
  );

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const active = resizeState.current;
      if (!active) {
        return;
      }

      const delta = event.clientX - active.startX;
      if (active.pane === "project") {
        setProjectPaneWidth(clamp(active.projectPaneWidth + delta, projectMin, projectMax));
        return;
      }

      setSessionPaneWidth(clamp(active.sessionPaneWidth + delta, sessionMin, sessionMax));
    };

    const onPointerUp = () => {
      resizeState.current = null;
      document.body.classList.remove("resizing-panels");
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [projectMax, projectMin, sessionMax, sessionMin]);

  return {
    projectPaneWidth,
    setProjectPaneWidth,
    sessionPaneWidth,
    setSessionPaneWidth,
    beginResize,
  };
}
