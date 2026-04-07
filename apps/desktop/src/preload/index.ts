import { contextBridge, ipcRenderer } from "electron";

import type { IpcChannel, IpcRequestInput, IpcResponse } from "@codetrail/core";

import { APP_COMMAND_CHANNEL, type AppCommand } from "../shared/appCommands";
import type { CodetrailBridge } from "../shared/codetrailBridge";
import { normalizeDesktopPlatform } from "../shared/desktopPlatform";
import {
  HISTORY_EXPORT_PROGRESS_CHANNEL,
  type HistoryExportProgressPayload,
} from "../shared/historyExport";
import { LIVE_STATUS_CHANGED_CHANNEL } from "../shared/liveStatusPush";

function invoke<C extends IpcChannel>(
  channel: C,
  payload: IpcRequestInput<C>,
): Promise<IpcResponse<C>> {
  return ipcRenderer.invoke(channel, payload);
}

const api: CodetrailBridge = {
  platform: normalizeDesktopPlatform(process.platform),
  appFlushState: (payload) => invoke("app:flushState", payload),
  appSetCommandState: (payload) => invoke("app:setCommandState", payload),
  appGetSettingsInfo: (payload) => invoke("app:getSettingsInfo", payload),
  dashboardGetStats: (payload) => invoke("dashboard:getStats", payload),
  bookmarksGetStates: (payload) => invoke("bookmarks:getStates", payload),
  bookmarksListProject: (payload) => invoke("bookmarks:listProject", payload),
  bookmarksToggle: (payload) => invoke("bookmarks:toggle", payload),
  claudeHooksInstall: (payload) => invoke("claudeHooks:install", payload),
  claudeHooksRemove: (payload) => invoke("claudeHooks:remove", payload),
  debugRecordLiveUiTrace: (payload) => invoke("debug:recordLiveUiTrace", payload),
  dialogPickExternalToolCommand: (payload) => invoke("dialog:pickExternalToolCommand", payload),
  editorListAvailable: (payload) => invoke("editor:listAvailable", payload),
  editorOpen: (payload) => invoke("editor:open", payload),
  historyExportMessages: (payload) => invoke("history:exportMessages", payload),
  indexerGetConfig: (payload) => invoke("indexer:getConfig", payload),
  indexerGetStatus: (payload) => invoke("indexer:getStatus", payload),
  indexerRefresh: (payload) => invoke("indexer:refresh", payload),
  indexerSetConfig: (payload) => invoke("indexer:setConfig", payload),
  pathOpenInFileManager: (payload) => invoke("path:openInFileManager", payload),
  projectsDelete: (payload) => invoke("projects:delete", payload),
  projectsGetCombinedDetail: (payload) => invoke("projects:getCombinedDetail", payload),
  projectsList: (payload) => invoke("projects:list", payload),
  searchQuery: (payload) => invoke("search:query", payload),
  sessionsDelete: (payload) => invoke("sessions:delete", payload),
  sessionsGetDetail: (payload) => invoke("sessions:getDetail", payload),
  sessionsGetTurn: (payload) => invoke("sessions:getTurn", payload),
  sessionsList: (payload) => invoke("sessions:list", payload),
  sessionsListMany: (payload) => invoke("sessions:listMany", payload),
  uiGetPaneState: (payload) => invoke("ui:getPaneState", payload),
  uiGetZoom: (payload) => invoke("ui:getZoom", payload),
  uiSetPaneState: (payload) => invoke("ui:setPaneState", payload),
  uiSetZoom: (payload) => invoke("ui:setZoom", payload),
  watcherGetLiveStatus: (payload) => invoke("watcher:getLiveStatus", payload),
  watcherGetStats: (payload) => invoke("watcher:getStats", payload),
  watcherGetStatus: (payload) => invoke("watcher:getStatus", payload),
  watcherStart: (payload) => invoke("watcher:start", payload),
  watcherStop: (payload) => invoke("watcher:stop", payload),
  onHistoryExportProgress: (listener) => {
    const handler = (_event: unknown, payload: HistoryExportProgressPayload) => {
      listener(payload);
    };
    ipcRenderer.on(HISTORY_EXPORT_PROGRESS_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(HISTORY_EXPORT_PROGRESS_CHANNEL, handler);
    };
  },
  onAppCommand: (listener) => {
    const handler = (_event: unknown, command: AppCommand) => {
      listener(command);
    };
    ipcRenderer.on(APP_COMMAND_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(APP_COMMAND_CHANNEL, handler);
    };
  },
  onLiveStatusChanged: (listener) => {
    const handler = () => {
      listener();
    };
    ipcRenderer.on(LIVE_STATUS_CHANGED_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(LIVE_STATUS_CHANGED_CHANNEL, handler);
    };
  },
};

contextBridge.exposeInMainWorld("codetrail", api);
