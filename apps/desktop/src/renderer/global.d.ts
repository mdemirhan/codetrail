import type { IpcChannel, IpcRequest, IpcResponse } from "@codetrail/core";

declare global {
  interface Window {
    codetrail: {
      invoke<C extends IpcChannel>(channel: C, payload: IpcRequest<C>): Promise<IpcResponse<C>>;
    };
  }
}
