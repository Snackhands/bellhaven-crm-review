import { useId, useState } from "react";
import { ChevronDown, Clock3 } from "lucide-react";
import { z } from "zod";
import type { Schedule } from "../../shared/contracts";
import "./schedule-groups.css";

const preferenceKey = "bellhaven.schedule-groups.v1";
const preferenceSchema = z.object({
  active: z.boolean().optional(),
  inactive: z.boolean().optional(),
}).strict();
type Preferences = z.infer<typeof preferenceSchema>;
const groups = [
  { id: "active", label: "Active", enabled: true, defaultOpen: true },
  { id: "inactive", label: "Inactive", enabled: false, defaultOpen: false },
] as const;

function readPreferences(): Preferences {
  try {
    const stored = localStorage.getItem(preferenceKey);
    if (!stored) return {};
    const result = preferenceSchema.safeParse(JSON.parse(stored));
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

export default function ScheduleGroups({
  schedules,
  edit,
}: {
  schedules: Schedule[];
  edit: (schedule: Schedule) => void;
}) {
  const id = useId();
  const [preferences, setPreferences] = useState(readPreferences);
  function toggle(group: typeof groups[number]["id"], open: boolean) {
    const next = { ...preferences, [group]: open };
    setPreferences(next);
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(next));
    } catch {
      // The controls still work when browser storage is unavailable.
    }
  }

  if (!schedules.length) return null;
  return (
    <div className="schedule-groups">
      {groups.map((group) => {
        const entries = schedules.filter((schedule) => schedule.enabled === group.enabled);
        if (!entries.length) return null;
        const open = preferences[group.id] ?? group.defaultOpen;
        const panelId = `${id}-${group.id}`;
        return (
          <div className="schedule-group" key={group.id}>
            <button
              type="button"
              className="schedule-group-toggle"
              aria-label={`${group.label} ${entries.length}`}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => toggle(group.id, !open)}
            >
              <ChevronDown size={14} aria-hidden="true" />
              <span>{group.label}</span>
              <span className="schedule-group-count">{entries.length}</span>
            </button>
            <div id={panelId} hidden={!open}>
              {entries.map((schedule) => (
                <button
                  type="button"
                  key={schedule.id}
                  className="schedule-nav"
                  onClick={() => edit(schedule)}
                >
                  <Clock3 size={17} aria-hidden="true" />
                  <span>
                    {schedule.name}
                    <small>
                      {schedule.cadence === "hourly" ? `Hourly at :${schedule.time.slice(3)}` : schedule.time} · {group.label}
                    </small>
                  </span>
                  <span
                    className={`status-dot ${schedule.enabled ? "active" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
