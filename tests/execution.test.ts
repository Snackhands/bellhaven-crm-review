import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Account, Proposal, Snapshot, SourceMode } from '../shared/contracts.js';
import { account, location, snapshot } from '../fixtures/synthetic.js';
import { Store } from '../server/store.js';
import { ReviewService } from '../server/service.js';
import { LocalAdapter } from '../server/adapters.js';
import type { AccountFields } from '../server/domain.js';

class FaultAdapter extends LocalAdapter {
  creates = 0; patches = 0;
  createFailure: 'none' | 'before' | 'after' = 'none';
  patchFailure: 'none' | 'before' | 'after' | 'corrupt' = 'none';
  override async create(fields: AccountFields): Promise<Account> {
    this.creates++;
    if (this.createFailure === 'before') throw new Error('Synthetic create timeout');
    const value = await super.create(fields);
    if (this.createFailure === 'after') throw new Error('Synthetic response lost');
    return value;
  }
  override async patch(id: string, fields: Record<string, unknown>): Promise<Account> {
    this.patches++;
    if (this.patchFailure === 'before') throw new Error('Synthetic patch timeout');
    const value = await super.patch(id, this.patchFailure === 'corrupt' ? { ...fields, status: 'Inactive' } : fields);
    if (this.patchFailure === 'after') throw new Error('Synthetic patch response lost');
    return value;
  }
}
function setup(data = snapshot(), path = ':memory:') {
  const store = new Store(path);
  const adapters = new Map<SourceMode, FaultAdapter>();
  const adapter = (source: SourceMode): FaultAdapter => {
    let result = adapters.get(source); if (!result) { result = new FaultAdapter(store, source); adapters.set(source, result); } return result;
  };
  const service = new ReviewService({ store, captureDir: '/nonexistent-private-capture', websiteUrl: 'https://synthetic.invalid', apiBase: 'https://synthetic.invalid/api', token: '', liveWritesEnabled: false,
    demoSnapshot: data, loadCapture: async () => data, adapter });
  return { service, store, adapter };
}
async function run(service: ReviewService, source: SourceMode = 'demo'): Promise<Proposal[]> { service.startRun(source); await service.waitForRun(); assert.equal(service.state().run?.status, 'ready'); return service.state().proposals; }
function actionable(proposals: Proposal[]): Proposal { const item = proposals.find(proposal => proposal.kind !== 'unchanged' && proposal.kind !== 'needs_review'); assert.ok(item); return item; }
const approve = (service: ReviewService, proposal: Proposal) => service.decide(proposal.id, { decision: 'approve', runId: proposal.runId, revision: proposal.revision });

test('rejection survives restart, timestamp refresh, and identical rerun; new evidence creates pending revision', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bellhaven-test-')); const db = join(directory, 'review.sqlite');
  const data = snapshot([account({ name: 'Old name' })]);
  let instance = setup(data, db);
  const proposal = actionable(await run(instance.service));
  await instance.service.decide(proposal.id, { decision: 'reject', runId: proposal.runId, revision: proposal.revision }); instance.store.close();
  data.accounts = data.accounts.map(item => ({ ...item, updated_at: '2026-03-03T00:00:00Z', parent_name: 'Refreshed derived label' }));
  instance = setup(data, db);
  const second = actionable(await run(instance.service)); assert.equal(second.id, proposal.id); assert.equal(second.status, 'rejected');
  data.locations = [location({ phone: '5555550300' })];
  const changed = actionable(await run(instance.service)); assert.notEqual(changed.revision, proposal.revision); assert.equal(changed.status, 'pending');
  instance.store.close(); rmSync(directory, { recursive: true });
});
test('approve performs exact patch, readback, and repeated approval performs no write', async () => {
  const { service, store, adapter } = setup(snapshot([account({ name: 'Old name' })]));
  const proposal = actionable(await run(service));
  assert.equal((await approve(service, proposal)).status, 'applied');
  assert.equal((await adapter('demo').get('facility-a')).name, location().name);
  await approve(service, proposal); assert.equal(adapter('demo').patches, 1);
  assert.equal((await run(service))[0]?.kind, 'unchanged'); store.close();
});
test('changed finances invalidate approved reparenting before mutation', async () => {
  const { service, store, adapter } = setup(snapshot([account({ parent_id: 'old-owner', lifetime_revenue: 500, outstanding_ar: 0 })]));
  const proposal = actionable(await run(service));
  store.putAccount('demo', { ...await adapter('demo').get('facility-a'), outstanding_ar: 100 });
  assert.equal((await approve(service, proposal)).status, 'stale'); assert.equal(adapter('demo').patches, 0); assert.equal(adapter('demo').creates, 0);
  assert.equal((await run(service))[0]?.kind, 'chow'); store.close();
});
test('a new competing match invalidates a missing-location create', async () => {
  const { service, store, adapter } = setup(snapshot([])); const proposal = actionable(await run(service));
  store.putAccount('demo', account({ account_id: 'concurrent-account' }));
  assert.equal((await approve(service, proposal)).status, 'stale'); assert.equal(adapter('demo').creates, 0); store.close();
});
test('concurrent and repeated approvals create at most one account', async () => {
  const { service, store, adapter } = setup(snapshot([])); const proposal = actionable(await run(service));
  const results = await Promise.allSettled([approve(service, proposal), approve(service, proposal)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(adapter('demo').creates, 1);
  await approve(service, proposal); assert.equal(adapter('demo').creates, 1); store.close();
});
test('create timeout with landed result recovers through complete readback', async () => {
  const { service, store, adapter } = setup(snapshot([])); const proposal = actionable(await run(service));
  adapter('demo').createFailure = 'after'; const result = await approve(service, proposal);
  assert.equal(result.status, 'applied'); assert.ok(result.resultAccountId); assert.equal(adapter('demo').creates, 1); store.close();
});
test('uncertain create never retries after timeout or restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bellhaven-test-')); const db = join(directory, 'review.sqlite'); const data = snapshot([]);
  let instance = setup(data, db); const proposal = actionable(await run(instance.service)); instance.adapter('demo').createFailure = 'before';
  assert.equal((await approve(instance.service, proposal)).status, 'uncertain'); assert.equal(instance.adapter('demo').creates, 1); instance.store.close();
  instance = setup(data, db); await assert.rejects(approve(instance.service, proposal), /uncertain result/); assert.equal(instance.adapter('demo').creates, 0);
  assert.equal(actionable(await run(instance.service)).status, 'uncertain'); instance.store.close(); rmSync(directory, { recursive: true });
});
test('CHOW partial create/link failure resumes only link across restart and preserves old fields', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bellhaven-test-')); const db = join(directory, 'review.sqlite');
  const old = account({ parent_id: 'old-owner', name: 'Birch Grove original billing', lifetime_revenue: 5000, outstanding_ar: 50, note: 'Original legal billing notes', status: 'Inactive' });
  const data = snapshot([old]); let instance = setup(data, db); const proposal = actionable(await run(instance.service)); assert.equal(proposal.kind, 'chow');
  instance.adapter('demo').patchFailure = 'before'; const partial = await approve(instance.service, proposal);
  assert.equal(partial.status, 'failed'); assert.ok(partial.resultAccountId); assert.equal(instance.adapter('demo').creates, 1); instance.store.close();
  instance = setup(data, db); const final = await approve(instance.service, proposal); assert.equal(final.status, 'applied'); assert.equal(final.resultAccountId, partial.resultAccountId);
  assert.equal(instance.adapter('demo').creates, 0); assert.deepEqual(await instance.adapter('demo').get(old.account_id), { ...old, chow_current_account: partial.resultAccountId });
  const created = await instance.adapter('demo').get(String(partial.resultAccountId)); assert.equal(created.lifetime_revenue, 0); assert.equal(created.outstanding_ar, 0); assert.equal(created.parent_id, 'parent-bellhaven');
  instance.store.close(); rmSync(directory, { recursive: true });
});
test('CHOW stops after successor creation if old finances change before link', async () => {
  const { service, store, adapter } = setup(snapshot([account({ parent_id: 'old-owner', lifetime_revenue: 5000, outstanding_ar: 50 })])); const proposal = actionable(await run(service));
  const originalCreate = adapter('demo').create.bind(adapter('demo'));
  adapter('demo').create = async fields => { const created = await originalCreate(fields); const old = await adapter('demo').get('facility-a'); store.putAccount('demo', { ...old, outstanding_ar: 25 }); return created; };
  const result = await approve(service, proposal); assert.equal(result.status, 'stale'); assert.ok(result.resultAccountId); assert.equal(adapter('demo').patches, 0); assert.equal(adapter('demo').creates, 1); store.close();
});
test('CHOW readback flags any unexpected change to the old account', async () => {
  const { service, store, adapter } = setup(snapshot([account({ parent_id: 'old-owner', lifetime_revenue: 50, outstanding_ar: 10 })])); const proposal = actionable(await run(service));
  adapter('demo').patchFailure = 'corrupt'; const result = await approve(service, proposal); assert.equal(result.status, 'failed'); assert.match(result.error ?? '', /preservation/); store.close();
});
test('patch timeout checks whether write landed and safely resumes unchanged preconditions', async () => {
  const { service, store, adapter } = setup(snapshot([account({ name: 'Old name' })])); const proposal = actionable(await run(service));
  adapter('demo').patchFailure = 'before'; assert.equal((await approve(service, proposal)).status, 'failed');
  adapter('demo').patchFailure = 'after'; assert.equal((await approve(service, proposal)).status, 'applied'); assert.equal(adapter('demo').patches, 2); store.close();
});
test('failed absence patch becomes stale when the facility returns to the website', async () => {
  const data = snapshot([account()], []); const { service, store, adapter } = setup(data);
  const proposal = actionable(await run(service)); adapter('demo').patchFailure = 'before';
  assert.equal((await approve(service, proposal)).status, 'failed');
  data.locations = [location()]; adapter('demo').patchFailure = 'none';
  assert.equal((await approve(service, proposal)).status, 'stale');
  assert.equal(adapter('demo').patches, 1); assert.equal((await adapter('demo').get('facility-a')).status, 'Active'); store.close();
});
test('failed patch retry rechecks new competing identity evidence', async () => {
  const { service, store, adapter } = setup(snapshot([account({ name: 'Old name' })]));
  const proposal = actionable(await run(service)); adapter('demo').patchFailure = 'before';
  assert.equal((await approve(service, proposal)).status, 'failed');
  store.putAccount('demo', account({ account_id: 'competing-facility', name: 'Campus Nursing', care_type: 'Skilled Nursing' }));
  adapter('demo').patchFailure = 'none';
  assert.equal((await approve(service, proposal)).status, 'stale'); assert.equal(adapter('demo').patches, 1); store.close();
});
test('a landed patch is confirmed without replay when website evidence later changes', async () => {
  const data = snapshot([account({ name: 'Old name' })]); const { service, store, adapter } = setup(data);
  const proposal = actionable(await run(service)); const plan = store.getPlan(proposal.id); assert.ok(plan);
  if (plan.operation.kind !== 'patch') throw new Error('Wrong fixture');
  await adapter('demo').patch(plan.operation.accountId, plan.operation.patch);
  store.saveExecution(proposal.id, { stage: 'patching' });
  data.locations = [location({ phone: '5555550300' })];
  assert.equal((await approve(service, proposal)).status, 'applied'); assert.equal(adapter('demo').patches, 1); store.close();
});
test('uncertain create blocks changed revisions after restart and a late first result', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bellhaven-revision-')); const path = join(directory, 'state.sqlite'); const data = snapshot([]);
  let instance = setup(data, path);
  try {
    const first = actionable(await run(instance.service)); const original = instance.store.getPlan(first.id); assert.ok(original);
    if (original.operation.kind !== 'create') throw new Error('Wrong fixture');
    const firstFields = original.operation.fields;
    instance.adapter('demo').createFailure = 'before'; assert.equal((await approve(instance.service, first)).status, 'uncertain');
    instance.store.close(); instance = setup(data, path);
    data.locations = [location({ id: 'birch-grove-new-slug', sourceUrl: 'https://synthetic.invalid/communities/birch-grove-new-slug', phone: '5555550300' })];
    const replacement = actionable(await run(instance.service)); assert.notEqual(replacement.id, first.id);
    assert.equal(replacement.status, 'uncertain'); assert.match(replacement.error ?? '', /earlier|unresolved/i);
    const savedReplacement = instance.store.getPlan(replacement.id); assert.ok(savedReplacement);
    savedReplacement.proposal.status = 'pending'; instance.store.savePlan(savedReplacement);
    const result = await approve(instance.service, replacement); assert.equal(result.status, 'uncertain'); assert.equal(instance.adapter('demo').creates, 0);
    await new LocalAdapter(instance.store, 'demo').create(firstFields);
    assert.equal((await instance.adapter('demo').list()).filter(item => item.parent_id === 'parent-bellhaven').length, 1);
  } finally { instance.store.close(); rmSync(directory, { recursive: true }); }
});
test('CHOW link retry rechecks competing identity evidence without creating a replacement', async () => {
  const { service, store, adapter } = setup(snapshot([account({ parent_id: 'old-owner', lifetime_revenue: 500, outstanding_ar: 50 })]));
  const first = actionable(await run(service)); adapter('demo').patchFailure = 'before';
  const partial = await approve(service, first); assert.equal(partial.status, 'failed'); assert.ok(partial.resultAccountId);
  store.putAccount('demo', account({ account_id: 'competing-facility', name: 'Campus Nursing', care_type: 'Skilled Nursing' }));
  adapter('demo').patchFailure = 'none';
  const result = await approve(service, first); assert.equal(result.status, 'stale'); assert.equal(result.resultAccountId, partial.resultAccountId);
  assert.equal(adapter('demo').creates, 1); assert.equal(adapter('demo').patches, 1); assert.equal((await adapter('demo').get('facility-a')).chow_current_account, ''); store.close();
});
test('an unknown interrupted create pauses unrelated creation only in the same source', async () => {
  const data = snapshot([]); const { service, store, adapter } = setup(data);
  const first = actionable(await run(service));
  store.saveExecution(first.id, { stage: 'creating', baselineIds: ['parent-bellhaven'] });
  data.locations = [location({ id: 'other-location', sourceUrl: 'https://synthetic.invalid/communities/other-location', name: 'Other facility', street: '700 Other Road', city: 'Othercity', state: 'CO', zip: '80000', phone: '5555550300' })];
  const replacement = actionable(await run(service)); assert.notEqual(replacement.locationId, first.locationId);
  assert.equal(replacement.status, 'uncertain'); assert.equal((await approve(service, replacement)).status, 'uncertain'); assert.equal(adapter('demo').creates, 0);
  store.putAccount('demo', account({ name: 'Other facility', parent_id: 'old-owner', billing_street: '700 Other Road', billing_city: 'Othercity', billing_state: 'CO', billing_zip: '80000', phone: '5555550300', lifetime_revenue: 500, outstanding_ar: 50 }));
  const chow = actionable(await run(service)); assert.equal(chow.kind, 'chow'); assert.equal(chow.status, 'uncertain');
  assert.equal((await approve(service, chow)).status, 'uncertain'); assert.equal(adapter('demo').creates, 0);
  const snapshotProposal = actionable(await run(service, 'snapshot')); assert.equal(snapshotProposal.status, 'pending');
  assert.equal((await approve(service, snapshotProposal)).status, 'applied'); store.close();
});
test('a saved create result blocks a replacement after both slug and phone change', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bellhaven-known-create-')); const path = join(directory, 'state.sqlite'); const data = snapshot([]);
  let instance = setup(data, path);
  try {
    const first = actionable(await run(instance.service)); const original = instance.store.getPlan(first.id); assert.ok(original);
    if (original.operation.kind !== 'create') throw new Error('Wrong fixture');
    const result = await new LocalAdapter(instance.store, 'demo').create(original.operation.fields);
    instance.store.saveExecution(first.id, { stage: 'created', resultAccountId: result.account_id });
    instance.store.putAccount('demo', { ...result, name: 'Manual investigation', billing_street: '900 Remote Road', billing_city: 'Othercity', billing_state: 'CO', billing_zip: '80000', phone: '5555559999' });
    instance.store.close(); instance = setup(data, path);
    data.locations = [location({ id: 'new-slug', sourceUrl: 'https://synthetic.invalid/communities/new-slug', street: '100 Maple St.', phone: '5555550300' })];
    const replacement = actionable(await run(instance.service)); assert.equal(replacement.kind, 'create'); assert.notEqual(replacement.id, first.id);
    assert.equal(replacement.status, 'uncertain'); assert.equal(replacement.resultAccountId, result.account_id);
    assert.equal((await approve(instance.service, replacement)).status, 'uncertain'); assert.equal(instance.adapter('demo').creates, 0);
    instance.store.putAccount('demo', result); data.locations = [location()];
    await assert.rejects(approve(instance.service, first), /historical/);
    const resumed = await run(instance.service); assert.ok(resumed.every(item => item.kind === 'unchanged')); assert.equal(instance.adapter('demo').creates, 0);
  } finally { instance.store.close(); rmSync(directory, { recursive: true }); }
});
test('unresolved CHOW successor blocks a changed revision even after stale recovery and restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bellhaven-chow-revision-')); const path = join(directory, 'state.sqlite');
  const data = snapshot([account({ parent_id: 'old-owner', lifetime_revenue: 500, outstanding_ar: 50 })]); let instance = setup(data, path);
  try {
    const first = actionable(await run(instance.service)); instance.adapter('demo').patchFailure = 'before';
    const partial = await approve(instance.service, first); assert.equal(partial.status, 'failed'); assert.ok(partial.resultAccountId);
    const savedId = partial.resultAccountId;
    instance.store.saveExecution(first.id, { stage: 'created', resultAccountId: savedId });
    const successor = await instance.adapter('demo').get(savedId);
    instance.store.putAccount('demo', { ...successor, name: 'Manual investigation', billing_street: '900 Remote Road', billing_city: 'Othercity', billing_state: 'CO', billing_zip: '80000', phone: '5555559999' });
    assert.equal((await approve(instance.service, first)).status, 'stale');
    instance.store.close(); instance = setup(data, path);
    data.locations = [location({ id: 'reindexed-chow-location', sourceUrl: 'https://synthetic.invalid/communities/reindexed', phone: '5555550300' })];
    const replacement = actionable(await run(instance.service)); assert.equal(replacement.kind, 'chow'); assert.notEqual(replacement.id, first.id);
    assert.equal(replacement.status, 'uncertain'); assert.equal(replacement.resultAccountId, savedId);
    assert.equal((await approve(instance.service, replacement)).status, 'uncertain'); assert.equal(instance.adapter('demo').creates, 0);
  } finally { instance.store.close(); rmSync(directory, { recursive: true }); }
});
test('interrupted create journal recovers its unique account without creating again', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bellhaven-test-')); const db = join(directory, 'review.sqlite'); const data = snapshot([]);
  let instance = setup(data, db); const proposal = actionable(await run(instance.service)); const plan = instance.store.getPlan(proposal.id); assert.ok(plan); assert.equal(plan.operation.kind, 'create');
  if (plan.operation.kind !== 'create') throw new Error('Wrong fixture');
  instance.store.saveExecution(proposal.id, { stage: 'creating', baselineIds: (await instance.adapter('demo').list()).map(item => item.account_id) });
  const created = await instance.adapter('demo').create(plan.operation.fields); plan.proposal.status = 'applying'; instance.store.savePlan(plan); instance.store.close();
  instance = setup(data, db); const result = await approve(instance.service, proposal); assert.equal(result.status, 'applied'); assert.equal(result.resultAccountId, created.account_id); assert.equal(instance.adapter('demo').creates, 0); instance.store.close(); rmSync(directory, { recursive: true });
});
test('internal synthetic and private snapshot simulation states are isolated', async () => {
  const { service, store, adapter } = setup(snapshot([account({ name: 'Old name' })]));
  const proposal = actionable(await run(service, 'snapshot')); await approve(service, proposal);
  const internal = actionable(await run(service)); assert.equal(internal.status, 'pending'); assert.equal((await adapter('demo').get('facility-a')).name, 'Old name');
  assert.equal((await adapter('snapshot').get('facility-a')).name, location().name); store.close();
});
test('exact revision, rejected state and manual findings block approval', async () => {
  const { service, store } = setup(snapshot([account({ name: 'Old name' })])); const proposal = actionable(await run(service));
  await assert.rejects(service.decide(proposal.id, { decision: 'approve', runId: proposal.runId, revision: 'outdated' }), /out of date/);
  await service.decide(proposal.id, { decision: 'reject', runId: proposal.runId, revision: proposal.revision }); await assert.rejects(approve(service, proposal), /closed/); store.close();
});
test('live writes need both local gate and exact approval confirmation with mocked remote adapter', async () => {
  const data = snapshot([account({ name: 'Old name' })]); const store = new Store(':memory:'); store.seedAccounts('live', data.accounts); const adapter = new FaultAdapter(store, 'live');
  const options = { store, captureDir: '/unused', websiteUrl: 'https://synthetic.invalid', apiBase: 'https://synthetic.invalid/api', token: 'synthetic-not-a-credential', liveWritesEnabled: false, collect: async (): Promise<Snapshot> => ({ ...data, accounts: await adapter.list() }), adapter: () => adapter };
  let service = new ReviewService(options); const proposal = actionable(await run(service, 'live'));
  await assert.rejects(service.decide(proposal.id, { decision: 'approve', runId: proposal.runId, revision: proposal.revision, confirmLive: true }), /disabled/); assert.equal(adapter.patches, 0);
  service = new ReviewService({ ...options, liveWritesEnabled: true }); await assert.rejects(approve(service, proposal), /Explicit confirmation/);
  assert.equal((await service.decide(proposal.id, { decision: 'approve', runId: proposal.runId, revision: proposal.revision, confirmLive: true })).status, 'applied'); assert.equal(adapter.patches, 1); store.close();
});
