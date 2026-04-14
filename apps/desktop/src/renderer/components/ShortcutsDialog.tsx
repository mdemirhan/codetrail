import type { CSSProperties, ReactNode } from "react";

import type { MessageCategory } from "@codetrail/core/browser";

import type { ShortcutRegistry } from "../lib/shortcutRegistry";

type SyntaxItem = {
  syntax: string;
  description: string;
  note?: string;
};

type ShortcutSectionRow = {
  label: string;
  shortcuts: string[];
};

type FilterRow = {
  category: MessageCategory;
  label: string;
  colorVar:
    | "--cat-user-text"
    | "--cat-assistant-text"
    | "--cat-write-text"
    | "--cat-tool-use-text"
    | "--cat-tool-result-text"
    | "--cat-thinking-text"
    | "--cat-system-text";
};

const MODIFIER_SYMBOLS: Record<string, string> = {
  Cmd: "⌘",
  Ctrl: "⌃",
  Shift: "⇧",
  Alt: "⌥",
  Option: "⌥",
};

const KEY_SYMBOLS: Record<string, string> = {
  Left: "←",
  Right: "→",
  Up: "↑",
  Down: "↓",
  Plus: "+",
  "Page Up": "PgUp",
  "Page Down": "PgDn",
};

const FILTER_ROWS: FilterRow[] = [
  { category: "user", label: "User", colorVar: "--cat-user-text" },
  { category: "assistant", label: "Assistant", colorVar: "--cat-assistant-text" },
  { category: "tool_edit", label: "Write", colorVar: "--cat-write-text" },
  { category: "tool_use", label: "Tool Use", colorVar: "--cat-tool-use-text" },
  { category: "tool_result", label: "Tool Result", colorVar: "--cat-tool-result-text" },
  { category: "thinking", label: "Thinking", colorVar: "--cat-thinking-text" },
  { category: "system", label: "System", colorVar: "--cat-system-text" },
] as const;

export function ShortcutsDialog({
  shortcuts,
  commonSyntaxItems,
  advancedSyntaxItems,
}: {
  shortcuts: ShortcutRegistry;
  commonSyntaxItems: SyntaxItem[];
  advancedSyntaxItems: SyntaxItem[];
}) {
  const syntaxItems = [
    ...commonSyntaxItems.map((item) => ({ ...item, advanced: false })),
    ...advancedSyntaxItems.map((item) => ({ ...item, advanced: true })),
  ];
  const searchRows: ShortcutSectionRow[] = [
    {
      label: "Search current view",
      shortcuts: [findShortcut(shortcuts, "Search current view")],
    },
    {
      label: "Global search",
      shortcuts: [shortcuts.actions.openGlobalSearch],
    },
  ];
  const navigationRows: ShortcutSectionRow[] = [
    {
      label: "Previous page / turn",
      shortcuts: [shortcuts.actions.previousPage],
    },
    {
      label: "Next page / turn",
      shortcuts: [shortcuts.actions.nextPage],
    },
    {
      label: "Previous message / result",
      shortcuts: [findShortcut(shortcuts, "Previous message or result")],
    },
    {
      label: "Next message / result",
      shortcuts: [findShortcut(shortcuts, "Next message or result")],
    },
    {
      label: "Previous session / project",
      shortcuts: [
        findShortcut(
          shortcuts,
          "Previous session, or previous project when Sessions pane is collapsed or hidden",
        ),
      ],
    },
    {
      label: "Next session / project",
      shortcuts: [
        findShortcut(
          shortcuts,
          "Next session, or next project when Sessions pane is collapsed or hidden",
        ),
      ],
    },
    {
      label: "Previous project",
      shortcuts: [findShortcut(shortcuts, "Previous project")],
    },
    {
      label: "Next project",
      shortcuts: [findShortcut(shortcuts, "Next project")],
    },
  ];
  const scrollRows: ShortcutSectionRow[] = [
    {
      label: "Page up",
      shortcuts: sortPageTraversalShortcuts(
        findShortcuts(shortcuts, "Page up in current list"),
        shortcuts,
      ),
    },
    {
      label: "Page down",
      shortcuts: sortPageTraversalShortcuts(
        findShortcuts(shortcuts, "Page down in current list"),
        shortcuts,
      ),
    },
  ];
  const paneRows: ShortcutSectionRow[] = [
    { label: "Next pane", shortcuts: ["Tab"] },
    { label: "Previous pane", shortcuts: ["Shift+Tab"] },
  ];
  const viewRows: ShortcutSectionRow[] = [
    {
      label: "Flat view",
      shortcuts: [shortcuts.actions.showMessagesView],
    },
    {
      label: "Turns view",
      shortcuts: [shortcuts.actions.showTurnsView],
    },
    {
      label: "Toggle flat / turns view",
      shortcuts: [shortcuts.actions.cycleMessagesTurnsView],
    },
    {
      label: "Bookmarks view",
      shortcuts: [shortcuts.actions.showBookmarksView],
    },
    {
      label: "Toggle Projects pane",
      shortcuts: [shortcuts.actions.toggleProjectPane],
    },
    {
      label: "Toggle Sessions pane",
      shortcuts: [shortcuts.actions.toggleSessionPane],
    },
    {
      label: "Expand / collapse / restore",
      shortcuts: [shortcuts.actions.toggleAllMessagesExpanded],
    },
    {
      label: "Expand / collapse combined diffs",
      shortcuts: splitShortcutAlternatives(shortcuts.actions.toggleCombinedChangesDiffsExpanded),
    },
  ];
  const refreshRows: ShortcutSectionRow[] = [
    {
      label: "Refresh now",
      shortcuts: [shortcuts.actions.refreshNow],
    },
    {
      label: "Toggle auto-refresh",
      shortcuts: [shortcuts.actions.toggleAutoRefresh],
    },
  ];
  const systemRows: ShortcutSectionRow[] = [
    {
      label: "Settings",
      shortcuts: [shortcuts.actions.openSettings],
    },
    {
      label: "Zoom in",
      shortcuts: [shortcuts.actions.zoomIn],
    },
    {
      label: "Zoom out",
      shortcuts: [shortcuts.actions.zoomOut],
    },
    {
      label: "Reset zoom",
      shortcuts: [shortcuts.actions.zoomReset],
    },
  ];

  return (
    <div className="help-view">
      <div className="help-page">
        <HelpSection title="Search">
          <ShortcutGrid rows={searchRows} />
        </HelpSection>

        <HelpSection title="Search Syntax">
          <div className="help-syntax-grid">
            {syntaxItems.map((item) => (
              <div key={`${item.syntax}-${item.description}`} className="help-syntax-row">
                <div className="help-syntax-example">{renderSyntaxToken(item.syntax)}</div>
                <div className="help-syntax-copy">
                  <span className="help-syntax-description">{item.description}</span>
                  {item.advanced ? <span className="help-badge">Advanced</span> : null}
                  {item.note ? <div className="help-syntax-note">{item.note}</div> : null}
                </div>
              </div>
            ))}
          </div>
          <div className="help-info-box">
            <strong>Advanced mode</strong> applies to history and global message search only.
            Project search uses plain text filtering.
          </div>
        </HelpSection>

        <HelpSection title="Navigation">
          <ShortcutGrid rows={navigationRows} />
          <div className="help-subheading">Scroll current list</div>
          <ShortcutGrid rows={scrollRows} />
          <div className="help-subheading">Panes</div>
          <ShortcutGrid rows={paneRows} />
        </HelpSection>

        <HelpSection title="Views & Panels">
          <ShortcutGrid rows={viewRows} />
        </HelpSection>

        <HelpSection title="Message Filters">
          <p className="help-section-copy">
            Each message type has three filter modes. The number key selects the type:
          </p>
          <div className="help-filter-table-wrap">
            <table className="help-filter-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Show / Hide</th>
                  <th>Expand / Collapse</th>
                  <th>Focus (solo)</th>
                </tr>
              </thead>
              <tbody>
                {FILTER_ROWS.map((row) => (
                  <tr key={row.category}>
                    <td>
                      <span
                        className="help-filter-dot"
                        aria-hidden
                        style={{ "--help-filter-color": `var(${row.colorVar})` } as CSSProperties}
                      />
                      {row.label}
                    </td>
                    <td>
                      {renderShortcutSequence(shortcuts.historyCategoryShortcuts[row.category])}
                    </td>
                    <td>
                      {renderShortcutSequence(
                        shortcuts.historyCategoryExpandShortcuts[row.category],
                      )}
                    </td>
                    <td>
                      {renderShortcutSequence(shortcuts.historyCategorySoloShortcuts[row.category])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="help-section-divider" aria-hidden />
          <ShortcutGrid
            rows={[
              {
                label: "Toggle User + Assistant + Write",
                shortcuts: [shortcuts.historyCategoryShortcuts.user.replace(/\d$/u, "8")],
              },
              {
                label: "Focus User + Assistant + Write",
                shortcuts: [shortcuts.historyCategorySoloShortcuts.user.replace(/\d$/u, "8")],
              },
              {
                label: "Toggle all types",
                shortcuts: [shortcuts.historyCategoryShortcuts.user.replace(/\d$/u, "9")],
              },
              {
                label: "Focus all types",
                shortcuts: [shortcuts.historyCategorySoloShortcuts.user.replace(/\d$/u, "9")],
              },
            ]}
          />
          <p className="help-matrix-note">
            Pattern:{" "}
            {renderShortcutSequence(shortcuts.historyCategoryShortcuts.user.replace(/\d$/u, ""))}
            <span> toggles visibility </span>
            <span className="help-close-divider" aria-hidden>
              ·
            </span>
            {renderShortcutSequence(
              shortcuts.historyCategoryExpandShortcuts.user.replace(/\d$/u, ""),
            )}
            <span> expands/collapses </span>
            <span className="help-close-divider" aria-hidden>
              ·
            </span>
            {renderShortcutSequence(
              shortcuts.historyCategorySoloShortcuts.user.replace(/\d$/u, ""),
            )}
            <span> focuses (hides everything else)</span>
          </p>
        </HelpSection>

        <div className="help-two-col">
          <HelpSection title="Refresh">
            <ShortcutList rows={refreshRows} />
          </HelpSection>
          <HelpSection title="System">
            <ShortcutList rows={systemRows} />
          </HelpSection>
        </div>
      </div>
    </div>
  );
}

function HelpSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="help-section">
      <h2 className="help-section-title">{title}</h2>
      {children}
    </section>
  );
}

function ShortcutGrid({ rows }: { rows: ShortcutSectionRow[] }) {
  return (
    <div className="help-shortcut-grid">
      {rows.map((row) => (
        <ShortcutRow key={`${row.label}-${row.shortcuts.join("|")}`} row={row} />
      ))}
    </div>
  );
}

function ShortcutList({ rows }: { rows: ShortcutSectionRow[] }) {
  return (
    <div className="help-shortcut-list-simple">
      {rows.map((row) => (
        <ShortcutRow key={`${row.label}-${row.shortcuts.join("|")}`} row={row} />
      ))}
    </div>
  );
}

function ShortcutRow({ row }: { row: ShortcutSectionRow }) {
  return (
    <div className="help-shortcut-row">
      <span className="help-shortcut-label">{row.label}</span>
      <span className="help-shortcut-keys">
        {row.shortcuts.map((shortcut, index) => (
          <span key={`${row.label}-${shortcut}`} className="help-shortcut-sequence">
            {index > 0 ? <span className="help-shortcut-or">or</span> : null}
            {renderShortcutSequence(shortcut)}
          </span>
        ))}
      </span>
    </div>
  );
}

function renderShortcutSequence(shortcut: string): ReactNode {
  const normalized = shortcut.trim().endsWith("++")
    ? `${shortcut.trim().slice(0, -2)}+Plus`
    : shortcut;
  const tokens = normalized
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const tokenOccurrenceCounts = new Map<string, number>();
  return (
    <span className="help-key-group" aria-label={shortcut}>
      {tokens.map((token, index) => {
        const occurrence = tokenOccurrenceCounts.get(token) ?? 0;
        tokenOccurrenceCounts.set(token, occurrence + 1);
        return (
          <span key={`${shortcut}-${token}-${occurrence}`} className="help-key-fragment">
            {index > 0 ? <span className="help-key-separator">+</span> : null}
            <kbd className="help-key">{formatKeyToken(token)}</kbd>
          </span>
        );
      })}
    </span>
  );
}

function renderSyntaxToken(syntax: string) {
  const parts = syntax.split(/(AND|OR|NOT|and|or|not|"|[+*()\/-]|\s+)/g).filter(Boolean);
  return parts.map((part, index) => {
    const key = `${syntax}-${part}-${index}`;
    if (/^\s+$/u.test(part)) {
      return <span key={key}>{part}</span>;
    }
    if (part === "OR") {
      return (
        <span key={key} className="help-syntax-part is-or">
          {part}
        </span>
      );
    }
    if (part === "NOT") {
      return (
        <span key={key} className="help-syntax-part is-not">
          {part}
        </span>
      );
    }
    if (part === "AND") {
      return (
        <span key={key} className="help-syntax-part is-and">
          {part}
        </span>
      );
    }
    if (
      part === '"' ||
      part === "+" ||
      part === "*" ||
      part === "-" ||
      part === "(" ||
      part === ")" ||
      part === "/"
    ) {
      return (
        <span key={key} className="help-syntax-part is-symbol">
          {part}
        </span>
      );
    }
    if (part === "and" || part === "or" || part === "not") {
      return (
        <span key={key} className="help-syntax-part is-literal-op">
          {part}
        </span>
      );
    }
    return (
      <span key={key} className="help-syntax-part is-literal">
        {part}
      </span>
    );
  });
}

function findShortcut(shortcuts: ShortcutRegistry, description: string): string {
  const item = shortcuts.shortcutItems.find((entry) => entry.description === description);
  if (!item) {
    throw new Error(`Missing shortcut for "${description}".`);
  }
  return item.shortcut;
}

function findShortcuts(shortcuts: ShortcutRegistry, description: string): string[] {
  const matches = shortcuts.shortcutItems
    .filter((entry) => entry.description === description)
    .map((entry) => entry.shortcut);
  return Array.from(new Set(matches));
}

function splitShortcutAlternatives(shortcut: string): string[] {
  return shortcut
    .split(/\s+\/\s+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function sortPageTraversalShortcuts(
  shortcuts: string[],
  shortcutRegistry: ShortcutRegistry,
): string[] {
  return [...shortcuts].sort(
    (left, right) =>
      shortcutRegistry.rankPageTraversalShortcut(left) -
      shortcutRegistry.rankPageTraversalShortcut(right),
  );
}

function formatKeyToken(token: string): string {
  return MODIFIER_SYMBOLS[token] ?? KEY_SYMBOLS[token] ?? token;
}
