import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import type { Schedule } from '../shared/contracts.js';

function ensureTables(store: Store): void {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_versions (schedule_id TEXT PRIMARY KEY, version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS schedule_occurrences (
      schedule_id TEXT NOT NULL, version TEXT NOT NULL, slot TEXT NOT NULL,
      PRIMARY KEY(schedule_id, version, slot)
    );
  `);
}
export function saveScheduleVersion(store: Store, schedule: Schedule): void {
  ensureTables(store);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const existing = store.schedule(schedule.id);
    const definitionChanged = !existing || existing.time !== schedule.time || existing.timezone !== schedule.timezone ||
      (existing.cadence ?? 'daily') !== (schedule.cadence ?? 'daily') || existing.startDate !== schedule.startDate ||
      existing.endDate !== schedule.endDate || existing.source !== schedule.source || existing.workflowId !== schedule.workflowId;
    store.saveSchedule(schedule);
    if (definitionChanged) store.db.prepare('INSERT INTO schedule_versions(schedule_id,version) VALUES(?,?) ON CONFLICT(schedule_id) DO UPDATE SET version=excluded.version').run(schedule.id, randomUUID());
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
}
export function claimOccurrence(store: Store, id: string, slot: string): boolean {
  ensureTables(store);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const created = store.db.prepare('INSERT OR IGNORE INTO schedule_versions(schedule_id,version) VALUES(?,?)').run(id, randomUUID());
    if (created.changes === 1) store.db.prepare('INSERT OR IGNORE INTO schedule_occurrences(schedule_id,version,slot) SELECT v.schedule_id,v.version,s.slot FROM schedule_versions v JOIN schedule_slots s ON s.schedule_id=v.schedule_id WHERE v.schedule_id=?').run(id);
    const claimed = store.db.prepare('INSERT OR IGNORE INTO schedule_occurrences(schedule_id,version,slot) SELECT schedule_id,version,? FROM schedule_versions WHERE schedule_id=?').run(slot, id).changes === 1;
    store.db.exec('COMMIT');
    return claimed;
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
}
export function releaseOccurrence(store: Store, id: string, slot: string): void {
  store.db.prepare('DELETE FROM schedule_occurrences WHERE schedule_id=? AND version=(SELECT version FROM schedule_versions WHERE schedule_id=?) AND slot=?').run(id, id, slot);
}
