import type { IpcResponse } from "@cch/core";

export type SessionMessage = IpcResponse<"sessions:getDetail">["messages"][number];
