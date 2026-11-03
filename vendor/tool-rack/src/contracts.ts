import type { ReactNode, RefObject } from "react";

export type CalendarDay = {
  iso: string;
  label: string;
  outsideMonth?: boolean;
  disabled?: boolean;
};

export type CalendarDatePickerProps = {
  value: string;
  today: string;
  days: readonly CalendarDay[];
  month: number;
  year: number;
  onChange: (day: string) => void;
  onMonthChange: (month: { month: number; year: number }) => void;
  triggerLabel?: string;
};



export type ToolRackDialogKind = "surface" | "anchored" | "drawer";
export type DialogOrigin = HTMLElement | RefObject<HTMLElement | null> | null | (() => HTMLElement | null);
export type DialogSurfaceProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  triggerRef?: DialogOrigin;
  origin?: DialogOrigin;
  kind?: ToolRackDialogKind;
  children: ReactNode;
  onVisible?: () => void;
  panelSelector?: string;
  panelRef?: RefObject<HTMLElement | null>;
  className?: string;
};
