import { type Ref, useMemo } from "react";

import type { DashboardStatsResponse } from "../app/types";
import { formatCompactInteger, formatInteger } from "../lib/numberFormatting";
import { compactPath, formatDate, prettyProvider } from "../lib/viewUtils";

const CATEGORY_ACCENT_BY_ID = {
  user: "var(--dashboard-redesign-pink)",
  assistant: "var(--dashboard-redesign-blue)",
  tool_edit: "var(--dashboard-redesign-orange)",
  tool_use: "var(--dashboard-redesign-cyan)",
  tool_result: "var(--dashboard-redesign-purple)",
  thinking: "var(--dashboard-redesign-green)",
  system: "var(--dashboard-redesign-silver)",
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

const PROVIDER_ACCENT_BY_ID = {
  claude: "var(--dashboard-redesign-gold)",
  codex: "var(--dashboard-redesign-blue)",
  gemini: "var(--dashboard-redesign-cyan)",
  cursor: "var(--dashboard-redesign-purple)",
  copilot: "var(--dashboard-redesign-green)",
} as const;

const FILE_TYPE_ACCENTS = [
  "var(--dashboard-redesign-cyan)",
  "var(--dashboard-redesign-blue)",
  "var(--dashboard-redesign-purple)",
  "var(--dashboard-redesign-gold)",
  "var(--dashboard-redesign-green)",
  "var(--dashboard-redesign-pink)",
  "var(--dashboard-redesign-silver)",
] as const;

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

function formatPercentage(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0.0%";
  }
  return `${value.toFixed(1)}%`;
}

function MiniStatCard({
  label,
  value,
  meta,
  accent,
}: {
  label: string;
  value: string;
  meta: string;
  accent: string;
}) {
  return (
    <article className="dashboard-redesign-mini-stat">
      <p className="dashboard-redesign-micro-label">{label}</p>
      <strong className="dashboard-redesign-mini-value" style={{ color: accent }}>
        {value}
      </strong>
      <p className="dashboard-redesign-muted-copy">{meta}</p>
    </article>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <div className="dashboard-redesign-section-label">{children}</div>;
}

function EmptyListState({ copy }: { copy: string }) {
  return <div className="dashboard-redesign-empty-list">{copy}</div>;
}

export function DashboardView({
  stats,
  error,
  rootRef,
}: {
  stats: DashboardStatsResponse;
  error: string | null;
  rootRef?: Ref<HTMLDivElement>;
}) {
  const messageCategories = useMemo(() => {
    return Object.entries(stats.categoryCounts)
      .map(([category, count]) => ({
        category,
        count,
        label:
          CATEGORY_LABEL_BY_ID[category as keyof typeof CATEGORY_LABEL_BY_ID] ??
          category.replaceAll("_", " "),
        accent:
          CATEGORY_ACCENT_BY_ID[category as keyof typeof CATEGORY_ACCENT_BY_ID] ??
          "var(--dashboard-redesign-silver)",
      }))
      .sort((left, right) => right.count - left.count);
  }, [stats.categoryCounts]);

  const totalMessages = stats.summary.messageCount;
  const donutStops = useMemo(() => {
    if (totalMessages <= 0) {
      return "var(--dashboard-redesign-border-strong) 0deg 360deg";
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
      return "var(--dashboard-redesign-border-strong) 0deg 360deg";
    }
    return segments.join(", ");
  }, [messageCategories, totalMessages]);

  const visibleProviderStats = useMemo(() => {
    const activeProviders = stats.providerStats.filter((provider) => provider.messageCount > 0);
    return activeProviders.length > 0 ? activeProviders : stats.providerStats;
  }, [stats.providerStats]);

  const providerMax = useMemo(() => {
    return Math.max(1, ...visibleProviderStats.map((provider) => provider.messageCount));
  }, [visibleProviderStats]);

  const recentActivityMax = useMemo(() => {
    return Math.max(1, ...stats.recentActivity.map((point) => point.messageCount));
  }, [stats.recentActivity]);

  const hasAiWriteActivity = stats.aiCodeStats.summary.writeEventCount > 0;
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
        accent: "var(--dashboard-redesign-green)",
        percentage: (stats.aiCodeStats.changeTypeCounts.add / total) * 100,
      },
      {
        label: "Update",
        count: stats.aiCodeStats.changeTypeCounts.update,
        accent: "var(--dashboard-redesign-blue)",
        percentage: (stats.aiCodeStats.changeTypeCounts.update / total) * 100,
      },
      {
        label: "Delete",
        count: stats.aiCodeStats.changeTypeCounts.delete,
        accent: "var(--dashboard-redesign-red)",
        percentage: (stats.aiCodeStats.changeTypeCounts.delete / total) * 100,
      },
      {
        label: "Move",
        count: stats.aiCodeStats.changeTypeCounts.move,
        accent: "var(--dashboard-redesign-purple)",
        percentage: (stats.aiCodeStats.changeTypeCounts.move / total) * 100,
      },
    ];
  }, [stats.aiCodeStats.changeTypeCounts, stats.aiCodeStats.summary.fileChangeCount]);

  const leadingProject = stats.topProjects[0] ?? null;
  const leadingModel = stats.topModels[0] ?? null;
  const runnerUpModel = stats.topModels[1] ?? null;
  const aiWriteSessionRatio =
    stats.summary.sessionCount > 0
      ? (stats.aiCodeStats.summary.writeSessionCount / stats.summary.sessionCount) * 100
      : 0;

  const topFileTypes = useMemo(() => {
    const totalChanges = Math.max(
      1,
      stats.aiCodeStats.topFileTypes.reduce((sum, fileType) => sum + fileType.fileChangeCount, 0),
    );
    return stats.aiCodeStats.topFileTypes.map((fileType, index) => ({
      ...fileType,
      accent: FILE_TYPE_ACCENTS[index % FILE_TYPE_ACCENTS.length],
      width: `${(fileType.fileChangeCount / totalChanges) * 100}%`,
    }));
  }, [stats.aiCodeStats.topFileTypes]);

  return (
    <div className="dashboard-view dashboard-redesign" ref={rootRef} tabIndex={-1}>
      <header className="dashboard-redesign-hero">
        <div className="dashboard-redesign-hero-main">
          <p className="dashboard-redesign-eyebrow">Workspace telemetry</p>
          <h1 className="dashboard-redesign-title">
            Activity <span>Dashboard</span>
          </h1>
          <p className="dashboard-redesign-subtitle">
            Workspace telemetry across all providers, sessions, projects, message categories, and
            indexed AI write activity.
          </p>
        </div>

        <div className="dashboard-redesign-hero-side">
          <div className="dashboard-redesign-pill-row">
            <span className="dashboard-redesign-pill dashboard-redesign-pill-live">
              <span className="dashboard-redesign-pill-dot" aria-hidden />
              {formatInteger(stats.summary.activeProviderCount)} active providers
            </span>
            <span className="dashboard-redesign-pill">
              {formatInteger(stats.summary.projectCount)} projects
            </span>
            <span className="dashboard-redesign-pill">
              {formatInteger(stats.summary.sessionCount)} sessions
            </span>
          </div>
        </div>
      </header>

      {error ? <div className="dashboard-redesign-banner">{error}</div> : null}

      <section className="dashboard-redesign-primary-grid">
        <article className="dashboard-redesign-stat-card dashboard-redesign-stat-card-spotlight">
          <p className="dashboard-redesign-micro-label">Indexed Messages</p>
          <strong className="dashboard-redesign-stat-value dashboard-redesign-stat-value-gold">
            {formatCompactInteger(stats.summary.messageCount)}
          </strong>
          <p className="dashboard-redesign-stat-meta">
            Across <strong>{formatInteger(stats.summary.sessionCount)} sessions</strong> from{" "}
            <strong>{formatInteger(stats.summary.activeProviderCount)} providers</strong>
          </p>
          <div className="dashboard-redesign-substats">
            <div>
              <span>Tokens In</span>
              <strong>{formatCompactInteger(stats.summary.tokenInputTotal)}</strong>
            </div>
            <div>
              <span>Tokens Out</span>
              <strong>{formatCompactInteger(stats.summary.tokenOutputTotal)}</strong>
            </div>
            <div>
              <span>Bookmarks</span>
              <strong>{formatCompactInteger(stats.summary.bookmarkCount)}</strong>
            </div>
          </div>
        </article>

        <article className="dashboard-redesign-stat-card">
          <p className="dashboard-redesign-micro-label">Total Runtime</p>
          <strong className="dashboard-redesign-stat-value">
            {formatDuration(stats.summary.totalDurationMs)}
          </strong>
          <p className="dashboard-redesign-stat-meta">
            Avg <strong>{formatDuration(stats.summary.averageSessionDurationMs)}</strong> per
            session · <strong>{formatAverage(stats.summary.averageMessagesPerSession)} msgs</strong>
            /session
          </p>
          <div className="dashboard-redesign-substats">
            <div>
              <span>Indexed Files</span>
              <strong>{formatCompactInteger(stats.summary.indexedFileCount)}</strong>
            </div>
            <div>
              <span>Disk Scanned</span>
              <strong>{formatBytes(stats.summary.indexedBytesTotal)}</strong>
            </div>
            <div>
              <span>Tool Calls</span>
              <strong>{formatCompactInteger(stats.summary.toolCallCount)}</strong>
            </div>
          </div>
        </article>

        <article className="dashboard-redesign-stat-card">
          <p className="dashboard-redesign-micro-label">Top Model</p>
          <strong className="dashboard-redesign-stat-value dashboard-redesign-stat-value-model">
            {leadingModel ? leadingModel.modelName : "None"}
          </strong>
          <p className="dashboard-redesign-stat-meta">
            {leadingModel ? (
              <>
                <strong>{formatCompactInteger(leadingModel.messageCount)} messages</strong> across{" "}
                <strong>{formatCompactInteger(leadingModel.sessionCount)} sessions</strong>
              </>
            ) : (
              "No model metadata indexed yet"
            )}
          </p>
          <div className="dashboard-redesign-substats">
            <div>
              <span>Runner-up</span>
              <strong>{runnerUpModel ? runnerUpModel.modelName : "None"}</strong>
            </div>
            <div>
              <span>Messages</span>
              <strong>
                {runnerUpModel ? formatCompactInteger(runnerUpModel.messageCount) : "0"}
              </strong>
            </div>
            <div>
              <span>Sessions</span>
              <strong>
                {runnerUpModel ? formatCompactInteger(runnerUpModel.sessionCount) : "0"}
              </strong>
            </div>
          </div>
        </article>
      </section>

      <SectionLabel>AI Code Activity</SectionLabel>

      {!hasAiWriteActivity ? (
        <section className="dashboard-redesign-panel">
          <div className="dashboard-redesign-panel-header">
            <div>
              <p className="dashboard-redesign-panel-kicker">No write activity yet</p>
              <h2 className="dashboard-redesign-panel-title">No AI write activity indexed yet</h2>
            </div>
          </div>
          <p className="dashboard-redesign-panel-copy">
            Code Trail will surface write volume, file change mix, and top touched files here as
            soon as indexed sessions include explicit edit tools such as patches or structured
            writes.
          </p>
        </section>
      ) : (
        <>
          <section className="dashboard-redesign-mini-grid">
            <MiniStatCard
              label="Write Events"
              value={formatCompactInteger(stats.aiCodeStats.summary.writeEventCount)}
              meta={`${formatCompactInteger(stats.aiCodeStats.summary.writeSessionCount)} sessions with writes`}
              accent="var(--dashboard-redesign-cyan)"
            />
            <MiniStatCard
              label="Files Touched"
              value={formatCompactInteger(stats.aiCodeStats.summary.distinctFilesTouchedCount)}
              meta={`${formatCompactInteger(stats.aiCodeStats.summary.fileChangeCount)} file changes recorded`}
              accent="var(--dashboard-redesign-blue)"
            />
            <MiniStatCard
              label="Lines Added"
              value={formatCompactInteger(stats.aiCodeStats.summary.linesAdded)}
              meta={`${formatCompactInteger(stats.aiCodeStats.summary.linesDeleted)} deleted alongside`}
              accent="var(--dashboard-redesign-green)"
            />
            <MiniStatCard
              label="Net Lines"
              value={formatSignedInteger(stats.aiCodeStats.summary.netLines)}
              meta={`${formatAverage(stats.aiCodeStats.summary.averageFilesPerWrite)} files per measurable write`}
              accent="var(--dashboard-redesign-gold)"
            />
          </section>

          <section className="dashboard-redesign-grid dashboard-redesign-grid-feature">
            <article className="dashboard-redesign-panel">
              <div className="dashboard-redesign-panel-header">
                <div>
                  <p className="dashboard-redesign-panel-kicker">Recent AI edits</p>
                  <h2 className="dashboard-redesign-panel-title">Write Velocity</h2>
                </div>
                <span className="dashboard-redesign-badge">
                  Last {stats.activityWindowDays} days
                </span>
              </div>
              <div className="dashboard-redesign-bar-chart">
                {stats.aiCodeStats.recentActivity.map((point) => {
                  const totalLines = point.linesAdded + point.linesDeleted;
                  const stackHeight = `${Math.max(10, (totalLines / aiVelocityMax) * 100)}%`;
                  const additionsHeight =
                    totalLines > 0 ? `${(point.linesAdded / totalLines) * 100}%` : "0%";
                  const deletionsHeight =
                    totalLines > 0 ? `${(point.linesDeleted / totalLines) * 100}%` : "0%";

                  return (
                    <div key={point.date} className="dashboard-redesign-bar-group">
                      <div
                        className="dashboard-redesign-bar-stack"
                        style={{ height: stackHeight }}
                        title={`${point.date}: ${formatInteger(point.writeEventCount)} write events, ${formatInteger(point.fileChangeCount)} file changes, +${formatInteger(point.linesAdded)} / -${formatInteger(point.linesDeleted)}`}
                      >
                        <span
                          className="dashboard-redesign-bar-segment dashboard-redesign-bar-segment-add"
                          style={{ height: additionsHeight }}
                        />
                        <span
                          className="dashboard-redesign-bar-segment dashboard-redesign-bar-segment-delete"
                          style={{ height: deletionsHeight }}
                        />
                      </div>
                      <span className="dashboard-redesign-chart-date">{point.date.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="dashboard-redesign-panel">
              <div className="dashboard-redesign-panel-header">
                <div>
                  <p className="dashboard-redesign-panel-kicker">Change mix</p>
                  <h2 className="dashboard-redesign-panel-title">Change Profile</h2>
                </div>
                <span className="dashboard-redesign-badge">Mix</span>
              </div>

              <div className="dashboard-redesign-inline-bar">
                {aiChangeProfile.map((item) => (
                  <span
                    key={item.label}
                    className="dashboard-redesign-inline-segment"
                    style={{
                      width: `${Math.max(item.percentage, item.count > 0 ? 3 : 0)}%`,
                      background: item.accent,
                    }}
                  />
                ))}
              </div>

              <div className="dashboard-redesign-change-grid">
                {aiChangeProfile.map((item) => (
                  <div key={item.label} className="dashboard-redesign-change-item">
                    <strong style={{ color: item.accent }}>
                      {formatCompactInteger(item.count)}
                    </strong>
                    <span>{item.label}</span>
                    <em>{formatPercentage(item.percentage)}</em>
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="dashboard-redesign-grid dashboard-redesign-grid-dual">
            <article className="dashboard-redesign-panel">
              <div className="dashboard-redesign-panel-header">
                <div>
                  <p className="dashboard-redesign-panel-kicker">Providers</p>
                  <h2 className="dashboard-redesign-panel-title">Provider Write Throughput</h2>
                </div>
                <span className="dashboard-redesign-badge">Providers</span>
              </div>

              <div className="dashboard-redesign-list">
                {aiProviderStats.length === 0 ? (
                  <EmptyListState copy="No provider write activity indexed yet." />
                ) : (
                  aiProviderStats.map((provider) => {
                    const accent =
                      PROVIDER_ACCENT_BY_ID[
                        provider.provider as keyof typeof PROVIDER_ACCENT_BY_ID
                      ] ?? "var(--dashboard-redesign-silver)";
                    const width = `${Math.max(8, (provider.fileChangeCount / aiProviderMax) * 100)}%`;
                    return (
                      <div key={provider.provider} className="dashboard-redesign-throughput-card">
                        <div>
                          <strong
                            className="dashboard-redesign-provider-name"
                            style={{ color: accent }}
                          >
                            {prettyProvider(provider.provider)}
                          </strong>
                          <p className="dashboard-redesign-muted-copy">
                            {formatCompactInteger(provider.writeSessionCount)} sessions ·{" "}
                            {formatCompactInteger(provider.writeEventCount)} write events
                          </p>
                          <div className="dashboard-redesign-provider-bar">
                            <span
                              className="dashboard-redesign-provider-bar-fill"
                              style={{
                                width,
                                background: `linear-gradient(90deg, ${accent}, color-mix(in srgb, ${accent} 65%, white))`,
                              }}
                            />
                          </div>
                          <div className="dashboard-redesign-line-stats">
                            <span className="dashboard-redesign-line-plus">
                              +{formatCompactInteger(provider.linesAdded)} lines
                            </span>
                            <span className="dashboard-redesign-line-minus">
                              -{formatCompactInteger(provider.linesDeleted)} lines
                            </span>
                          </div>
                        </div>

                        <div className="dashboard-redesign-provider-value">
                          <strong style={{ color: accent }}>
                            {formatCompactInteger(provider.fileChangeCount)}
                          </strong>
                          <span>file changes</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </article>

            <article className="dashboard-redesign-panel">
              <div className="dashboard-redesign-panel-header">
                <div>
                  <p className="dashboard-redesign-panel-kicker">Message mix</p>
                  <h2 className="dashboard-redesign-panel-title">Message Composition</h2>
                </div>
                <span className="dashboard-redesign-badge">
                  {formatInteger(totalMessages)} total
                </span>
              </div>

              <div className="dashboard-redesign-donut-layout">
                <div
                  className="dashboard-redesign-donut"
                  style={{ backgroundImage: `conic-gradient(${donutStops})` }}
                  aria-hidden
                >
                  <div className="dashboard-redesign-donut-center">
                    <strong>{formatCompactInteger(totalMessages)}</strong>
                    <span>Messages</span>
                  </div>
                </div>

                <div className="dashboard-redesign-list">
                  {messageCategories.map((item) => {
                    const percentage = totalMessages > 0 ? (item.count / totalMessages) * 100 : 0;
                    return (
                      <div key={item.category} className="dashboard-redesign-legend-item">
                        <div className="dashboard-redesign-legend-main">
                          <span
                            className="dashboard-redesign-legend-dot"
                            style={{ background: item.accent }}
                            aria-hidden
                          />
                          <span>{item.label}</span>
                        </div>
                        <div className="dashboard-redesign-legend-right">
                          <strong>{formatCompactInteger(item.count)}</strong>
                          <span>{formatPercentage(percentage)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </article>
          </section>
        </>
      )}

      <SectionLabel>Providers &amp; Activity</SectionLabel>

      <section className="dashboard-redesign-grid dashboard-redesign-grid-dual">
        <article className="dashboard-redesign-panel">
          <div className="dashboard-redesign-panel-header">
            <div>
              <p className="dashboard-redesign-panel-kicker">Providers</p>
              <h2 className="dashboard-redesign-panel-title">Provider Throughput</h2>
            </div>
            <span className="dashboard-redesign-badge">
              {formatInteger(stats.summary.activeProviderCount)} active
            </span>
          </div>

          <div className="dashboard-redesign-list">
            {visibleProviderStats.length === 0 ? (
              <EmptyListState copy="No provider activity indexed yet." />
            ) : (
              visibleProviderStats.map((provider) => {
                const accent =
                  PROVIDER_ACCENT_BY_ID[provider.provider as keyof typeof PROVIDER_ACCENT_BY_ID] ??
                  "var(--dashboard-redesign-silver)";
                const width = `${Math.max(8, (provider.messageCount / providerMax) * 100)}%`;
                return (
                  <div key={provider.provider} className="dashboard-redesign-provider-item">
                    <div className="dashboard-redesign-provider-main">
                      <strong
                        className="dashboard-redesign-provider-name"
                        style={{ color: accent }}
                      >
                        {prettyProvider(provider.provider)}
                      </strong>
                      <p className="dashboard-redesign-muted-copy">
                        {formatCompactInteger(provider.projectCount)} projects ·{" "}
                        {formatCompactInteger(provider.sessionCount)} sessions ·{" "}
                        {formatCompactInteger(provider.toolCallCount)} tool calls
                      </p>
                      <div className="dashboard-redesign-provider-bar">
                        <span
                          className="dashboard-redesign-provider-bar-fill"
                          style={{
                            width,
                            background: accent,
                            minWidth: provider.messageCount > 0 ? "3px" : undefined,
                          }}
                        />
                      </div>
                    </div>

                    <div className="dashboard-redesign-provider-value">
                      <strong>{formatCompactInteger(provider.messageCount)}</strong>
                      <span>messages</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>

        <article className="dashboard-redesign-panel dashboard-redesign-panel-skyline">
          <div className="dashboard-redesign-panel-header">
            <div>
              <p className="dashboard-redesign-panel-kicker">Recent activity</p>
              <h2 className="dashboard-redesign-panel-title">Message Skyline</h2>
            </div>
            <span className="dashboard-redesign-badge">Last {stats.activityWindowDays} days</span>
          </div>

          <div className="dashboard-redesign-skyline">
            {stats.recentActivity.map((point) => {
              const height = `${Math.max(10, (point.messageCount / recentActivityMax) * 100)}%`;
              return (
                <div key={point.date} className="dashboard-redesign-skyline-column">
                  <div
                    className="dashboard-redesign-skyline-bar"
                    style={{ height }}
                    title={`${point.date}: ${formatInteger(point.messageCount)} messages across ${formatInteger(point.sessionCount)} sessions`}
                  />
                  <span className="dashboard-redesign-chart-date">{point.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </article>
      </section>

      <SectionLabel>Projects &amp; Models</SectionLabel>

      <section className="dashboard-redesign-grid dashboard-redesign-grid-dual">
        <article className="dashboard-redesign-panel">
          <div className="dashboard-redesign-panel-header">
            <div>
              <p className="dashboard-redesign-panel-kicker">Top projects</p>
              <h2 className="dashboard-redesign-panel-title">Top Projects</h2>
            </div>
            <span className="dashboard-redesign-badge">Where the action is</span>
          </div>

          <div className="dashboard-redesign-list">
            {stats.topProjects.length === 0 ? (
              <EmptyListState copy="No indexed project activity yet." />
            ) : (
              stats.topProjects.map((project, index) => {
                const accent =
                  PROVIDER_ACCENT_BY_ID[project.provider as keyof typeof PROVIDER_ACCENT_BY_ID] ??
                  "var(--dashboard-redesign-silver)";
                return (
                  <div key={project.projectId} className="dashboard-redesign-ranked-item">
                    <span
                      className={`dashboard-redesign-rank-chip${index < 2 ? " is-highlighted" : ""}`}
                    >
                      {index + 1}
                    </span>

                    <div className="dashboard-redesign-ranked-main">
                      <strong>{project.name || "(untitled project)"}</strong>
                      <div className="dashboard-redesign-ranked-meta-row">
                        <span className="dashboard-redesign-muted-copy" title={project.path}>
                          {compactPath(project.path)}
                        </span>
                        <span
                          className="dashboard-redesign-provider-tag"
                          style={{
                            color: accent,
                            background: `color-mix(in srgb, ${accent} 16%, transparent)`,
                            borderColor: `color-mix(in srgb, ${accent} 34%, transparent)`,
                          }}
                        >
                          {prettyProvider(project.provider)}
                        </span>
                      </div>
                    </div>

                    <div className="dashboard-redesign-ranked-value">
                      <span className="dashboard-redesign-count-primary">
                        {formatCompactInteger(project.messageCount)} msgs
                      </span>
                      <span className="dashboard-redesign-count-secondary">
                        {formatCompactInteger(project.sessionCount)} sessions
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>

        <article className="dashboard-redesign-panel">
          <div className="dashboard-redesign-panel-header">
            <div>
              <p className="dashboard-redesign-panel-kicker">Top models</p>
              <h2 className="dashboard-redesign-panel-title">Top Models</h2>
            </div>
            <span className="dashboard-redesign-badge">Most-used signatures</span>
          </div>

          <div className="dashboard-redesign-list">
            {stats.topModels.length === 0 ? (
              <EmptyListState copy="No indexed model metadata yet." />
            ) : (
              stats.topModels.map((model, index) => (
                <div key={`${model.modelName}-${index}`} className="dashboard-redesign-ranked-item">
                  <span
                    className={`dashboard-redesign-rank-chip${index < 2 ? " is-highlighted" : ""}`}
                  >
                    {index + 1}
                  </span>

                  <div className="dashboard-redesign-ranked-main">
                    <strong className="dashboard-redesign-mono">{model.modelName}</strong>
                    <p className="dashboard-redesign-muted-copy">
                      {formatCompactInteger(model.sessionCount)} sessions
                    </p>
                  </div>

                  <div className="dashboard-redesign-ranked-value">
                    <span className="dashboard-redesign-count-primary">
                      {formatCompactInteger(model.messageCount)} msgs
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <SectionLabel>Files &amp; Types</SectionLabel>

      <section className="dashboard-redesign-grid dashboard-redesign-grid-dual">
        <article className="dashboard-redesign-panel">
          <div className="dashboard-redesign-panel-header">
            <div>
              <p className="dashboard-redesign-panel-kicker">Top files</p>
              <h2 className="dashboard-redesign-panel-title">Top Written Files</h2>
            </div>
            <span className="dashboard-redesign-badge">By write events</span>
          </div>

          <div className="dashboard-redesign-list">
            {stats.aiCodeStats.topFiles.length === 0 ? (
              <EmptyListState copy="No indexed file write activity yet." />
            ) : (
              stats.aiCodeStats.topFiles.map((file, index) => (
                <div key={file.filePath} className="dashboard-redesign-ranked-item">
                  <span
                    className={`dashboard-redesign-rank-chip${index < 2 ? " is-highlighted" : ""}`}
                  >
                    {index + 1}
                  </span>

                  <div className="dashboard-redesign-ranked-main">
                    <strong className="dashboard-redesign-mono" title={file.filePath}>
                      {compactPath(file.filePath)}
                    </strong>
                    <p className="dashboard-redesign-muted-copy">
                      {formatCompactInteger(file.writeEventCount)} write events ·{" "}
                      {file.lastTouchedAt ? formatDate(file.lastTouchedAt) : "No activity"}
                    </p>
                  </div>

                  <div className="dashboard-redesign-ranked-value">
                    <span className="dashboard-redesign-line-plus">
                      +{formatCompactInteger(file.linesAdded)}
                    </span>
                    <span className="dashboard-redesign-line-minus">
                      -{formatCompactInteger(file.linesDeleted)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="dashboard-redesign-panel">
          <div className="dashboard-redesign-panel-header">
            <div>
              <p className="dashboard-redesign-panel-kicker">File types</p>
              <h2 className="dashboard-redesign-panel-title">Top File Types</h2>
            </div>
            <span className="dashboard-redesign-badge">By file changes</span>
          </div>

          {topFileTypes.length > 0 ? (
            <div className="dashboard-redesign-inline-bar dashboard-redesign-inline-bar-filetypes">
              {topFileTypes.map((fileType) => (
                <span
                  key={fileType.label}
                  className="dashboard-redesign-inline-segment"
                  style={{ width: fileType.width, background: fileType.accent }}
                />
              ))}
            </div>
          ) : null}

          <div className="dashboard-redesign-list">
            {topFileTypes.length === 0 ? (
              <EmptyListState copy="No indexed file type activity yet." />
            ) : (
              topFileTypes.map((fileType, index) => (
                <div key={`${fileType.label}-${index}`} className="dashboard-redesign-ranked-item">
                  <span
                    className={`dashboard-redesign-rank-chip${index === 0 ? " is-highlighted" : ""}`}
                    style={{
                      color: fileType.accent,
                      background: `color-mix(in srgb, ${fileType.accent} 16%, transparent)`,
                      borderColor: `color-mix(in srgb, ${fileType.accent} 36%, transparent)`,
                    }}
                  >
                    {index + 1}
                  </span>

                  <div className="dashboard-redesign-ranked-main">
                    <strong className="dashboard-redesign-mono">{fileType.label}</strong>
                    <p className="dashboard-redesign-muted-copy">
                      {formatCompactInteger(fileType.fileChangeCount)} file changes
                    </p>
                  </div>

                  <div className="dashboard-redesign-ranked-value">
                    <span className="dashboard-redesign-line-plus">
                      +{formatCompactInteger(fileType.linesAdded)}
                    </span>
                    <span className="dashboard-redesign-line-minus">
                      -{formatCompactInteger(fileType.linesDeleted)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <footer className="dashboard-redesign-footer">
        Code Trail · Workspace Telemetry · {formatPercentage(aiWriteSessionRatio)} of sessions
        include AI writes
      </footer>
    </div>
  );
}
