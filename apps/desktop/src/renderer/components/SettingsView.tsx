import { useState } from "react";

import type {
  IpcResponse,
  MessageCategory,
  Provider,
  SystemMessageRegexRules,
} from "@codetrail/core";

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
} from "../../shared/uiPreferences";
import { copyTextToClipboard } from "../lib/clipboard";
import { openPath } from "../lib/pathActions";
import { prettyCategory } from "../lib/viewUtils";
import { ToolbarIcon } from "./ToolbarIcon";
import { ZoomPercentInput } from "./ZoomPercentInput";
type SettingsInfo = IpcResponse<"app:getSettingsInfo">;
type WatchStats = IpcResponse<"watcher:getStats">;

const MONO_FONT_OPTIONS: Array<{ value: MonoFontFamily; label: string }> = [
  ...UI_MONO_FONT_VALUES.map((value) => ({
    value,
    label: value === "current" ? "JetBrains Mono" : "Droid Sans Mono",
  })),
];

const REGULAR_FONT_OPTIONS: Array<{ value: RegularFontFamily; label: string }> = [
  ...UI_REGULAR_FONT_VALUES.map((value) => ({
    value,
    label: value === "current" ? "Plus Jakarta Sans" : "Inter",
  })),
];

const MONO_FONT_SIZE_OPTIONS: Array<{ value: MonoFontSize; label: string }> =
  UI_MONO_FONT_SIZE_VALUES.map((value) => ({ value, label: value }));

const REGULAR_FONT_SIZE_OPTIONS: Array<{ value: RegularFontSize; label: string }> =
  UI_REGULAR_FONT_SIZE_VALUES.map((value) => ({ value, label: value }));

export function SettingsView({
  info,
  loading,
  error,
  diagnostics,
  diagnosticsLoading,
  diagnosticsError,
  theme,
  zoomPercent,
  monoFontFamily,
  regularFontFamily,
  monoFontSize,
  regularFontSize,
  useMonospaceForAllMessages,
  onThemeChange,
  onZoomPercentChange,
  onMonoFontFamilyChange,
  onRegularFontFamilyChange,
  onMonoFontSizeChange,
  onRegularFontSizeChange,
  onUseMonospaceForAllMessagesChange,
  expandedByDefaultCategories,
  onToggleExpandedByDefault,
  systemMessageRegexRules,
  onAddSystemMessageRegexRule,
  onUpdateSystemMessageRegexRule,
  onRemoveSystemMessageRegexRule,
}: {
  info: SettingsInfo | null;
  loading: boolean;
  error: string | null;
  diagnostics: WatchStats | null;
  diagnosticsLoading: boolean;
  diagnosticsError: string | null;
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
  expandedByDefaultCategories: MessageCategory[];
  onToggleExpandedByDefault: (category: MessageCategory) => void;
  systemMessageRegexRules: SystemMessageRegexRules;
  onAddSystemMessageRegexRule: (provider: Provider) => void;
  onUpdateSystemMessageRegexRule: (provider: Provider, index: number, pattern: string) => void;
  onRemoveSystemMessageRegexRule: (provider: Provider, index: number) => void;
}) {
  const [activeTab, setActiveTab] = useState<"settings" | "diagnostics">("settings");
  const storageRows = info
    ? [
        { label: "Settings file", value: info.storage.settingsFile },
        { label: "Database file", value: info.storage.databaseFile },
        { label: "Bookmarks database file", value: info.storage.bookmarksDatabaseFile },
        { label: "User data directory", value: info.storage.userDataDir },
      ]
    : [];

  const discoveryRows: Array<{ label: string; value: string; provider: Provider }> = info
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
        { label: "Cursor root", value: info.discovery.cursorRoot, provider: "cursor" },
        { label: "Copilot root", value: info.discovery.copilotRoot, provider: "copilot" },
      ]
    : [];

  return (
    <div className="settings-view">
      <div className="settings-page">
        <header className="settings-page-header">
          <div className="settings-page-header-left">
            <span className="settings-page-eyebrow">Code Trail</span>
            <h2>Settings</h2>
            <p>Application preferences and configuration</p>
          </div>
        </header>
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
        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon settings-section-icon-theme" aria-hidden>
              ◐
            </div>
            <div>
              <h3>Appearance</h3>
              <p>Theme and zoom used across history, search, help, and settings.</p>
            </div>
          </div>
          <div className="settings-section-body">
            <div className="settings-font-grid">
              <label className="settings-field">
                <span className="settings-field-label">Application theme</span>
                <select
                  className="settings-select"
                  aria-label="Theme"
                  value={theme}
                  onChange={(event) => onThemeChange(event.target.value as ThemeMode)}
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
              </label>

              <div className="settings-field">
                <span className="settings-field-label">Zoom</span>
                <ZoomPercentInput
                  value={zoomPercent}
                  onCommit={onZoomPercentChange}
                  ariaLabel="Zoom"
                  title="Zoom level (60%-175%)"
                  wrapperClassName="settings-zoom-control"
                  inputClassName="settings-zoom-input"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon settings-section-icon-fonts" aria-hidden>
              Aa
            </div>
            <div>
              <h3>Fonts</h3>
              <p>Regular and monospaced fonts used in the UI and message content.</p>
            </div>
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
            <div className="settings-section-icon settings-section-icon-expansion" aria-hidden>
              []
            </div>
            <div>
              <h3>Default Expansion</h3>
              <p>Which message types should start expanded in session view.</p>
            </div>
          </div>
          <div className="settings-section-body">
            <div className="settings-category-row">
              {UI_MESSAGE_CATEGORY_VALUES.map((category) => {
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

        <section className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-icon settings-section-icon-rules" aria-hidden>
              {"//"}
            </div>
            <div>
              <h3>System Message Rules</h3>
              <p>
                Regex patterns applied during ingestion to classify messages. Run Reindex after
                changes.
              </p>
            </div>
          </div>
          <div className="settings-section-body">
            {(["claude", "codex", "gemini", "cursor", "copilot"] as const).map((provider) => {
              const patterns = systemMessageRegexRules[provider] ?? [];
              return (
                <div key={provider} className="settings-rule-group">
                  <div className="settings-rule-group-header">
                    <span className={`settings-provider-badge settings-provider-${provider}`}>
                      {provider}
                    </span>
                    <button
                      type="button"
                      className="settings-rule-button settings-rule-add-button"
                      onClick={() => onAddSystemMessageRegexRule(provider)}
                      aria-label={`Add ${provider} regex rule`}
                      title={`Add ${provider} regex rule`}
                    >
                      Add Pattern
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
                                onUpdateSystemMessageRegexRule(provider, index, event.target.value)
                              }
                              placeholder="Regex pattern"
                              aria-label={`${provider} regex rule ${index + 1}`}
                            />
                            <button
                              type="button"
                              className="settings-rule-button settings-rule-remove-button"
                              onClick={() => onRemoveSystemMessageRegexRule(provider, index)}
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
                <div className="settings-section-icon settings-section-icon-storage" aria-hidden>
                  DB
                </div>
                <div>
                  <h3>Storage</h3>
                  <p>File and directory locations used by the application.</p>
                </div>
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
                <div className="settings-section-icon settings-section-icon-discovery" aria-hidden>
                  /\
                </div>
                <div>
                  <h3>Discovery Roots</h3>
                  <p>Session and project directories scanned for each provider.</p>
                </div>
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
  );
}

function SettingsInfoRow({
  label,
  value,
  provider,
}: {
  label: string;
  value: string;
  provider?: Provider;
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
            void copyTextToClipboard(value).then((copied) => {
              if (!copied) {
                console.error(`[codetrail] failed copying settings value for '${label}'`);
              }
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
            void openPath(value).then((result) => {
              if (!result.ok) {
                console.error(
                  `[codetrail] failed opening settings path '${label}': ${result.error}`,
                );
              }
            });
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

function DiagnosticsTab({
  diagnostics,
  loading,
  error,
}: {
  diagnostics: WatchStats | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !diagnostics) {
    return (
      <section className="settings-section settings-status-card">
        <p className="empty-state">Loading diagnostics...</p>
      </section>
    );
  }

  if (error && !diagnostics) {
    return (
      <section className="settings-section settings-status-card">
        <p className="empty-state">{error}</p>
      </section>
    );
  }

  if (!diagnostics) {
    return (
      <section className="settings-section settings-status-card">
        <p className="empty-state">Diagnostics are not available yet.</p>
      </section>
    );
  }

  return (
    <>
      {error ? (
        <section className="settings-section settings-status-card">
          <p className="empty-state">{error}</p>
        </section>
      ) : null}

      <section className="settings-section">
        <div className="settings-section-header">
          <div className="settings-section-icon settings-section-icon-diagnostics" aria-hidden>
            DI
          </div>
          <div>
            <h3>Overview</h3>
            <p>In-memory refresh and watcher counters for this app run.</p>
          </div>
        </div>
        <div className="settings-section-body">
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
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <div className="settings-section-icon settings-section-icon-breakdown" aria-hidden>
            RB
          </div>
          <div>
            <h3>Run Breakdown</h3>
            <p>Run counts and durations grouped by refresh source.</p>
          </div>
        </div>
        <div className="settings-section-body">
          <div className="settings-diagnostics-table">
            <div className="settings-diagnostics-row settings-diagnostics-row-header">
              <span className="settings-diagnostics-label">Trigger type</span>
              <span className="settings-diagnostics-number">Runs</span>
              <span className="settings-diagnostics-number">Avg duration</span>
              <span className="settings-diagnostics-number">Max duration</span>
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
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <div className="settings-section-icon settings-section-icon-discovery" aria-hidden>
            RT
          </div>
          <div>
            <h3>Runtime</h3>
            <p>Watcher backend, run durations, and the most recent indexing job.</p>
          </div>
        </div>
        <div className="settings-section-body">
          <div className="settings-runtime-grid">
            <RuntimeStat
              label="Started"
              value={formatTimestamp(diagnostics.startedAt)}
            />
            <RuntimeStat
              label="Watcher backend"
              value={diagnostics.watcher.backend ?? "not started"}
            />
            <RuntimeStat
              label="Watched roots"
              value={formatUnitCount(diagnostics.watcher.watchedRootCount, "root")}
            />
            <RuntimeStat
              label="Last trigger"
              value={formatOptionalTrigger(diagnostics.watcher.lastTriggerAt, diagnostics.watcher.lastTriggerPathCount)}
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
                <span>{diagnostics.lastRun.success ? "completed successfully" : "failed"}</span>
              </div>
            ) : (
              <div className="settings-last-run-value">No indexing jobs recorded yet.</div>
            )}
          </div>
        </div>
      </section>
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
    <div className="settings-diagnostics-row">
      <span className="settings-diagnostics-label">{label}</span>
      <span className="settings-diagnostics-number">{formatCount(runs)}</span>
      <span className="settings-diagnostics-number">{formatDuration(averageDurationMs)}</span>
      <span className="settings-diagnostics-number">{formatDuration(maxDurationMs)}</span>
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

function formatSourceLabel(source: NonNullable<WatchStats["lastRun"]>["source"]): string {
  return source.replaceAll("_", " ");
}

function formatOptionalTrigger(timestamp: string | null, pathCount: number | null): string {
  if (!timestamp) {
    return "No watch trigger yet";
  }
  const countLabel = pathCount === null ? "" : ` (${formatUnitCount(pathCount, "changed path")})`;
  return `${formatTimestamp(timestamp)}${countLabel}`;
}
