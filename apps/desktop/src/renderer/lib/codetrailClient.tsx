import { createContext, useContext, useRef } from "react";

import type { IpcChannel, IpcRequestInput, IpcResponse } from "@codetrail/core/browser";

import type { AppCommand } from "../../shared/appCommands";
import { type DesktopPlatform, normalizeDesktopPlatform } from "../../shared/desktopPlatform";
import type { HistoryExportProgressPayload } from "../../shared/historyExport";

export type CodetrailClient = {
  platform: DesktopPlatform;
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequestInput<C>): Promise<IpcResponse<C>>;
  onHistoryExportProgress(listener: (payload: HistoryExportProgressPayload) => void): () => void;
  onAppCommand(listener: (command: AppCommand) => void): () => void;
};

const MISSING_PRELOAD_ERROR =
  "Codetrail preload bridge is unavailable. Ensure the preload script exposed window.codetrail.";

const MISSING_CLIENT: CodetrailClient = {
  platform: "darwin",
  invoke: async () => {
    throw new Error(MISSING_PRELOAD_ERROR);
  },
  onHistoryExportProgress: () => () => undefined,
  onAppCommand: () => () => undefined,
};

function isCodetrailClient(value: unknown): value is CodetrailClient {
  return (
    typeof value === "object" &&
    value !== null &&
    "platform" in value &&
    typeof (value as { platform?: unknown }).platform === "string" &&
    "invoke" in value &&
    typeof (value as { invoke?: unknown }).invoke === "function" &&
    "onHistoryExportProgress" in value &&
    typeof (value as { onHistoryExportProgress?: unknown }).onHistoryExportProgress ===
      "function" &&
    "onAppCommand" in value &&
    typeof (value as { onAppCommand?: unknown }).onAppCommand === "function"
  );
}

function getDefaultClient(): CodetrailClient {
  if (typeof window === "undefined") {
    return MISSING_CLIENT;
  }
  try {
    const candidate = window.codetrail as unknown;
    return isCodetrailClient(candidate) ? candidate : MISSING_CLIENT;
  } catch (error) {
    console.error("[codetrail] failed reading preload bridge", error);
    return MISSING_CLIENT;
  }
}

export const CodetrailClientContext = createContext<CodetrailClient | null>(null);

export function CodetrailClientProvider({
  value,
  children,
}: {
  value: CodetrailClient;
  children: React.ReactNode;
}) {
  return (
    <CodetrailClientContext.Provider value={value}>{children}</CodetrailClientContext.Provider>
  );
}

export function useCodetrailClient(): CodetrailClient {
  const value = useContext(CodetrailClientContext);
  const fallbackRef = useRef<CodetrailClient | null>(null);
  if (value) {
    return value;
  }
  if (!fallbackRef.current) {
    fallbackRef.current = getDefaultClient();
  }
  return fallbackRef.current;
}

export function getCodetrailClient(): CodetrailClient {
  return getDefaultClient();
}

export function useDesktopPlatform(): DesktopPlatform {
  return useCodetrailClient().platform;
}

export function isMissingCodetrailClient(client: CodetrailClient): boolean {
  return client === MISSING_CLIENT;
}
