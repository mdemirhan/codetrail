import type { MessageCategory } from "@codetrail/core";
import type { IpcResponse } from "@codetrail/core";

import { openPath } from "../lib/pathActions";
import { prettyCategory } from "../lib/viewUtils";
import { ToolbarIcon } from "./ToolbarIcon";

type SettingsInfo = IpcResponse<"app:getSettingsInfo">;
type DiscoveryProvider = "claude" | "codex" | "gemini";
type MonoFontFamily = "current" | "droid_sans_mono";
type RegularFontFamily = "current" | "inter";
type MonoFontSize = "10px" | "11px" | "12px" | "13px" | "14px" | "15px" | "16px" | "17px" | "18px";
type RegularFontSize =
  | "11px"
  | "12px"
  | "13px"
  | "13.5px"
  | "14px"
  | "15px"
  | "16px"
  | "17px"
  | "18px"
  | "20px";

const SETTINGS_MESSAGE_CATEGORIES: MessageCategory[] = [
  "user",
  "assistant",
  "tool_edit",
  "tool_use",
  "tool_result",
  "thinking",
  "system",
];

const MONO_FONT_OPTIONS: Array<{ value: MonoFontFamily; label: string }> = [
  { value: "current", label: "JetBrains Mono" },
  { value: "droid_sans_mono", label: "Droid Sans Mono" },
];

const REGULAR_FONT_OPTIONS: Array<{ value: RegularFontFamily; label: string }> = [
  { value: "current", label: "Plus Jakarta Sans" },
  { value: "inter", label: "Inter" },
];

const MONO_FONT_SIZE_OPTIONS: Array<{ value: MonoFontSize; label: string }> = [
  { value: "10px", label: "10px" },
  { value: "11px", label: "11px" },
  { value: "12px", label: "12px" },
  { value: "13px", label: "13px" },
  { value: "14px", label: "14px" },
  { value: "15px", label: "15px" },
  { value: "16px", label: "16px" },
  { value: "17px", label: "17px" },
  { value: "18px", label: "18px" },
];

const REGULAR_FONT_SIZE_OPTIONS: Array<{ value: RegularFontSize; label: string }> = [
  { value: "11px", label: "11px" },
  { value: "12px", label: "12px" },
  { value: "13px", label: "13px" },
  { value: "13.5px", label: "13.5px" },
  { value: "14px", label: "14px" },
  { value: "15px", label: "15px" },
  { value: "16px", label: "16px" },
  { value: "17px", label: "17px" },
  { value: "18px", label: "18px" },
  { value: "20px", label: "20px" },
];

export function SettingsView({
  info,
  loading,
  error,
  monoFontFamily,
  regularFontFamily,
  monoFontSize,
  regularFontSize,
  useMonospaceForAllMessages,
  onMonoFontFamilyChange,
  onRegularFontFamilyChange,
  onMonoFontSizeChange,
  onRegularFontSizeChange,
  onUseMonospaceForAllMessagesChange,
  expandedByDefaultCategories,
  onToggleExpandedByDefault,
}: {
  info: SettingsInfo | null;
  loading: boolean;
  error: string | null;
  monoFontFamily: MonoFontFamily;
  regularFontFamily: RegularFontFamily;
  monoFontSize: MonoFontSize;
  regularFontSize: RegularFontSize;
  useMonospaceForAllMessages: boolean;
  onMonoFontFamilyChange: (fontFamily: MonoFontFamily) => void;
  onRegularFontFamilyChange: (fontFamily: RegularFontFamily) => void;
  onMonoFontSizeChange: (fontSize: MonoFontSize) => void;
  onRegularFontSizeChange: (fontSize: RegularFontSize) => void;
  onUseMonospaceForAllMessagesChange: (enabled: boolean) => void;
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
            <h3>Fonts</h3>
            <p>Choose regular and monospaced fonts used in the UI and message content.</p>
          </div>
          <div className="settings-section-body">
            <div className="settings-font-grid">
              <label className="settings-field">
                <span className="settings-field-label">Monospaced font</span>
                <select
                  className="settings-select"
                  value={monoFontFamily}
                  onChange={(event) => onMonoFontFamilyChange(event.target.value as MonoFontFamily)}
                >
                  {MONO_FONT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="settings-field">
                <span className="settings-field-label">Monospaced size</span>
                <select
                  className="settings-select"
                  value={monoFontSize}
                  onChange={(event) => onMonoFontSizeChange(event.target.value as MonoFontSize)}
                >
                  {MONO_FONT_SIZE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="settings-field">
                <span className="settings-field-label">Regular font</span>
                <select
                  className="settings-select"
                  value={regularFontFamily}
                  onChange={(event) =>
                    onRegularFontFamilyChange(event.target.value as RegularFontFamily)
                  }
                >
                  {REGULAR_FONT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="settings-field">
                <span className="settings-field-label">Regular size</span>
                <select
                  className="settings-select"
                  value={regularFontSize}
                  onChange={(event) =>
                    onRegularFontSizeChange(event.target.value as RegularFontSize)
                  }
                >
                  {REGULAR_FONT_SIZE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="settings-checkbox-row">
                <input
                  type="checkbox"
                  checked={useMonospaceForAllMessages}
                  onChange={(event) => onUseMonospaceForAllMessagesChange(event.target.checked)}
                />
                <span>Use monospaced fonts for all messages</span>
              </label>
            </div>
          </div>
        </section>

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
