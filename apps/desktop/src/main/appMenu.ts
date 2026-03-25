import type { MenuItemConstructorOptions } from "electron";

import type { AppCommand } from "../shared/appCommands";
import type { DesktopPlatform } from "../shared/desktopPlatform";

type BuildAppMenuTemplateOptions = {
  appName: string;
  platform: DesktopPlatform;
  isDevelopment: boolean;
  dispatchAppCommand: (command: AppCommand) => void;
  reloadFocusedWindow: () => void;
  forceReloadFocusedWindow: () => void;
  toggleFocusedWindowDevTools: () => void;
};

function createSeparatorItem(): MenuItemConstructorOptions {
  return { type: "separator" };
}

function createRoleMenuItem(
  role: NonNullable<MenuItemConstructorOptions["role"]>,
): MenuItemConstructorOptions {
  return { role };
}

function createCommandMenuItem(
  label: string,
  accelerator: string,
  command: AppCommand,
  dispatchAppCommand: (command: AppCommand) => void,
): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    registerAccelerator: false,
    click: () => {
      dispatchAppCommand(command);
    },
  };
}

export function buildAppMenuTemplate({
  appName,
  platform,
  isDevelopment,
  dispatchAppCommand,
  reloadFocusedWindow,
  forceReloadFocusedWindow,
  toggleFocusedWindowDevTools,
}: BuildAppMenuTemplateOptions): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [
    ...(platform === "darwin"
      ? [
          {
            label: appName,
            submenu: [
              createCommandMenuItem(
                "Settings…",
                "CommandOrControl+,",
                "open-settings",
                dispatchAppCommand,
              ),
              createSeparatorItem(),
              createRoleMenuItem("services"),
              createSeparatorItem(),
              createRoleMenuItem("hide"),
              createRoleMenuItem("hideOthers"),
              createRoleMenuItem("unhide"),
              createSeparatorItem(),
              createRoleMenuItem("quit"),
            ],
          },
        ]
      : [
          {
            label: "File",
            submenu: [
              createCommandMenuItem(
                "Settings…",
                "CommandOrControl+,",
                "open-settings",
                dispatchAppCommand,
              ),
              createSeparatorItem(),
              createRoleMenuItem("quit"),
            ],
          },
        ]),
    {
      role: "editMenu",
      submenu: [
        createRoleMenuItem("undo"),
        createRoleMenuItem("redo"),
        createSeparatorItem(),
        createRoleMenuItem("cut"),
        createRoleMenuItem("copy"),
        createRoleMenuItem("paste"),
        createRoleMenuItem("selectAll"),
        createSeparatorItem(),
        createCommandMenuItem(
          "Search Current View",
          "CommandOrControl+F",
          "search-current-view",
          dispatchAppCommand,
        ),
        createCommandMenuItem(
          "Global Search",
          "CommandOrControl+Shift+F",
          "open-global-search",
          dispatchAppCommand,
        ),
      ],
    },
    {
      label: "View",
      submenu: [
        createCommandMenuItem(
          "Refresh Now",
          "CommandOrControl+R",
          "refresh-now",
          dispatchAppCommand,
        ),
        createCommandMenuItem(
          "Toggle Auto-Refresh",
          "CommandOrControl+Shift+R",
          "toggle-auto-refresh",
          dispatchAppCommand,
        ),
        createSeparatorItem(),
        createCommandMenuItem("Zoom In", "CommandOrControl+=", "zoom-in", dispatchAppCommand),
        createCommandMenuItem("Zoom Out", "CommandOrControl+-", "zoom-out", dispatchAppCommand),
        createCommandMenuItem(
          "Actual Size",
          "CommandOrControl+0",
          "zoom-reset",
          dispatchAppCommand,
        ),
        createSeparatorItem(),
        createCommandMenuItem(
          "Toggle Projects Pane",
          "CommandOrControl+B",
          "toggle-project-pane",
          dispatchAppCommand,
        ),
        createCommandMenuItem(
          "Toggle Sessions Pane",
          "CommandOrControl+Shift+B",
          "toggle-session-pane",
          dispatchAppCommand,
        ),
        createCommandMenuItem(
          "Toggle Focus Mode",
          "CommandOrControl+Shift+M",
          "toggle-focus-mode",
          dispatchAppCommand,
        ),
        createCommandMenuItem(
          "Expand or Collapse All Messages",
          "CommandOrControl+E",
          "toggle-all-messages-expanded",
          dispatchAppCommand,
        ),
        createSeparatorItem(),
        createRoleMenuItem("togglefullscreen"),
      ],
    },
    {
      role: "windowMenu",
      submenu:
        platform === "darwin"
          ? [
              createRoleMenuItem("minimize"),
              createRoleMenuItem("zoom"),
              createRoleMenuItem("front"),
            ]
          : [createRoleMenuItem("minimize"), createRoleMenuItem("close")],
    },
    {
      label: "Help",
      submenu: [
        {
          label: `${appName} Help`,
          accelerator: "Shift+/",
          registerAccelerator: false,
          click: () => {
            dispatchAppCommand("open-help");
          },
        },
      ],
    },
  ];

  if (isDevelopment) {
    template.push({
      label: "Developer",
      submenu: [
        {
          label: "Reload",
          click: () => {
            reloadFocusedWindow();
          },
        },
        {
          label: "Force Reload",
          click: () => {
            forceReloadFocusedWindow();
          },
        },
        {
          label: "Toggle Developer Tools",
          click: () => {
            toggleFocusedWindowDevTools();
          },
        },
      ],
    });
  }

  return template;
}
