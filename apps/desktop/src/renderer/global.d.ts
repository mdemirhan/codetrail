import type { IpcChannel, IpcRequest, IpcResponse } from "@cch/core";

declare global {
  interface Window {
    cch: {
      invoke<C extends IpcChannel>(channel: C, payload: IpcRequest<C>): Promise<IpcResponse<C>>;
    };
  }
}
