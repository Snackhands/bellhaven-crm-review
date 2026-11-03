import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createServer, request as httpRequest } from 'node:http';
import { Store } from '../server/store.js';
import { ReviewService } from '../server/service.js';
import { createApp } from '../server/app.js';
import { createSchedule, nextRun, scheduleConfig, tickSchedules, updateSchedule } from '../server/schedules.js';
import { snapshot, account } from '../fixtures/synthetic.js';
import type { Run } from '../shared/contracts.js';

function setup() {
  const store = new Store(':memory:'); const data = snapshot([account({ name: 'Former published name' })]);
  const service = new ReviewService({ store, captureDir: '/unused-private', apiBase: 'https://synthetic.invalid/api', websiteUrl: 'https://synthetic.invalid', token: '', liveWritesEnabled: false, loadCapture: async () => data });
  return { store, service };
}
test('HTTP guards enforce localhost Host, approved Origin and JSON; public demo/reset are absent', async () => {
  const { store, service } = setup(); const server = createServer().listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const webDir = mkdtempSync(join(tmpdir(), 'bellhaven-web-'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Local review</title>');
  server.on('request', createApp(service, { port: address.port, webDir }));
  const request = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; json: () => unknown }> => new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: address.port, path, method: init.method ?? 'GET', headers: { Host: `localhost:${address.port}`, ...init.headers } }, response => {
      let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, json: () => JSON.parse(body) }));
    });
    request.on('error', reject); request.end(init.body);
  });
  try {
    assert.equal((await request('/api/health')).status, 200);
    const navigation = await request('/', { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' } }); assert.equal(navigation.status, 200);
    assert.equal((await request('/api/state', { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' } })).status, 403);
    assert.equal((await request('/assets/app.js', { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Dest': 'script' } })).status, 403);
    assert.equal((await request('/api/state', { headers: { Host: 'attacker.invalid' } })).status, 403);
    assert.equal((await request('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.invalid' }, body: JSON.stringify({ source: 'live' }) })).status, 403);
    assert.equal((await request('/api/runs', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await request('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, body: '{}' })).status, 403);
    assert.equal((await request('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })).status, 400);
    assert.equal((await request('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'demo' }) })).status, 400);
    assert.equal((await request('/api/demo/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
    const response = await request('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://localhost:${address.port}` }, body: JSON.stringify({ source: 'snapshot' }) }); assert.equal(response.status, 202);
    await service.waitForRun(); assert.equal(service.state().run?.status, 'ready');
    const proposal = service.state().proposals[0]; assert.ok(proposal);
    const wrong = await request(`/api/proposals/${proposal.id}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve', runId: proposal.runId, revision: 'old' }) });
    assert.equal(wrong.status, 409); assert.ok(z.object({ error: z.string() }).parse(await wrong.json()).error);
    const noContext = await request(`/api/proposals/${proposal.id}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'reject', revision: proposal.revision }) }); assert.equal(noContext.status, 400);
    assert.equal((await request('/api/runs')).status, 200);
    const detail = await request(`/api/runs/${proposal.runId}`); assert.equal(detail.status, 200); assert.equal(z.object({ evidenceQuality: z.literal('complete') }).parse(detail.json()).evidenceQuality, 'complete');
    assert.equal((await request('/api/runs/unknown')).status, 404);
    for (const path of ['/api/local-working-copy/reset', '/api/schedules/tick']) {
      assert.equal((await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.invalid' }, body: '{}' })).status, 403);
      assert.equal((await request(path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    }
    assert.equal((await request('/api/schedules/tick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
    assert.equal((await request('/api/schedules/tick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"unexpected":true}' })).status, 400);
    const session = service.store.session().sessionId;
    assert.equal((await request('/api/local-working-copy/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
    assert.equal((await request('/api/local-working-copy/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedSessionId: session }) })).status, 200);
    assert.equal((await request('/api/local-working-copy/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedSessionId: session }) })).status, 409);
    assert.equal(service.state().run, null); assert.equal(store.runs().length, 1);
    const state = await request('/api/state'); const raw: unknown = await state.json(); assert.equal(z.object({ settings: z.object({ credentialsConfigured: z.boolean() }) }).parse(raw).settings.credentialsConfigured, false);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); store.close(); rmSync(webDir, { recursive: true }); }
});
test('a credential-free live scan fails visibly without making a remote request', async () => {
  const { store, service } = setup(); service.startRun('live'); await service.waitForRun();
  assert.equal(service.state().run?.status, 'failed'); assert.match(service.state().run?.message ?? '', /CRM_TOKEN/); store.close();
});
test('named daily schedules validate fields, start disabled and expose scan-only config', () => {
  const { store } = setup();
  const schedule = createSchedule(store, { name: 'Morning Bellhaven', workflowId: 'bellhaven', time: '08:15', timezone: 'America/Regina', source: 'live' });
  assert.equal(schedule.enabled, false); assert.equal(schedule.cron, '* * * * *');
  const enabledAtCreate = createSchedule(store, { name: 'Explicitly enabled', workflowId: 'bellhaven', time: '08:15', timezone: 'America/Regina', source: 'live', enabled: true }); assert.equal(enabledAtCreate.enabled, true); assert.ok(enabledAtCreate.nextRunAt);
  const edited = updateSchedule(store, schedule.id, { name: 'Before coffee', enabled: true, time: '09:00' }); assert.equal(edited.name, 'Before coffee'); assert.ok(edited.nextRunAt);
  const config = scheduleConfig(edited); assert.match(config.command, /npm run schedule:tick/); assert.match(config.note, /No approval or CRM writes/);
  assert.throws(() => updateSchedule(store, schedule.id, { time: '25:00' }));
  assert.throws(() => createSchedule(store, { name: 'Bad timezone', workflowId: 'bellhaven', time: '08:00', timezone: 'Mars/Crater', source: 'live' }));
  assert.throws(() => updateSchedule(store, schedule.id, { arbitrary: 'value' })); store.close();
});
test('timezone daily scheduler prepares a queue once per local day and never approves it', async () => {
  const { store, service } = setup(); const schedule = createSchedule(store, { name: 'Local capture scan', workflowId: 'bellhaven', time: '08:00', timezone: 'America/Regina', source: 'snapshot' });
  updateSchedule(store, schedule.id, { enabled: true }); const now = new Date('2026-11-03T14:00:05Z');
  tickSchedules(service, now); await service.waitForRun(); const first = service.state().run; assert.ok(first);
  assert.ok(service.state().proposals.every(item => item.status === 'pending'));
  tickSchedules(service, new Date('2026-11-03T14:00:50Z')); assert.equal(service.state().run?.id, first.id);
  tickSchedules(service, new Date('2026-11-04T14:00:05Z')); await service.waitForRun(); assert.notEqual(service.state().run?.id, first.id);
  assert.equal(service.state().history.length, 0); store.close();
});
test('next daily run respects timezone and skips nonexistent spring-forward local time', () => {
  assert.equal(nextRun({ enabled: true, timezone: 'America/Regina', time: '08:00' }, new Date('2026-11-03T13:00:00Z')), '2026-11-03T14:00:00.000Z');
  assert.equal(nextRun({ enabled: true, timezone: 'America/New_York', time: '02:30' }, new Date('2026-03-08T06:59:00Z')), '2026-03-09T06:30:00.000Z');
});
test('startup converts interrupted running scan into visible failed state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bellhaven-restart-')); const path = join(directory, 'state.sqlite'); let store = new Store(path);
  const now = new Date().toISOString(); const run: Run = { id: 'interrupted', source: 'snapshot', workflowId: 'bellhaven', status: 'running', phase: 'scrape', startedAt: now, updatedAt: now, progress: { website: { completed: 3, total: null }, crm: { completed: 5, total: 10 }, compare: { completed: 0, total: null } }, message: 'Collecting', errors: [], etaSeconds: null };
  store.activateRun(run); store.close(); store = new Store(path);
  assert.equal(store.latestRun()?.status, 'failed'); assert.match(store.latestRun()?.message ?? '', /stopped/); store.close(); rmSync(directory, { recursive: true });
});
