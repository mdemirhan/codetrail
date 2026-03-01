import { createContext, useContext, useRef } from "react";

import type { IpcChannel, IpcRequest, IpcResponse } from "@codetrail/core";

export type CodetrailClient = {
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequest<C>): Promise<IpcResponse<C>>;
};

const MISSING_PRELOAD_ERROR =
  "Codetrail preload bridge is unavailable. Ensure the preload script exposed window.codetrail.";

const MISSING_CLIENT: CodetrailClient = {
  invoke: async () => {
    throw new Error(MISSING_PRELOAD_ERROR);
  },
};

function isCodetrailClient(value: unknown): value is CodetrailClient {
  return (
    typeof value === "object" &&
    value !== null &&
    "invoke" in value &&
    typeof (value as { invoke?: unknown }).invoke === "function"
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

export function isMissingCodetrailClient(client: CodetrailClient): boolean {
  return client === MISSING_CLIENT;
}
