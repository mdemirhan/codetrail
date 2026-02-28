import type { MessageCategory } from "@codetrail/core";
import type { IpcResponse } from "@codetrail/core";

import { openPath } from "../lib/pathActions";
import { prettyCategory } from "../lib/viewUtils";
import { ToolbarIcon } from "./ToolbarIcon";

type SettingsInfo = IpcResponse<"app:getSettingsInfo">;
type DiscoveryProvider = "claude" | "codex" | "gemini";

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
        { label: "Database file", value: info.storage.databaseFile },
        { label: "User data directory", value: info.storage.userDataDir },
      ]
    : [];

  const discoveryRows: Array<{ label: string; value: string; provider: DiscoveryProvider }> = info
    ? [
        { label: "Claude root", value: info.discovery.claudeRoot, provider: "claude" },
        { label: "Codex root", value: info.discovery.codexRoot, provider: "codex" },
        { label: "Gemini tmp root", value: info.discovery.geminiRoot, provider: "gemini" },
        {
          label: "Gemini history root",
          value: info.discovery.geminiHistoryRoot,
          provider: "gemini",
        },
        {
          label: "Gemini projects file",
          value: info.discovery.geminiProjectsPath,
          provider: "gemini",
        },
      ]
    : [];

  return (
    <div className="settings-view">
      <div className="settings-scroll">
        <div className="settings-title">
          <ToolbarIcon name="settings" />
          <span>Settings</span>
        </div>

        <section className="settings-section">
          <div className="settings-section-header">
            <h3>Default Expansion</h3>
            <p>Select which message types should start expanded in session view.</p>
          </div>
          <div className="settings-section-body">
            <div className="settings-category-row">
              {SETTINGS_MESSAGE_CATEGORIES.map((category) => {
                const active = expandedByDefaultCategories.includes(category);
                return (
                  <button
                    key={category}
                    type="button"
                    className={`settings-chip${active ? " active" : ""}`}
                    onClick={() => onToggleExpandedByDefault(category)}
                    aria-pressed={active}
                    title={`Toggle default expansion for ${prettyCategory(category)}`}
                  >
                    <span className="settings-chip-check" aria-hidden>
                      <svg viewBox="0 0 24 24">
                        <title>Selected</title>
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </span>
                    <span>{prettyCategory(category)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {loading ? (
          <section className="settings-section settings-status-card">
            <p className="empty-state">Loading settings...</p>
          </section>
        ) : null}
        {!loading && error ? (
          <section className="settings-section settings-status-card">
            <p className="empty-state">{error}</p>
          </section>
        ) : null}
        {!loading && !error && info ? (
          <>
            <section className="settings-section">
              <div className="settings-section-header">
                <h3>Storage</h3>
                <p>File and directory locations used by the application.</p>
              </div>
              <div className="settings-section-body">
                <div className="settings-grid">
                  {storageRows.map((row) => (
                    <SettingsInfoRow key={row.label} label={row.label} value={row.value} />
                  ))}
                </div>
              </div>
            </section>
            <section className="settings-section">
              <div className="settings-section-header">
                <h3>Discovery Roots</h3>
                <p>Session and project directories scanned for each provider.</p>
              </div>
              <div className="settings-section-body">
                <div className="settings-grid">
                  {discoveryRows.map((row) => (
                    <SettingsInfoRow
                      key={row.label}
                      label={row.label}
                      value={row.value}
                      provider={row.provider}
                    />
                  ))}
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SettingsInfoRow({
  label,
  value,
  provider,
}: {
  label: string;
  value: string;
  provider?: DiscoveryProvider;
}) {
  return (
    <div className={`settings-row${provider ? " settings-row-discovery" : ""}`}>
      {provider ? (
        <span className={`settings-provider-badge settings-provider-${provider}`}>{label}</span>
      ) : (
        <span className="settings-key">{label}</span>
      )}
      <code className="settings-value" title={value}>
        {value}
      </code>
      <div className="settings-actions">
        <button
          type="button"
          className="settings-action-button"
          onClick={() => {
            void copyText(value);
          }}
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
        >
          <ToolbarIcon name="copy" />
        </button>
        <button
          type="button"
          className="settings-action-button"
          onClick={() => {
            void openInFileManager(value);
          }}
          aria-label={`Open ${label}`}
          title={`Open ${label}`}
        >
          <svg className="settings-action-icon" viewBox="0 0 24 24" aria-hidden>
            <title>Open in file manager</title>
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <path d="M15 3h6v6" />
            <path d="m10 14 11-11" />
          </svg>
        </button>
      </div>
    </div>
  );
}

async function openInFileManager(path: string): Promise<void> {
  const result = await openPath(path);
  if (!result.ok) {
    return;
  }
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
