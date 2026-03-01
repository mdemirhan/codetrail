export function ShortcutsDialog({
  shortcutItems,
  onClose,
}: {
  shortcutItems: Array<{ shortcut: string; description: string }>;
  onClose: () => void;
}) {
  return (
    <dialog open className="shortcuts-dialog">
      <h3>Keyboard Shortcuts</h3>
      <div className="shortcuts-table-wrap">
        <table className="shortcuts-table">
          <thead>
            <tr>
              <th scope="col">Shortcut</th>
              <th scope="col">Description</th>
            </tr>
          </thead>
          <tbody>
            {shortcutItems.map((item) => (
              <tr key={`dialog-${item.shortcut}-${item.description}`}>
                <td>{item.shortcut}</td>
                <td>{item.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={onClose}
        title="Close shortcuts (Esc)"
        aria-label="Close shortcuts"
      >
        Close
      </button>
    </dialog>
  );
}
