import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account, location, snapshot } from '../fixtures/synthetic.js';
import { comparisonsFor, reconcile, street } from '../server/domain.js';

const scan = (data = snapshot()) => reconcile(data, 'demo', 'test-run');

for (const [direction, abbreviation] of [['Northwest', 'NW'], ['Northeast', 'NE'], ['Southwest', 'SW'], ['Southeast', 'SE']]) {
  test(`${direction} and ${abbreviation} match symmetrically for a phone-corroborated rename`, () => {
    for (const [crmDirection, websiteDirection] of [[direction, abbreviation], [abbreviation, direction]]) {
      const data = snapshot([account({ name: 'Former Orchard Residence', billing_street: `2846 ${crmDirection} Orchard Road` })], [location({ street: `2846 ${websiteDirection} Orchard Rd.` })]);
      const plans = scan(data);
      assert.equal(plans.length, 1);
      assert.equal(plans[0]?.proposal.kind, 'update');
      assert.deepEqual(plans[0]?.proposal.proposed, { name: location().name });
      const candidate = comparisonsFor(data, plans)[0]?.candidates[0];
      assert.ok(candidate?.signals.includes('same physical street and locality'));
      assert.equal(candidate?.fields.find(field => field.field === 'billing_street')?.relation, 'normalized_equal');
    }
  });

  test(`${direction} formatting alone does not propose an update`, () => {
    for (const [crmDirection, websiteDirection] of [[direction, abbreviation], [abbreviation, direction]]) {
      const plans = scan(snapshot([account({ billing_street: `2846 ${crmDirection} Orchard Road` })], [location({ street: `2846 ${websiteDirection} Orchard Rd.` })]));
      assert.equal(plans.length, 1);
      assert.equal(plans[0]?.proposal.kind, 'unchanged');
      assert.equal(plans[0]?.operation.kind, 'none');
    }
  });
}

test('compound direction normalization only replaces whole words', () => {
  assert.equal(street('2846 Northwestview Road'), '2846 northwestview rd');
  assert.equal(street('2846 Southeaston Road'), '2846 southeaston rd');
});

test('a weak Pk/Pike candidate joins two strong competing records in manual evidence', () => {
  const data = snapshot([
    account({ account_id: 'orchard-first', name: 'Former Orchard Residence', billing_street: '2846 Ridge Pike' }),
    account({ account_id: 'orchard-second', name: 'Ridge Nursing Residence', billing_street: '2846 Ridge Pike' }),
    account({ account_id: 'orchard-possible', name: 'Legacy Ridge House', billing_street: '2846 Ridge Pk', phone: '' }),
  ], [location({ street: '2846 Ridge Pike' })]);
  const plans = scan(data);
  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.proposal.kind, 'needs_review');
  assert.equal(plans[0]?.proposal.ruleCode, 'competing_accounts');
  assert.equal(plans[0]?.operation.kind, 'none');
  for (const id of ['orchard-first', 'orchard-second', 'orchard-possible']) {
    assert.ok(plans[0]?.proposal.evidence.some(item => item.detail.includes(id)));
  }
  const candidates = comparisonsFor(data, plans)[0]?.candidates ?? [];
  assert.deepEqual(candidates.map(candidate => candidate.accountId).sort(), ['orchard-first', 'orchard-possible', 'orchard-second']);
  const possible = candidates.find(candidate => candidate.accountId === 'orchard-possible');
  assert.ok(possible?.signals.includes('possible street suffix variant'));
  assert.ok(!possible?.signals.includes('same physical street and locality'));
  assert.equal(possible?.fields.find(field => field.field === 'billing_street')?.relation, 'different');
});

test('Pk/Pike alone blocks creation and automatic updates in either direction', () => {
  for (const [crmSuffix, websiteSuffix] of [['Pk', 'Pike'], ['Pike', 'Pk']]) {
    for (const phone of ['', location().phone]) {
      const data = snapshot([account({ name: 'Legacy Ridge House', billing_street: `2846 Ridge ${crmSuffix}`, phone })], [location({ street: `2846 Ridge ${websiteSuffix}` })]);
      const plans = scan(data);
      assert.equal(plans.length, 1);
      assert.equal(plans[0]?.proposal.kind, 'needs_review');
      assert.equal(plans[0]?.proposal.ruleCode, 'identity_ambiguity');
      assert.equal(plans[0]?.operation.kind, 'none');
      assert.ok(comparisonsFor(data, plans)[0]?.candidates[0]?.signals.includes('possible street suffix variant'));
      assert.notEqual(street(`2846 Ridge ${crmSuffix}`), street(`2846 Ridge ${websiteSuffix}`));
    }
  }
});

test('a Pk/Pike candidate requires matching state and either city or ZIP', () => {
  for (const locality of [
    { billing_city: 'Othercity', billing_zip: '43000-1234' },
    { billing_city: 'Sampletown', billing_zip: '43999' },
  ]) {
    const data = snapshot([account({ name: 'Legacy Ridge House', billing_street: '2846 Ridge Pk', phone: '', ...locality })], [location({ street: '2846 Ridge Pike' })]);
    const plans = scan(data);
    assert.equal(plans[0]?.proposal.kind, 'needs_review');
    assert.equal(comparisonsFor(data, plans)[0]?.candidates.length, 1);
  }
});

test('a same-name Pk/Pike candidate with matching ZIP and different city stays manual', () => {
  const data = snapshot([account({ billing_street: '2846 Ridge Pk', billing_city: 'Othercity', phone: '' })], [location({ street: '2846 Ridge Pike' })]);
  const plans = scan(data);
  assert.equal(plans.length, 1);
  assert.equal(plans[0]?.proposal.kind, 'needs_review');
  assert.equal(plans[0]?.operation.kind, 'none');
  assert.ok(comparisonsFor(data, plans)[0]?.candidates[0]?.signals.includes('possible street suffix variant'));
});

test('Pk/Pike cannot match another house, street, state, missing locality, or nonterminal suffix', () => {
  for (const difference of [
    { billing_street: '2847 Ridge Pk' },
    { billing_street: '2846 Orchard Pk' },
    { billing_state: 'PA' },
    { billing_state: '' },
    { billing_city: 'Othercity', billing_zip: '43999' },
    { billing_city: '', billing_zip: '' },
    { billing_street: '2846 Ridge Pk Suite 2' },
    { billing_street: 'Ridge Pk' },
  ]) {
    const data = snapshot([account({ name: 'Legacy Ridge House', billing_street: '2846 Ridge Pk', phone: '', ...difference })], [location({ street: '2846 Ridge Pike' })]);
    const plans = scan(data);
    assert.equal(plans[0]?.proposal.kind, 'create', JSON.stringify(difference));
    assert.deepEqual(comparisonsFor(data, plans)[0]?.candidates, [], JSON.stringify(difference));
  }
});

test('Pk/Pike without a house number does not establish a possible physical street', () => {
  const data = snapshot([account({ name: 'Legacy Ridge House', billing_street: 'Ridge Pk', phone: '' })], [location({ street: 'Ridge Pike' })]);
  const plans = scan(data);
  assert.equal(plans[0]?.proposal.kind, 'create');
  assert.deepEqual(comparisonsFor(data, plans)[0]?.candidates, []);
});
