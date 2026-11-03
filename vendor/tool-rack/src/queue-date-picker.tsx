import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Select } from "./ui";
import type { CalendarDatePickerProps, CalendarDay } from "./contracts";

export type QueueDatePickerProps = CalendarDatePickerProps & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerLabel?: string;
  /** Visible text independent of the ISO value. */
  triggerText?: string;
  /** Unclipped, untransformed host overlay inside the parent focus scope. */
  popupContainer?: HTMLElement | null;
  /** Date-only exclusions, including Today when it is outside the displayed grid. */
  disabledDates?: readonly string[];
  triggerIcon?: ReactNode;
  monthOptions?: readonly { value: number; label: string }[];
  yearOptions?: readonly number[];
  className?: string;
  weekdayLabels?: readonly [string, string, string, string, string, string, string];
};

function shiftMonth(month: number, year: number, amount: number) {
  const date = new Date(year, month - 1 + amount, 1);
  return { month: date.getMonth() + 1, year: date.getFullYear() };
}

function defaultMonths() {
  return Array.from({ length: 12 }, (_, index) => ({
    value: index + 1,
    label: new Date(2020, index, 1).toLocaleString(undefined, { month: "long" }),
  }));
}

/**
 * Controlled date picker. The host supplies the 42-day grid and date policy;
 * this component owns only presentation, focus, and dismissal behavior.
 */
export function QueueDatePicker({
  value,
  today,
  days,
  month,
  year,
  onChange,
  onMonthChange,
  open: controlledOpen,
  onOpenChange,
  triggerLabel = "Choose date",
  triggerIcon,
  triggerText,
  popupContainer,
  disabledDates = [],
  monthOptions = defaultMonths(),
  yearOptions = [year - 1, year, year + 1],
  className = "",
  weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
}: QueueDatePickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dayRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const titleId = useId();
  const focusRequested = useRef(false);
  const focusMode = useRef<"open" | "grid">("open");
  const restoreFocus = useRef<boolean | null>(null);
  const wasOpen = useRef(false);
  const copiedThemeProperties = useRef<string[]>([]);
  const contains = (target: EventTarget | null) => target instanceof Node
    && Boolean(rootRef.current?.contains(target) || panelRef.current?.contains(target));
  const isDisabled = (day: CalendarDay) => Boolean(day.disabled || disabledDates.includes(day.iso));
  const setOpen = (next: boolean, shouldRestoreFocus = true) => {
    // Blur and pointerdown can arrive in either order. Preserve an explicit
    // restore request so a later blur cannot undo Escape/selection/X behavior.
    if (!next && (shouldRestoreFocus || restoreFocus.current === null)) {
      restoreFocus.current = shouldRestoreFocus;
    }
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  useLayoutEffect(() => {
    const root = rootRef.current;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!root || !trigger || !panel) return;
    const updateOrigin = () => {
      const triggerBounds = trigger.getBoundingClientRect();
      if (popupContainer) {
        const inherited = getComputedStyle(root);
        for (const property of copiedThemeProperties.current) panel.style.removeProperty(property);
        copiedThemeProperties.current = [];
        for (let index = 0; index < inherited.length; index += 1) {
          const property = inherited.item(index);
          if (property.startsWith("--tr-")) {
            panel.style.setProperty(property, inherited.getPropertyValue(property));
            copiedThemeProperties.current.push(property);
          }
        }
        panel.style.fontFamily = inherited.fontFamily;
        const viewport = window.visualViewport;
        const viewportLeft = viewport?.offsetLeft ?? 0;
        const viewportTop = viewport?.offsetTop ?? 0;
        const viewportWidth = viewport?.width ?? window.innerWidth;
        const viewportHeight = viewport?.height ?? window.innerHeight;
        const margin = 14;
        const gap = 10;
        const availableHeight = Math.max(0, viewportHeight - margin * 2);
        panel.style.width = `${Math.min(322, Math.max(0, viewportWidth - margin * 2))}px`;
        panel.style.maxHeight = `${availableHeight}px`;
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;
        const left = Math.max(viewportLeft + margin, Math.min(triggerBounds.right - width, viewportLeft + viewportWidth - width - margin));
        const below = triggerBounds.bottom + gap;
        const above = triggerBounds.top - gap - height;
        const top = below + height <= viewportTop + viewportHeight - margin || above < viewportTop + margin
          ? Math.max(viewportTop + margin, Math.min(below, viewportTop + viewportHeight - height - margin))
          : above;
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.setProperty("--tr-calendar-origin-y", top < triggerBounds.top ? "calc(100% + 16px)" : "-16px");
      }
      const panelBounds = panel.getBoundingClientRect();
      const panelWidth = panel.offsetWidth || panelBounds.width;
      const center = triggerBounds.left + triggerBounds.width / 2 - panelBounds.left;
      const x = Math.max(0, Math.min(panelWidth, center));
      // A portal does not inherit the trigger root's custom properties.
      (popupContainer ? panel : root).style.setProperty("--tr-calendar-origin-x", `${x}px`);
    };
    updateOrigin();
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateOrigin);
    resizeObserver?.observe(root);
    resizeObserver?.observe(panel);
    window.addEventListener("resize", updateOrigin);
    if (popupContainer) {
      window.addEventListener("scroll", updateOrigin, true);
      window.visualViewport?.addEventListener("resize", updateOrigin);
      window.visualViewport?.addEventListener("scroll", updateOrigin);
    }
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateOrigin);
      window.removeEventListener("scroll", updateOrigin, true);
      window.visualViewport?.removeEventListener("resize", updateOrigin);
      window.visualViewport?.removeEventListener("scroll", updateOrigin);
    };
  }, [open, popupContainer, month, year]);

  // React 18's HTML typings do not consistently expose the inert property;
  // setting the attribute through the ref keeps the package type-safe while
  // preserving the closed surface's keyboard isolation.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (open) panel.removeAttribute("inert");
    else {
      // Inert may move native focus to body before the restoration effect runs.
      if (wasOpen.current && restoreFocus.current === null && contains(document.activeElement)) {
        restoreFocus.current = true;
      }
      panel.setAttribute("inert", "");
    }
  }, [open, popupContainer]);

  useEffect(() => {
    if (open && !wasOpen.current) {
      focusRequested.current = true;
      focusMode.current = "open";
    }
    if (!open) focusRequested.current = false;
  }, [open]);

  useEffect(() => {
    if (!open || !focusRequested.current) return;
    const selected = days.findIndex((day) => day.iso === value && !isDisabled(day));
    const index = selected >= 0 ? selected : days.findIndex((day) => !isDisabled(day));
    const mode = focusMode.current;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      const mayMoveFocus = mode === "open"
        ? active === triggerRef.current || active === document.body || contains(active)
        : contains(active);
      // Do not pull focus back from a user who tabbed/clicked away while the
      // opening frame was pending. This also keeps month/year selects usable.
      if (index >= 0 && mayMoveFocus) dayRefs.current[index]?.focus({ preventScroll: true });
      focusRequested.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, days, value, month, year]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !contains(target)) setOpen(false, false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false, true);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (wasOpen.current && !open) {
      const active = document.activeElement;
      const inPicker = contains(active);
      if (restoreFocus.current === true || (restoreFocus.current === null && inPicker)) {
        triggerRef.current?.focus({ preventScroll: true });
      }
      restoreFocus.current = null;
    }
    wasOpen.current = open;
  }, [open]);

  const choose = (day: CalendarDay) => {
    if (isDisabled(day)) return;
    onChange(day.iso);
    setOpen(false, true);
  };

  const focusDay = (index: number) => {
    if (!days.length) return;
    const clamped = Math.max(0, Math.min(days.length - 1, index));
    let fallback = -1;
    for (let candidate = clamped; candidate < days.length; candidate += 1) {
      if (!isDisabled(days[candidate])) {
        fallback = candidate;
        break;
      }
    }
    if (fallback < 0) {
      for (let candidate = clamped - 1; candidate >= 0; candidate -= 1) {
        if (!isDisabled(days[candidate])) {
          fallback = candidate;
          break;
        }
      }
    }
    if (fallback >= 0) dayRefs.current[fallback]?.focus();
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = dayRefs.current.indexOf(document.activeElement instanceof HTMLButtonElement ? document.activeElement : null);
    if (current < 0) return;
    let next: number | undefined;
    if (event.key === "ArrowRight") next = current + 1;
    if (event.key === "ArrowLeft") next = current - 1;
    if (event.key === "ArrowDown") next = current + 7;
    if (event.key === "ArrowUp") next = current - 7;
    if (event.key === "Home") next = Math.floor(current / 7) * 7;
    if (event.key === "End") next = Math.floor(current / 7) * 7 + 6;
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      focusRequested.current = true;
      focusMode.current = "grid";
      onMonthChange(shiftMonth(month, year, event.key === "PageUp" ? -1 : 1));
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    focusDay(next);
  };

  const onPickerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false, true);
    }
  };

  const onTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setOpen(!open, true);
  };

  const selectedIndex = days.findIndex((day) => day.iso === value && !isDisabled(day));
  const firstEnabledIndex = days.findIndex((day) => !isDisabled(day));
  const tabIndex = selectedIndex >= 0 ? selectedIndex : firstEnabledIndex;
  const rowCount = Math.ceil(days.length / 7);

  const panel = (
      <div
        className="tr-date-picker"
        data-portalled={popupContainer ? "true" : undefined}
        id={titleId}
        ref={panelRef}
        role="dialog"
        aria-label={triggerLabel}
        aria-hidden={!open}
      >
        <div className="tr-date-picker-topbar">
          <button type="button" className="tr-date-picker-today" disabled={disabledDates.includes(today) || days.some((day) => day.iso === today && day.disabled)} onClick={() => { onChange(today); setOpen(false, true); }}>
            Today
          </button>
          <button type="button" className="tr-date-picker-close" aria-label="Close date picker" onClick={() => setOpen(false, true)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="tr-date-picker-browse">
          <button type="button" aria-label="Previous month" onClick={() => onMonthChange(shiftMonth(month, year, -1))}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
          <label className="tr-date-picker-select">
            <span className="tr-sr-only">Month</span>
            <span className="tr-date-picker-select-size" aria-hidden="true">
              {monthOptions.map((option) => <span key={option.value}>{option.label}</span>)}
            </span>
            <Select aria-label="Month" value={month} onChange={(event) => onMonthChange({ month: Number(event.target.value), year })}>
              {monthOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </Select>
          </label>
          <label className="tr-date-picker-select">
            <span className="tr-sr-only">Year</span>
            <span className="tr-date-picker-select-size" aria-hidden="true">{year}</span>
            <Select aria-label="Year" value={year} onChange={(event) => onMonthChange({ month, year: Number(event.target.value) })}>
              {yearOptions.map((option) => <option value={option} key={option}>{option}</option>)}
            </Select>
          </label>
          <button type="button" aria-label="Next month" onClick={() => onMonthChange(shiftMonth(month, year, 1))}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></button>
        </div>
        <div
          className="tr-date-picker-grid"
          role="grid"
          aria-label={triggerLabel}
          aria-rowcount={rowCount + 1}
          aria-colcount={7}
          onKeyDown={onGridKeyDown}
        >
          <div className="tr-date-picker-row tr-date-picker-weekdays" role="row" aria-rowindex={1}>
            {weekdayLabels.map((label, index) => (
              <span role="columnheader" key={index} aria-label={label} aria-colindex={index + 1}>{label[0]}</span>
            ))}
          </div>
          {Array.from({ length: rowCount }, (_, row) => (
            <div className="tr-date-picker-row" role="row" aria-rowindex={row + 2} key={row}>
              {days.slice(row * 7, row * 7 + 7).map((day, column) => {
                const index = row * 7 + column;
                return (
                  <button
                    type="button"
                    role="gridcell"
                    key={`${day.iso}-${index}`}
                    ref={(element) => { dayRefs.current[index] = element; }}
                    tabIndex={index === tabIndex ? 0 : -1}
                    aria-colindex={column + 1}
                    aria-selected={day.iso === value}
                    aria-current={day.iso === today ? "date" : undefined}
                    aria-disabled={isDisabled(day) || undefined}
                    disabled={isDisabled(day)}
                    className={`tr-date-day ${day.iso === value ? "is-selected" : ""} ${day.iso === today ? "is-today" : ""} ${day.outsideMonth ? "is-outside" : ""}`.trim()}
                    onClick={() => choose(day)}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
  );

  return (
    <div
      ref={rootRef}
      className={`tr-date-picker-root ${className}`.trim()}
      onKeyDown={onPickerKeyDown}
      onBlur={(event) => {
        if (open && !contains(event.relatedTarget)) setOpen(false, false);
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        className="tr-date-picker-trigger"
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={titleId}
        onClick={onTriggerClick}
      >
        {triggerIcon && <span aria-hidden="true">{triggerIcon}</span>}
        <span>{triggerText ?? value}</span>
      </button>
      {popupContainer ? createPortal(panel, popupContainer) : panel}
    </div>
  );
}
