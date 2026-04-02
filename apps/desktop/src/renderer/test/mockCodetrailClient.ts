import { vi } from "vitest";

import type { IpcChannel, IpcRequestInput, IpcResponse } from "@codetrail/core/browser";

import type { AppCommand } from "../../shared/appCommands";
import type { DesktopPlatform } from "../../shared/desktopPlatform";
import type { HistoryExportProgressPayload } from "../../shared/historyExport";
import type { CodetrailClient } from "../lib/codetrailClient";

type MockInvoke = <C extends IpcChannel>(
  channel: C,
  payload: IpcRequestInput<C>,
) => Promise<IpcResponse<C>>;

export type MockCodetrailClient = CodetrailClient & {
  invoke: ReturnType<typeof vi.fn<MockInvoke>>;
  onHistoryExportProgress: ReturnType<
    typeof vi.fn<(listener: (payload: HistoryExportProgressPayload) => void) => () => void>
  >;
  onAppCommand: ReturnType<typeof vi.fn<(listener: (command: AppCommand) => void) => () => void>>;
  onLiveStatusChanged: ReturnType<typeof vi.fn<(listener: () => void) => () => void>>;
};

export function createMockCodetrailClient(): MockCodetrailClient {
  const invoke = vi.fn<MockInvoke>(async () => {
    throw new Error("Mock codetrail client response not configured for this invocation.");
  });
  const onHistoryExportProgress = vi.fn<
    (listener: (payload: HistoryExportProgressPayload) => void) => () => void
  >(() => () => undefined);
  const onAppCommand = vi.fn<(listener: (command: AppCommand) => void) => () => void>(
    () => () => undefined,
  );
  const onLiveStatusChanged = vi.fn<(listener: () => void) => () => void>(() => () => undefined);

  return {
    platform: "darwin" satisfies DesktopPlatform,
    invoke,
    onHistoryExportProgress,
    onAppCommand,
    onLiveStatusChanged,
  };
}
