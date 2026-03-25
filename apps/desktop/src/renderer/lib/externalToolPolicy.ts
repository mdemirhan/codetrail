import { useMemo } from "react";

import { isMacPlatform } from "../../shared/desktopPlatform";
import { createDefaultExternalTools, getExternalAppOptions } from "../../shared/uiPreferences";
import { useDesktopPlatform } from "./codetrailClient";

export function useExternalToolPolicy() {
  const desktopPlatform = useDesktopPlatform();
  return useMemo(
    () => ({
      defaultExternalTools: createDefaultExternalTools(desktopPlatform),
      externalAppOptions: getExternalAppOptions(desktopPlatform),
      terminalAppSetting: isMacPlatform(desktopPlatform)
        ? {
            visible: true,
            label: "Terminal app (macOS)",
            placeholder: "Terminal or /Applications/iTerm.app",
            browseContext: "Choose terminal app",
            hint: "Used when launching terminal-based tools like Neovim on macOS. Leave empty to use Terminal.",
          }
        : {
            visible: false,
            label: "",
            placeholder: "",
            browseContext: "",
            hint: "",
          },
    }),
    [desktopPlatform],
  );
}
