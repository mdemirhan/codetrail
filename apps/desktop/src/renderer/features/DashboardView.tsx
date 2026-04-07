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

  const leadingProject = stats.topProjects[0] ?? null;
  const leadingModel = stats.topModels[0] ?? null;

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
