import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { PaneFocusProvider, useCreatePaneFocusController } from "../lib/paneFocusController";
import { ViewerExternalAppsTestProvider } from "./viewerExternalApps";

export function renderWithPaneFocus(element: ReactElement) {
  function Wrapper({ children }: { children: ReactNode }) {
    const controller = useCreatePaneFocusController();
    return (
      <ViewerExternalAppsTestProvider>
        <PaneFocusProvider controller={controller}>{children}</PaneFocusProvider>
      </ViewerExternalAppsTestProvider>
    );
  }

  return render(element, { wrapper: Wrapper });
}
