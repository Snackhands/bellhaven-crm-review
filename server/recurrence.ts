import { localParts, occurrenceAt } from '../shared/schedule-time.js';
export { localParts, occurrenceAt } from '../shared/schedule-time.js';
import type { Schedule } from '../shared/contracts.js';

type Recurrence = Pick<Schedule, 'enabled' | 'timezone' | 'time' | 'cadence' | 'startDate' | 'endDate'>;
const dayMs = 86_400_000;
function dayNumber(date: string): number { return Date.parse(`${date}T00:00:00Z`) / dayMs; }
function dateForDay(day: number): string { return new Date(day * dayMs).toISOString().slice(0, 10); }

export function matchesDate(schedule: Recurrence, date: string): boolean {
  if (schedule.startDate && date < schedule.startDate || schedule.endDate && date > schedule.endDate) return false;
  const cadence = schedule.cadence ?? 'daily';
  if (cadence === 'daily') return true;
  if (!schedule.startDate) return false;
  const elapsed = dayNumber(date) - dayNumber(schedule.startDate);
  switch (cadence) {
    case 'hourly': return elapsed >= 0;
    case 'once': return elapsed === 0;
    case 'weekly': return elapsed % 7 === 0;
    case 'biweekly': return elapsed % 14 === 0;
    case 'monthly': return date.slice(8) === schedule.startDate.slice(8);
  }
}
export function dueOccurrence(schedule: Recurrence, now: Date): { date: string; time: string } | undefined {
  if (!schedule.enabled) return undefined;
  const local = localParts(now, schedule.timezone);
  if (!matchesDate(schedule, local.date)) return undefined;
  if (schedule.cadence === 'hourly') {
    if (local.time.slice(3) !== schedule.time.slice(3) || local.date === schedule.startDate && local.time < schedule.time) return undefined;
  } else if (local.time !== schedule.time) return undefined;
  const first = occurrenceAt(local.date, local.time, schedule.timezone);
  return first && now.getTime() >= first.getTime() && now.getTime() < first.getTime() + 60_000 ? local : undefined;
}

export function nextRun(schedule: Recurrence, after = new Date()): string | undefined {
  if (!schedule.enabled) return undefined;
  const cadence = schedule.cadence ?? 'daily';
  if (cadence !== 'daily' && !schedule.startDate) return undefined;
  const local = localParts(after, schedule.timezone);
  const today = local.date;
  const firstDate = schedule.startDate && schedule.startDate > today ? schedule.startDate : today;
  const lastDate = schedule.endDate ?? '9999-12-31';
  if (firstDate > lastDate) return undefined;
  if (cadence === 'hourly') {
    // Resolve local hour slots independently so gaps skip and folds run only once.
    for (let day = dayNumber(firstDate), lastDay = dayNumber(lastDate); day <= lastDay; day++) {
      const date = dateForDay(day);
      const firstHour = Math.max(date === today ? Number(local.time.slice(0, 2)) : 0,
        date === schedule.startDate ? Number(schedule.time.slice(0, 2)) : 0);
      for (let hour = firstHour; hour < 24; hour++) {
        const time = `${String(hour).padStart(2, '0')}:${schedule.time.slice(3)}`;
        const candidate = occurrenceAt(date, time, schedule.timezone);
        if (candidate && candidate > after) return candidate.toISOString();
      }
    }
    return undefined;
  }
  if (cadence === 'once') {
    if (!schedule.startDate || schedule.startDate < firstDate || schedule.startDate > lastDate) return undefined;
    const candidate = occurrenceAt(schedule.startDate, schedule.time, schedule.timezone);
    return candidate && candidate > after ? candidate.toISOString() : undefined;
  }
  if (cadence === 'monthly') {
    const anchor = schedule.startDate;
    if (!anchor) return undefined;
    const day = Number(anchor.slice(8));
    let month = Number(firstDate.slice(0, 4)) * 12 + Number(firstDate.slice(5, 7)) - 1;
    const lastMonth = Number(lastDate.slice(0, 4)) * 12 + Number(lastDate.slice(5, 7)) - 1;
    for (; month <= lastMonth; month++) {
      const date = `${String(Math.floor(month / 12)).padStart(4, '0')}-${String(month % 12 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (date < firstDate || date > lastDate || dateForDay(dayNumber(date)) !== date) continue;
      const candidate = occurrenceAt(date, schedule.time, schedule.timezone);
      if (candidate && candidate > after) return candidate.toISOString();
    }
    return undefined;
  }
  const interval = cadence === 'weekly' ? 7 : cadence === 'biweekly' ? 14 : 1;
  let day = dayNumber(firstDate);
  if (schedule.startDate) {
    const anchor = dayNumber(schedule.startDate);
    day = anchor + Math.ceil((day - anchor) / interval) * interval;
  }
  for (const lastDay = dayNumber(lastDate); day <= lastDay; day += interval) {
    const candidate = occurrenceAt(dateForDay(day), schedule.time, schedule.timezone);
    if (candidate && candidate > after) return candidate.toISOString();
  }
  return undefined;
}
