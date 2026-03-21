import { type ReactNode, useState } from "react";

import {
  type MessageCategory,
  PROVIDER_LIST,
  type Provider,
  type SystemMessageRegexRules,
} from "@codetrail/core/browser";

import {
  type MonoFontFamily,
  type MonoFontSize,
  type RegularFontFamily,
  type RegularFontSize,
  THEME_GROUPS,
  type ThemeMode,
  UI_MESSAGE_CATEGORY_VALUES,
  UI_MONO_FONT_SIZE_VALUES,
  UI_MONO_FONT_VALUES,
  UI_REGULAR_FONT_SIZE_VALUES,
  UI_REGULAR_FONT_VALUES,
  UI_THEME_VALUES,
} from "../../shared/uiPreferences";
import type { SettingsInfoResponse, WatchStatsResponse } from "../app/types";
import { copyTextToClipboard } from "../lib/clipboard";
import { openPath } from "../lib/pathActions";
import { compactPath, prettyCategory, toErrorMessage } from "../lib/viewUtils";
import { ToolbarIcon } from "./ToolbarIcon";
import { ZoomPercentInput } from "./ZoomPercentInput";

type SettingsAppearanceProps = {
  theme: ThemeMode;
  zoomPercent: number;
  monoFontFamily: MonoFontFamily;
  regularFontFamily: RegularFontFamily;
  monoFontSize: MonoFontSize;
  regularFontSize: RegularFontSize;
  useMonospaceForAllMessages: boolean;
  onThemeChange: (theme: ThemeMode) => void;
  onZoomPercentChange: (zoomPercent: number) => void;
  onMonoFontFamilyChange: (fontFamily: MonoFontFamily) => void;
  onRegularFontFamilyChange: (fontFamily: RegularFontFamily) => void;
  onMonoFontSizeChange: (fontSize: MonoFontSize) => void;
  onRegularFontSizeChange: (fontSize: RegularFontSize) => void;
  onUseMonospaceForAllMessagesChange: (enabled: boolean) => void;
};

type SettingsIndexingProps = {
  enabledProviders: Provider[];
  removeMissingSessionsDuringIncrementalIndexing: boolean;
  canForceReindex: boolean;
  onToggleProviderEnabled: (provider: Provider) => void;
  onForceReindex: () => void;
  onRemoveMissingSessionsDuringIncrementalIndexingChange: (enabled: boolean) => void;
};

type SettingsMessageRulesProps = {
  expandedByDefaultCategories: MessageCategory[];
  onToggleExpandedByDefault: (category: MessageCategory) => void;
  systemMessageRegexRules: SystemMessageRegexRules;
  onAddSystemMessageRegexRule: (provider: Provider) => void;
  onUpdateSystemMessageRegexRule: (provider: Provider, index: number, pattern: string) => void;
  onRemoveSystemMessageRegexRule: (provider: Provider, index: number) => void;
};

const MONO_FONT_OPTIONS: Array<{ value: MonoFontFamily; label: string }> = UI_MONO_FONT_VALUES.map(
  (value) => ({
    value,
    label: value === "current" ? "JetBrains Mono" : "Droid Sans Mono",
  }),
);

const REGULAR_FONT_OPTIONS: Array<{ value: RegularFontFamily; label: string }> =
  UI_REGULAR_FONT_VALUES.map((value) => ({
    value,
    label: value === "current" ? "Plus Jakarta Sans" : "Inter",
  }));

const MONO_FONT_SIZE_OPTIONS: Array<{ value: MonoFontSize; label: string }> =
  UI_MONO_FONT_SIZE_VALUES.map((value) => ({ value, label: value }));

const REGULAR_FONT_SIZE_OPTIONS: Array<{ value: RegularFontSize; label: string }> =
  UI_REGULAR_FONT_SIZE_VALUES.map((value) => ({ value, label: value }));

const PROVIDER_ICONS: Record<Provider, string> = {
  claude: "C",
  codex: "X",
  gemini: "G",
  cursor: "U",
  copilot: "P",
};

const MESSAGE_CATEGORY_ICONS: Record<MessageCategory, string> = {
  user: "U",
  assistant: "A",
  tool_edit: "W",
  tool_use: "T",
  tool_result: "R",
  thinking: "Q",
  system: "S",
};

export function SettingsView({
  info,
  loading,
  error,
  diagnostics,
  diagnosticsLoading,
  diagnosticsError,
  appearance,
  indexing,
  messageRules,
  onActionError,
}: {
  info: SettingsInfoResponse | null;
  loading: boolean;
  error: string | null;
  diagnostics: WatchStatsResponse | null;
  diagnosticsLoading: boolean;
  diagnosticsError: string | null;
  appearance: SettingsAppearanceProps;
  indexing: SettingsIndexingProps;
  messageRules: SettingsMessageRulesProps;
  onActionError?: (context: string, error: unknown) => void;
}) {
  const [activeTab, setActiveTab] = useState<"settings" | "diagnostics">("settings");
  const storageRows = info
    ? [
        { label: "Settings file", value: info.storage.settingsFile },
        { label: "Database file", value: info.storage.databaseFile },
        { label: "Bookmarks database", value: info.storage.bookmarksDatabaseFile },
        { label: "User data directory", value: info.storage.userDataDir },
      ]
    : [];

  const discoveryRows: Array<{ label: string; value: string; provider: Provider }> = info
    ? info.discovery.providers.flatMap((provider) =>
        provider.paths.map((path) => ({
          label: path.label,
          value: path.value,
          provider: provider.provider,
        })),
      )
    : [];

  return (
    <div className="settings-view">
      <div className="settings-page">
        <div className="settings-page-body">
          <div className="settings-tab-bar" role="tablist" aria-label="Settings sections">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "settings"}
              className={`settings-tab${activeTab === "settings" ? " active" : ""}`}
              onClick={() => setActiveTab("settings")}
            >
              Application Settings
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "diagnostics"}
              className={`settings-tab${activeTab === "diagnostics" ? " active" : ""}`}
              onClick={() => setActiveTab("diagnostics")}
            >
              Diagnostics
            </button>
          </div>

          {activeTab === "settings" ? (
            <>
              <SectionCard>
                <SectionHeader
                  tone="theme"
                  icon="◑"
                  title="Appearance"
                  subtitle="Theme and zoom used across history, search, help, and settings."
                />
                <div className="settings-field-grid">
                  <SettingsField label="Application theme">
                    <div className="settings-select-wrap">
                      <select
                        className="settings-select"
                        aria-label="Theme"
                        value={appearance.theme}
                        onChange={(event) =>
                          appearance.onThemeChange(
                            selectValueOrFallback(
                              event.target.value,
                              UI_THEME_VALUES,
                              appearance.theme,
                            ),
                          )
                        }
                      >
                        {THEME_GROUPS.map((group) => (
                          <optgroup key={group.value} label={group.label}>
                            {group.options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <span className="settings-select-chevron" aria-hidden>
                        <svg viewBox="0 0 12 12">
                          <path d="M3 4.5L6 7.5L9 4.5" />
                        </svg>
                      </span>
                    </div>
                  </SettingsField>

                  <SettingsField label="Zoom">
                    <ZoomPercentInput
                      value={appearance.zoomPercent}
                      onCommit={appearance.onZoomPercentChange}
                      ariaLabel="Zoom"
                      title="Zoom level (60%-175%)"
                      wrapperClassName="settings-zoom-control"
                      inputClassName="settings-zoom-input"
                    />
                  </SettingsField>
                </div>
              </SectionCard>

              <SectionCard>
                <SectionHeader
                  tone="fonts"
                  icon="Aa"
                  title="Fonts"
                  subtitle="Regular and monospaced fonts used in the UI and message content."
                />
                <div className="settings-field-grid">
                  <SettingsField label="Monospaced font">
                    <div className="settings-select-wrap">
                      <select
                        className="settings-select"
                        value={appearance.monoFontFamily}
                        onChange={(event) =>
                          appearance.onMonoFontFamilyChange(
                            selectValueOrFallback(
                              event.target.value,
                              UI_MONO_FONT_VALUES,
                              appearance.monoFontFamily,
                            ),
                          )
                        }
                      >
                        {MONO_FONT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="settings-select-chevron" aria-hidden>
                        <svg viewBox="0 0 12 12">
                          <path d="M3 4.5L6 7.5L9 4.5" />
                        </svg>
                      </span>
                    </div>
                  </SettingsField>

                  <SettingsField label="Monospaced size">
                    <div className="settings-select-wrap">
                      <select
                        className="settings-select"
                        value={appearance.monoFontSize}
                        onChange={(event) =>
                          appearance.onMonoFontSizeChange(
                            selectValueOrFallback(
                              event.target.value,
                              UI_MONO_FONT_SIZE_VALUES,
                              appearance.monoFontSize,
                            ),
                          )
                        }
                      >
                        {MONO_FONT_SIZE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="settings-select-chevron" aria-hidden>
                        <svg viewBox="0 0 12 12">
                          <path d="M3 4.5L6 7.5L9 4.5" />
                        </svg>
                      </span>
                    </div>
                  </SettingsField>

                  <SettingsField label="Regular font">
                    <div className="settings-select-wrap">
                      <select
                        className="settings-select"
                        value={appearance.regularFontFamily}
                        onChange={(event) =>
                          appearance.onRegularFontFamilyChange(
                            selectValueOrFallback(
                              event.target.value,
                              UI_REGULAR_FONT_VALUES,
                              appearance.regularFontFamily,
                            ),
                          )
                        }
                      >
                        {REGULAR_FONT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="settings-select-chevron" aria-hidden>
                        <svg viewBox="0 0 12 12">
                          <path d="M3 4.5L6 7.5L9 4.5" />
                        </svg>
                      </span>
                    </div>
                  </SettingsField>

                  <SettingsField label="Regular size">
                    <div className="settings-select-wrap">
                      <select
                        className="settings-select"
                        value={appearance.regularFontSize}
                        onChange={(event) =>
                          appearance.onRegularFontSizeChange(
                            selectValueOrFallback(
                              event.target.value,
                              UI_REGULAR_FONT_SIZE_VALUES,
                              appearance.regularFontSize,
                            ),
                          )
                        }
                      >
                        {REGULAR_FONT_SIZE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="settings-select-chevron" aria-hidden>
                        <svg viewBox="0 0 12 12">
                          <path d="M3 4.5L6 7.5L9 4.5" />
                        </svg>
                      </span>
                    </div>
                  </SettingsField>
                </div>

                <InlineSwitchRow label="Use monospaced fonts for all messages">
                  <SettingsSwitch
                    checked={appearance.useMonospaceForAllMessages}
                    onChange={appearance.onUseMonospaceForAllMessagesChange}
                    ariaLabel="Use monospaced fonts for all messages"
                  />
                </InlineSwitchRow>
              </SectionCard>

              <SectionCard>
                <SectionHeader
                  tone="expansion"
                  icon="⊞"
                  title="Default Expansion"
                  subtitle="Which message types should start expanded in session view."
                />
                <div className="settings-token-grid">
                  {UI_MESSAGE_CATEGORY_VALUES.map((category) => {
                    const active = messageRules.expandedByDefaultCategories.includes(category);
                    return (
                      <button
                        key={category}
                        type="button"
                        className={`settings-token${active ? " is-active" : ""}`}
                        onClick={() => messageRules.onToggleExpandedByDefault(category)}
                        aria-pressed={active}
                        aria-label={prettyCategory(category)}
                        title={`Toggle default expansion for ${prettyCategory(category)}`}
                      >
                        <span className="settings-token-icon" aria-hidden>
                          {MESSAGE_CATEGORY_ICONS[category]}
                        </span>
                        <span className="settings-token-label">{prettyCategory(category)}</span>
                        <span className="settings-token-check" aria-hidden>
                          <svg viewBox="0 0 14 14">
                            <path d="M3 7l3 3 5-5" />
                          </svg>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </SectionCard>

              <SectionCard padded={false}>
                <div className="settings-section-block">
                  <SectionHeader
                    tone="provider"
                    icon="AI"
                    title="Providers"
                    subtitle="Choose which providers stay active in Code Trail. Disabled providers stop watching, indexing, and showing up in history until re-enabled."
                  />
                  <div className="settings-provider-summary">
                    <div className="settings-provider-summary-copy">
                      <span className="settings-provider-summary-value">
                        {indexing.enabledProviders.length}
                      </span>
                      <span className="settings-provider-summary-label">
                        of {PROVIDER_LIST.length} active
                      </span>
                    </div>
                    <div className="settings-provider-summary-dots" aria-hidden>
                      {PROVIDER_LIST.map(({ id }) => (
                        <span
                          key={id}
                          className={`settings-provider-dot settings-provider-dot-${id}${
                            indexing.enabledProviders.includes(id) ? " is-active" : ""
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="settings-provider-list">
                  {PROVIDER_LIST.map(({ id: provider, label }) => {
                    const enabled = indexing.enabledProviders.includes(provider);
                    return (
                      <div
                        key={provider}
                        className={`settings-provider-row settings-provider-row-${provider}${
                          enabled ? " is-enabled" : ""
                        }`}
                      >
                        <div className="settings-provider-row-main">
                          <span
                            className={`settings-provider-avatar settings-provider-${provider}`}
                            aria-hidden
                          >
                            {PROVIDER_ICONS[provider]}
                          </span>
                          <span className="settings-provider-name">{label}</span>
                        </div>
                        <span
                          className={`settings-provider-row-state${
                            enabled ? " is-enabled" : ""
                          }`}
                        >
                          {enabled ? "Watching" : "Disabled"}
                        </span>
                        <SettingsSwitch
                          checked={enabled}
                          onChange={() => indexing.onToggleProviderEnabled(provider)}
                          ariaLabel={label}
                          tone={provider}
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="settings-section-note">
                  Turning a provider off removes its indexed history and bookmarks on the next
                  refresh, but never touches the raw transcript files on disk.
                </div>
              </SectionCard>

              <SectionCard>
                <SectionHeader
                  tone="warning"
                  icon="DB"
                  title="Database Maintenance"
                  subtitle="Rebuild or clean indexed history without touching the raw transcript files on disk."
                />
                <div className="settings-callout-row">
                  <div className="settings-callout-copy">
                    <strong>Force reindex</strong>
                    <p>
                      Re-read all enabled provider session files from scratch and rebuild indexed
                      history.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="settings-primary-button"
                    onClick={indexing.onForceReindex}
                    disabled={!indexing.canForceReindex}
                    aria-label="Force reindex"
                    title={
                      indexing.canForceReindex
                        ? "Force full reindex"
                        : "Disable auto-refresh and wait for indexing to finish before reindexing"
                    }
                  >
                    <ToolbarIcon name="reindex" />
                    <span>Reindex</span>
                  </button>
                </div>

                <InlineSwitchRow label="Remove indexed sessions when source files disappear during incremental refresh">
                  <SettingsSwitch
                    checked={indexing.removeMissingSessionsDuringIncrementalIndexing}
                    onChange={indexing.onRemoveMissingSessionsDuringIncrementalIndexingChange}
                    ariaLabel="Remove indexed sessions when source files disappear during incremental refresh"
                  />
                </InlineSwitchRow>
              </SectionCard>

              <SectionCard>
                <SectionHeader
                  tone="rules"
                  icon="//"
                  title="System Message Rules"
                  subtitle="Regex patterns applied during ingestion to classify messages. Run Reindex after changes."
                />
                <div className="settings-rule-groups">
                  {PROVIDER_LIST.map(({ id: provider, label }) => {
                    const patterns = messageRules.systemMessageRegexRules[provider] ?? [];
                    return (
                      <div key={provider} className="settings-rule-group">
                        <div className="settings-rule-group-header">
                          <div className="settings-rule-group-title">
                            <span className={`settings-provider-pill settings-provider-${provider}`}>
                              {label}
                            </span>
                            {patterns.length > 0 ? (
                              <span className="settings-rule-count">
                                {patterns.length} rule{patterns.length === 1 ? "" : "s"}
                              </span>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className="settings-rule-button"
                            onClick={() => messageRules.onAddSystemMessageRegexRule(provider)}
                            aria-label={`Add ${provider} regex rule`}
                            title={`Add ${provider} regex rule`}
                          >
                            <span aria-hidden>+</span>
                            <span>Add Pattern</span>
                          </button>
                        </div>

                        {patterns.length === 0 ? (
                          <p className="settings-rule-empty">No regex rules configured.</p>
                        ) : (
                          <div className="settings-rule-list">
                            {patterns.map((pattern, index) => {
                              const duplicateCount = patterns
                                .slice(0, index)
                                .filter((existingPattern) => existingPattern === pattern).length;

                              return (
                                <div
                                  key={`${provider}-rule-${pattern}-${duplicateCount}`}
                                  className="settings-rule-row"
                                >
                                  <input
                                    className="settings-rule-input"
                                    type="text"
                                    value={pattern}
                                    onChange={(event) =>
                                      messageRules.onUpdateSystemMessageRegexRule(
                                        provider,
                                        index,
                                        event.target.value,
                                      )
                                    }
                                    placeholder="^regex pattern"
                                    aria-label={`${provider} regex rule ${index + 1}`}
                                    spellCheck={false}
                                  />
                                  <button
                                    type="button"
                                    className="settings-rule-remove"
                                    onClick={() =>
                                      messageRules.onRemoveSystemMessageRegexRule(provider, index)
                                    }
                                    aria-label={`Remove ${provider} regex rule ${index + 1}`}
                                    title={`Remove ${provider} regex rule ${index + 1}`}
                                  >
                                    Remove
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </SectionCard>

              {loading ? <StatusCard message="Loading settings..." /> : null}
              {!loading && error ? <StatusCard message={error} /> : null}
              {!loading && !error && info ? (
                <>
                  <SectionCard padded={false}>
                    <div className="settings-section-block">
                      <SectionHeader
                        tone="storage"
                        icon="DB"
                        title="Storage"
                        subtitle="File and directory locations used by the application."
                      />
                    </div>
                    <div className="settings-path-list">
                      {storageRows.map((row) => (
                        <SettingsInfoRow
                          key={row.label}
                          label={row.label}
                          value={row.value}
                          {...(onActionError ? { onActionError } : {})}
                        />
                      ))}
                    </div>
                  </SectionCard>

                  <SectionCard padded={false}>
                    <div className="settings-section-block">
                      <SectionHeader
                        tone="discovery"
                        icon="/\\"
                        title="Discovery Roots"
                        subtitle="Session and project directories scanned for each provider."
                      />
                    </div>
                    <div className="settings-path-list">
                      {discoveryRows.map((row) => (
                        <SettingsInfoRow
                          key={`${row.provider}-${row.label}-${row.value}`}
                          label={row.label}
                          value={row.value}
                          provider={row.provider}
                          {...(onActionError ? { onActionError } : {})}
                        />
                      ))}
                    </div>
                  </SectionCard>
                </>
              ) : null}
            </>
          ) : (
            <DiagnosticsTab
              diagnostics={diagnostics}
              loading={diagnosticsLoading}
              error={diagnosticsError}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function SectionCard({
  children,
  padded = true,
}: {
  children: ReactNode;
  padded?: boolean;
}) {
  return <section className={`settings-section${padded ? "" : " no-padding"}`}>{children}</section>;
}

function SectionHeader({
  icon,
  title,
  subtitle,
  tone,
}: {
  icon: string;
  title: string;
  subtitle: string;
  tone:
    | "theme"
    | "fonts"
    | "provider"
    | "expansion"
    | "warning"
    | "rules"
    | "storage"
    | "discovery"
    | "diagnostics"
    | "breakdown";
}) {
  return (
    <div className="settings-section-header">
      <div className={`settings-section-icon settings-section-icon-${tone}`} aria-hidden>
        {icon}
      </div>
      <div className="settings-section-heading">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function SettingsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="settings-field">
      <span className="settings-field-label">{label}</span>
      {children}
    </label>
  );
}

function InlineSwitchRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="settings-inline-switch-row">
      <span>{label}</span>
      {children}
    </div>
  );
}

function SettingsSwitch({
  checked,
  onChange,
  ariaLabel,
  tone,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
  tone?: Provider;
}) {
  return (
    <label className={`settings-switch${tone ? ` settings-switch-${tone}` : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={ariaLabel}
      />
      <span className="settings-switch-track" aria-hidden>
        <span className="settings-switch-thumb" />
      </span>
    </label>
  );
}

function StatusCard({ message }: { message: string }) {
  return (
    <SectionCard>
      <p className="empty-state">{message}</p>
    </SectionCard>
  );
}

function SettingsInfoRow({
  label,
  value,
  provider,
  onActionError,
}: {
  label: string;
  value: string;
  provider?: Provider;
  onActionError?: ((context: string, error: unknown) => void) | undefined;
}) {
  return (
    <div className="settings-path-row">
      <div className="settings-path-label">
        {provider ? (
          <span className={`settings-provider-pill settings-provider-${provider}`}>{label}</span>
        ) : (
          <span className="settings-path-key">{label}</span>
        )}
      </div>
      <code className="settings-path-value" title={value}>
        {compactPath(value)}
      </code>
      <div className="settings-actions">
        <button
          type="button"
          className="settings-action-button"
          onClick={() => {
            void copyTextToClipboard(value)
              .then((copied) => {
                if (!copied) {
                  reportSettingsActionError(
                    onActionError,
                    `Failed copying settings value for '${label}'`,
                    "Clipboard write returned false",
                  );
                }
              })
              .catch((copyError: unknown) => {
                reportSettingsActionError(
                  onActionError,
                  `Failed copying settings value for '${label}'`,
                  copyError,
                );
              });
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
            void openPath(value)
              .then((result) => {
                if (!result.ok) {
                  reportSettingsActionError(
                    onActionError,
                    `Failed opening settings path '${label}'`,
                    result.error ?? `Failed to open ${value}`,
                  );
                }
              })
              .catch((openError: unknown) => {
                reportSettingsActionError(
                  onActionError,
                  `Failed opening settings path '${label}'`,
                  openError,
                );
              });
          }}
          aria-label={`Open ${label}`}
          title={`Open ${label}`}
        >
          <svg className="settings-action-icon" viewBox="0 0 24 24" aria-hidden>
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <path d="M15 3h6v6" />
            <path d="m10 14 11-11" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function selectValueOrFallback<T extends string>(
  value: string,
  allowedValues: readonly T[],
  fallback: T,
): T {
  return allowedValues.includes(value as T) ? (value as T) : fallback;
}

function reportSettingsActionError(
  onActionError: ((context: string, error: unknown) => void) | undefined,
  context: string,
  error: unknown,
): void {
  if (onActionError) {
    onActionError(context, error);
    return;
  }
  console.error(`[codetrail] ${context}: ${toErrorMessage(error)}`);
}

function DiagnosticsTab({
  diagnostics,
  loading,
  error,
}: {
  diagnostics: WatchStatsResponse | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !diagnostics) {
    return <StatusCard message="Loading diagnostics..." />;
  }

  if (error && !diagnostics) {
    return <StatusCard message={error} />;
  }

  if (!diagnostics) {
    return <StatusCard message="Diagnostics are not available yet." />;
  }

  return (
    <>
      {error ? <StatusCard message={error} /> : null}

      <SectionCard>
        <SectionHeader
          tone="diagnostics"
          icon="DI"
          title="Overview"
          subtitle="In-memory refresh and watcher counters for this app run."
        />
        <div className="settings-metric-grid">
          <MetricCard
            label="Manual Incremental Scans"
            value={formatUnitCount(diagnostics.jobs.manualIncremental.runs, "run")}
            detail={`average ${formatDurationPerRun(diagnostics.jobs.manualIncremental.averageDurationMs)}`}
          />
          <MetricCard
            label="Watch Fallback Scans"
            value={formatUnitCount(diagnostics.watcher.fallbackToIncrementalScans, "scan")}
            detail={`${formatUnitCount(diagnostics.jobs.watchFallbackIncremental.runs, "fallback incremental run")} executed`}
          />
          <MetricCard
            label="Watch-Based Triggers"
            value={formatUnitCount(diagnostics.watcher.watchBasedTriggers, "trigger")}
            detail={`${formatUnitCount(diagnostics.jobs.watchTargeted.runs, "targeted run")} | ${formatUnitCount(diagnostics.jobs.watchFallbackIncremental.runs, "fallback run")}`}
          />
          <MetricCard
            label="Completed Runs"
            value={formatUnitCount(diagnostics.jobs.totals.completedRuns, "run")}
            detail={`${formatUnitCount(diagnostics.jobs.totals.failedRuns, "failed run")} recorded`}
          />
        </div>
      </SectionCard>

      <SectionCard padded={false}>
        <div className="settings-section-block">
          <SectionHeader
            tone="breakdown"
            icon="RB"
            title="Run Breakdown"
            subtitle="Run counts and durations grouped by refresh source."
          />
        </div>
        <div className="settings-breakdown-table">
          <div className="settings-breakdown-header">
            <span className="settings-breakdown-label">Trigger type</span>
            <span className="settings-breakdown-number">Runs</span>
            <span className="settings-breakdown-number">Avg duration</span>
            <span className="settings-breakdown-number">Max duration</span>
          </div>
          <DiagnosticsRow
            label="Startup incremental"
            runs={diagnostics.jobs.startupIncremental.runs}
            averageDurationMs={diagnostics.jobs.startupIncremental.averageDurationMs}
            maxDurationMs={diagnostics.jobs.startupIncremental.maxDurationMs}
          />
          <DiagnosticsRow
            label="Manual incremental"
            runs={diagnostics.jobs.manualIncremental.runs}
            averageDurationMs={diagnostics.jobs.manualIncremental.averageDurationMs}
            maxDurationMs={diagnostics.jobs.manualIncremental.maxDurationMs}
          />
          <DiagnosticsRow
            label="Manual force reindex"
            runs={diagnostics.jobs.manualForceReindex.runs}
            averageDurationMs={diagnostics.jobs.manualForceReindex.averageDurationMs}
            maxDurationMs={diagnostics.jobs.manualForceReindex.maxDurationMs}
          />
          <DiagnosticsRow
            label="Watch-triggered total"
            runs={diagnostics.jobs.watchTriggered.runs}
            averageDurationMs={diagnostics.jobs.watchTriggered.averageDurationMs}
            maxDurationMs={diagnostics.jobs.watchTriggered.maxDurationMs}
          />
          <DiagnosticsRow
            label="Watch targeted"
            runs={diagnostics.jobs.watchTargeted.runs}
            averageDurationMs={diagnostics.jobs.watchTargeted.averageDurationMs}
            maxDurationMs={diagnostics.jobs.watchTargeted.maxDurationMs}
          />
          <DiagnosticsRow
            label="Watch fallback incremental"
            runs={diagnostics.jobs.watchFallbackIncremental.runs}
            averageDurationMs={diagnostics.jobs.watchFallbackIncremental.averageDurationMs}
            maxDurationMs={diagnostics.jobs.watchFallbackIncremental.maxDurationMs}
          />
          <DiagnosticsRow
            label="Watch initial scan"
            runs={diagnostics.jobs.watchInitialScan.runs}
            averageDurationMs={diagnostics.jobs.watchInitialScan.averageDurationMs}
            maxDurationMs={diagnostics.jobs.watchInitialScan.maxDurationMs}
          />
        </div>
      </SectionCard>

      <SectionCard>
        <SectionHeader
          tone="discovery"
          icon="RT"
          title="Runtime"
          subtitle="Watcher backend, run durations, and the most recent indexing job."
        />
        <div className="settings-runtime-grid">
          <RuntimeStat label="Started" value={formatTimestamp(diagnostics.startedAt)} />
          <RuntimeStat label="Watcher backend" value={diagnostics.watcher.backend ?? "not started"} />
          <RuntimeStat
            label="Watched roots"
            value={formatUnitCount(diagnostics.watcher.watchedRootCount, "root")}
          />
          <RuntimeStat
            label="Last trigger"
            value={formatOptionalTrigger(
              diagnostics.watcher.lastTriggerAt,
              diagnostics.watcher.lastTriggerPathCount,
            )}
          />
          <RuntimeStat
            label="Manual avg duration"
            value={formatDurationPerRun(diagnostics.jobs.manualIncremental.averageDurationMs)}
          />
          <RuntimeStat
            label="Watch avg duration"
            value={formatDurationPerRun(diagnostics.jobs.watchTriggered.averageDurationMs)}
          />
        </div>

        <div className="settings-last-run">
          <div className="settings-last-run-label">Last run</div>
          {diagnostics.lastRun ? (
            <div className="settings-last-run-value">
              <strong>{formatSourceLabel(diagnostics.lastRun.source)}</strong>
              <span>{formatTimestamp(diagnostics.lastRun.completedAt)}</span>
              <span>duration {formatDuration(diagnostics.lastRun.durationMs)}</span>
              <span
                className={`settings-last-run-status${
                  diagnostics.lastRun.success ? " success" : " failure"
                }`}
              >
                {diagnostics.lastRun.success ? "completed successfully" : "failed"}
              </span>
            </div>
          ) : (
            <div className="settings-last-run-value">No indexing jobs recorded yet.</div>
          )}
        </div>
      </SectionCard>
    </>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="settings-metric-card">
      <div className="settings-metric-label">{label}</div>
      <div className="settings-metric-value">{value}</div>
      <div className="settings-metric-detail">{detail}</div>
    </div>
  );
}

function DiagnosticsRow({
  label,
  runs,
  averageDurationMs,
  maxDurationMs,
}: {
  label: string;
  runs: number;
  averageDurationMs: number;
  maxDurationMs: number;
}) {
  return (
    <div className="settings-breakdown-row">
      <span className="settings-breakdown-label">{label}</span>
      <span className="settings-breakdown-number">{formatCount(runs)}</span>
      <span className="settings-breakdown-number">{formatDuration(averageDurationMs)}</span>
      <span className="settings-breakdown-number">{formatDuration(maxDurationMs)}</span>
    </div>
  );
}

function RuntimeStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-runtime-stat">
      <span className="settings-runtime-label">{label}</span>
      <span className="settings-runtime-value">{value}</span>
    </div>
  );
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatUnitCount(value: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(value)} ${value === 1 ? singular : plural}`;
}

function formatDuration(value: number): string {
  if (value <= 0) {
    return "0 ms";
  }
  if (value < 1000) {
    return `${value} ms`;
  }
  return `${(value / 1000).toFixed(2)} s`;
}

function formatDurationPerRun(value: number): string {
  return `${formatDuration(value)} per run`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatSourceLabel(source: NonNullable<WatchStatsResponse["lastRun"]>["source"]): string {
  return source.replaceAll("_", " ");
}

function formatOptionalTrigger(timestamp: string | null, pathCount: number | null): string {
  if (!timestamp) {
    return "No watch trigger yet";
  }
  const countLabel = pathCount === null ? "" : ` (${formatUnitCount(pathCount, "changed path")})`;
  return `${formatTimestamp(timestamp)}${countLabel}`;
}
