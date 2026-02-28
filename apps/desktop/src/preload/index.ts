import { contextBridge, ipcRenderer } from "electron";

import type { IpcChannel, IpcRequest, IpcResponse } from "@codetrail/core";

type InvokeApi = {
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequest<C>): Promise<IpcResponse<C>>;
};

const api: InvokeApi = {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
};

contextBridge.exposeInMainWorld("codetrail", api);
