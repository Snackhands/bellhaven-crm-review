import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Schedule } from "../../shared/contracts";
import ScheduleGroups from "./ScheduleGroups";

const preferenceKey = "bellhaven.schedule-groups.v1";
function schedule(id: string, enabled: boolean): Schedule {
  return {
    id, name: id, enabled, time: "09:00", timezone: "UTC", source: "snapshot",
    workflowId: "bellhaven", cron: "0 9 * * *", cadence: "daily", startDate: "2026-11-04",
  };
}
const entries = [
  schedule("Inactive A", false), schedule("Active A", true),
  schedule("Inactive B", false), schedule("Active B", true),
];
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("schedule groups", () => {
  it("distinguishes the hourly minute from a daily time and opens its saved record", async () => {
    const hourly: Schedule = { ...schedule("Hourly capture", true), cadence: "hourly", time: "14:25" };
    const edit = vi.fn();
    render(<ScheduleGroups schedules={[hourly, schedule("Daily capture", true)]} edit={edit} />);
    expect(screen.getByRole("button", { name: "Hourly captureHourly at :25 · Active" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Daily capture09:00 · Active" })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: /^Hourly capture/ }));
    expect(edit).toHaveBeenCalledWith(hourly);
  });
  it("shows nonempty groups in active-first order with counts and stable schedule labels", async () => {
    const user = userEvent.setup();
    const originalOrder = entries.map((entry) => entry.id);
    render(<ScheduleGroups schedules={entries} edit={vi.fn()} />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Active2", "Active A09:00 · Active", "Active B09:00 · Active", "Inactive2",
    ]);
    expect(screen.getByRole("button", { name: "Active 2" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Inactive 2" }).getAttribute("aria-expanded")).toBe("false");
    expect(localStorage.getItem(preferenceKey)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Inactive 2" }));
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Active2", "Active A09:00 · Active", "Active B09:00 · Active", "Inactive2",
      "Inactive A09:00 · Inactive", "Inactive B09:00 · Inactive",
    ]);
    expect(entries.map((entry) => entry.id)).toEqual(originalOrder);
  });

  it("toggles with the keyboard and restores explicit choices after a remount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ScheduleGroups schedules={entries} edit={vi.fn()} />);
    const active = screen.getByRole("button", { name: "Active 2" });
    active.focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Inactive 2" }));
    expect(screen.queryByRole("button", { name: /^Active A/ })).toBeNull();
    expect(JSON.parse(localStorage.getItem(preferenceKey) ?? "null")).toEqual({ active: false, inactive: true });
    unmount();
    render(<ScheduleGroups schedules={entries} edit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Active 2" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Inactive 2" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /^Inactive A/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Active A/ })).toBeNull();
  });

  it("omits empty groups and their layout, including when all schedules disappear", () => {
    const { container, rerender } = render(<ScheduleGroups schedules={[]} edit={vi.fn()} />);
    expect(container.innerHTML).toBe("");
    rerender(<ScheduleGroups schedules={[schedule("Only active", true)]} edit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Active 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Inactive/ })).toBeNull();
    expect(container.querySelectorAll(".schedule-group")).toHaveLength(1);
    rerender(<ScheduleGroups schedules={[schedule("Only inactive", false)]} edit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Inactive 1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Active/ })).toBeNull();
    expect(container.querySelectorAll(".schedule-group")).toHaveLength(1);
    rerender(<ScheduleGroups schedules={[]} edit={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it("regroups changed schedules without losing choices while a group is absent", async () => {
    const user = userEvent.setup();
    const edit = vi.fn();
    const { rerender } = render(<ScheduleGroups schedules={entries} edit={edit} />);
    await user.click(screen.getByRole("button", { name: "Active 2" }));
    await user.click(screen.getByRole("button", { name: "Inactive 2" }));
    const updated = entries.map((entry) => ({ ...entry, enabled: false }));
    rerender(<ScheduleGroups schedules={updated} edit={edit} />);
    expect(screen.queryByRole("button", { name: /^Active \d/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Inactive 4" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Active A09:00 · Inactive" })).toBeTruthy();
    rerender(<ScheduleGroups schedules={entries} edit={edit} />);
    expect(screen.getByRole("button", { name: "Active 2" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Inactive 2" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("button", { name: /^Active A/ })).toBeNull();
    rerender(<ScheduleGroups schedules={[]} edit={edit} />);
    rerender(<ScheduleGroups schedules={entries} edit={edit} />);
    expect(screen.getByRole("button", { name: "Active 2" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("passes the selected record to the existing editor callback", async () => {
    const user = userEvent.setup();
    const edit = vi.fn();
    render(<ScheduleGroups schedules={entries} edit={edit} />);
    await user.click(screen.getByRole("button", { name: /^Active B/ }));
    expect(edit).toHaveBeenLastCalledWith(entries[3]);
    await user.click(screen.getByRole("button", { name: "Inactive 2" }));
    await user.click(screen.getByRole("button", { name: /^Inactive A/ }));
    expect(edit).toHaveBeenLastCalledWith(entries[0]);
  });

  it.each(["not-json", "null", "[]", '{"active":"false"}', '{"inactive":1}', '{"unexpected":true}'])(
    "falls back to defaults for malformed stored preferences %s",
    (stored) => {
      localStorage.setItem(preferenceKey, stored);
      render(<ScheduleGroups schedules={entries} edit={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Active 2" }).getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByRole("button", { name: "Inactive 2" }).getAttribute("aria-expanded")).toBe("false");
    },
  );

  it("keeps the other group at its default when only one choice is stored", () => {
    localStorage.setItem(preferenceKey, JSON.stringify({ inactive: true }));
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const { rerender } = render(<ScheduleGroups schedules={entries} edit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Active 2" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Inactive 2" }).getAttribute("aria-expanded")).toBe("true");
    rerender(<ScheduleGroups schedules={[...entries]} edit={vi.fn()} />);
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it("works in memory when access to browser storage is unavailable", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    render(<ScheduleGroups schedules={entries} edit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Active 2" }).getAttribute("aria-expanded")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Inactive 2" }));
    expect(screen.getByRole("button", { name: /^Inactive A/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Active 2" }));
    expect(screen.queryByRole("button", { name: /^Active A/ })).toBeNull();
  });

  it("still toggles when saving preferences exceeds the storage quota", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
    render(<ScheduleGroups schedules={entries} edit={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Inactive 2" }));
    expect(screen.getByRole("button", { name: /^Inactive A/ })).toBeTruthy();
  });
});
