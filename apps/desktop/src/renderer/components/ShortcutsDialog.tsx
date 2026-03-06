type ShortcutItem = {
  group: string;
  shortcut: string;
  description: string;
};

type SyntaxItem = {
  syntax: string;
  description: string;
  note?: string;
};

export function ShortcutsDialog({
  shortcutItems,
  commonSyntaxItems,
  advancedSyntaxItems,
}: {
  shortcutItems: ShortcutItem[];
  commonSyntaxItems: SyntaxItem[];
  advancedSyntaxItems: SyntaxItem[];
}) {
  const shortcutGroups = groupShortcuts(shortcutItems);

  return (
    <div className="help-view">
      <div className="help-page">
        <header className="help-header">
          <div className="help-header-left">
            <span className="help-header-eyebrow">Code Trail</span>
            <h2>Help &amp; Reference</h2>
            <p>Keyboard shortcuts and search syntax guide</p>
          </div>
          <span className="help-header-badge">Built-in Guide</span>
        </header>

        <div className="help-grid">
          <section className="help-card">
            <div className="help-card-header">
              <div className="help-card-icon success" aria-hidden>
                ⌨
              </div>
              <div>
                <h3 className="help-card-title help-card-title-shortcuts">Keyboard Shortcuts</h3>
                <p className="help-card-description">
                  Navigate and control the app without touching your mouse.
                </p>
              </div>
            </div>
            <div className="help-shortcut-list">
              {shortcutGroups.map((group) => (
                <div key={group.name}>
                  <div className="help-group-label">{group.name}</div>
                  {group.items.map((item) => (
                    <div
                      key={`shortcut-${item.shortcut}-${item.description}`}
                      className="help-shortcut-row"
                    >
                      <span className="help-shortcut-description">{item.description}</span>
                      <div className="help-shortcut-keys">
                        {shortcutParts(item.shortcut).map((part, index) => (
                          <span key={`${item.shortcut}-${part}-${index}`} className="help-key-fragment">
                            {index > 0 ? <span className="help-key-separator">+</span> : null}
                            <kbd className="help-key">{part}</kbd>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section className="help-card">
            <div className="help-card-header">
              <div className="help-card-icon success" aria-hidden>
                ⌕
              </div>
              <div>
                <h3 className="help-card-title help-card-title-search">Search Syntax</h3>
                <p className="help-card-description">
                  Build precise queries across your session history.
                </p>
              </div>
            </div>
            <div className="help-syntax-section">
              <div className="help-syntax-block common">
                <div className="help-syntax-block-header">
                  <span className="help-group-label">Common</span>
                  <span className="help-syntax-tag common">Normal + Advanced</span>
                </div>
                {commonSyntaxItems.map((item) => (
                  <div key={`syntax-common-${item.syntax}-${item.description}`} className="help-syntax-row">
                    <span className="help-syntax-token">{renderSyntaxToken(item.syntax)}</span>
                    <div>
                      <div className="help-syntax-description">{item.description}</div>
                      {item.note ? <div className="help-syntax-note">{item.note}</div> : null}
                    </div>
                  </div>
                ))}
              </div>

              <div className="help-syntax-block advanced">
                <div className="help-syntax-block-header">
                  <span className="help-group-label">Advanced Only</span>
                  <span className="help-syntax-tag advanced">Advanced mode</span>
                </div>
                {advancedSyntaxItems.map((item) => (
                  <div
                    key={`syntax-advanced-${item.syntax}-${item.description}`}
                    className="help-syntax-row"
                  >
                    <span className="help-syntax-token">{renderSyntaxToken(item.syntax)}</span>
                    <div>
                      <div className="help-syntax-description">{item.description}</div>
                      {item.note ? <div className="help-syntax-note">{item.note}</div> : null}
                    </div>
                  </div>
                ))}
              </div>

              <div className="help-tip-box">
                <span className="help-tip-icon" aria-hidden>
                  i
                </span>
                <p className="help-tip-text">
                  <strong>Advanced mode</strong> applies to history and global message search only.
                  Project search uses plain text filtering.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function groupShortcuts(shortcuts: ShortcutItem[]): Array<{ name: string; items: ShortcutItem[] }> {
  const map = new Map<string, ShortcutItem[]>();
  for (const item of shortcuts) {
    const existing = map.get(item.group);
    if (existing) {
      existing.push(item);
      continue;
    }
    map.set(item.group, [item]);
  }
  return Array.from(map.entries()).map(([name, items]) => ({ name, items }));
}

function shortcutParts(shortcut: string): string[] {
  const normalized = shortcut.endsWith("++")
    ? `${shortcut.slice(0, -2)}+Plus`
    : shortcut;
  return normalized
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function renderSyntaxToken(syntax: string) {
  const parts = syntax.split(/(AND|OR|NOT|and|or|not|"|[+*()\/-]|\s+)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (/^\s+$/.test(part)) {
      return <span key={`token-space-${index}`}>{part}</span>;
    }

    if (part === "AND" || part === "OR" || part === "NOT") {
      return (
        <span key={`token-op-${index}`} className="help-syntax-part op">
          {part}
        </span>
      );
    }

    if (part === "and" || part === "or" || part === "not") {
      return (
        <span key={`token-meta-${index}`} className="help-syntax-part meta">
          {part}
        </span>
      );
    }

    if (part === '"') {
      return (
        <span key={`token-quote-${index}`} className="help-syntax-part quote">
          {part}
        </span>
      );
    }

    if (part === "/") {
      return (
        <span key={`token-sep-${index}`} className="help-syntax-part separator">
          {part}
        </span>
      );
    }

    if (part === "+" || part === "*" || part === "-" || part === "(" || part === ")") {
      return (
        <span key={`token-symbol-${index}`} className="help-syntax-part symbol">
          {part}
        </span>
      );
    }

    return (
      <span key={`token-literal-${index}`} className="help-syntax-part literal">
        {part}
      </span>
    );
  });
}
