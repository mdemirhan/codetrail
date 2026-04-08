import { useMemo } from "react";

import type { DashboardStatsResponse } from "../app/types";
import { ToolbarIcon } from "../components/ToolbarIcon";
import { formatCompactInteger, formatInteger } from "../lib/numberFormatting";
import { compactPath, formatDate, prettyProvider } from "../lib/viewUtils";

const CATEGORY_ACCENT_BY_ID = {
  user: "var(--cat-user-text)",
  assistant: "var(--cat-assistant-text)",
  tool_edit: "var(--cat-write-text)",
  tool_use: "var(--cat-tool-use-text)",
  tool_result: "var(--cat-tool-result-text)",
  thinking: "var(--cat-thinking-text)",
  system: "var(--cat-system-text)",
} as const;

const CATEGORY_LABEL_BY_ID = {
  user: "User",
  assistant: "Assistant",
  tool_edit: "Write",
  tool_use: "Tool Use",
  tool_result: "Tool Result",
  thinking: "Thinking",
  system: "System",
} as const;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 100 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return "0m";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${totalSeconds}s`;
}

function formatAverage(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function formatSignedInteger(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) {
    return `+${formatInteger(rounded)}`;
  }
  return formatInteger(rounded);
}

function MetricCard({
  label,
  value,
  meta,
  tone = "blue",
}: {
  label: string;
  value: string;
  meta: string;
  tone?: "blue" | "green" | "orange" | "purple" | "teal" | "muted";
}) {
  return (
    <article className={`dashboard-metric-card dashboard-tone-${tone}`}>
      <p className="dashboard-metric-label">{label}</p>
      <strong className="dashboard-metric-value">{value}</strong>
      <p className="dashboard-metric-meta">{meta}</p>
    </article>
  );
}

export function DashboardView({
  stats,
  loading,
  error,
  onRefresh,
}: {
  stats: DashboardStatsResponse;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const messageCategories = useMemo(() => {
    return Object.entries(stats.categoryCounts)
      .map(([category, count]) => ({
        category,
        count,
        label: CATEGORY_LABEL_BY_ID[category as keyof typeof CATEGORY_LABEL_BY_ID],
        accent: CATEGORY_ACCENT_BY_ID[category as keyof typeof CATEGORY_ACCENT_BY_ID],
      }))
      .sort((left, right) => right.count - left.count);
  }, [stats.categoryCounts]);

  const totalMessages = stats.summary.messageCount;
  const donutStops = useMemo(() => {
    if (totalMessages <= 0) {
      return "var(--border) 0deg 360deg";
    }
    let offset = 0;
    const segments: string[] = [];
    for (const item of messageCategories) {
      if (item.count <= 0) {
        continue;
      }
      const span = (item.count / totalMessages) * 360;
      const nextOffset = offset + span;
      segments.push(`${item.accent} ${offset.toFixed(2)}deg ${nextOffset.toFixed(2)}deg`);
      offset = nextOffset;
    }
    if (segments.length === 0) {
      return "var(--border) 0deg 360deg";
    }
    return segments.join(", ");
  }, [messageCategories, totalMessages]);

  const recentActivityMax = useMemo(() => {
    return Math.max(1, ...stats.recentActivity.map((point) => point.messageCount));
  }, [stats.recentActivity]);

  const providerMax = useMemo(() => {
    return Math.max(1, ...stats.providerStats.map((provider) => provider.messageCount));
  }, [stats.providerStats]);
  const aiVelocityMax = useMemo(() => {
    return Math.max(
      1,
      ...stats.aiCodeStats.recentActivity.map((point) => point.linesAdded + point.linesDeleted),
    );
  }, [stats.aiCodeStats.recentActivity]);
  const aiProviderStats = useMemo(() => {
    return [...stats.aiCodeStats.providerStats]
      .filter((provider) => provider.writeEventCount > 0 || provider.fileChangeCount > 0)
      .sort((left, right) => {
        if (right.fileChangeCount !== left.fileChangeCount) {
          return right.fileChangeCount - left.fileChangeCount;
        }
        const leftLines = left.linesAdded + left.linesDeleted;
        const rightLines = right.linesAdded + right.linesDeleted;
        if (rightLines !== leftLines) {
          return rightLines - leftLines;
        }
        return left.provider.localeCompare(right.provider);
      });
  }, [stats.aiCodeStats.providerStats]);
  const aiProviderMax = useMemo(() => {
    return Math.max(1, ...aiProviderStats.map((provider) => provider.fileChangeCount));
  }, [aiProviderStats]);
  const aiChangeProfile = useMemo(() => {
    const total = Math.max(1, stats.aiCodeStats.summary.fileChangeCount);
    return [
      {
        label: "Add",
        count: stats.aiCodeStats.changeTypeCounts.add,
        accent: "var(--accent-green)",
        percentage: (stats.aiCodeStats.changeTypeCounts.add / total) * 100,
      },
      {
        label: "Update",
        count: stats.aiCodeStats.changeTypeCounts.update,
        accent: "var(--accent-blue)",
        percentage: (stats.aiCodeStats.changeTypeCounts.update / total) * 100,
      },
      {
        label: "Delete",
        count: stats.aiCodeStats.changeTypeCounts.delete,
        accent: "var(--accent-red)",
        percentage: (stats.aiCodeStats.changeTypeCounts.delete / total) * 100,
      },
      {
        label: "Move",
        count: stats.aiCodeStats.changeTypeCounts.move,
        accent: "var(--accent-purple)",
        percentage: (stats.aiCodeStats.changeTypeCounts.move / total) * 100,
      },
    ];
  }, [stats.aiCodeStats.changeTypeCounts, stats.aiCodeStats.summary.fileChangeCount]);

  const leadingProject = stats.topProjects[0] ?? null;
  const leadingModel = stats.topModels[0] ?? null;
  const hasAiWriteActivity = stats.aiCodeStats.summary.writeEventCount > 0;
  const hasPartialAiCoverage =
    stats.aiCodeStats.summary.measurableWriteEventCount < stats.aiCodeStats.summary.writeEventCount;
  const aiWriteSessionRatio =
    stats.summary.sessionCount > 0
      ? (stats.aiCodeStats.summary.writeSessionCount / stats.summary.sessionCount) * 100
      : 0;

  return (
    <div className="dashboard-view">
      <header className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <p className="dashboard-eyebrow">Workspace telemetry</p>
          <h1 className="dashboard-title">Activity Dashboard</h1>
          <p className="dashboard-subtitle">
            A live snapshot of everything Code Trail has indexed across providers, sessions, message
            categories, tool usage, and recent project activity.
          </p>
        </div>
        <button
          type="button"
          className="tb-btn"
          onClick={onRefresh}
          aria-label={loading ? "Refreshing dashboard" : "Refresh dashboard"}
          title={loading ? "Refreshing dashboard" : "Refresh dashboard"}
        >
          <ToolbarIcon name="refresh" />
          {loading ? "Refreshing..." : "Refresh Dashboard"}
        </button>
      </header>

      {error ? <div className="dashboard-banner dashboard-banner-error">{error}</div> : null}

      <section className="dashboard-summary-grid">
        <article className="dashboard-spotlight-card">
          <div className="dashboard-spotlight-orb" aria-hidden />
          <p className="dashboard-spotlight-label">Indexed Messages</p>
          <strong className="dashboard-spotlight-value">
            {formatCompactInteger(stats.summary.messageCount)}
          </strong>
          <p className="dashboard-spotlight-meta">
            {formatInteger(stats.summary.activeProviderCount)} active providers,{" "}
            {formatInteger(stats.summary.projectCount)} projects,{" "}
            {formatInteger(stats.summary.sessionCount)} sessions
          </p>
          <div className="dashboard-spotlight-foot">
            <span>Tokens in {formatCompactInteger(stats.summary.tokenInputTotal)}</span>
            <span>Tokens out {formatCompactInteger(stats.summary.tokenOutputTotal)}</span>
          </div>
        </article>

        <MetricCard
          label="Bookmarks"
          value={formatCompactInteger(stats.summary.bookmarkCount)}
          meta={`${formatInteger(stats.summary.toolCallCount)} captured tool calls`}
          tone="purple"
        />
        <MetricCard
          label="Indexed Files"
          value={formatCompactInteger(stats.summary.indexedFileCount)}
          meta={`${formatBytes(stats.summary.indexedBytesTotal)} scanned from disk`}
          tone="teal"
        />
        <MetricCard
          label="Average Session"
          value={`${formatAverage(stats.summary.averageMessagesPerSession)} msgs`}
          meta={`${formatDuration(stats.summary.averageSessionDurationMs)} per session`}
          tone="orange"
        />
        <MetricCard
          label="Total Runtime"
          value={formatDuration(stats.summary.totalDurationMs)}
          meta={leadingProject ? `${leadingProject.name} leads by volume` : "No projects yet"}
          tone="green"
        />
        <MetricCard
          label="Top Model Mix"
          value={leadingModel ? leadingModel.modelName : "None"}
          meta={
            leadingModel
              ? `${formatCompactInteger(leadingModel.messageCount)} messages across ${formatCompactInteger(leadingModel.sessionCount)} sessions`
              : "No model metadata indexed yet"
          }
          tone="muted"
        />
      </section>

      <section className="dashboard-ai-section">
        <div className="dashboard-section-heading">
          <div>
            <p className="dashboard-card-eyebrow">AI code activity</p>
            <h2 className="dashboard-section-title">AI Code Activity</h2>
          </div>
          <span className="dashboard-card-meta">Write-only telemetry from explicit tool edits</span>
        </div>

        {!hasAiWriteActivity ? (
          <article className="dashboard-card dashboard-ai-empty-state">
            <div className="dashboard-card-header">
              <div>
                <p className="dashboard-card-eyebrow">No write activity yet</p>
                <h2 className="dashboard-card-title">No AI write activity indexed yet</h2>
              </div>
            </div>
            <p className="dashboard-ai-empty-copy">
              Code Trail will surface write volume, file change mix, and top touched files here as
              soon as indexed sessions include explicit edit tools such as patches or structured
              writes.
            </p>
          </article>
        ) : (
          <>
            <section className="dashboard-ai-metric-grid">
              <MetricCard
                label="AI Write Events"
                value={formatCompactInteger(stats.aiCodeStats.summary.writeEventCount)}
                meta={`${formatCompactInteger(stats.aiCodeStats.summary.writeSessionCount)} sessions with writes`}
                tone="blue"
              />
              <MetricCard
                label="Files Touched"
                value={formatCompactInteger(stats.aiCodeStats.summary.distinctFilesTouchedCount)}
                meta={`${formatCompactInteger(stats.aiCodeStats.summary.fileChangeCount)} file changes recorded`}
                tone="teal"
              />
              <MetricCard
                label="Lines Added"
                value={formatCompactInteger(stats.aiCodeStats.summary.linesAdded)}
                meta={`${formatCompactInteger(stats.aiCodeStats.summary.linesDeleted)} deleted alongside additions`}
                tone="green"
              />
              <MetricCard
                label="Net Lines"
                value={formatSignedInteger(stats.aiCodeStats.summary.netLines)}
                meta={`${formatAverage(stats.aiCodeStats.summary.averageFilesPerWrite)} files per measurable write`}
                tone="orange"
              />
            </section>

            <div className="dashboard-ai-note">
              <span>
                Measured from{" "}
                {formatCompactInteger(stats.aiCodeStats.summary.measurableWriteEventCount)} of{" "}
                {formatCompactInteger(stats.aiCodeStats.summary.writeEventCount)} write events.
              </span>
              <span>
                {aiWriteSessionRatio.toFixed(1)}% of indexed sessions include AI writes.
              </span>
              {hasPartialAiCoverage ? (
                <span>Some write payloads could not be fully parsed, so line totals are conservative.</span>
              ) : null}
            </div>

            <section className="dashboard-ai-main-grid">
              <article className="dashboard-card dashboard-card-feature">
                <div className="dashboard-card-header">
                  <div>
                    <p className="dashboard-card-eyebrow">Recent AI edits</p>
                    <h2 className="dashboard-card-title">Write Velocity</h2>
                  </div>
                  <span className="dashboard-card-meta">Last {stats.activityWindowDays} days</span>
                </div>
                <div className="dashboard-ai-velocity">
                  {stats.aiCodeStats.recentActivity.map((point) => {
                    const totalLines = point.linesAdded + point.linesDeleted;
                    const stackHeight = `${Math.max(10, (totalLines / aiVelocityMax) * 100)}%`;
                    const additionShare = totalLines > 0 ? (point.linesAdded / totalLines) * 100 : 0;
                    const deletionShare = totalLines > 0 ? (point.linesDeleted / totalLines) * 100 : 0;
                    return (
                      <div key={point.date} className="dashboard-ai-velocity-column">
                        <div
                          className="dashboard-ai-velocity-stack"
                          style={{ height: stackHeight }}
                          title={`${point.date}: ${formatInteger(point.writeEventCount)} write events, ${formatInteger(point.fileChangeCount)} file changes, +${formatInteger(point.linesAdded)} / -${formatInteger(point.linesDeleted)}`}
                        >
                          <span
                            className="dashboard-ai-velocity-bar dashboard-ai-velocity-bar-add"
                            style={{ height: `${additionShare}%` }}
                          />
                          <span
                            className="dashboard-ai-velocity-bar dashboard-ai-velocity-bar-delete"
                            style={{ height: `${deletionShare}%` }}
                          />
                        </div>
                        <span>{point.date.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              </article>

              <div className="dashboard-ai-side-grid">
                <article className="dashboard-card">
                  <div className="dashboard-card-header">
                    <div>
                      <p className="dashboard-card-eyebrow">Change mix</p>
                      <h2 className="dashboard-card-title">Change Profile</h2>
                    </div>
                  </div>
                  <div className="dashboard-legend">
                    {aiChangeProfile.map((item) => (
                      <div key={item.label} className="dashboard-legend-row">
                        <div className="dashboard-legend-main">
                          <span
                            className="dashboard-legend-swatch"
                            style={{ background: item.accent }}
                            aria-hidden
                          />
                          <span className="dashboard-legend-label">{item.label}</span>
                        </div>
                        <div className="dashboard-legend-stats">
                          <strong>{formatCompactInteger(item.count)}</strong>
                          <span>{item.percentage.toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="dashboard-card">
                  <div className="dashboard-card-header">
                    <div>
                      <p className="dashboard-card-eyebrow">Providers</p>
                      <h2 className="dashboard-card-title">Provider Write Throughput</h2>
                    </div>
                  </div>
                  <div className="dashboard-provider-list">
                    {aiProviderStats.map((provider) => {
                      const width = `${Math.max(8, (provider.fileChangeCount / aiProviderMax) * 100)}%`;
                      return (
                        <div key={provider.provider} className="dashboard-provider-row">
                          <div className="dashboard-provider-head">
                            <div>
                              <strong>{prettyProvider(provider.provider)}</strong>
                              <p>
                                {formatCompactInteger(provider.writeSessionCount)} sessions,{" "}
                                {formatCompactInteger(provider.writeEventCount)} write events
                              </p>
                            </div>
                            <div className="dashboard-provider-counts">
                              <strong>{formatCompactInteger(provider.fileChangeCount)}</strong>
                              <span>file changes</span>
                            </div>
                          </div>
                          <div className="dashboard-provider-bar">
                            <span className="dashboard-provider-bar-fill" style={{ width }} />
                          </div>
                          <div className="dashboard-provider-foot">
                            <span>+{formatCompactInteger(provider.linesAdded)} lines</span>
                            <span>-{formatCompactInteger(provider.linesDeleted)} lines</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </article>
              </div>
            </section>

            <section className="dashboard-ai-secondary-grid">
              <article className="dashboard-card">
                <div className="dashboard-card-header">
                  <div>
                    <p className="dashboard-card-eyebrow">Top files</p>
                    <h2 className="dashboard-card-title">Top Written Files</h2>
                  </div>
                </div>
                <div className="dashboard-ranked-list">
                  {stats.aiCodeStats.topFiles.map((file, index) => (
                    <div key={file.filePath} className="dashboard-ranked-row">
                      <div className="dashboard-ranked-rank">{index + 1}</div>
                      <div className="dashboard-ranked-main">
                        <div className="dashboard-ranked-title-row">
                          <strong title={file.filePath}>{compactPath(file.filePath)}</strong>
                        </div>
                        <div className="dashboard-ranked-meta">
                          <span>{formatCompactInteger(file.writeEventCount)} write events</span>
                          <span>+{formatCompactInteger(file.linesAdded)}</span>
                          <span>-{formatCompactInteger(file.linesDeleted)}</span>
                          <span>
                            {file.lastTouchedAt ? formatDate(file.lastTouchedAt) : "No activity"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="dashboard-card">
                <div className="dashboard-card-header">
                  <div>
                    <p className="dashboard-card-eyebrow">File types</p>
                    <h2 className="dashboard-card-title">Top File Types</h2>
                  </div>
                </div>
                <div className="dashboard-model-list">
                  {stats.aiCodeStats.topFileTypes.map((fileType, index) => (
                    <div key={`${fileType.label}-${index}`} className="dashboard-model-row">
                      <div>
                        <strong>{fileType.label}</strong>
                        <p>
                          {formatCompactInteger(fileType.fileChangeCount)} file changes, +
                          {formatCompactInteger(fileType.linesAdded)} / -
                          {formatCompactInteger(fileType.linesDeleted)}
                        </p>
                      </div>
                      <span className="dashboard-model-chip">{index + 1}</span>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </>
        )}
      </section>

      <section className="dashboard-main-grid">
        <article className="dashboard-card dashboard-card-feature">
          <div className="dashboard-card-header">
            <div>
              <p className="dashboard-card-eyebrow">Message mix</p>
              <h2 className="dashboard-card-title">Category Composition</h2>
            </div>
            <span className="dashboard-card-meta">{formatInteger(totalMessages)} total</span>
          </div>
          <div className="dashboard-composition">
            <div
              className="dashboard-donut"
              style={{ backgroundImage: `conic-gradient(${donutStops})` }}
              aria-hidden
            >
              <div className="dashboard-donut-center">
                <span>Messages</span>
                <strong>{formatCompactInteger(totalMessages)}</strong>
              </div>
            </div>
            <div className="dashboard-legend">
              {messageCategories.map((item) => {
                const percentage = totalMessages > 0 ? (item.count / totalMessages) * 100 : 0;
                return (
                  <div key={item.category} className="dashboard-legend-row">
                    <div className="dashboard-legend-main">
                      <span
                        className="dashboard-legend-swatch"
                        style={{ background: item.accent }}
                        aria-hidden
                      />
                      <span className="dashboard-legend-label">{item.label}</span>
                    </div>
                    <div className="dashboard-legend-stats">
                      <strong>{formatCompactInteger(item.count)}</strong>
                      <span>{percentage.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </article>

        <article className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <p className="dashboard-card-eyebrow">Providers</p>
              <h2 className="dashboard-card-title">Provider Throughput</h2>
            </div>
            <span className="dashboard-card-meta">
              {formatInteger(stats.summary.activeProviderCount)} with activity
            </span>
          </div>
          <div className="dashboard-provider-list">
            {stats.providerStats.map((provider) => {
              const width = `${Math.max(8, (provider.messageCount / providerMax) * 100)}%`;
              return (
                <div key={provider.provider} className="dashboard-provider-row">
                  <div className="dashboard-provider-head">
                    <div>
                      <strong>{prettyProvider(provider.provider)}</strong>
                      <p>
                        {formatCompactInteger(provider.projectCount)} projects,{" "}
                        {formatCompactInteger(provider.sessionCount)} sessions
                      </p>
                    </div>
                    <div className="dashboard-provider-counts">
                      <strong>{formatCompactInteger(provider.messageCount)}</strong>
                      <span>messages</span>
                    </div>
                  </div>
                  <div className="dashboard-provider-bar">
                    <span className="dashboard-provider-bar-fill" style={{ width }} />
                  </div>
                  <div className="dashboard-provider-foot">
                    <span>{formatCompactInteger(provider.toolCallCount)} tool calls</span>
                    <span>
                      {provider.lastActivity ? formatDate(provider.lastActivity) : "No activity"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="dashboard-card dashboard-card-feature">
          <div className="dashboard-card-header">
            <div>
              <p className="dashboard-card-eyebrow">Recent activity</p>
              <h2 className="dashboard-card-title">Message Skyline</h2>
            </div>
            <span className="dashboard-card-meta">Last {stats.activityWindowDays} days</span>
          </div>
          <div className="dashboard-skyline">
            {stats.recentActivity.map((point) => {
              const height = `${Math.max(10, (point.messageCount / recentActivityMax) * 100)}%`;
              return (
                <div key={point.date} className="dashboard-skyline-column">
                  <div
                    className="dashboard-skyline-bar"
                    style={{ height }}
                    title={`${point.date}: ${formatInteger(point.messageCount)} messages across ${formatInteger(point.sessionCount)} sessions`}
                  />
                  <span>{point.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </article>
      </section>

      <section className="dashboard-secondary-grid">
        <article className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <p className="dashboard-card-eyebrow">Top projects</p>
              <h2 className="dashboard-card-title">Where the action is</h2>
            </div>
          </div>
          <div className="dashboard-ranked-list">
            {stats.topProjects.map((project, index) => (
              <div key={project.projectId} className="dashboard-ranked-row">
                <div className="dashboard-ranked-rank">{index + 1}</div>
                <div className="dashboard-ranked-main">
                  <div className="dashboard-ranked-title-row">
                    <strong>{project.name || "(untitled project)"}</strong>
                    <span className="dashboard-ranked-provider">
                      {prettyProvider(project.provider)}
                    </span>
                  </div>
                  <p title={project.path}>{compactPath(project.path)}</p>
                  <div className="dashboard-ranked-meta">
                    <span>{formatCompactInteger(project.messageCount)} messages</span>
                    <span>{formatCompactInteger(project.sessionCount)} sessions</span>
                    <span>{formatCompactInteger(project.bookmarkCount)} bookmarks</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <p className="dashboard-card-eyebrow">Top models</p>
              <h2 className="dashboard-card-title">Most-used model signatures</h2>
            </div>
          </div>
          <div className="dashboard-model-list">
            {stats.topModels.map((model, index) => (
              <div key={`${model.modelName}-${index}`} className="dashboard-model-row">
                <div>
                  <strong>{model.modelName}</strong>
                  <p>
                    {formatCompactInteger(model.sessionCount)} sessions,{" "}
                    {formatCompactInteger(model.messageCount)} messages
                  </p>
                </div>
                <span className="dashboard-model-chip">{index + 1}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
