import type { IpcRequestInput, IpcResponse } from "@codetrail/core/browser";

import type { AppCommand } from "./appCommands";
import type { DesktopPlatform } from "./desktopPlatform";
import type { HistoryExportProgressPayload } from "./historyExport";

export type CodetrailBridge = {
  platform: DesktopPlatform;
  appFlushState(payload: IpcRequestInput<"app:flushState">): Promise<IpcResponse<"app:flushState">>;
  appSetCommandState(
    payload: IpcRequestInput<"app:setCommandState">,
  ): Promise<IpcResponse<"app:setCommandState">>;
  appGetSettingsInfo(
    payload: IpcRequestInput<"app:getSettingsInfo">,
  ): Promise<IpcResponse<"app:getSettingsInfo">>;
  dashboardGetStats(
    payload: IpcRequestInput<"dashboard:getStats">,
  ): Promise<IpcResponse<"dashboard:getStats">>;
  bookmarksGetStates(
    payload: IpcRequestInput<"bookmarks:getStates">,
  ): Promise<IpcResponse<"bookmarks:getStates">>;
  bookmarksListProject(
    payload: IpcRequestInput<"bookmarks:listProject">,
  ): Promise<IpcResponse<"bookmarks:listProject">>;
  bookmarksToggle(
    payload: IpcRequestInput<"bookmarks:toggle">,
  ): Promise<IpcResponse<"bookmarks:toggle">>;
  claudeHooksInstall(
    payload: IpcRequestInput<"claudeHooks:install">,
  ): Promise<IpcResponse<"claudeHooks:install">>;
  claudeHooksRemove(
    payload: IpcRequestInput<"claudeHooks:remove">,
  ): Promise<IpcResponse<"claudeHooks:remove">>;
  debugRecordLiveUiTrace(
    payload: IpcRequestInput<"debug:recordLiveUiTrace">,
  ): Promise<IpcResponse<"debug:recordLiveUiTrace">>;
  dialogPickExternalToolCommand(
    payload: IpcRequestInput<"dialog:pickExternalToolCommand">,
  ): Promise<IpcResponse<"dialog:pickExternalToolCommand">>;
  editorListAvailable(
    payload: IpcRequestInput<"editor:listAvailable">,
  ): Promise<IpcResponse<"editor:listAvailable">>;
  editorOpen(payload: IpcRequestInput<"editor:open">): Promise<IpcResponse<"editor:open">>;
  historyExportMessages(
    payload: IpcRequestInput<"history:exportMessages">,
  ): Promise<IpcResponse<"history:exportMessages">>;
  indexerGetConfig(
    payload: IpcRequestInput<"indexer:getConfig">,
  ): Promise<IpcResponse<"indexer:getConfig">>;
  indexerGetStatus(
    payload: IpcRequestInput<"indexer:getStatus">,
  ): Promise<IpcResponse<"indexer:getStatus">>;
  indexerRefresh(
    payload: IpcRequestInput<"indexer:refresh">,
  ): Promise<IpcResponse<"indexer:refresh">>;
  indexerSetConfig(
    payload: IpcRequestInput<"indexer:setConfig">,
  ): Promise<IpcResponse<"indexer:setConfig">>;
  pathOpenInFileManager(
    payload: IpcRequestInput<"path:openInFileManager">,
  ): Promise<IpcResponse<"path:openInFileManager">>;
  projectsDelete(
    payload: IpcRequestInput<"projects:delete">,
  ): Promise<IpcResponse<"projects:delete">>;
  projectsGetCombinedDetail(
    payload: IpcRequestInput<"projects:getCombinedDetail">,
  ): Promise<IpcResponse<"projects:getCombinedDetail">>;
  projectsList(payload: IpcRequestInput<"projects:list">): Promise<IpcResponse<"projects:list">>;
  searchQuery(payload: IpcRequestInput<"search:query">): Promise<IpcResponse<"search:query">>;
  sessionsDelete(
    payload: IpcRequestInput<"sessions:delete">,
  ): Promise<IpcResponse<"sessions:delete">>;
  sessionsGetDetail(
    payload: IpcRequestInput<"sessions:getDetail">,
  ): Promise<IpcResponse<"sessions:getDetail">>;
  sessionsGetTurn(
    payload: IpcRequestInput<"sessions:getTurn">,
  ): Promise<IpcResponse<"sessions:getTurn">>;
  sessionsList(payload: IpcRequestInput<"sessions:list">): Promise<IpcResponse<"sessions:list">>;
  sessionsListMany(
    payload: IpcRequestInput<"sessions:listMany">,
  ): Promise<IpcResponse<"sessions:listMany">>;
  uiGetPaneState(
    payload: IpcRequestInput<"ui:getPaneState">,
  ): Promise<IpcResponse<"ui:getPaneState">>;
  uiGetZoom(payload: IpcRequestInput<"ui:getZoom">): Promise<IpcResponse<"ui:getZoom">>;
  uiSetPaneState(
    payload: IpcRequestInput<"ui:setPaneState">,
  ): Promise<IpcResponse<"ui:setPaneState">>;
  uiSetZoom(payload: IpcRequestInput<"ui:setZoom">): Promise<IpcResponse<"ui:setZoom">>;
  watcherGetLiveStatus(
    payload: IpcRequestInput<"watcher:getLiveStatus">,
  ): Promise<IpcResponse<"watcher:getLiveStatus">>;
  watcherGetStats(
    payload: IpcRequestInput<"watcher:getStats">,
  ): Promise<IpcResponse<"watcher:getStats">>;
  watcherGetStatus(
    payload: IpcRequestInput<"watcher:getStatus">,
  ): Promise<IpcResponse<"watcher:getStatus">>;
  watcherStart(payload: IpcRequestInput<"watcher:start">): Promise<IpcResponse<"watcher:start">>;
  watcherStop(payload: IpcRequestInput<"watcher:stop">): Promise<IpcResponse<"watcher:stop">>;
  onHistoryExportProgress(listener: (payload: HistoryExportProgressPayload) => void): () => void;
  onAppCommand(listener: (command: AppCommand) => void): () => void;
  onLiveStatusChanged(listener: () => void): () => void;
};

export const CHANNEL_TO_BRIDGE_METHOD = {
  "app:flushState": "appFlushState",
  "app:setCommandState": "appSetCommandState",
  "app:getSettingsInfo": "appGetSettingsInfo",
  "dashboard:getStats": "dashboardGetStats",
  "bookmarks:getStates": "bookmarksGetStates",
  "bookmarks:listProject": "bookmarksListProject",
  "bookmarks:toggle": "bookmarksToggle",
  "claudeHooks:install": "claudeHooksInstall",
  "claudeHooks:remove": "claudeHooksRemove",
  "debug:recordLiveUiTrace": "debugRecordLiveUiTrace",
  "dialog:pickExternalToolCommand": "dialogPickExternalToolCommand",
  "editor:listAvailable": "editorListAvailable",
  "editor:open": "editorOpen",
  "history:exportMessages": "historyExportMessages",
  "indexer:getConfig": "indexerGetConfig",
  "indexer:getStatus": "indexerGetStatus",
  "indexer:refresh": "indexerRefresh",
  "indexer:setConfig": "indexerSetConfig",
  "path:openInFileManager": "pathOpenInFileManager",
  "projects:delete": "projectsDelete",
  "projects:getCombinedDetail": "projectsGetCombinedDetail",
  "projects:list": "projectsList",
  "search:query": "searchQuery",
  "sessions:delete": "sessionsDelete",
  "sessions:getDetail": "sessionsGetDetail",
  "sessions:getTurn": "sessionsGetTurn",
  "sessions:list": "sessionsList",
  "sessions:listMany": "sessionsListMany",
  "ui:getPaneState": "uiGetPaneState",
  "ui:getZoom": "uiGetZoom",
  "ui:setPaneState": "uiSetPaneState",
  "ui:setZoom": "uiSetZoom",
  "watcher:getLiveStatus": "watcherGetLiveStatus",
  "watcher:getStats": "watcherGetStats",
  "watcher:getStatus": "watcherGetStatus",
  "watcher:start": "watcherStart",
  "watcher:stop": "watcherStop",
} as const;
