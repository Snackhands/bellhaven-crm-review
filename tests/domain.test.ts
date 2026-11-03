import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, location, snapshot } from '../fixtures/synthetic.js';
import { accountVersion, care, money, reconcile } from '../server/domain.js';

const scan = (data = snapshot()) => reconcile(data, 'demo', 'test-run');
test('semantic normalization keeps matching accounts unchanged', () => {
  const plans = scan(snapshot([account({ billing_street: '100 Maple St.', phone: '5555550100', care_type: 'Memory Care; Skilled Nursing' })], [location({ careOfferings: ['Short-Term Rehabilitation & Nursing', 'Memory Support'] })]));
  assert.equal(plans[0]?.proposal.kind, 'unchanged');
  assert.deepEqual(care(['Memory Support', 'Memory Care']), ['Memory Care']);
});
test('financial parsing refuses missing, malformed, negative and nonfinite values', () => {
  for (const value of [null, '', 'unknown', '-1', -1, Infinity, '1,2', '$300', 'NaN']) assert.equal(money(value), null);
  assert.equal(money('1,234.50'), 1234.5); assert.equal(money(' 0 '), 0);
});
test('cross-parent identity is matched across the complete account set', () => {
  const plan = scan(snapshot([account({ parent_id: 'previous-owner', lifetime_revenue: 500, outstanding_ar: 0 })]))[0];
  assert.equal(plan?.proposal.kind, 'update'); assert.equal(plan?.proposal.proposed.parent_id, 'parent-bellhaven');
});
test('positive revenue AND AR uses CHOW, preserving old fields in the proposed action', () => {
  const old = account({ parent_id: 'previous-owner', lifetime_revenue: '1200', outstanding_ar: 25, note: 'Keep this original note.' });
  const plan = scan(snapshot([old]))[0]; assert.equal(plan?.operation.kind, 'chow');
  assert.equal(plan?.proposal.billing?.protected, true);
  assert.deepEqual(plan?.proposal.current, { oldAccount: old });
  assert.deepEqual(plan?.proposal.proposed.oldAccountPatch, { chow_current_account: '(new account ID)' });
  if (plan?.operation.kind === 'chow') { assert.equal(plan.operation.fields.lifetime_revenue, 0); assert.equal(plan.operation.fields.outstanding_ar, 0); }
});
test('unknown financial values block reparenting', () => {
  assert.equal(scan(snapshot([account({ parent_id: 'previous-owner', outstanding_ar: '' })]))[0]?.proposal.kind, 'needs_review');
});
test('parentless facilities are not mistaken for company accounts', () => {
  assert.equal(scan(snapshot([account({ parent_id: '' })]))[0]?.proposal.kind, 'update');
  const missing = snapshot(); missing.accounts.shift(); assert.throws(() => scan(missing), /unique Bellhaven company/);
});
test('same-campus competing identities remain manual', () => {
  const plans = scan(snapshot([account(), account({ account_id: 'campus-nursing', name: 'Birch Grove Nursing', care_type: 'Skilled Nursing' })]));
  assert.equal(plans[0]?.proposal.kind, 'needs_review');
  assert.ok(plans[0]?.proposal.evidence.some(item => item.detail.includes('campus-nursing')));
});
test('duplicate survivor prefers exact website phone, preserving all unrelated fields', () => {
  const plans = scan(snapshot([account({ account_id: 'loser', billing_street: '100 Maple St', phone: '5555559999' }), account({ account_id: 'survivor' })]));
  const duplicate = plans.find(item => item.proposal.kind === 'duplicate'); assert.ok(duplicate);
  assert.equal(duplicate.proposal.accountId, 'loser'); assert.equal(duplicate.proposal.proposed.duplicate_of_account, 'survivor');
  assert.deepEqual(Object.keys(duplicate.proposal.proposed).sort(), ['duplicate_of_account', 'note', 'status']);
});
test('otherwise equal duplicate pair uses explained stable ID tie-break', () => {
  const plans = scan(snapshot([account({ account_id: 'z' }), account({ account_id: 'a' })]));
  const duplicate = plans.find(item => item.proposal.kind === 'duplicate'); assert.equal(duplicate?.proposal.accountId, 'z');
  assert.match(duplicate?.proposal.reason ?? '', /stable account ID/);
});
test('historical CHOW account is never proposed as a duplicate', () => {
  const plans = scan(snapshot([account(), account({ account_id: 'old', parent_id: 'old-owner', chow_current_account: 'facility-a', lifetime_revenue: 100, outstanding_ar: 10 })]));
  assert.equal(plans.filter(item => item.proposal.kind === 'duplicate').length, 0); assert.equal(plans[0]?.proposal.kind, 'unchanged');
});
test('unlinked financial account in a competing pair remains manual', () => {
  assert.equal(scan(snapshot([account(), account({ account_id: 'old', parent_id: 'old-owner', lifetime_revenue: 100, outstanding_ar: 10 })]))[0]?.proposal.kind, 'needs_review');
});
test('unique full address and compatible care establishes a rename despite changed phone', () => {
  const plans = scan(snapshot([account({ name: 'Birch Grove of Sampletown', phone: '5555559999' })]));
  assert.equal(plans[0]?.proposal.kind, 'update'); assert.equal(plans[0]?.proposal.proposed.name, location().name);
});
test('remote homonym is excluded instead of blocking a missing-location create', () => {
  const plans = scan(snapshot([account({ billing_street: '500 Other Avenue', billing_city: 'Othercity', billing_state: 'CO', billing_zip: '80000', phone: '5555559999', parent_id: 'other-owner' })]));
  assert.equal(plans[0]?.proposal.kind, 'create');
});
test('PO box evidence does not silently replace billing intent', () => {
  const plans = scan(snapshot([account({ billing_street: 'PO Box 55' })])); assert.equal(plans[0]?.proposal.kind, 'needs_review');
});
test('incomplete collection makes every result non-executable', () => {
  const data = snapshot(); data.coverage.websiteComplete = false;
  assert.ok(scan(data).every(item => item.operation.kind === 'none'));
});
test('absence only flags Needs Review and equivalent note does not repeat', () => {
  const old = account({ lifetime_revenue: 5000, outstanding_ar: 100, note: 'Original note' });
  const plan = scan(snapshot([old], []))[0]; assert.equal(plan?.proposal.kind, 'update');
  assert.equal(plan?.proposal.proposed.status, 'Needs Review'); assert.equal(plan?.proposal.proposed.parent_id, undefined);
  const repeated = scan(snapshot([account({ ...old, status: 'Needs Review', note: String(plan?.proposal.proposed.note) })], []));
  assert.equal(repeated[0]?.proposal.kind, 'unchanged');
});
test('timestamp and derived parent name changes leave decision identity stable', () => {
  const first = account({ name: 'Old published name' });
  const second = { ...first, updated_at: '2026-02-01T00:00:00Z', parent_name: 'A refreshed derived label' };
  assert.equal(accountVersion(first), accountVersion(second));
  assert.equal(scan(snapshot([first]))[0]?.proposal.id, scan(snapshot([second]))[0]?.proposal.id);
});
test('rule codes distinguish identity, competing-account and billing ambiguity branches', () => {
  assert.equal(scan(snapshot([account({ billing_city: '', billing_street: 'Other Street', phone: '' })]))[0]?.proposal.ruleCode, 'identity_ambiguity');
  assert.equal(scan(snapshot([account({ name: 'Former name A', parent_id: 'owner-a', phone: '' }), account({ account_id: 'second', name: 'Former name B', parent_id: 'owner-b', phone: '' })]))[0]?.proposal.ruleCode, 'competing_accounts');
  assert.equal(scan(snapshot([account(), account({ account_id: 'old', parent_id: 'old-owner', lifetime_revenue: 100, outstanding_ar: 10 })]))[0]?.proposal.ruleCode, 'billing_ambiguity');
  assert.equal(scan(snapshot([account({ parent_id: 'old-owner', lifetime_revenue: 0, outstanding_ar: 0 })]))[0]?.proposal.ruleCode, 'ownership_change');
  assert.equal(scan(snapshot([account({ name: 'Former name' })]))[0]?.proposal.ruleCode, 'field_update');
});
