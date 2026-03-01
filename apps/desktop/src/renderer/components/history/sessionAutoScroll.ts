type ScrollIntoViewTarget = {
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
};

export function scheduleSelectedSessionScroll(args: {
  selectedSessionId: string;
  collapsed: boolean;
  selectedSessionElement: ScrollIntoViewTarget | null;
  scheduleAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
}): (() => void) | undefined {
  const { selectedSessionId, collapsed, selectedSessionElement } = args;
  if (!selectedSessionId || collapsed || !selectedSessionElement) {
    return undefined;
  }

  const scheduleAnimationFrame =
    args.scheduleAnimationFrame ?? window.requestAnimationFrame.bind(window);
  const cancelAnimationFrame =
    args.cancelAnimationFrame ?? window.cancelAnimationFrame.bind(window);

  const rafId = scheduleAnimationFrame(() => {
    selectedSessionElement.scrollIntoView({ block: "nearest" });
  });

  return () => {
    cancelAnimationFrame(rafId);
  };
}
