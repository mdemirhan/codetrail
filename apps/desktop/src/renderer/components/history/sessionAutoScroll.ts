type ScrollIntoViewTarget = {
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
};

export function scheduleSelectedSessionScroll(args: {
  selectedItemId: string;
  collapsed: boolean;
  selectedSessionElement: ScrollIntoViewTarget | null;
  scheduleAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
}): (() => void) | undefined {
  const { selectedItemId, collapsed, selectedSessionElement } = args;
  if (!selectedItemId || collapsed || !selectedSessionElement) {
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
