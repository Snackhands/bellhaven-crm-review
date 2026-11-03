import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Account, Proposal, Snapshot, SourceMode } from '../shared/contracts.js';
import { account, location, snapshot } from '../fixtures/synthetic.js';
import { LocalAdapter } from '../server/adapters.js';
import { ReviewService } from '../server/service.js';
import { Store } from '../server/store.js';
import { comparisonsFor, reconcile } from '../server/domain.js';

function setup(data: Snapshot = snapshot([account({ name: 'Previous name' })]), path = ':memory:') {
  const store = new Store(path);
  let loads = 0;
  const service = new ReviewService({ store, captureDir: '/unused', websiteUrl: 'https://synthetic.invalid', apiBase: 'https://synthetic.invalid/api', token: '', liveWritesEnabled: false,
    loadCapture: async () => { loads++; return data; } });
  return { store, service, loads: () => loads };
}
async function scan(service: ReviewService, source: SourceMode = 'snapshot'): Promise<Proposal> {
  service.startRun(source); await service.waitForRun();
  assert.equal(service.state().run?.status, 'ready');
  const proposal = service.state().proposals[0]; assert.ok(proposal); return proposal;
}
const decide = (service: ReviewService, proposal: Proposal, decision: 'approve' | 'reject' = 'approve') => service.decide(proposal.id, { runId: proposal.runId, revision: proposal.revision, decision });

test('run input, comparison and proposal definitions survive later writes and scans unchanged', async () => {
  const { store, service } = setup();
  try {
    const first = await scan(service);
    const before = store.runDetail(first.runId); assert.ok(before?.input);
    const frozen = JSON.stringify({ input: before.input, comparisons: before.comparisons, current: before.proposals[0]?.current, proposed: before.proposals[0]?.proposed });
    assert.equal(before.result, null);
    await decide(service, first);
    const applied = store.runDetail(first.runId); assert.ok(applied?.result);
    assert.equal(applied.result.accounts.find(item => item.account_id === 'facility-a')?.name, location().name);
    assert.equal(applied.proposals[0]?.status, 'applied'); assert.ok(applied.events.some(event => event.status === 'applied'));
    await scan(service);
    const old = store.runDetail(first.runId); assert.ok(old);
    assert.equal(JSON.stringify({ input: old.input, comparisons: old.comparisons, current: old.proposals[0]?.current, proposed: old.proposals[0]?.proposed }), frozen);
    assert.equal(old.actionable, false); assert.equal(old.proposals[0]?.status, 'applied');
    assert.equal(store.runs().length, 2);
  } finally { store.close(); }
});

test('both decisions reject old tabs, wrong membership, wrong revision and stale sessions', async () => {
  const { store, service } = setup();
  try {
    const first = await scan(service); const second = await scan(service);
    for (const decision of ['approve', 'reject'] as const) {
      await assert.rejects(decide(service, first, decision), /historical/);
      await assert.rejects(service.decide('not-in-run', { decision, runId: second.runId, revision: second.revision }), /belong/);
      await assert.rejects(service.decide(second.id, { decision, runId: second.runId, revision: 'old' }), /out of date/);
    }
    const previousSession = store.session().sessionId; service.resetLocal(previousSession);
    await assert.rejects(decide(service, second, 'reject'), /historical/);
    assert.throws(() => service.resetLocal(previousSession), /session changed/);
    assert.equal(service.state().run, null);
  } finally { store.close(); }
});

test('reset restores the pinned original capture without loading files or requesting a remote adapter', async () => {
  const data = snapshot([account({ name: 'Original name' })]); const { store, service, loads } = setup(data);
  try {
    const original = structuredClone(data); const first = await scan(service); await decide(service, first);
    const oldSession = store.session().sessionId; const beforeLoads = loads();
    data.accounts = [account({ name: 'Overwritten capture' })]; data.locations = [location({ name: 'Overwritten website' })];
    const guarded = new ReviewService({ ...service.options, adapter: () => { throw new Error('Reset must not construct an adapter'); } });
    const state = guarded.resetLocal(oldSession);
    assert.notEqual(state.localWorkspace?.sessionId, oldSession); assert.equal(state.run, null); assert.equal(loads(), beforeLoads);
    assert.deepEqual(store.accounts('snapshot'), [...original.accounts].sort((a, b) => a.account_id.localeCompare(b.account_id)));
    const next = await scan(service); assert.notEqual(next.id, first.id); assert.equal(loads(), beforeLoads);
    assert.deepEqual(store.runDetail(next.runId)?.input?.locations, original.locations);
    assert.equal(store.runDetail(first.runId)?.proposals[0]?.status, 'applied'); assert.ok(store.runDetail(first.runId)?.result);
    assert.equal(store.db.prepare('SELECT count(DISTINCT source) AS n FROM accounts').get()?.n, 2);
  } finally { store.close(); }
});

test('rejection suppresses identical evidence in one session and does not leak into a reset session', async () => {
  const { store, service } = setup();
  try {
    const first = await scan(service); await decide(service, first, 'reject');
    const second = await scan(service); assert.equal(second.id, first.id); assert.equal(second.status, 'rejected');
    service.resetLocal(store.session().sessionId);
    const fresh = await scan(service); assert.notEqual(fresh.id, first.id); assert.equal(fresh.status, 'pending');
    assert.equal(store.runDetail(first.runId)?.proposals[0]?.status, 'rejected');
  } finally { store.close(); }
});

test('reset is blocked during a scan, and no baseline is fabricated before import', async () => {
  const { store, service } = setup();
  try {
    assert.equal(store.workspace().canReset, false);
    assert.throws(() => service.resetLocal(store.session().sessionId), /original capture/);
    service.startRun('snapshot'); assert.throws(() => service.resetLocal(store.session().sessionId), /in progress/);
    await service.waitForRun();
  } finally { store.close(); }
});

test('partial CHOW stores actual successor creation and preserves the unlinked original result', async () => {
  const data = snapshot([account({ parent_id: 'old-owner', lifetime_revenue: 500, outstanding_ar: 50 })]);
  const { store, service } = setup(data);
  class FailedLink extends LocalAdapter {
    override async patch(): Promise<Account> { throw new Error('Synthetic link failure'); }
  }
  const local = new FailedLink(store, 'snapshot');
  const failing = new ReviewService({ ...service.options, adapter: () => local });
  try {
    const proposal = await scan(failing); assert.equal(proposal.kind, 'chow');
    const result = await decide(failing, proposal); assert.equal(result.status, 'failed'); assert.ok(result.resultAccountId);
    const detail = store.runDetail(proposal.runId); assert.ok(detail?.result);
    const successor = detail.result.accounts.find(account => account.account_id === result.resultAccountId); assert.ok(successor);
    assert.equal(successor.lifetime_revenue, 0); assert.equal(detail.result.accounts.find(account => account.account_id === 'facility-a')?.chow_current_account, '');
    assert.equal(detail.input?.accounts.length, data.accounts.length); assert.equal(detail.result.accounts.length, data.accounts.length + 1);
  } finally { store.close(); }
});

test('local account mutation rolls back when its result version cannot be persisted', async () => {
  const { store, service } = setup();
  try {
    const proposal = await scan(service); const original = store.account('snapshot', 'facility-a'); assert.ok(original);
    store.withWriteRun(proposal.runId);
    store.db.exec("CREATE TRIGGER fail_result BEFORE INSERT ON local_results BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
    await assert.rejects(new LocalAdapter(store, 'snapshot').patch('facility-a', { name: 'Should roll back' }), /synthetic failure/);
    assert.deepEqual(store.account('snapshot', 'facility-a'), original); assert.equal(store.runDetail(proposal.runId)?.result, null);
  } finally { store.close(); }
});

test('saved inputs, sessions, result versions and reset baseline survive restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bellhaven-history-')); const path = join(directory, 'state.sqlite');
  let instance = setup(undefined, path);
  try {
    const proposal = await scan(instance.service); await decide(instance.service, proposal);
    const expected = instance.store.runDetail(proposal.runId); const session = instance.store.session().sessionId;
    instance.store.close(); instance = setup(undefined, path);
    assert.deepEqual(instance.store.runDetail(proposal.runId), expected); assert.equal(instance.store.session().sessionId, session);
    instance.service.resetLocal(session); const resetSession = instance.store.session().sessionId;
    instance.store.close(); instance = setup(undefined, path);
    assert.equal(instance.service.state().run, null); assert.equal(instance.store.session().sessionId, resetSession);
    assert.deepEqual(instance.store.runDetail(proposal.runId)?.input, expected?.input);
  } finally { instance.store.close(); rmSync(directory, { recursive: true }); }
});

test('legacy runs retain known proposal views without invented input, results or review events', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bellhaven-legacy-')); const path = join(directory, 'state.sqlite');
  const db = new DatabaseSync(path); const data = snapshot([account({ name: 'Former name' })]);
  const now = new Date().toISOString(); const run = { id: 'legacy', source: 'snapshot', workflowId: 'bellhaven', status: 'ready', phase: 'review', startedAt: now, updatedAt: now, progress: { website: { completed: 1, total: 1 }, crm: { completed: 1, total: 1 }, compare: { completed: 1, total: 1 } }, message: 'Legacy', errors: [], etaSeconds: null };
  db.exec('CREATE TABLE runs(id TEXT PRIMARY KEY,json TEXT NOT NULL,created TEXT NOT NULL); CREATE TABLE proposals(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE run_items(run_id TEXT,proposal_id TEXT,ordinal INTEGER);');
  db.prepare('INSERT INTO runs VALUES(?,?,?)').run(run.id, JSON.stringify(run), now);
  const plan = reconcile(data, 'snapshot', run.id)[0]; assert.ok(plan); plan.proposal.status = 'rejected';
  db.prepare('INSERT INTO proposals VALUES(?,?)').run(plan.proposal.id, JSON.stringify(plan)); db.prepare('INSERT INTO run_items VALUES(?,?,0)').run(run.id, plan.proposal.id); db.close();
  const store = new Store(path);
  try {
    const detail = store.runDetail(run.id); assert.equal(detail?.evidenceQuality, 'legacy-partial'); assert.equal(detail?.input, null); assert.equal(detail?.result, null); assert.deepEqual(detail?.events, []);
    assert.equal(detail?.proposals[0]?.id, plan.proposal.id); assert.equal(store.workspace().canReset, false); assert.equal(detail?.run.sessionId, store.session().sessionId);
    plan.proposal.title = 'Later mutation'; store.savePlan(plan); assert.notEqual(store.runDetail(run.id)?.proposals[0]?.title, 'Later mutation');
    const service = new ReviewService({ store, captureDir: '/unused', websiteUrl: 'https://synthetic.invalid', apiBase: 'https://synthetic.invalid/api', token: '', liveWritesEnabled: false, loadCapture: async () => data });
    const imported = await scan(service); assert.equal(imported.id, plan.proposal.id); assert.equal(imported.status, 'rejected');
  } finally { store.close(); rmSync(directory, { recursive: true }); }
});

test('comparisons expose actual candidates, normalized relations, rule branches and CRM-only absence', () => {
  const data = snapshot([account({ billing_street: '100 Maple St.', phone: '(555) 555-0100' }), account({ account_id: 'historical', chow_current_account: 'facility-a' }), account({ account_id: 'duplicate', duplicate_of_account: 'facility-a' }), account({ account_id: 'missing', name: 'Missing', billing_street: '90 Elsewhere', billing_city: 'Other', phone: '5555558888' })]);
  const plans = reconcile(data, 'snapshot', 'comparison-run'); const comparisons = comparisonsFor(data, plans);
  const comparison = comparisons.find(item => item.locationId); assert.ok(comparison);
  assert.equal(comparison.candidates.length, 3); assert.equal(comparison.candidates.find(item => item.accountId === 'historical')?.disposition, 'historical'); assert.equal(comparison.candidates.find(item => item.accountId === 'duplicate')?.disposition, 'duplicate');
  assert.equal(comparison.candidates.find(item => item.accountId === 'facility-a')?.fields.find(field => field.field === 'billing_street')?.relation, 'normalized_equal');
  assert.equal(comparison.candidates[0]?.fields.find(field => field.field === 'lifetime_revenue')?.relation, 'not_comparable');
  assert.ok(comparisons.find(item => item.accountId === 'missing')?.ruleCodes.includes('missing_from_website'));
  assert.ok(plans.every(plan => plan.proposal.ruleCode));
});

test('failed reconciliation still preserves collected input without inventing proposals', async () => {
  const data = snapshot(); data.accounts = data.accounts.filter(account => account.account_id !== 'parent-bellhaven');
  const { store, service } = setup(data);
  try {
    const run = service.startRun('snapshot'); await service.waitForRun();
    assert.equal(store.getRun(run.id)?.status, 'failed');
    assert.deepEqual(store.runDetail(run.id)?.input, data); assert.equal(store.runDetail(run.id)?.evidenceQuality, 'complete');
    assert.deepEqual(store.runDetail(run.id)?.proposals, []);
  } finally { store.close(); }
});

test('unknown creates are isolated by local session while the live uncertainty scope survives reset', async () => {
  const data = snapshot([]); const { store, service } = setup(data);
  try {
    const first = await scan(service); store.saveExecution(first.id, { stage: 'uncertain', baselineIds: [] });
    const blocked = await scan(service); assert.equal(blocked.status, 'uncertain');
    service.resetLocal(store.session().sessionId);
    const fresh = await scan(service); assert.equal(fresh.status, 'pending'); assert.notEqual(fresh.id, first.id);
    store.seedAccounts('live', data.accounts); const localLive = new LocalAdapter(store, 'live');
    const mockedLive = new ReviewService({ ...service.options, token: 'synthetic-test-token', adapter: source => source === 'live' ? localLive : new LocalAdapter(store, source), collect: async () => data });
    const live = await scan(mockedLive, 'live'); store.saveExecution(live.id, { stage: 'uncertain', baselineIds: [] });
    service.resetLocal(store.session().sessionId);
    const liveAgain = await scan(mockedLive, 'live'); assert.equal(liveAgain.id, live.id);
    await assert.rejects(mockedLive.decide(liveAgain.id, { runId: liveAgain.runId, revision: liveAgain.revision, decision: 'approve', confirmLive: true }), /disabled/);
    const allowed = new ReviewService({ ...mockedLive.options, liveWritesEnabled: true });
    await assert.rejects(allowed.decide(liveAgain.id, { runId: liveAgain.runId, revision: liveAgain.revision, decision: 'approve', confirmLive: true }), /uncertain/);
    assert.equal(store.accounts('live').length, data.accounts.length);
  } finally { store.close(); }
});

test('incomplete comparisons label missing records as incomplete instead of asserting website absence', () => {
  const data = snapshot([account({ account_id: 'unmatched', name: 'Missing', billing_street: '90 Elsewhere', billing_city: 'Other', phone: '5555558888' })]);
  data.coverage.websiteComplete = false;
  const plans = reconcile(data, 'snapshot', 'incomplete-run'); const comparisons = comparisonsFor(data, plans);
  assert.ok(comparisons.every(comparison => comparison.ruleCodes.includes('incomplete_sources')));
  assert.ok(comparisons.every(comparison => !comparison.ruleCodes.includes('missing_from_website')));
});

async function verifyLegacyRejections(data: Snapshot, fingerprints: { accountId: string; id: string; revision: string }[]): Promise<void> {
  const plans = reconcile(data, 'snapshot', 'legacy');
  assert.deepEqual(plans.map(plan => ({ accountId: plan.proposal.accountId, id: plan.proposal.id, revision: plan.proposal.revision })), fingerprints);
  const directory = mkdtempSync(join(tmpdir(), 'bellhaven-legacy-fingerprints-')); const path = join(directory, 'state.sqlite');
  const db = new DatabaseSync(path);
  const now = '2026-11-03T10:00:00.000Z';
  const run = { id: 'legacy', source: 'snapshot', workflowId: 'bellhaven', status: 'ready', phase: 'review', startedAt: now, updatedAt: now, progress: { website: { completed: 1, total: 1 }, crm: { completed: data.accounts.length, total: data.accounts.length }, compare: { completed: 1, total: 1 } }, message: 'Legacy', errors: [], etaSeconds: null };
  db.exec('CREATE TABLE runs(id TEXT PRIMARY KEY,json TEXT NOT NULL,created TEXT NOT NULL); CREATE TABLE proposals(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE run_items(run_id TEXT,proposal_id TEXT,ordinal INTEGER);');
  db.prepare('INSERT INTO runs VALUES(?,?,?)').run(run.id, JSON.stringify(run), now);
  for (const [ordinal, plan] of plans.entries()) {
    plan.proposal.status = 'rejected'; delete plan.proposal.ruleCode;
    db.prepare('INSERT INTO proposals VALUES(?,?)').run(plan.proposal.id, JSON.stringify(plan));
    db.prepare('INSERT INTO run_items VALUES(?,?,?)').run(run.id, plan.proposal.id, ordinal);
  }
  db.close(); const instance = setup(data, path);
  try {
    await scan(instance.service);
    const proposals = instance.service.state().proposals;
    assert.deepEqual(proposals.map(proposal => proposal.id), fingerprints.map(fingerprint => fingerprint.id));
    assert.ok(proposals.every(proposal => proposal.status === 'rejected'));
    assert.ok(instance.store.runDetail('legacy')?.proposals.every(proposal => proposal.status === 'rejected'));
    const comparison = instance.store.runDetail(instance.service.state().run?.id ?? '')?.comparisons[0];
    assert.equal(comparison?.candidates.length, data.accounts.length - 1);
  } finally { instance.store.close(); rmSync(directory, { recursive: true }); }
}

test('v1 duplicate and unchanged identities retain legacy rejections with three equivalent CRM accounts', async () => {
  // Fingerprints were produced by the v1 reconciler at df996f7, before visible comparisons were added.
  await verifyLegacyRejections(snapshot([account({ account_id: 'a' }), account({ account_id: 'b' }), account({ account_id: 'c' })]), [
    { accountId: 'b', id: '96a8797accf51033f63be0be', revision: 'b0f0adfd1e500c4269d1ff42' },
    { accountId: 'c', id: '01a1fc040ff92a04ef93bd5c', revision: 'cb58d8f07703426033478d73' },
    { accountId: 'a', id: 'a1409bd527f3ca57c06f585f', revision: 'c6104dd10e63c0f08f61437b' },
  ]);
});

test('v1 update identity retains its legacy rejection while a historical candidate remains visible', async () => {
  await verifyLegacyRejections(snapshot([account({ account_id: 'a', name: 'Former name' }), account({ account_id: 'historical', chow_current_account: 'a', parent_id: 'old-owner' })]), [
    { accountId: 'a', id: 'b17cd5f925294b00c0998615', revision: '7ebb0fe4b48121ae90dd9bec' },
  ]);
});
