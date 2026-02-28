export function ShortcutsDialog({
  shortcutItems,
  onClose,
}: {
  shortcutItems: string[];
  onClose: () => void;
}) {
  return (
    <dialog open className="shortcuts-dialog">
      <h3>Keyboard Shortcuts</h3>
      {shortcutItems.map((item) => (
        <p key={`dialog-${item}`}>{item}</p>
      ))}
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
