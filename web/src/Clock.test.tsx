import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UtcClock } from "./Clock";

afterEach(() => { cleanup(); vi.useRealTimers(); });
it("shows UTC seconds and updates the date across midnight", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T23:59:59Z"));
  render(<UtcClock />);
  const clock = screen.getByLabelText("Current UTC time");
  expect(clock.textContent).toContain("23:59:59 UTC");
  expect(clock.textContent).toContain("Nov 3, 2026");
  act(() => { vi.advanceTimersByTime(1000); });
  expect(clock.textContent).toContain("00:00:00 UTC");
  expect(clock.textContent).toContain("Nov 4, 2026");
});
