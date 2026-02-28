import type { MessageCategory } from "@codetrail/core";
import type { IpcResponse } from "@codetrail/core";

import { prettyCategory } from "../lib/viewUtils";
import { ToolbarIcon } from "./ToolbarIcon";

type SettingsInfo = IpcResponse<"app:getSettingsInfo">;

const SETTINGS_MESSAGE_CATEGORIES: MessageCategory[] = [
  "user",
  "assistant",
  "tool_edit",
  "tool_use",
  "tool_result",
  "thinking",
  "system",
];

export function SettingsView({
  info,
  loading,
  error,
  expandedByDefaultCategories,
  onToggleExpandedByDefault,
}: {
  info: SettingsInfo | null;
  loading: boolean;
  error: string | null;
  expandedByDefaultCategories: MessageCategory[];
  onToggleExpandedByDefault: (category: MessageCategory) => void;
}) {
  const storageRows = info
    ? [
        { label: "Settings file", value: info.storage.settingsFile },
        { label: "Cache directory", value: info.storage.cacheDir },
        { label: "Database file", value: info.storage.databaseFile },
        { label: "User data directory", value: info.storage.userDataDir },
      ]
    : [];

  const discoveryRows = info
    ? [
        { label: "Claude root", value: info.discovery.claudeRoot },
        { label: "Codex root", value: info.discovery.codexRoot },
        { label: "Gemini tmp root", value: info.discovery.geminiRoot },
        { label: "Gemini history root", value: info.discovery.geminiHistoryRoot },
        { label: "Gemini projects file", value: info.discovery.geminiProjectsPath },
      ]
    : [];

  return (
    <div className="settings-view">
      <div className="content-head">
        <h2>Settings</h2>
      </div>
      <div className="settings-scroll">
        <section className="settings-section">
          <h3>Default Expansion</h3>
          <p>Select which message types should start expanded in session view.</p>
          <div className="settings-category-row">
            {SETTINGS_MESSAGE_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                className={`settings-chip${expandedByDefaultCategories.includes(category) ? " active" : ""}`}
                onClick={() => onToggleExpandedByDefault(category)}
                aria-pressed={expandedByDefaultCategories.includes(category)}
                title={`Toggle default expansion for ${prettyCategory(category)}`}
              >
                {prettyCategory(category)}
              </button>
            ))}
          </div>
        </section>

        {loading ? <p className="empty-state">Loading settings...</p> : null}
        {!loading && error ? <p className="empty-state">{error}</p> : null}
        {!loading && !error && info ? (
          <>
            <section className="settings-section">
              <h3>Storage</h3>
              <div className="settings-grid">
                {storageRows.map((row) => (
                  <SettingsInfoRow key={row.label} label={row.label} value={row.value} />
                ))}
              </div>
            </section>
            <section className="settings-section">
              <h3>Discovery Roots</h3>
              <div className="settings-grid">
                {discoveryRows.map((row) => (
                  <SettingsInfoRow key={row.label} label={row.label} value={row.value} />
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SettingsInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-row">
      <span className="settings-key">{label}</span>
      <code className="settings-value">{value}</code>
      <button
        type="button"
        className="settings-copy-button"
        onClick={() => {
          void copyText(value);
        }}
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
      >
        <ToolbarIcon name="copy" />
      </button>
    </div>
  );
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = value;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.left = "-9999px";
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand("copy");
    document.body.removeChild(fallback);
  }
}
