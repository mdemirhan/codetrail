import type { IpcResponse } from "@codetrail/core";

type SettingsInfo = IpcResponse<"app:getSettingsInfo">;

export function SettingsView({
  info,
  loading,
  error,
}: {
  info: SettingsInfo | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="settings-view">
      <div className="content-head">
        <h2>Settings</h2>
        <p>Environment and storage information</p>
      </div>
      <div className="settings-scroll">
        {loading ? <p className="empty-state">Loading settings…</p> : null}
        {!loading && error ? <p className="empty-state">{error}</p> : null}
        {!loading && !error && info ? (
          <>
            <section className="settings-section">
              <h3>Storage</h3>
              <p>These locations are managed by the app and are read-only here.</p>
              <div className="settings-grid">
                <div className="settings-row">
                  <span className="settings-key">Settings file</span>
                  <code className="settings-value">{info.storage.settingsFile}</code>
                </div>
                <div className="settings-row">
                  <span className="settings-key">Cache directory</span>
                  <code className="settings-value">{info.storage.cacheDir}</code>
                </div>
                <div className="settings-row">
                  <span className="settings-key">Database file</span>
                  <code className="settings-value">{info.storage.databaseFile}</code>
                </div>
                <div className="settings-row">
                  <span className="settings-key">User data directory</span>
                  <code className="settings-value">{info.storage.userDataDir}</code>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <h3>Discovery Roots</h3>
              <p>These roots are used when indexing Claude, Gemini, and Codex sessions.</p>
              <div className="settings-grid">
                <div className="settings-row">
                  <span className="settings-key">Claude root</span>
                  <code className="settings-value">{info.discovery.claudeRoot}</code>
                </div>
                <div className="settings-row">
                  <span className="settings-key">Codex root</span>
                  <code className="settings-value">{info.discovery.codexRoot}</code>
                </div>
                <div className="settings-row">
                  <span className="settings-key">Gemini tmp root</span>
                  <code className="settings-value">{info.discovery.geminiRoot}</code>
                </div>
                <div className="settings-row">
                  <span className="settings-key">Gemini history root</span>
                  <code className="settings-value">{info.discovery.geminiHistoryRoot}</code>
                </div>
                <div className="settings-row">
                  <span className="settings-key">Gemini projects file</span>
                  <code className="settings-value">{info.discovery.geminiProjectsPath}</code>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
