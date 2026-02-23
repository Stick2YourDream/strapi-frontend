import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import "../css/popup-modal.css";

type PopupModalProps = {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

export default function PopupModal({
  open,
  title,
  onClose,
  children,
  className,
  bodyClassName,
}: PopupModalProps) {
  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="popup-modal-overlay" role="dialog" aria-modal="true">
      <button
        type="button"
        className="popup-modal-backdrop"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div className={`popup-modal ${className || ""}`.trim()}>
        <div className="popup-modal-header">
          {title && <h3 className="popup-modal-title">{title}</h3>}
          <button
            type="button"
            className="popup-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            <span className="popup-modal-close-icon" aria-hidden="true">
              ✕
            </span>
          </button>
        </div>
        <div className={`popup-modal-body ${bodyClassName || ""}`.trim()}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
