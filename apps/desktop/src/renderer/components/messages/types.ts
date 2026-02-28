import type { IpcResponse } from "@codetrail/core";

export type SessionMessage = IpcResponse<"sessions:getDetail">["messages"][number];
