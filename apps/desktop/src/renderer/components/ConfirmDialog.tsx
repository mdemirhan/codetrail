import { useEffect, useRef } from "react";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  // Track whether the close was triggered by a confirm action so onClose doesn't
  // double-fire onCancel after a successful confirm.
  const confirmedRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      confirmedRef.current = false;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      onClose={() => {
        if (!confirmedRef.current) onCancel();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          dialogRef.current?.close();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && e.target === dialogRef.current) {
          dialogRef.current?.close();
        }
      }}
    >
      <div className="confirm-dialog-content">
        <h3 className="confirm-dialog-title">{title}</h3>
        <p className="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-actions">
          <button type="button" className="tb-btn" onClick={() => dialogRef.current?.close()}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="tb-btn primary"
            onClick={() => {
              confirmedRef.current = true;
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
