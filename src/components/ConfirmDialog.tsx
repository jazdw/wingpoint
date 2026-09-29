import { useEffect, useRef, type ReactNode } from 'react';

interface ConfirmDialogProps {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation built on the native `<dialog>` element, which provides
 * focus trapping, Escape-to-close and a backdrop for free.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Back',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog card"
      aria-labelledby="confirm-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        // The content fills the dialog, so a click on the element itself is
        // a click on the backdrop.
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="confirm-dialog-inner">
        <h2 id="confirm-dialog-title">{title}</h2>
        {children && <div className="confirm-dialog-body">{children}</div>}
        <div className="confirm-dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          onClick={onConfirm}
          autoFocus
        >
          {confirmLabel}
        </button>
        </div>
      </div>
    </dialog>
  );
}
