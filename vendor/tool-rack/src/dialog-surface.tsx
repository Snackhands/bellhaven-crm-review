import { useEffect, useId, useRef } from "react";
import type { DialogSurfaceProps } from "./contracts";
import { useDialogMotion } from "./dialog-motion";

function outside(dialog: HTMLDialogElement, clientX: number, clientY: number) {
  const bounds = dialog.getBoundingClientRect();
  return clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom;
}

/** Compact native dialog that grows from its trigger. The host owns guards and content. */
export function DialogSurface({
  open,
  onClose,
  title = "Dialog",
  subtitle,
  triggerRef,
  origin,
  kind = "anchored",
  onVisible,
  children,
  panelSelector,
  panelRef,
  className = "",
}: DialogSurfaceProps) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const outsidePointer = useRef(false);
  const titleId = useId();
  const subtitleId = useId();
  const motion = useDialogMotion(ref, { open, origin: triggerRef ?? origin, kind, panelSelector, panelRef });
  useEffect(() => {
    if (motion.visible) onVisible?.();
  }, [motion.visible, onVisible]);
  useEffect(() => {
    outsidePointer.current = false;
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`tr-dialog-surface ${className}`.trim()}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        outsidePointer.current = false;
        if (event.target === event.currentTarget) onClose();
      }}
      onPointerDown={(event) => {
        outsidePointer.current = event.target === event.currentTarget
          && outside(event.currentTarget, event.clientX, event.clientY);
      }}
      onPointerCancel={() => { outsidePointer.current = false; }}
      onClick={(event) => {
        const dismiss = outsidePointer.current && event.target === event.currentTarget
          && outside(event.currentTarget, event.clientX, event.clientY);
        outsidePointer.current = false;
        if (dismiss) onClose();
      }}
    >
      <div className="tr-dialog-head">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p id={subtitleId}>{subtitle}</p>}
        </div>
        <button type="button" className="tr-dialog-close" aria-label="Close dialog" onClick={onClose}>
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      <div className="tr-dialog-body">{children}</div>
    </dialog>
  );
}
