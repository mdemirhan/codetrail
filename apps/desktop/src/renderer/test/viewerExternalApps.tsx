import type { ReactNode } from "react";

import {
  ViewerExternalAppsProvider,
  type ViewerExternalAppsSnapshot,
} from "../lib/viewerExternalAppsContext";

export const emptyViewerExternalAppsSnapshot: ViewerExternalAppsSnapshot = {
  editors: [],
  diffTools: [],
  preferences: {
    preferredExternalEditor: null,
    preferredExternalDiffTool: null,
    terminalAppCommand: "",
    orderedToolIds: [],
    externalTools: [],
  },
};

export function ViewerExternalAppsTestProvider({ children }: { children: ReactNode }) {
  return (
    <ViewerExternalAppsProvider value={emptyViewerExternalAppsSnapshot}>
      {children}
    </ViewerExternalAppsProvider>
  );
}
