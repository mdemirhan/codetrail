import { useCallback, useEffect, useState } from "react";

import type { IpcRequest } from "@codetrail/core";

import type {
  MonoFontFamily,
  MonoFontSize,
  RegularFontFamily,
  RegularFontSize,
  ThemeMode,
} from "../../shared/uiPreferences";
import { MONO_FONT_STACKS, REGULAR_FONT_STACKS } from "../app/constants";
import type { PaneStateSnapshot, SettingsInfoResponse } from "../app/types";
import { useCodetrailClient } from "../lib/codetrailClient";
import { toErrorMessage } from "../lib/viewUtils";

export function useAppearanceController({
  initialPaneState,
  logError,
}: {
  initialPaneState?: PaneStateSnapshot | null;
  logError: (context: string, error: unknown) => void;
}) {
  const codetrail = useCodetrailClient();
  const [theme, setTheme] = useState<ThemeMode>(initialPaneState?.theme ?? "light");
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
  const [useMonospaceForAllMessages, setUseMonospaceForAllMessages] = useState(
    initialPaneState?.useMonospaceForAllMessages ?? false,
  );
  const [zoomPercent, setZoomPercent] = useState(100);
  const [settingsInfo, setSettingsInfo] = useState<SettingsInfoResponse | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void codetrail
      .invoke("ui:getZoom", {})
      .then((response) => {
        if (!cancelled) {
          setZoomPercent(response.percent);
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
    document.documentElement.dataset.theme = theme;
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

  const applyZoomAction = useCallback(
    async (action: IpcRequest<"ui:setZoom">["action"]) => {
      try {
        const response = await codetrail.invoke("ui:setZoom", { action });
        setZoomPercent(response.percent);
      } catch (error) {
        logError(`Failed applying zoom action '${action}'`, error);
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
    monoFontFamily,
    setMonoFontFamily,
    regularFontFamily,
    setRegularFontFamily,
    monoFontSize,
    setMonoFontSize,
    regularFontSize,
    setRegularFontSize,
    useMonospaceForAllMessages,
    setUseMonospaceForAllMessages,
    zoomPercent,
    canZoomIn: zoomPercent < 500,
    canZoomOut: zoomPercent > 25,
    applyZoomAction,
    settingsInfo,
    settingsLoading,
    settingsError,
    loadSettingsInfo,
  };
}
