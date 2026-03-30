import { type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { IpcResponse } from "@codetrail/core/browser";

import type {
  DiffViewMode,
  ExternalEditorId,
  ExternalToolConfig,
  MessagePageSize,
  MonoFontFamily,
  MonoFontSize,
  RegularFontFamily,
  RegularFontSize,
  ShikiThemeId,
  ThemeMode,
  ViewerWrapMode,
} from "../../shared/uiPreferences";
import {
  getPreferredExternalToolId,
  getThemeFamily,
  resolveShikiThemeForFamily,
  resolveShikiThemeForUiTheme,
} from "../../shared/uiPreferences";
import { MONO_FONT_STACKS, REGULAR_FONT_STACKS } from "../app/constants";
import type { PaneStateSnapshot, SettingsInfoResponse } from "../app/types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useCodetrailClient } from "../lib/codetrailClient";
import { useExternalToolPolicy } from "../lib/externalToolPolicy";
import { applyDocumentAppearance } from "../lib/theme";
import { toErrorMessage } from "../lib/viewUtils";
import {
  DEFAULT_ZOOM_PERCENT,
  MAX_ZOOM_PERCENT,
  MIN_ZOOM_PERCENT,
  clampZoomPercent,
} from "../lib/zoom";

function pickPreferredExternalApp(
  apps:
    | Array<
        | IpcResponse<"editor:listAvailable">["editors"][number]
        | IpcResponse<"editor:listAvailable">["diffTools"][number]
      >
    | null
    | undefined,
  role: "editor" | "diff",
): ExternalEditorId | null {
  if (!Array.isArray(apps) || apps.length === 0) {
    return null;
  }
  return (
    apps.find(
      (app) =>
        app.detected && (role === "diff" ? app.capabilities.openDiff : app.capabilities.openFile),
    )?.id ?? null
  );
}

export function useAppearanceController({
  initialPaneState,
  logError,
}: {
  initialPaneState?: PaneStateSnapshot | null;
  logError: (context: string, error: unknown) => void;
}) {
  const codetrail = useCodetrailClient();
  const { defaultExternalTools } = useExternalToolPolicy();
  const initialTheme = initialPaneState?.theme ?? "dark";
  const [theme, setThemeState] = useState<ThemeMode>(initialTheme);
  const [darkShikiTheme, setDarkShikiTheme] = useState<ShikiThemeId>(
    resolveShikiThemeForFamily("dark", initialPaneState?.darkShikiTheme),
  );
  const [lightShikiTheme, setLightShikiTheme] = useState<ShikiThemeId>(
    resolveShikiThemeForFamily("light", initialPaneState?.lightShikiTheme),
  );
  const [monoFontFamily, setMonoFontFamily] = useState<MonoFontFamily>(
    initialPaneState?.monoFontFamily ?? "droid_sans_mono",
  );
  const [regularFontFamily, setRegularFontFamily] = useState<RegularFontFamily>(
    initialPaneState?.regularFontFamily ?? "inter",
  );
  const [monoFontSize, setMonoFontSize] = useState<MonoFontSize>(
    initialPaneState?.monoFontSize ?? "13px",
  );
  const [regularFontSize, setRegularFontSize] = useState<RegularFontSize>(
    initialPaneState?.regularFontSize ?? "14px",
  );
  const [messagePageSize, setMessagePageSize] = useState<MessagePageSize>(
    initialPaneState?.messagePageSize ?? 50,
  );
  const [useMonospaceForAllMessages, setUseMonospaceForAllMessages] = useState(
    initialPaneState?.useMonospaceForAllMessages ?? false,
  );
  const [autoHideMessageActions, setAutoHideMessageActions] = useState(
    initialPaneState?.autoHideMessageActions ?? true,
  );
  const [autoHideViewerHeaderActions, setAutoHideViewerHeaderActions] = useState(
    initialPaneState?.autoHideViewerHeaderActions ?? false,
  );
  const [defaultViewerWrapMode, setDefaultViewerWrapMode] = useState<ViewerWrapMode>(
    initialPaneState?.defaultViewerWrapMode ?? "nowrap",
  );
  const [defaultDiffViewMode, setDefaultDiffViewMode] = useState<DiffViewMode>(
    initialPaneState?.defaultDiffViewMode ?? "unified",
  );
  const [externalTools, setExternalTools] = useState<ExternalToolConfig[]>(
    initialPaneState?.externalTools ?? defaultExternalTools,
  );
  const [preferredExternalEditor, setPreferredExternalEditor] = useState<ExternalEditorId>(
    initialPaneState?.preferredExternalEditor ??
      getPreferredExternalToolId(
        initialPaneState?.externalTools ?? defaultExternalTools,
        null,
        "editor",
      ),
  );
  const [preferredExternalDiffTool, setPreferredExternalDiffTool] = useState<ExternalEditorId>(
    initialPaneState?.preferredExternalDiffTool ??
      getPreferredExternalToolId(
        initialPaneState?.externalTools ?? defaultExternalTools,
        null,
        "diff",
      ),
  );
  const debouncedExternalTools = useDebouncedValue(externalTools, 200);
  const [terminalAppCommand, setTerminalAppCommand] = useState(
    initialPaneState?.terminalAppCommand ?? "",
  );
  const [availableEditors, setAvailableEditors] = useState<
    Array<IpcResponse<"editor:listAvailable">["editors"][number]>
  >([]);
  const [availableDiffTools, setAvailableDiffTools] = useState<
    Array<IpcResponse<"editor:listAvailable">["diffTools"][number]>
  >([]);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [settingsInfo, setSettingsInfo] = useState<SettingsInfoResponse | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const hasAutoSelectedPreferredEditorRef = useRef(false);
  const hasAutoSelectedPreferredDiffToolRef = useRef(false);
  const externalToolsRequestRef = useRef(0);

  const shikiTheme = resolveShikiThemeForUiTheme(theme, darkShikiTheme, lightShikiTheme);
  const applyCommittedAppearance = useCallback(
    (nextTheme: ThemeMode, nextShikiTheme: ShikiThemeId) => {
      applyDocumentAppearance(nextTheme, nextShikiTheme);
    },
    [],
  );

  const setTheme = useCallback((value: SetStateAction<ThemeMode>) => {
    setThemeState((currentTheme) => (typeof value === "function" ? value(currentTheme) : value));
  }, []);

  const setShikiTheme = useCallback(
    (value: SetStateAction<ShikiThemeId>) => {
      const family = getThemeFamily(theme);
      if (family === "dark") {
        setDarkShikiTheme((current) => (typeof value === "function" ? value(current) : value));
        return;
      }
      setLightShikiTheme((current) => (typeof value === "function" ? value(current) : value));
    },
    [theme],
  );

  const loadAvailableExternalTools = useCallback(async () => {
    const requestId = externalToolsRequestRef.current + 1;
    externalToolsRequestRef.current = requestId;
    const response = await codetrail.invoke("editor:listAvailable", {
      externalTools: debouncedExternalTools,
    });
    return {
      requestId,
      editors: Array.isArray(response.editors) ? response.editors : [],
      diffTools: Array.isArray(response.diffTools) ? response.diffTools : [],
    };
  }, [codetrail, debouncedExternalTools]);

  useEffect(() => {
    let cancelled = false;
    void loadAvailableExternalTools()
      .then((response) => {
        if (cancelled || response.requestId !== externalToolsRequestRef.current) {
          return;
        }
        setAvailableEditors(response.editors);
        setAvailableDiffTools(response.diffTools);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          logError("Failed loading available editors", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadAvailableExternalTools, logError]);

  useEffect(() => {
    if (initialPaneState?.preferredExternalEditor == null && availableEditors.length > 0) {
      const preferred = pickPreferredExternalApp(availableEditors, "editor");
      if (
        preferred &&
        !hasAutoSelectedPreferredEditorRef.current &&
        preferred !== preferredExternalEditor
      ) {
        hasAutoSelectedPreferredEditorRef.current = true;
        setPreferredExternalEditor(preferred);
      }
    }

    if (initialPaneState?.preferredExternalDiffTool == null && availableDiffTools.length > 0) {
      const preferred = pickPreferredExternalApp(availableDiffTools, "diff");
      if (
        preferred &&
        !hasAutoSelectedPreferredDiffToolRef.current &&
        preferred !== preferredExternalDiffTool
      ) {
        hasAutoSelectedPreferredDiffToolRef.current = true;
        setPreferredExternalDiffTool(preferred);
      }
    }
  }, [
    availableEditors,
    availableDiffTools,
    initialPaneState?.preferredExternalDiffTool,
    initialPaneState?.preferredExternalEditor,
    preferredExternalDiffTool,
    preferredExternalEditor,
  ]);

  useEffect(() => {
    let cancelled = false;
    void codetrail
      .invoke("ui:getZoom", {})
      .then((response) => {
        if (!cancelled) {
          setZoomPercent(clampZoomPercent(response.percent));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          logError("Failed loading zoom state", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [codetrail, logError]);

  useEffect(() => {
    applyCommittedAppearance(theme, shikiTheme);
  }, [applyCommittedAppearance, shikiTheme, theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem("codetrail-theme", theme);
    } catch {
      // Ignore storage errors when persisting the last selected theme.
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-mono", MONO_FONT_STACKS[monoFontFamily]);
  }, [monoFontFamily]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--font-sans",
      REGULAR_FONT_STACKS[regularFontFamily],
    );
  }, [regularFontFamily]);

  useEffect(() => {
    document.documentElement.style.setProperty("--message-mono-font-size", monoFontSize);
  }, [monoFontSize]);

  useEffect(() => {
    document.documentElement.style.setProperty("--message-font-size", regularFontSize);
  }, [regularFontSize]);

  useEffect(() => {
    document.documentElement.dataset.useMonospaceMessages = useMonospaceForAllMessages
      ? "true"
      : "false";
  }, [useMonospaceForAllMessages]);

  useEffect(() => {
    document.documentElement.dataset.autoHideMessageActions = autoHideMessageActions
      ? "true"
      : "false";
  }, [autoHideMessageActions]);

  useEffect(() => {
    document.documentElement.dataset.autoHideViewerHeaderActions = autoHideViewerHeaderActions
      ? "true"
      : "false";
  }, [autoHideViewerHeaderActions]);

  useEffect(() => {
    document.documentElement.dataset.defaultViewerWrapMode = defaultViewerWrapMode;
  }, [defaultViewerWrapMode]);

  useEffect(() => {
    document.documentElement.dataset.defaultDiffViewMode = defaultDiffViewMode;
  }, [defaultDiffViewMode]);

  const previewTheme = useCallback(
    (nextTheme: ThemeMode) => {
      applyDocumentAppearance(
        nextTheme,
        resolveShikiThemeForUiTheme(nextTheme, darkShikiTheme, lightShikiTheme),
      );
    },
    [darkShikiTheme, lightShikiTheme],
  );

  const previewShikiTheme = useCallback(
    (nextShikiTheme: ShikiThemeId) => {
      applyDocumentAppearance(theme, nextShikiTheme);
    },
    [theme],
  );

  const clearPreviewTheme = useCallback(() => {
    applyCommittedAppearance(theme, shikiTheme);
  }, [applyCommittedAppearance, shikiTheme, theme]);

  const clearPreviewShikiTheme = useCallback(() => {
    applyCommittedAppearance(theme, shikiTheme);
  }, [applyCommittedAppearance, shikiTheme, theme]);

  const applyZoomAction = useCallback(
    async (action: "in" | "out" | "reset") => {
      try {
        const response = await codetrail.invoke("ui:setZoom", { action });
        setZoomPercent(clampZoomPercent(response.percent));
      } catch (error) {
        logError(`Failed applying zoom action '${action}'`, error);
      }
    },
    [codetrail, logError],
  );

  const setZoomPercentValue = useCallback(
    async (percent: number) => {
      const clampedPercent = clampZoomPercent(percent);
      try {
        const response = await codetrail.invoke("ui:setZoom", { percent: clampedPercent });
        setZoomPercent(clampZoomPercent(response.percent));
      } catch (error) {
        logError(`Failed setting zoom to ${clampedPercent}%`, error);
      }
    },
    [codetrail, logError],
  );

  const loadSettingsInfo = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const response = await codetrail.invoke("app:getSettingsInfo", {});
      setSettingsInfo(response);
    } catch (error) {
      setSettingsError(toErrorMessage(error));
    } finally {
      setSettingsLoading(false);
    }
  }, [codetrail]);

  return {
    theme,
    setTheme,
    darkShikiTheme,
    setDarkShikiTheme,
    lightShikiTheme,
    setLightShikiTheme,
    shikiTheme,
    setShikiTheme,
    previewTheme,
    clearPreviewTheme,
    previewShikiTheme,
    clearPreviewShikiTheme,
    monoFontFamily,
    setMonoFontFamily,
    regularFontFamily,
    setRegularFontFamily,
    monoFontSize,
    setMonoFontSize,
    regularFontSize,
    setRegularFontSize,
    messagePageSize,
    setMessagePageSize,
    useMonospaceForAllMessages,
    setUseMonospaceForAllMessages,
    autoHideMessageActions,
    setAutoHideMessageActions,
    autoHideViewerHeaderActions,
    setAutoHideViewerHeaderActions,
    defaultViewerWrapMode,
    setDefaultViewerWrapMode,
    defaultDiffViewMode,
    setDefaultDiffViewMode,
    preferredExternalEditor,
    setPreferredExternalEditor,
    preferredExternalDiffTool,
    setPreferredExternalDiffTool,
    terminalAppCommand,
    setTerminalAppCommand,
    externalTools,
    setExternalTools,
    availableEditors,
    availableDiffTools,
    zoomPercent,
    canZoomIn: zoomPercent < MAX_ZOOM_PERCENT,
    canZoomOut: zoomPercent > MIN_ZOOM_PERCENT,
    applyZoomAction,
    setZoomPercent: setZoomPercentValue,
    defaultZoomPercent: DEFAULT_ZOOM_PERCENT,
    settingsInfo,
    settingsLoading,
    settingsError,
    loadSettingsInfo,
    loadAvailableExternalTools,
  };
}
