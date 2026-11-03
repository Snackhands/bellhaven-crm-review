import { randomUUID } from 'node:crypto';
import type { Schedule } from '../shared/contracts.js';
import { scheduleInputSchema, schedulePatchSchema } from './schema.js';
import type { Store } from './store.js';
import type { ReviewService } from './service.js';
import { AppError } from './executor.js';
import { dueOccurrence, nextRun } from './recurrence.js';
import { claimOccurrence, releaseOccurrence, saveScheduleVersion } from './schedule-claims.js';

export { nextRun } from './recurrence.js';
export function cronFor(_time?: string): string { return '* * * * *'; }
export function createSchedule(store: Store, raw: unknown): Schedule {
  const input = scheduleInputSchema.parse(raw);
  const schedule: Schedule = { ...input, id: randomUUID(), cron: cronFor() };
  schedule.nextRunAt = nextRun(schedule);
  saveScheduleVersion(store, schedule); return schedule;
}
export function updateSchedule(store: Store, id: string, raw: unknown): Schedule {
  const existing = store.schedule(id);
  if (!existing) throw new AppError('Schedule not found.', 404);
  const patch = schedulePatchSchema.parse(raw);
  const values = scheduleInputSchema.parse({ name: existing.name, workflowId: existing.workflowId, time: existing.time, timezone: existing.timezone, source: existing.source, enabled: existing.enabled, cadence: existing.cadence, startDate: existing.startDate, endDate: existing.endDate, ...patch });
  const updated: Schedule = { ...existing, ...values, cron: cronFor() };
  updated.nextRunAt = nextRun(updated);
  saveScheduleVersion(store, updated); return updated;
}
export function scheduleConfig(schedule: Schedule): { cron: string; command: string; timezone: string; note: string } {
  return { cron: cronFor(), command: 'npm run schedule:tick', timezone: schedule.timezone,
    note: 'Every-minute due check uses each saved schedule\'s cadence, dates, time and IANA timezone. No approval or CRM writes. The server or cron must be awake; missed minutes are not backfilled. DST gaps skip and folds run once at the earlier instant. Run from the project directory. This command evaluates all enabled schedules; install it only once.' };
}
export function tickSchedules(service: ReviewService, now = new Date()): void {
  for (const saved of service.store.schedules()) {
    if (!saved.enabled) continue;
    const schedule = { ...saved, nextRunAt: nextRun(saved, now) };
    if (schedule.nextRunAt !== saved.nextRunAt) service.store.saveSchedule(schedule);
    if (service.isBusy) continue;
    const local = dueOccurrence(schedule, now);
    if (!local) continue;
    const slot = `${local.date} ${local.time}`;
    if (!claimOccurrence(service.store, schedule.id, slot)) continue;
    try {
      service.startRun(schedule.source);
    } catch {
      releaseOccurrence(service.store, schedule.id, slot);
      continue;
    }
    const enabled = schedule.cadence === 'once' ? false : schedule.enabled;
    service.store.saveSchedule({ ...schedule, enabled, lastRunAt: now.toISOString(), nextRunAt: nextRun({ ...schedule, enabled }, now) });
  }
}
