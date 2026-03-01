import type { ReactElement } from "react";

import { type RenderResult, render } from "@testing-library/react";

import { type CodetrailClient, CodetrailClientProvider } from "../lib/codetrailClient";

export function renderWithClient(element: ReactElement, client: CodetrailClient): RenderResult {
  return render(<CodetrailClientProvider value={client}>{element}</CodetrailClientProvider>);
}
