import type { IpcMain, IpcMainInvokeEvent } from "electron";

import {
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  IpcValidationError,
  ipcChannels,
  ipcContractSchemas,
} from "@codetrail/core";

type IpcHandlerMap = {
  [K in IpcChannel]: (
    payload: IpcRequest<K>,
    event: IpcMainInvokeEvent,
  ) => Promise<IpcResponse<K>> | IpcResponse<K>;
};

export function registerIpcHandlers(
  ipcMain: Pick<IpcMain, "handle">,
  handlers: IpcHandlerMap,
): void {
  for (const channel of ipcChannels) {
    ipcMain.handle(channel, async (event, payload) => {
      const request = ipcContractSchemas[channel].request.safeParse(payload ?? {});
      if (!request.success) {
        throw new IpcValidationError(`Invalid payload for ${channel}: ${request.error.message}`);
      }

      const responsePayload = await handlers[channel](request.data as never, event);
      const response = ipcContractSchemas[channel].response.safeParse(responsePayload);

      if (!response.success) {
        throw new IpcValidationError(`Invalid response for ${channel}: ${response.error.message}`);
      }

      return response.data;
    });
  }
}
