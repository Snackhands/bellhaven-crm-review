import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { QueueDatePicker, Select } from "@tool-shed/tool-rack";
import type { CalendarDay } from "@tool-shed/tool-rack";
import { CalendarClock } from "lucide-react";
import type {
  AppState,
  Schedule,
  ScheduleInput,
  SourceMode,
} from "../../shared/contracts";
import { api, errorMessage } from "./api";
import type { CronConfig } from "./api";
import { Modal, useModalElement } from "./ui";
import { localParts, occurrenceAt } from "../../shared/schedule-time";
import { useClock } from "./Clock";

const minuteTimes = Array.from({ length: 1440 }, (_, minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
const hours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));

export function minuteOccurrences(date: string, timezone: string) {
  return minuteTimes.map((time) => ({ time, at: occurrenceAt(date, time, timezone)?.getTime() }));
}

export function nextMinute(now: Date, timezone: string) {
  // Walk actual minutes so midnight and skipped wall-clock minutes advance together.
  let instant = Math.floor(now.getTime() / 60_000) * 60_000 + 60_000;
  for (;;) {
    const local = localParts(new Date(instant), timezone);
    const at = occurrenceAt(local.date, local.time, timezone);
    if (at && at > now) return local;
    instant += 60_000;
  }
}
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function calendarDays(
  month: number,
  year: number,
  minimum?: string,
  maximum?: string,
): CalendarDay[] {
  const first = new Date(year, month - 1, 1);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, month - 1, index - first.getDay() + 1);
    const iso = localDate(date);
    return {
      iso,
      label: String(date.getDate()),
      outsideMonth: date.getMonth() !== month - 1,
      disabled: Boolean(
        (minimum && iso < minimum) || (maximum && iso > maximum),
      ),
    };
  });
}
function DateControl({
  label,
  value,
  change,
  minimum,
  maximum,
  today,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
  minimum?: string;
  maximum?: string;
  today: string;
}) {
  const date = value ? new Date(`${value}T12:00:00`) : new Date();
  const [view, setView] = useState({
    month: date.getMonth() + 1,
    year: date.getFullYear(),
  });
  const popupContainer = useModalElement();
  return (
    <div className="date-control">
      <span>{label}</span>
      <QueueDatePicker
        value={value}
        today={today}
        days={calendarDays(view.month, view.year, minimum, maximum)}
        month={view.month}
        year={view.year}
        onChange={change}
        onMonthChange={setView}
        triggerLabel={label}
        triggerText={
          value
            ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : "No end date"
        }
        triggerIcon={<CalendarClock size={16} />}
        popupContainer={popupContainer}
        yearOptions={Array.from({ length: 151 }, (_, index) => 1970 + index)}
        disabledDates={
          (minimum && today < minimum) || (maximum && today > maximum)
            ? [today]
            : []
        }
      />
    </div>
  );
}
export default function ScheduleEditor({
  schedule,
  state,
  close,
  save,
}: {
  schedule: Schedule | null;
  state: AppState;
  close: () => void;
  save: (body: ScheduleInput, id?: string) => Promise<void>;
}) {
  const now = useClock();
  const [timezone, setTimezone] = useState(
    schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [initialStart] = useState(() => nextMinute(new Date(), timezone));
  const [startDate, setStartDate] = useState(schedule?.startDate ?? initialStart.date);
  const [startDateEdited, setStartDateEdited] = useState(false);
  const [time, setTime] = useState(schedule?.time ?? initialStart.time);
  const [enabled, setEnabled] = useState(schedule?.enabled ?? false);
  const [endDate, setEndDate] = useState(schedule?.endDate ?? "");
  const [cadence, setCadence] = useState<NonNullable<Schedule["cadence"]>>(
    schedule?.cadence ?? "daily",
  );
  const [timezoneOptions] = useState(() => Array.from(
    new Set([timezone, "UTC", ...Intl.supportedValuesOf("timeZone")]),
  ));
  const today = localParts(now, timezone).date;
  const occurrences = useMemo(() => minuteOccurrences(startDate, timezone), [startDate, timezone]);
  const selectedHour = time.slice(0, 2);
  const selectedMinute = time.slice(3);
  const hourOptions = hours.map((hour, index) => ({
    hour,
    minutes: occurrences.slice(index * 60, (index + 1) * 60),
  }));
  const minuteOptions = hourOptions[Number(selectedHour)]?.minutes ?? [];
  function isFutureMinute({ at }: (typeof occurrences)[number]) {
    return at !== undefined && at > now.getTime();
  }
  function changeHour(hour: string) {
    const available = hourOptions.find((option) => option.hour === hour)?.minutes.filter(isFutureMinute) ?? [];
    const next = available.find((option) => option.time.slice(3) === selectedMinute) ?? available[0];
    setTime(next?.time ?? `${hour}:${selectedMinute}`);
  }
  const unchangedStart = Boolean(schedule &&
    (schedule.startDate === undefined ? !startDateEdited : startDate === schedule.startDate) && time === schedule.time &&
    timezone === schedule.timezone && cadence === (schedule.cadence ?? "daily"));
  function timingError(at: Date) {
    const start = occurrenceAt(startDate, time, timezone);
    const future = Boolean(start && start > at);
    const preserveStart = unchangedStart && (cadence !== "once" || !enabled);
    if (!future && !preserveStart)
      return start ? "Choose a future start date and time." : "This time does not exist in the selected timezone. Choose another time.";
    const currentDate = localParts(at, timezone).date;
    const minimumEnd = startDate > currentDate ? startDate : currentDate;
    const preserveEnd = unchangedStart && endDate === (schedule?.endDate ?? "") &&
      (!enabled || schedule?.enabled) && (!schedule?.startDate || endDate >= schedule.startDate);
    if (endDate && !preserveEnd && endDate < minimumEnd)
      return "End date must be on or after today and the start date.";
    return "";
  }
  const currentTimingError = timingError(now);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<CronConfig | null>(null);
  useEffect(() => setError(""), [startDate, endDate, time, timezone, cadence, enabled]);
  const [source, setSource] = useState<SourceMode>(
    schedule?.source ?? "live",
  );
  useEffect(() => {
    if (schedule)
      api
        .config(schedule.id)
        .then(setConfig)
        .catch((error) => setError(errorMessage(error)));
  }, [schedule]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    if (!name) {
      setError("Give this schedule a name.");
      return;
    }
    const invalidTiming = timingError(new Date());
    if (invalidTiming) {
      setError(invalidTiming);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await save(
        {
          name,
          workflowId: String(data.get("workflowId")),
          time,
          timezone,
          source,
          enabled,
          cadence,
          startDate: unchangedStart && schedule?.startDate === undefined ? undefined : startDate,
          endDate: endDate || null,
        },
        schedule?.id,
      );
      close();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={schedule ? "Edit schedule" : "New schedule"} onClose={close}
      headerActions={
        <button type="button" className="schedule-switch" role="switch" aria-label="Enable schedule"
          aria-checked={enabled} onClick={() => setEnabled((value) => !value)}>
          <span className="switch-track" aria-hidden="true"><span /></span>
          {enabled ? "Enabled" : "Disabled"}
        </button>
      }>

      <form onSubmit={submit} className="schedule-form">
        <label>
          Schedule name
          <input
            name="name"
            placeholder="e.g. Morning account check"
            defaultValue={schedule?.name ?? ""}
            maxLength={100}
            required
            autoFocus
          />
        </label>
        <label>
          Workflow
          <Select
            name="workflowId"
            defaultValue={schedule?.workflowId ?? state.workflows[0]?.id}
          >
            {state.workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </Select>
        </label>
        <label>
          Cadence
          <Select
            name="cadence"
            value={cadence}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === "once" ||
                value === "hourly" ||
                value === "daily" ||
                value === "weekly" ||
                value === "biweekly" ||
                value === "monthly"
              )
                setCadence(value);
            }}
          >
            <option value="once">Once</option>
            <option value="hourly">Hourly</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every two weeks</option>
            <option value="monthly">Monthly</option>
          </Select>
        </label>
        <div className="date-pair">
          <DateControl
            label="Start date"
            value={startDate}
            change={(value) => {
              setStartDateEdited(true);
              setStartDate(value);
            }}
            minimum={today}
            today={today}
            maximum={endDate && endDate >= today ? endDate : undefined}
          />
          <div>
            <DateControl
              label="End date (optional)"
              value={endDate}
              change={setEndDate}
              minimum={startDate > today ? startDate : today}
              today={today}
            />
            {endDate && (
              <button
                className="text-button clear-date"
                type="button"
                onClick={() => setEndDate("")}
              >
                Clear end date
              </button>
            )}
          </div>
        </div>
        <p className="schedule-hint">
          {cadence === "once"
            ? "Runs once on the start date."
            : cadence === "hourly"
              ? `Repeats each hour at minute ${time.slice(3)}, starting at the chosen date and time.`
              : cadence === "monthly"
                ? "Uses the start day each month; months without that date are skipped."
                : cadence === "weekly" || cadence === "biweekly"
                  ? "Repeats from the start date."
                  : "Runs each day within the selected dates."}{" "}
          Dates are inclusive.
        </p>
        <div className="form-pair">
          <fieldset className="schedule-time">
            <legend>{cadence === "hourly" ? "First run time" : "Time"}</legend>
            <div className="schedule-time-parts">
              <label>
                Hour
                <Select name="hour" required value={selectedHour} onChange={(event) => changeHour(event.target.value)}>
                  {hourOptions.map(({ hour, minutes }) => (
                    <option key={hour} value={hour} disabled={!minutes.some(isFutureMinute)}>{hour}</option>
                  ))}
                </Select>
              </label>
              <label>
                Minute
                <Select name="minute" required value={selectedMinute} onChange={(event) => setTime(`${selectedHour}:${event.target.value}`)}>
                  {minuteOptions.map((option) => (
                    <option key={option.time} value={option.time.slice(3)} disabled={!isFutureMinute(option)}>
                      {option.time.slice(3)}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          </fieldset>
          <label>
            Timezone
            <Select name="timezone" required value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              {timezoneOptions.map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <p className="schedule-hint zone-clock">Current time in {timezone}: <time dateTime={now.toISOString()}>{localParts(now, timezone).time}:{String(now.getUTCSeconds()).padStart(2, "0")} · {today}</time></p>
        <label>
          Source
          <Select
            name="source"
            value={source}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "snapshot" || value === "live") setSource(value);
            }}
          >
            <option
              value="snapshot"
              disabled={!state.settings.snapshotAvailable}
            >
              Saved snapshot
              {!state.settings.snapshotAvailable ? " · unavailable" : ""}
            </option>
            <option
              value="live"
              disabled={!state.settings.credentialsConfigured}
            >
              Fresh data
              {!state.settings.credentialsConfigured
                ? " · credentials missing"
                : ""}
            </option>
          </Select>
        </label>
        <p className="notice">
          <CalendarClock size={18} />
          Schedules prepare proposals only. The local server must be awake. New
          schedules start inactive unless you enable them here.
        </p>
        {config && (
          <div className="cron-config">
            <strong>Cron configuration</strong>
            <code>{config.cron}</code>
            <code>{config.command}</code>
            <span>{config.timezone}</span>
            <p>{config.note}</p>
          </div>
        )}
        {(error || currentTimingError) && (
          <p role="alert" className="notice error">
            {error || currentTimingError}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button disabled={busy || !state.workflows.length} type="submit">
            {busy ? "Saving…" : "Save schedule"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
