import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { Schedule } from '../shared/contracts.js';
import { Store } from '../server/store.js';
import { ReviewService } from '../server/service.js';
import { dueOccurrence, localParts, matchesDate, nextRun, occurrenceAt } from '../server/recurrence.js';
import { claimOccurrence, releaseOccurrence, saveScheduleVersion } from '../server/schedule-claims.js';
import { createSchedule, scheduleConfig, tickSchedules, updateSchedule } from '../server/schedules.js';
import { runScheduleTick } from '../server/schedule-cli.js';
import { scheduleInputSchema, schedulePatchSchema } from '../server/schema.js';
import { account, snapshot } from '../fixtures/synthetic.js';

const base: Schedule = { id: 'schedule', name: 'Capture check', workflowId: 'bellhaven', source: 'snapshot', time: '08:00', timezone: 'UTC', cron: '* * * * *', enabled: true };
function serviceFor(store: Store) {
  return new ReviewService({ store, captureDir: '/unused-private', apiBase: 'https://synthetic.invalid/api', websiteUrl: 'https://synthetic.invalid', token: '', liveWritesEnabled: false, loadCapture: async () => snapshot([account({ name: 'Old captured name' })]) });
}
function input(overrides: Partial<Schedule> = {}) {
  const { id: _id, cron: _cron, ...fields } = { ...base, ...overrides };
  return fields;
}

test('recurrence input accepts legacy daily and validates calendar dates, anchors and bounds', () => {
  const legacy = scheduleInputSchema.parse({ name: 'Legacy', workflowId: 'bellhaven', source: 'snapshot', time: '08:00', timezone: 'UTC' });
  assert.equal(legacy.enabled, false);
  assert.deepEqual(schedulePatchSchema.parse({ name: 'Only rename' }), { name: 'Only rename' });
  assert.equal(scheduleInputSchema.parse({ ...input(), endDate: null }).endDate, undefined);
  assert.deepEqual(schedulePatchSchema.parse({ endDate: null }), { endDate: undefined });
  for (const cadence of ['once', 'hourly', 'weekly', 'biweekly', 'monthly']) assert.throws(() => scheduleInputSchema.parse(input({ cadence: scheduleInputSchema.shape.cadence.parse(cadence) })));
  assert.throws(() => scheduleInputSchema.parse(input({ startDate: '2026-02-29' })));
  assert.throws(() => scheduleInputSchema.parse(input({ startDate: '2026-03-08', endDate: '2026-03-07' })));
  assert.throws(() => scheduleInputSchema.parse(input({ time: '8:00' })));
  assert.throws(() => scheduleInputSchema.parse(input({ timezone: 'Mars/Crater' })));
});
test('calendar dates apply inclusive bounds and anchored fortnight across year boundaries', () => {
  const fortnight: Schedule = { ...base, cadence: 'biweekly', startDate: '2026-12-25', endDate: '2027-01-22' };
  for (const date of ['2026-12-25', '2027-01-08', '2027-01-22']) assert.equal(matchesDate(fortnight, date), true);
  for (const date of ['2026-12-11', '2027-01-01', '2027-01-29', '2027-02-05']) assert.equal(matchesDate(fortnight, date), false);
  assert.equal(nextRun(fortnight, new Date('2026-12-26T00:00:00Z')), '2027-01-08T08:00:00.000Z');
  assert.equal(nextRun(fortnight, new Date('2027-01-22T08:00:00Z')), undefined);
  const weekly = { ...fortnight, cadence: 'weekly' } satisfies Schedule;
  assert.equal(nextRun(weekly, new Date('2026-12-26T00:00:00Z')), '2027-01-01T08:00:00.000Z');
  assert.equal(nextRun({ ...base, startDate: '2027-01-01', endDate: '2027-01-01' }, new Date('2026-01-01T00:00:00Z')), '2027-01-01T08:00:00.000Z');
});
test('monthly dates skip absent days and handle leap years with calendar candidates', { timeout: 1000 }, () => {
  const monthly = { ...base, cadence: 'monthly', startDate: '2026-01-31' } satisfies Schedule;
  assert.equal(nextRun(monthly, new Date('2026-01-31T08:00:00Z')), '2026-03-31T08:00:00.000Z');
  assert.equal(nextRun(monthly, new Date('2026-03-31T08:00:00Z')), '2026-05-31T08:00:00.000Z');
  assert.equal(nextRun({ ...monthly, endDate: '2026-03-30' }, new Date('2026-01-31T08:00:00Z')), undefined);
  const leap = { ...monthly, startDate: '2028-01-29' };
  assert.equal(nextRun(leap, new Date('2028-02-01T00:00:00Z')), '2028-02-29T08:00:00.000Z');
  assert.equal(nextRun({ ...leap, startDate: '2027-01-29' }, new Date('2027-02-01T00:00:00Z')), '2027-03-29T08:00:00.000Z');
  assert.equal(nextRun({ ...monthly, startDate: '2099-12-31' }, new Date('2026-01-01T00:00:00Z')), '2099-12-31T08:00:00.000Z');
});
test('once and inactive schedules have no extra occurrences or minute backfill', () => {
  const once = { ...base, cadence: 'once', startDate: '2026-11-03' } satisfies Schedule;
  assert.equal(nextRun(once, new Date('2026-11-02T12:00:00Z')), '2026-11-03T08:00:00.000Z');
  assert.ok(dueOccurrence(once, new Date('2026-11-03T08:00:59.999Z')));
  assert.equal(dueOccurrence(once, new Date('2026-11-03T08:01:00Z')), undefined);
  assert.equal(dueOccurrence(once, new Date('2026-11-04T08:00:00Z')), undefined);
  assert.equal(nextRun(once, new Date('2026-11-03T08:00:00Z')), undefined);
  assert.equal(nextRun({ ...once, enabled: false }, new Date('2026-11-02T12:00:00Z')), undefined);
  assert.equal(dueOccurrence({ ...once, enabled: false }, new Date('2026-11-03T08:00:10Z')), undefined);
});
test('DST gaps skip and folds select only their first instant, including after restart', () => {
  const spring = { ...base, timezone: 'America/New_York', time: '02:30' };
  assert.equal(occurrenceAt('2026-03-08', spring.time, spring.timezone), undefined);
  assert.equal(nextRun(spring, new Date('2026-03-08T06:59:00Z')), '2026-03-09T06:30:00.000Z');
  assert.equal(nextRun({ ...spring, cadence: 'once', startDate: '2026-03-08' }, new Date('2026-03-08T00:00:00Z')), undefined);
  const fold = { ...spring, time: '01:30' };
  assert.equal(occurrenceAt('2026-11-01', fold.time, fold.timezone)?.toISOString(), '2026-11-01T05:30:00.000Z');
  assert.ok(dueOccurrence(fold, new Date('2026-11-01T05:30:45Z')));
  assert.equal(dueOccurrence(fold, new Date('2026-11-01T06:30:00Z')), undefined);
  assert.equal(nextRun(fold, new Date('2026-11-01T05:31:00Z')), '2026-11-02T06:30:00.000Z');
  assert.equal(nextRun(fold, new Date('2026-11-01T06:29:00Z')), '2026-11-02T06:30:00.000Z');
});
test('calendar conversion supports quarter-hour offsets, half-hour DST and skipped dates', () => {
  assert.equal(occurrenceAt('2026-11-03', '08:00', 'Asia/Kathmandu')?.toISOString(), '2026-11-03T02:15:00.000Z');
  assert.equal(occurrenceAt('2026-10-04', '02:15', 'Australia/Lord_Howe'), undefined);
  assert.equal(occurrenceAt('2026-04-05', '01:45', 'Australia/Lord_Howe')?.toISOString(), '2026-04-04T14:45:00.000Z');
  assert.equal(nextRun({ ...base, timezone: 'Pacific/Apia' }, new Date('2011-12-29T19:00:00Z')), '2011-12-30T18:00:00.000Z');
});
test('hourly starts at its first local time, repeats across midnight and includes the entire end date', { timeout: 1000 }, () => {
  const hourly = { ...base, cadence: 'hourly', startDate: '2026-11-03', endDate: '2026-11-04', time: '14:25' } satisfies Schedule;
  for (const at of ['2026-11-02T14:25:00Z', '2026-11-03T13:25:00Z']) assert.equal(dueOccurrence(hourly, new Date(at)), undefined);
  assert.equal(nextRun(hourly, new Date('2026-11-03T14:24:59Z')), '2026-11-03T14:25:00.000Z');
  assert.equal(nextRun(hourly, new Date('2026-11-03T14:25:00Z')), '2026-11-03T15:25:00.000Z');
  assert.equal(nextRun(hourly, new Date('2026-11-03T14:25:59Z')), '2026-11-03T15:25:00.000Z');
  assert.equal(nextRun(hourly, new Date('2026-11-03T23:25:00Z')), '2026-11-04T00:25:00.000Z');
  for (const at of ['2026-11-03T14:25:00Z', '2026-11-03T15:25:59.999Z', '2026-11-04T00:25:00Z', '2026-11-04T23:25:00Z']) {
    assert.deepEqual(dueOccurrence(hourly, new Date(at)), localParts(new Date(at), 'UTC'));
  }
  for (const at of ['2026-11-03T15:26:00Z', '2026-11-05T00:25:00Z']) assert.equal(dueOccurrence(hourly, new Date(at)), undefined);
  assert.equal(nextRun(hourly, new Date('2026-11-04T23:25:00Z')), undefined);
  assert.equal(nextRun({ ...hourly, enabled: false }, new Date('2026-11-03T14:00:00Z')), undefined);
  assert.equal(dueOccurrence({ ...hourly, enabled: false }, new Date('2026-11-03T14:25:00Z')), undefined);
  assert.equal(nextRun({ ...hourly, startDate: undefined }, new Date('2026-11-03T14:00:00Z')), undefined);
  assert.equal(dueOccurrence({ ...hourly, startDate: undefined }, new Date('2026-11-03T14:25:00Z')), undefined);
  assert.equal(nextRun({ ...hourly, startDate: '2099-11-03', endDate: undefined }, new Date('2026-11-03T14:00:00Z')), '2099-11-03T14:25:00.000Z');
  assert.throws(() => scheduleInputSchema.parse(input({ ...hourly, startDate: '2026-02-30' })));
});
test('hourly enumerates local slots through quarter-hour offsets and DST gaps and folds', () => {
  const hourly = { ...base, cadence: 'hourly', startDate: '2026-01-01', time: '00:30' } satisfies Schedule;
  const cases = [
    { timezone: 'Asia/Kathmandu', after: '2026-11-03T02:45:00Z', next: '2026-11-03T03:45:00.000Z' },
    { timezone: 'America/New_York', after: '2026-03-08T06:30:00Z', next: '2026-03-08T07:30:00.000Z' },
    { timezone: 'America/New_York', after: '2026-11-01T05:30:00Z', next: '2026-11-01T07:30:00.000Z' },
    { timezone: 'America/New_York', after: '2026-11-01T06:29:00Z', next: '2026-11-01T07:30:00.000Z' },
    { timezone: 'Australia/Lord_Howe', after: '2026-10-03T15:00:00Z', next: '2026-10-03T15:30:00.000Z' },
    { timezone: 'Australia/Lord_Howe', after: '2026-04-04T14:30:00Z', next: '2026-04-04T16:00:00.000Z' },
  ];
  for (const { timezone, after, next } of cases) {
    const schedule = { ...hourly, timezone };
    assert.equal(nextRun(schedule, new Date(after)), next, `${timezone} after ${after}`);
    assert.ok(dueOccurrence(schedule, new Date(next)), `${timezone} due at next`);
    assert.ok(Date.parse(nextRun(schedule, new Date(next)) ?? '') > Date.parse(next));
  }
  const halfHourGap = { ...hourly, timezone: 'Australia/Lord_Howe', time: '00:15' };
  assert.equal(nextRun(halfHourGap, new Date('2026-10-03T14:45:00Z')), '2026-10-03T16:15:00.000Z');
  assert.equal(dueOccurrence({ ...hourly, timezone: 'America/New_York' }, new Date('2026-11-01T06:30:00Z')), undefined);
  assert.equal(dueOccurrence({ ...hourly, timezone: 'Australia/Lord_Howe', time: '00:45' }, new Date('2026-04-04T15:15:00Z')), undefined);
  assert.equal(nextRun({ ...hourly, timezone: 'America/New_York', startDate: '2026-03-08', time: '02:30' }, new Date('2026-03-08T05:00:00Z')), '2026-03-08T07:30:00.000Z');
});
test('hourly persistence and per-hour claims survive restart and remain independent by schedule ID', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'recurrence-hourly-')); const path = join(directory, 'state.sqlite');
  let store = new Store(path); let service = serviceFor(store);
  try {
    const legacy = createSchedule(store, input({ time: '14:25' }));
    assert.throws(() => updateSchedule(store, legacy.id, { cadence: 'hourly' }));
    const first = updateSchedule(store, legacy.id, { cadence: 'hourly', startDate: '2026-11-03', endDate: '2026-11-04' });
    const second = createSchedule(store, input({ cadence: 'hourly', startDate: '2026-11-03', time: '14:25' }));
    tickSchedules(service, new Date('2026-11-03T14:25:05Z')); await service.waitForRun();
    const firstRun = store.latestRun()?.id; assert.ok(firstRun);
    tickSchedules(service, new Date('2026-11-03T14:25:20Z')); await service.waitForRun();
    const secondRun = store.latestRun()?.id; assert.notEqual(secondRun, firstRun);
    assert.equal(store.schedule(first.id)?.lastRunAt, '2026-11-03T14:25:05.000Z');
    assert.equal(store.schedule(second.id)?.lastRunAt, '2026-11-03T14:25:20.000Z');
    store.close(); store = new Store(path); service = serviceFor(store);
    const loaded = store.schedule(first.id); assert.ok(loaded);
    assert.equal(loaded.cadence, 'hourly'); assert.equal(loaded.time, '14:25');
    assert.equal(loaded.startDate, '2026-11-03'); assert.equal(loaded.endDate, '2026-11-04');
    tickSchedules(service, new Date('2026-11-03T14:25:40Z'));
    assert.equal(store.latestRun()?.id, secondRun);
    tickSchedules(service, new Date('2026-11-03T15:25:05Z')); await service.waitForRun();
    const thirdRun = store.latestRun()?.id; assert.notEqual(thirdRun, secondRun);
    tickSchedules(service, new Date('2026-11-03T15:25:20Z')); await service.waitForRun();
    const fourthRun = store.latestRun()?.id; assert.notEqual(fourthRun, thirdRun);
    tickSchedules(service, new Date('2026-11-03T15:25:50Z'));
    assert.equal(store.latestRun()?.id, fourthRun);
    assert.equal(store.runs().length, 4);
    assert.equal(store.history().length, 0);
    assert.ok(service.state().proposals.every(proposal => proposal.status === 'pending'));
  } finally { await service.waitForRun(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('durable occurrence claims survive reopening, retain older slots and isolate schedule versions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'recurrence-claims-')); const path = join(directory, 'state.sqlite');
  let store = new Store(path);
  try {
    store.saveSchedule(base);
    store.claimScheduleSlot(base.id, '2026-11-01 08:00');
    assert.equal(claimOccurrence(store, base.id, '2026-11-01 08:00'), false);
    assert.equal(claimOccurrence(store, base.id, '2026-11-02 08:00'), true);
    assert.equal(claimOccurrence(store, base.id, '2026-11-03 08:00'), true);
    store.close(); store = new Store(path);
    assert.equal(claimOccurrence(store, base.id, '2026-11-02 08:00'), false);
    assert.equal(claimOccurrence(store, base.id, '2026-11-03 08:00'), false);
    saveScheduleVersion(store, { ...base, time: '09:00' });
    assert.equal(claimOccurrence(store, base.id, '2026-11-03 08:00'), true);
    releaseOccurrence(store, base.id, '2026-11-03 08:00');
    assert.equal(claimOccurrence(store, base.id, '2026-11-03 08:00'), true);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('all schedule exports invoke the same every-minute due checker', () => {
  for (const cadence of ['once', 'hourly', 'daily', 'weekly', 'biweekly', 'monthly']) {
    const config = scheduleConfig({ ...base, cadence: scheduleInputSchema.shape.cadence.parse(cadence), startDate: '2026-11-03', cron: '0 8 * * *' });
    assert.equal(config.cron, '* * * * *');
    assert.equal(config.command, 'npm run schedule:tick');
    assert.match(config.note, /No approval or CRM writes/);
    assert.match(config.note, /not backfilled/);
  }
});
test('CLI posts only the local tick when the server is awake', async () => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.setHeader('Content-Type', 'application/json'); response.end('{"ok":true}');
  }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    await runScheduleTick({ port: address.port, statePath: '/unused-private', captureDir: '/unused-private', apiBase: 'https://synthetic.invalid/api', websiteUrl: 'https://synthetic.invalid', token: '', liveWritesEnabled: false });
    assert.deepEqual(requests, ['GET /api/health', 'POST /api/schedules/tick']);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
test('CLI standalone tick locks its private database and leaves an inactive queue untouched', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'recurrence-cli-')); const statePath = join(directory, 'state.sqlite');
  const server = createServer().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  let store = new Store(statePath); createSchedule(store, input({ enabled: false })); store.close();
  try {
    await runScheduleTick({ port: address.port, statePath, captureDir: join(directory, 'capture'), apiBase: 'https://synthetic.invalid/api', websiteUrl: 'https://synthetic.invalid', token: '', liveWritesEnabled: false });
    assert.equal(existsSync(`${statePath}.lock`), false);
    store = new Store(statePath);
    assert.equal(store.latestRun(), null); assert.equal(store.history().length, 0); store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('persisted cadence and date bounds survive edits and a restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'recurrence-persistence-')); const path = join(directory, 'state.sqlite');
  let store = new Store(path);
  try {
    const created = createSchedule(store, input({ cadence: 'monthly', startDate: '2026-01-31', endDate: '2027-01-31' }));
    updateSchedule(store, created.id, { name: 'Renamed' });
    store.close(); store = new Store(path);
    const loaded = store.schedule(created.id); assert.ok(loaded);
    assert.equal(loaded.cadence, 'monthly'); assert.equal(loaded.startDate, '2026-01-31'); assert.equal(loaded.endDate, '2027-01-31'); assert.equal(loaded.enabled, true);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('persisted end date can be cleared explicitly while omission preserves it', () => {
  const store = new Store(':memory:');
  try {
    const schedule = createSchedule(store, input({ startDate: '2026-11-03', endDate: '2026-11-30' }));
    assert.equal(updateSchedule(store, schedule.id, { name: 'Name only' }).endDate, '2026-11-30');
    assert.equal(updateSchedule(store, schedule.id, { endDate: null }).endDate, undefined);
    assert.equal(store.schedule(schedule.id)?.endDate, undefined);
  } finally { store.close(); }
});
test('persisted once schedule disables only after starting, with truthful lastRunAt and no approvals', async () => {
  const store = new Store(':memory:'); const service = serviceFor(store);
  try {
    const created = createSchedule(store, input({ cadence: 'once', startDate: '2026-11-03' }));
    tickSchedules(service, new Date('2026-11-02T08:00:10Z'));
    assert.equal(store.latestRun(), null);
    assert.equal(store.schedule(created.id)?.lastRunAt, undefined);
    tickSchedules(service, new Date('2026-11-03T08:00:10Z')); await service.waitForRun();
    assert.equal(store.latestRun()?.status, 'ready');
    assert.equal(store.schedule(created.id)?.enabled, false);
    assert.equal(store.schedule(created.id)?.lastRunAt, '2026-11-03T08:00:10.000Z');
    assert.equal(store.schedule(created.id)?.nextRunAt, undefined);
    const id = store.latestRun()?.id;
    tickSchedules(service, new Date('2026-11-03T08:00:50Z'));
    tickSchedules(service, new Date('2026-11-04T08:00:10Z'));
    assert.equal(store.latestRun()?.id, id); assert.equal(store.history().length, 0);
    assert.ok(service.state().proposals.every(proposal => proposal.status === 'pending'));
  } finally { await service.waitForRun(); store.close(); }
});
test('busy scans skip due work without claiming it, and disabled schedules never scan', async () => {
  const store = new Store(':memory:'); const service = serviceFor(store);
  try {
    createSchedule(store, input({ enabled: false }));
    tickSchedules(service, new Date('2026-11-03T08:00:10Z')); assert.equal(store.latestRun(), null);
    const schedule = createSchedule(store, input());
    service.startRun('snapshot'); const busyRun = store.latestRun()?.id;
    tickSchedules(service, new Date('2026-11-03T08:00:10Z'));
    assert.equal(store.latestRun()?.id, busyRun);
    await service.waitForRun();
    tickSchedules(service, new Date('2026-11-03T08:00:20Z')); await service.waitForRun();
    assert.notEqual(store.latestRun()?.id, busyRun);
    assert.equal(store.schedule(schedule.id)?.lastRunAt, '2026-11-03T08:00:20.000Z');
    const first = store.latestRun()?.id;
    tickSchedules(service, new Date('2026-11-03T08:00:50Z'));
    assert.equal(store.latestRun()?.id, first);
    assert.deepEqual(localParts(new Date('2026-11-03T08:00:20Z'), 'UTC'), { date: '2026-11-03', time: '08:00' });
  } finally { await service.waitForRun(); store.close(); }
});

test('renaming, toggling and unchanged definitions retain claimed occurrence identity', async () => {
  const store = new Store(':memory:'); const service = serviceFor(store);
  try {
    const schedule = createSchedule(store, input());
    tickSchedules(service, new Date('2026-11-03T08:00:05Z')); await service.waitForRun();
    const first = store.latestRun()?.id; assert.ok(first);
    updateSchedule(store, schedule.id, { name: 'A new label' });
    tickSchedules(service, new Date('2026-11-03T08:00:10Z'));
    assert.equal(store.latestRun()?.id, first);
    updateSchedule(store, schedule.id, { enabled: false });
    tickSchedules(service, new Date('2026-11-03T08:00:15Z'));
    assert.equal(store.latestRun()?.id, first);
    updateSchedule(store, schedule.id, { enabled: true });
    tickSchedules(service, new Date('2026-11-03T08:00:20Z'));
    assert.equal(store.latestRun()?.id, first);
    updateSchedule(store, schedule.id, { cadence: 'daily', time: '08:00', timezone: 'UTC', source: 'snapshot', workflowId: 'bellhaven' });
    tickSchedules(service, new Date('2026-11-03T08:00:25Z'));
    assert.equal(store.latestRun()?.id, first);
    updateSchedule(store, schedule.id, { time: '08:01' });
    tickSchedules(service, new Date('2026-11-03T08:01:05Z')); await service.waitForRun();
    assert.notEqual(store.latestRun()?.id, first);
    assert.equal(store.schedule(schedule.id)?.lastRunAt, '2026-11-03T08:01:05.000Z');
    assert.equal(store.history().length, 0);
  } finally { await service.waitForRun(); store.close(); }
});
