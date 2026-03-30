import type { IpcChannel, IpcRequestInput, IpcResponse } from "@codetrail/core/browser";
import type { AppCommand } from "../shared/appCommands";
import type { CodetrailBridge } from "../shared/codetrailBridge";
import type { DesktopPlatform } from "../shared/desktopPlatform";
import type { HistoryExportProgressPayload } from "../shared/historyExport";

type LegacyCodetrailWindowClient = {
  platform?: DesktopPlatform;
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequestInput<C>): Promise<IpcResponse<C>>;
  onHistoryExportProgress(listener: (payload: HistoryExportProgressPayload) => void): () => void;
  onAppCommand(listener: (command: AppCommand) => void): () => void;
};

declare global {
  interface Window {
    codetrail: CodetrailBridge | LegacyCodetrailWindowClient;
  }
}
