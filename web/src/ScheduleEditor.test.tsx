import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppState, Schedule, ScheduleInput } from "../../shared/contracts";
import ScheduleEditor, { calendarDays, localDate, minuteOccurrences, nextMinute } from "./ScheduleEditor";
import { api } from "./api";
const state: AppState = {
  workflows: [{ id: "bellhaven", name: "Bellhaven" }],
  run: null,
  proposals: [],
  history: [],
  schedules: [],
  settings: {
    snapshotAvailable: true,
    credentialsConfigured: false,
    liveWritesEnabled: false,
  },
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T15:00:30Z"));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        cron: "* * * * *",
        command: "npm run schedule:tick",
        timezone: "UTC",
        note: "Checks due occurrences",
      }),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("schedule calendar", () => {
  it("supplies six complete weeks and disables out-of-range days", () => {
    const days = calendarDays(2, 2028, "2028-02-08", "2028-02-29");
    expect(days).toHaveLength(42);
    expect(days.find((day) => day.iso === "2028-02-07")?.disabled).toBe(true);
    expect(days.find((day) => day.iso === "2028-02-29")?.disabled).toBe(false);
    expect(days.find((day) => day.iso === "2028-03-01")?.disabled).toBe(true);
  });
  it.each(["once", "hourly", "daily", "weekly", "biweekly", "monthly"])(
    "saves %s anchored to a start date and inactive by default",
    async (cadence) => {
      const user = userEvent.setup();
      const save = vi.fn(async () => undefined);
      render(
        <ScheduleEditor
          schedule={null}
          state={state}
          close={() => undefined}
          save={save}
        />,
      );
      await user.type(
        screen.getByRole("textbox", { name: "Schedule name" }),
        "Named cadence",
      );
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Cadence" }),
        cadence,
      );
      await user.click(screen.getByRole("button", { name: "Save schedule" }));
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          cadence,
          startDate: localDate(),
          endDate: null,
          enabled: false,
          source: "live",
        }),
        undefined,
      );
    },
  );
  it("keeps the calendar inside the modal, restores focus on Escape and defers native parent cancellation", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(
      <ScheduleEditor
        schedule={null}
        state={state}
        close={close}
        save={async () => undefined}
      />,
    );
    const parent = screen.getByRole("dialog", { name: "New schedule" });
    const trigger = screen.getByRole("button", { name: "Start date" });
    await user.click(trigger);
    const calendar = screen.getByRole("dialog", { name: "Start date" });
    expect(parent.contains(calendar)).toBe(true);
    expect(within(calendar).getAllByRole("gridcell")).toHaveLength(42);
    fireEvent(
      parent,
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(close).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Start date" })).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);
    expect(close).not.toHaveBeenCalled();
    fireEvent(
      parent,
      new Event("cancel", { bubbles: false, cancelable: true }),
    );
    expect(close).toHaveBeenCalledOnce();
  });
  it("clears an existing end bound explicitly and prevents earlier end dates", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => undefined);
    const schedule: Schedule = {
      id: "schedule-a",
      name: "Date range",
      workflowId: "bellhaven",
      source: "snapshot",
      enabled: false,
      time: "09:00",
      timezone: "UTC",
      cron: "* * * * *",
      cadence: "monthly",
      startDate: "2028-02-08",
      endDate: "2028-02-29",
    };
    render(
      <ScheduleEditor
        schedule={schedule}
        state={state}
        close={() => undefined}
        save={save}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "End date (optional)" }),
    );
    const calendar = screen.getByRole("dialog", {
      name: "End date (optional)",
    });
    const early = within(calendar)
      .getAllByRole("gridcell")
      .find((day) => day.textContent === "7");
    expect(early?.hasAttribute("disabled")).toBe(true);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Clear end date" }));
    await user.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2028-02-08", endDate: null }),
      "schedule-a",
    );
  });
});

function existingSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: "schedule-a", name: "Original name", workflowId: "bellhaven", source: "snapshot",
    enabled: false, time: "09:00", timezone: "UTC", cron: "* * * * *",
    cadence: "weekly", startDate: "2020-01-06", ...overrides,
  };
}
function editor(schedule: Schedule | null = null) {
  const save = vi.fn(async () => undefined);
  render(<ScheduleEditor schedule={schedule} state={state} close={() => undefined} save={save} />);
  return save;
}
function submitNamed() {
  fireEvent.change(screen.getByRole("textbox", { name: "Schedule name" }), { target: { value: "Renamed schedule" } });
  fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
}

describe("future schedule controls", () => {
  it("defaults to the next minute, advances past midnight, and skips the second folded hour", () => {
    expect(nextMinute(new Date("2026-11-03T23:59:30Z"), "UTC")).toEqual({ date: "2026-11-04", time: "00:00" });
    expect(nextMinute(new Date("2026-11-03T15:00:00Z"), "UTC")).toEqual({ date: "2026-11-03", time: "15:01" });
    expect(nextMinute(new Date("2026-11-01T06:10:00Z"), "America/New_York")).toEqual({ date: "2026-11-01", time: "02:00" });
  });
  it("makes DST gaps unavailable and uses the earlier folded instant", () => {
    const gap = minuteOccurrences("2026-03-08", "America/New_York");
    expect(gap.find((minute) => minute.time === "02:30")?.at).toBeUndefined();
    expect(gap.find((minute) => minute.time === "03:00")?.at).toBe(Date.parse("2026-03-08T07:00:00Z"));
    const fold = minuteOccurrences("2026-11-01", "America/New_York");
    expect(fold.find((minute) => minute.time === "01:30")?.at).toBe(Date.parse("2026-11-01T05:30:00Z"));
  });
  it("has a controlled header switch immediately before Close and saves its state", async () => {
    const save = editor();
    const toggle = screen.getByRole("switch", { name: "Enable schedule" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.nextElementSibling).toBe(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("Enabled");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    submitNamed();
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }), undefined));
  });
  it.each(["hourly", "weekly", "biweekly", "monthly"] satisfies NonNullable<Schedule["cadence"]>[])("keeps an old %s anchor when renamed or enabled", async (cadence) => {
    const save = editor(existingSchedule({ cadence }));
    fireEvent.click(screen.getByRole("switch", { name: "Enable schedule" }));
    submitNamed();
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ startDate: "2020-01-06", time: "09:00", timezone: "UTC", cadence, enabled: true }), "schedule-a"));
  });
  it("preserves an omitted legacy daily anchor during rename and enable", async () => {
    const save = editor(existingSchedule({ cadence: undefined, startDate: undefined }));
    fireEvent.click(screen.getByRole("switch", { name: "Enable schedule" }));
    submitNamed();
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      startDate: undefined, time: "09:00", timezone: "UTC", enabled: true,
    }), "schedule-a"));
  });
  it.each([false, true])("preserves an expired legacy daily range when disabling is %s", async (disable) => {
    const save = editor(existingSchedule({
      cadence: undefined, startDate: undefined, enabled: true, endDate: "2021-01-06",
    }));
    if (disable) fireEvent.click(screen.getByRole("switch", { name: "Enable schedule" }));
    submitNamed();
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      name: "Renamed schedule", startDate: undefined, endDate: "2021-01-06", enabled: !disable,
    }), "schedule-a"));
  });
  it("retains a historic end bound on an unchanged rename or disable", async () => {
    const save = editor(existingSchedule({ enabled: true, endDate: "2021-01-06" }));
    fireEvent.click(screen.getByRole("switch", { name: "Enable schedule" }));
    submitNamed();
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ endDate: "2021-01-06", enabled: false }), "schedule-a"));
  });
  it("requires a future start after changing an old recurrence time or cadence", () => {
    const save = editor(existingSchedule());
    fireEvent.change(screen.getByRole("combobox", { name: "Time" }), { target: { value: "10:00" } });
    expect(screen.getByRole("alert").textContent).toContain("future start");
    submitNamed();
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "Time" }), { target: { value: "09:00" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Cadence" }), { target: { value: "daily" } });
    expect(screen.getByRole("alert").textContent).toContain("future start");
  });
  it("retains a disabled past once schedule but blocks enabling it", async () => {
    const schedule = existingSchedule({ cadence: "once" });
    const save = editor(schedule);
    submitNamed();
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("switch", { name: "Enable schedule" }));
    submitNamed();
    expect(screen.getByRole("alert").textContent).toContain("future start");
    expect(save).toHaveBeenCalledOnce();
  });
  it("disables elapsed minutes, rechecks timezone changes, and allows future dates", async () => {
    const save = editor(existingSchedule({ startDate: "2026-11-03", time: "16:00" }));
    const time = screen.getByRole("combobox", { name: "Time" });
    expect(within(time).getByRole("option", { name: "15:00" }).hasAttribute("disabled")).toBe(true);
    expect(within(time).getByRole("option", { name: "15:01" }).hasAttribute("disabled")).toBe(false);
    fireEvent.change(screen.getByRole("combobox", { name: "Timezone" }), { target: { value: "Asia/Tokyo" } });
    expect(screen.getByRole("alert").textContent).toContain("future start");
    expect(screen.getByText(/Current time in Asia\/Tokyo/).textContent).toContain("2026-11-04");
    fireEvent.click(screen.getByRole("button", { name: "Start date" }));
    const calendar = screen.getByRole("dialog", { name: "Start date" });
    const third = within(calendar).getAllByRole("gridcell").find((day) => day.textContent === "3");
    expect(third?.hasAttribute("disabled")).toBe(true);
    const fifth = within(calendar).getAllByRole("gridcell").find((day) => day.textContent === "5");
    if (!fifth) throw new Error("Missing fifth day");
    fireEvent.click(fifth);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(time).getByRole("option", { name: "00:00" }).hasAttribute("disabled")).toBe(false);
    submitNamed();
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ startDate: "2026-11-05", timezone: "Asia/Tokyo" }), "schedule-a"));
  });
  it("rechecks a fresh clock at submission even before the next display tick", () => {
    const save = editor(existingSchedule({ startDate: "2026-11-03", time: "15:01", cadence: "once" }));
    fireEvent.click(screen.getByRole("switch", { name: "Enable schedule" }));
    vi.setSystemTime(new Date("2026-11-03T15:01:00Z"));
    submitNamed();
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("future start");
  });
  it("updates availability and the selected-zone date after clock rollover", () => {
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T23:59:59Z"));
    editor(existingSchedule({ startDate: "2026-11-04", time: "00:00", cadence: "once" }));
    fireEvent.click(screen.getByRole("switch", { name: "Enable schedule" }));
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/Current time in UTC/).textContent).toContain("00:00:00 · 2026-11-04");
    expect(screen.getByRole("alert").textContent).toContain("future start");
    expect(within(screen.getByRole("combobox", { name: "Time" })).getByRole("option", { name: "00:00" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("hourly schedules", () => {
  it("defaults to fresh data even with a saved snapshot and reopens the saved hourly definition", async () => {
    const save = vi.fn(async (_body: ScheduleInput) => undefined);
    const { unmount } = render(<ScheduleEditor schedule={null} state={state} close={() => undefined} save={save} />);
    const source = screen.getByRole("combobox", { name: "Source" });
    expect(within(source).getByRole("option", { name: "Saved snapshot" }).hasAttribute("disabled")).toBe(false);
    expect(within(source).getByRole<HTMLOptionElement>("option", { name: /Fresh data/ }).selected).toBe(true);
    fireEvent.change(screen.getByRole("combobox", { name: "Cadence" }), { target: { value: "hourly" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Timezone" }), { target: { value: "UTC" } });
    const time = screen.getByRole("combobox", { name: "First run time" });
    fireEvent.change(time, { target: { value: "20:25" } });
    expect(screen.getByText(/Repeats each hour at minute 25/).textContent).toContain("starting at the chosen date and time");
    submitNamed();
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    const body = save.mock.calls[0]?.[0];
    if (!body) throw new Error("Missing saved schedule");
    expect(body).toEqual(expect.objectContaining({ cadence: "hourly", source: "live", time: "20:25", enabled: false }));
    const saved: Schedule = { ...body, id: "hourly-a", cron: "* * * * *", endDate: body.endDate ?? undefined };
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(saved));
    const decoded = await api.saveSchedule(body);
    expect(decoded).toEqual(saved);
    unmount();
    const resave = vi.fn(async () => undefined);
    render(<ScheduleEditor schedule={decoded} state={state} close={() => undefined} save={resave} />);
    expect(within(screen.getByRole("combobox", { name: "Cadence" })).getByRole<HTMLOptionElement>("option", { name: "Hourly" }).selected).toBe(true);
    expect(within(screen.getByRole("combobox", { name: "First run time" })).getByRole<HTMLOptionElement>("option", { name: "20:25" }).selected).toBe(true);
    submitNamed();
    await waitFor(() => expect(resave).toHaveBeenCalledWith(body, "hourly-a"));
  });
  it("retains an existing hourly snapshot source", async () => {
    const save = editor(existingSchedule({ cadence: "hourly" }));
    expect(within(screen.getByRole("combobox", { name: "Source" })).getByRole<HTMLOptionElement>("option", { name: "Saved snapshot" }).selected).toBe(true);
    submitNamed();
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ cadence: "hourly", source: "snapshot", startDate: "2020-01-06" }), "schedule-a"));
  });
});
