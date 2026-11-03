import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { Info, X } from "lucide-react";
import type { Counter } from "../../shared/contracts";
export function InfoTip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span
      className="info-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          e.stopPropagation();
        }
      }}
    >
      <button
        type="button"
        className="info-button"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
      >
        <Info size={17} />
      </button>
      {open && (
        <span role="tooltip" id={id} className="info-popover">
          {children}
        </span>
      )}
    </span>
  );
}
export function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="meter"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${value * 100}%` }} />
    </div>
  );
}
const ModalElement = createContext<HTMLDialogElement | null>(null);
export function useModalElement() {
  return useContext(ModalElement);
}
export function Modal({
  title,
  children,
  onClose,
  headerActions,
}: {
  headerActions?: ReactNode;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [element, setElement] = useState<HTMLDialogElement | null>(null);
  const bindDialog = useCallback((node: HTMLDialogElement | null) => {
    ref.current = node;
    setElement(node);
  }, []);
  const id = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={bindDialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        if (!ref.current?.querySelector('.tr-date-picker[aria-hidden="false"]'))
          onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <ModalElement.Provider value={element}>
        <div className="dialog-title">
          <h2 id={id}>{title}</h2>
          <div className="dialog-header-actions">
            {headerActions}
            <button
              type="button"
              className="icon-button"
              aria-label="Close dialog"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          </div>
        </div>
        {children}
      </ModalElement.Provider>
    </dialog>
  );
}
export function ProgressRow({
  icon,
  title,
  counter,
  value,
  unit,
}: {
  icon: ReactNode;
  title: string;
  counter: Counter;
  value: number;
  unit: string;
}) {
  return (
    <div className="progress-row">
      <span className="source-icon">{icon}</span>
      <strong>{title}</strong>
      <span className="counter">
        {counter.completed.toLocaleString()}
        {counter.total === null
          ? ` ${unit} · discovering`
          : ` / ${counter.total.toLocaleString()} ${unit}`}
      </span>
      <Meter value={value} label={`${title} progress`} />
      <strong className="percent">
        {counter.total === null ? "…" : `${Math.round(value * 100)}%`}
      </strong>
    </div>
  );
}
