import { createHash } from 'node:crypto';
import type { Account, Comparison, ComparisonCandidate, ComparisonField, Evidence, Location, Proposal, RuleCode, Snapshot, SourceMode } from '../shared/contracts.js';

export type AccountFields = Pick<Account, 'name' | 'parent_id' | 'billing_street' | 'billing_city' | 'billing_state' | 'billing_zip' | 'care_type' | 'status' | 'phone' | 'lifetime_revenue' | 'outstanding_ar' | 'chow_current_account' | 'duplicate_of_account' | 'note'>;
export type Operation =
  | { kind: 'patch'; accountId: string; patch: Record<string, unknown> }
  | { kind: 'create'; fields: AccountFields }
  | { kind: 'chow'; accountId: string; fields: AccountFields }
  | { kind: 'none' };
export type ProposalPlan = {
  proposal: Proposal; operation: Operation; preconditions: Account[];
  location: Location | null; websiteComplete: boolean; crmComplete: boolean;
};
export type Execution = {
  stage: 'prepared' | 'creating' | 'created' | 'patching' | 'done' | 'uncertain';
  baselineIds?: string[]; resultAccountId?: string; error?: string;
};
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  return JSON.stringify(value) ?? 'null';
}
export function hash(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex').slice(0, 24); }
export function normalize(value: string): string { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
export function street(value: string): string {
  const words: Record<string, string> = { street: 'st', road: 'rd', avenue: 'ave', boulevard: 'blvd', drive: 'dr', lane: 'ln', court: 'ct', highway: 'hwy', north: 'n', south: 's', east: 'e', west: 'w', northwest: 'nw', northeast: 'ne', southwest: 'sw', southeast: 'se', parkway: 'pkwy', circle: 'cir', place: 'pl' };
  return normalize(value).split(' ').map(word => words[word] ?? word).join(' ');
}
export function phone(value: string): string { return value.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); }
export function money(value: Account['lifetime_revenue']): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^\s*(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)\s*$/.test(value)) return null;
  const result = Number(value.replaceAll(',', '').trim());
  return Number.isFinite(result) && result >= 0 ? result : null;
}
const careAliases: Record<string, string> = {
  'memory support': 'Memory Care', 'memory care': 'Memory Care',
  'short term rehabilitation and nursing': 'Skilled Nursing', 'skilled nursing': 'Skilled Nursing',
  'assisted living': 'Assisted Living', 'independent living': 'Independent Living',
};
export function care(values: string[]): string[] {
  return [...new Set(values.flatMap(value => value.split(/;|,|\|/)).map(value => careAliases[normalize(value)] ?? value.trim()).filter(Boolean))].sort();
}
export function accountVersion(account: Account): string {
  const { updated_at: _timestamp, parent_name: _derived, ...record } = account;
  return hash(record);
}
export function locationVersion(location: Location): string {
  const { fetchedAt: _timestamp, ...record } = location;
  return hash({ ...record, careOfferings: care(location.careOfferings) });
}
export function sameFields(account: Account, fields: Record<string, unknown>): boolean {
  return Object.entries(fields).every(([key, value]) => canonical(account[key]) === canonical(value));
}
function parentAccount(accounts: Account[]): Account {
  const matches = accounts.filter(account => normalize(account.name.replace(/\(parent account\)/ig, '')) === 'bellhaven senior living' && (/\(parent account\)/i.test(account.name) || (!account.care_type && !account.billing_street)));
  const parent = matches[0];
  if (matches.length !== 1 || !parent) throw new Error('A unique Bellhaven company account could not be established. Check parent-account evidence before scanning.');
  return parent;
}
type Match = { account: Account; strong: boolean; signals: string[]; score: number };
function possibleStreetSuffixVariant(first: string, second: string): boolean {
  const firstAddress = /^(\d+\w* .+) (pk|pike)$/.exec(street(first));
  const secondAddress = /^(\d+\w* .+) (pk|pike)$/.exec(street(second));
  return Boolean(firstAddress && secondAddress && firstAddress[1] === secondAddress[1] && firstAddress[2] !== secondAddress[2]);
}
function match(location: Location, account: Account): Match | null {
  if (/\(parent account\)/i.test(account.name)) return null;
  const sameName = normalize(location.name) === normalize(account.name);
  const sameStreet = Boolean(location.street && account.billing_street && street(location.street) === street(account.billing_street));
  const sameCity = Boolean(location.city && normalize(location.city) === normalize(account.billing_city));
  const sameState = Boolean(location.state && normalize(location.state) === normalize(account.billing_state));
  const sameZip = Boolean(location.zip && location.zip.slice(0, 5) === account.billing_zip.slice(0, 5));
  const samePhone = phone(location.phone).length === 10 && phone(location.phone) === phone(account.phone);
  const address = sameStreet && sameState && (sameZip || sameCity);
  const possibleStreetVariant = sameState && (sameZip || sameCity) && possibleStreetSuffixVariant(location.street, account.billing_street);
  const nameLocality = sameName && sameCity && sameState;
  const phoneLocality = samePhone && sameCity && sameState;
  if (sameName && !address && !possibleStreetVariant && !samePhone && location.state && account.billing_state && (!sameState || (!sameCity && location.city && account.billing_city))) return null;
  if (!(sameName || address || phoneLocality || possibleStreetVariant)) return null;
  const signals = [sameName ? 'exact normalized name' : '', address ? 'same physical street and locality' : '', possibleStreetVariant ? 'possible street suffix variant' : '', samePhone ? 'same phone' : '', sameCity && sameState ? 'same city and state' : '', sameZip ? 'same ZIP' : ''].filter(Boolean);
  return { account, strong: address && (sameName || samePhone || sameZip && sameCity && canonical(care([account.care_type])) === canonical(care(location.careOfferings))) || nameLocality || phoneLocality && sameStreet, signals, score: Number(sameName) * 4 + Number(address) * 5 + Number(samePhone) * 3 + Number(sameCity && sameState) };
}
const labels: Record<string, string> = { name: 'Name', parent_id: 'Parent account', billing_street: 'Street', billing_city: 'City', billing_state: 'State', billing_zip: 'ZIP', care_type: 'Care offerings', status: 'Status', phone: 'Phone', note: 'Note', duplicate_of_account: 'Duplicate of', chow_current_account: 'Current CHOW account', newAccount: 'Create successor account', oldAccountPatch: 'Only change on old account' };
function desiredFields(location: Location, parent: Account): AccountFields {
  return { name: location.name, parent_id: parent.account_id, billing_street: location.street, billing_city: location.city,
    billing_state: location.state, billing_zip: location.zip, care_type: care(location.careOfferings).join('; '),
    status: 'Active', phone: location.phone, lifetime_revenue: 0, outstanding_ar: 0,
    chow_current_account: '', duplicate_of_account: '', note: `Verified against ${location.sourceUrl}. Historical billing is not copied.` };
}
function changesFor(account: Account, fields: AccountFields): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of ['name', 'parent_id', 'billing_street', 'billing_city', 'billing_state', 'billing_zip', 'care_type', 'status', 'phone'] as const) {
    const value = fields[key];
    if (key === 'care_type' && canonical(care([account.care_type])) === canonical(care([String(value)]))) continue;
    if (key === 'phone' && phone(account.phone) === phone(String(value))) continue;
    if (key === 'billing_street' && street(account.billing_street) === street(String(value))) continue;
    if (canonical(account[key]) !== canonical(value)) result[key] = value;
  }
  return result;
}
function appendNote(account: Account, reason: string): string { return [account.note.trim(), reason].filter(Boolean).join('\n'); }
export function reconcile(snapshot: Snapshot, source: SourceMode, runId: string, sessionId?: string): ProposalPlan[] {
  const parent = parentAccount(snapshot.accounts);
  const plans: ProposalPlan[] = [];
  const matched = new Set<string>();
  function add(input: {
    ruleCode: RuleCode; kind: Proposal['kind']; title: string; reason: string; location?: Location; account?: Account;
    current?: Record<string, unknown>; proposed?: Record<string, unknown>; operation?: Operation;
    candidates?: Match[]; preconditions?: Account[]; warnings?: string[];
  }): void {
    const preconditions = input.preconditions ?? (input.account ? [input.account] : []);
    const current = input.current ?? (input.account ? { ...input.account } : {});
    const proposed = input.proposed ?? {};
    const evidence: Evidence[] = input.location ? [{ label: 'Website location', detail: `${input.location.name} · ${input.location.street}, ${input.location.city}, ${input.location.state} ${input.location.zip} · ${input.location.careOfferings.join(', ')}`, url: input.location.sourceUrl }] : [];
    evidence.push(...(input.candidates ?? []).map(candidate => ({ label: `CRM · ${candidate.account.name}`, detail: `${candidate.account.account_id} · ${candidate.account.parent_name || candidate.account.parent_id || 'No parent'} · ${candidate.signals.join('; ')}` })));
    evidence.push({ label: 'Coverage', detail: `${snapshot.locations.length} website locations and ${snapshot.accounts.length} CRM accounts. Website ${snapshot.coverage.websiteComplete ? 'complete' : 'incomplete'}; CRM ${snapshot.coverage.crmComplete ? 'complete' : 'incomplete'}.` });
    const revision = hash({ kind: input.kind, operation: input.operation, current: input.account ? accountVersion(input.account) : current, proposed, evidence: (input.candidates ?? []).map(item => ({ id: item.account.account_id, parentId: item.account.parent_id, signals: item.signals })), preconditions: preconditions.map(accountVersion).sort(), location: input.location ? locationVersion(input.location) : null, websiteComplete: snapshot.coverage.websiteComplete, crmComplete: snapshot.coverage.crmComplete });
    const id = hash({ source, ...(source !== 'live' && sessionId ? { sessionId } : {}), kind: input.kind, account: input.account?.account_id, location: input.location?.id, revision });
    const revenue = input.account ? money(input.account.lifetime_revenue) : null;
    const ar = input.account ? money(input.account.outstanding_ar) : null;
    const proposal: Proposal = { id, revision, runId, source, ruleCode: input.ruleCode, kind: input.kind, status: 'pending', title: input.title,
      accountId: input.account?.account_id, locationId: input.location?.id, reason: input.reason,
      changes: Object.entries(proposed).filter(([field, after]) => canonical(current[field]) !== canonical(after)).map(([field, after]) => ({ field, label: labels[field] ?? field, before: current[field] ?? null, after })),
      evidence, warnings: input.warnings ?? [], current, proposed,
      ...(input.account ? { billing: { lifetimeRevenue: revenue, outstandingAr: ar, protected: revenue !== null && ar !== null && revenue > 0 && ar > 0 } } : {}) };
    plans.push({ proposal, operation: input.operation ?? { kind: 'none' }, preconditions, location: input.location ?? null, websiteComplete: snapshot.coverage.websiteComplete, crmComplete: snapshot.coverage.crmComplete });
  }
  if (!snapshot.coverage.crmComplete || !snapshot.coverage.websiteComplete || snapshot.coverage.errors.length) {
    add({ ruleCode: 'incomplete_sources', kind: 'needs_review', title: 'Source collection needs attention', reason: 'Collection is incomplete. No account changes can be approved from this scan.', warnings: snapshot.coverage.errors });
    return plans;
  }
  for (const location of snapshot.locations) {
    const candidates = snapshot.accounts.map(account => match(location, account)).filter((item): item is Match => item !== null).sort((a, b) => b.score - a.score || a.account.account_id.localeCompare(b.account.account_id));
    const active = candidates.filter(item => !item.account.duplicate_of_account && !item.account.chow_current_account);
    const strong = active.filter(item => item.strong);
    for (const candidate of candidates) matched.add(candidate.account.account_id);
    if (strong.length === 0) {
      if (candidates.length) add({ ruleCode: 'identity_ambiguity', kind: 'needs_review', title: `Confirm identity · ${location.name}`, location, candidates, reason: 'The CRM has possible matches, but there is not enough independent identity evidence to select one. No account is created.' });
      else add({ ruleCode: 'new_account', kind: 'create', title: `Create · ${location.name}`, location, candidates, reason: 'No competing name, address, or local phone match exists in the complete CRM.', proposed: desiredFields(location, parent), operation: { kind: 'create', fields: desiredFields(location, parent) }, preconditions: [parent] });
      continue;
    }
    let winner = strong[0];
    if (!winner) continue;
    if (strong.length > 1) {
      const current = strong.filter(item => item.account.parent_id === parent.account_id && normalize(item.account.name) === normalize(location.name) && street(item.account.billing_street) === street(location.street));
      const phoneSurvivors = current.filter(item => phone(location.phone).length === 10 && phone(item.account.phone) === phone(location.phone));
      if (current.length === 1 && current[0]) winner = current[0];
      else if (phoneSurvivors.length === 1 && phoneSurvivors[0]) winner = phoneSurvivors[0];
      else {
        const equivalent = strong.every(item => normalize(item.account.name) === normalize(location.name)
          && street(item.account.billing_street) === street(location.street)
          && phone(item.account.phone).length === 10 && phone(item.account.phone) === phone(location.phone)
          && canonical(care([item.account.care_type])) === canonical(care([strong[0]?.account.care_type ?? ''])));
        if (!equivalent) {
          add({ ruleCode: 'competing_accounts', kind: 'needs_review', title: `Competing accounts · ${location.name}`, location, candidates, reason: 'Multiple accounts have strong but conflicting identity evidence. A survivor cannot be established safely.' });
          continue;
        }
        const agreement = (item: Match): number => Number(item.account.parent_id === parent.account_id) * 20
          + Number(item.account.name === location.name) * 4 + Number(item.account.billing_street === location.street) * 3
          + Number(item.account.billing_zip === location.zip) + Number(Boolean(item.account.phone)) + Number(item.account.status === 'Active');
        winner = [...strong].sort((a, b) => agreement(b) - agreement(a) || a.account.account_id.localeCompare(b.account.account_id))[0] ?? winner;
      }
      const selectedWinner = winner;
      const losers = strong.filter(item => item !== selectedWinner);
      const unsafe = losers.some(item => money(item.account.lifetime_revenue) !== 0 || money(item.account.outstanding_ar) !== 0 || canonical(care([item.account.care_type])) !== canonical(care([selectedWinner.account.care_type])) || normalize(item.account.name) !== normalize(selectedWinner.account.name) || street(item.account.billing_street) !== street(selectedWinner.account.billing_street));
      if (unsafe) {
        add({ ruleCode: 'billing_ambiguity', kind: 'needs_review', title: `Billing or campus ambiguity · ${location.name}`, location, candidates, reason: 'Competing accounts have billing history, different care offerings, or conflicting identity fields. They may be historical accounts or separate services, so they are not marked as duplicates.' });
        continue;
      }
      for (const loser of losers) {
        const patch = { duplicate_of_account: winner.account.account_id, status: 'Inactive', note: appendNote(loser.account, `Reviewed duplicate of ${winner.account.account_id}; current website identity and Bellhaven parent establish the survivor.`) };
        add({ ruleCode: 'duplicate', kind: 'duplicate', title: `Retire duplicate · ${loser.account.name}`, account: loser.account, location, candidates: [winner, loser], reason: 'The accounts have the same corroborated identity and care offerings. Prefer the correct parent and a unique website phone match, then exact website field agreement and completeness; an otherwise equal pair uses the stable account ID as a tie-break. The loser has no revenue or AR.', proposed: patch, operation: { kind: 'patch', accountId: loser.account.account_id, patch }, preconditions: [loser.account, winner.account, parent] });
      }
    }
    const account = winner.account;
    const fields = desiredFields(location, parent);
    if (/\bp\s*\.?\s*o\s*\.?\s*box\b/i.test(account.billing_street) && street(account.billing_street) !== street(location.street)) {
      add({ ruleCode: 'billing_ambiguity', kind: 'needs_review', title: `Billing address · ${location.name}`, account, location, candidates, reason: 'The CRM uses a PO Box. The website gives a physical address, which does not establish that the billing address should be replaced.' });
      continue;
    }
    const patch = changesFor(account, fields);
    if (account.parent_id !== parent.account_id) {
      const revenue = money(account.lifetime_revenue); const ar = money(account.outstanding_ar);
      if (revenue === null || ar === null) {
        add({ ruleCode: 'billing_ambiguity', kind: 'needs_review', title: `Check financial values · ${location.name}`, account, location, candidates, reason: 'Revenue or AR is missing or malformed. The ownership rule cannot safely select re-parenting versus a CHOW account.' });
        continue;
      }
      if (revenue > 0 && ar > 0) {
        add({ ruleCode: 'ownership_change', kind: 'chow', title: `Preserve billing history · ${location.name}`, account, location, candidates, reason: 'Revenue and outstanding AR are both positive. Create a clean Bellhaven account, then set only the old account’s CHOW link. Every other old field is preserved.', current: { oldAccount: { ...account } }, proposed: { newAccount: fields, oldAccountPatch: { chow_current_account: '(new account ID)' } }, operation: { kind: 'chow', accountId: account.account_id, fields }, preconditions: [account, parent], warnings: ['Creates one new account with zero historical revenue and AR. The old account remains under its existing parent.'] });
        continue;
      }
    }
    if (Object.keys(patch).length) add({ ruleCode: account.parent_id !== parent.account_id ? 'ownership_change' : 'field_update', kind: 'update', title: `Update · ${location.name}`, account, location, candidates: [winner], reason: `${winner.signals.join(', ')} establish identity. Align the listed fields with current website evidence.`, proposed: patch, operation: { kind: 'patch', accountId: account.account_id, patch }, preconditions: [account, parent] });
    else add({ ruleCode: 'unchanged', kind: 'unchanged', title: location.name, account, location, candidates: [winner], reason: 'The matching account already agrees with the website and correct parent.' });
  }
  for (const account of snapshot.accounts.filter(item => item.parent_id === parent.account_id && !matched.has(item.account_id) && !item.duplicate_of_account && !item.chow_current_account)) {
    const explanation = 'Review required: no confident match in the complete Bellhaven website scan. Website absence does not establish sale or closure; confirm ownership.';
    const note = account.note.includes(explanation) ? account.note : appendNote(account, explanation);
    const patch = { status: 'Needs Review', note };
    if (account.status === 'Needs Review' && account.note === note) {
      add({ ruleCode: 'missing_from_website', kind: 'unchanged', title: `Awaiting ownership evidence · ${account.name}`, account, reason: 'This account is already flagged Needs Review for website absence. Its parent and billing history remain unchanged.' });
    } else add({ ruleCode: 'missing_from_website', kind: 'update', title: `Flag for ownership review · ${account.name}`, account, reason: 'No current location confidently matches this Bellhaven account. Set only Needs Review and an evidence note; keep its ownership and financial history.', proposed: patch, operation: { kind: 'patch', accountId: account.account_id, patch }, preconditions: [account, parent], warnings: ['Website absence is uncertain. This approval does not mark the account inactive or infer a sale.'] });
  }
  return plans;
}

function comparisonFields(location: Location | undefined, account: Account): ComparisonField[] {
  const pairs: { field: string; website: unknown; normalize?: (value: string) => string }[] = [
    { field: 'name', website: location?.name, normalize },
    { field: 'billing_street', website: location?.street, normalize: street },
    { field: 'billing_city', website: location?.city, normalize },
    { field: 'billing_state', website: location?.state, normalize },
    { field: 'billing_zip', website: location?.zip },
    { field: 'phone', website: location?.phone, normalize: phone },
    { field: 'care_type', website: location?.careOfferings.join('; '), normalize: value => canonical(care([value])) },
    ...['parent_id', 'status', 'lifetime_revenue', 'outstanding_ar', 'chow_current_account', 'duplicate_of_account'].map(field => ({ field, website: undefined })),
  ];
  return pairs.map(pair => {
    const crm = account[pair.field]; const website = pair.website;
    const relation: ComparisonField['relation'] = website === undefined ? 'not_comparable'
      : website === '' || website === null || crm === '' || crm === null || crm === undefined ? 'missing'
      : canonical(website) === canonical(crm) ? 'equal'
      : pair.normalize && typeof website === 'string' && typeof crm === 'string' && pair.normalize(website) === pair.normalize(crm) ? 'normalized_equal' : 'different';
    return { field: pair.field, label: labels[pair.field] ?? pair.field, website: website ?? null, crm: crm ?? null, relation };
  });
}
export function comparisonsFor(snapshot: Snapshot, plans: ProposalPlan[]): Comparison[] {
  const comparisons: Comparison[] = snapshot.locations.map(location => {
    const related = plans.filter(plan => plan.proposal.locationId === location.id || plan.proposal.ruleCode === 'incomplete_sources');
    const selected = new Set(related.filter(plan => plan.proposal.kind !== 'duplicate').map(plan => plan.proposal.accountId));
    for (const plan of related) if (plan.operation.kind === 'patch' && plan.proposal.kind === 'duplicate' && typeof plan.operation.patch.duplicate_of_account === 'string') selected.add(plan.operation.patch.duplicate_of_account);
    const candidates = snapshot.accounts.map(account => match(location, account)).filter((candidate): candidate is Match => candidate !== null).sort((a, b) => b.score - a.score || a.account.account_id.localeCompare(b.account.account_id)).map(candidate => {
      const disposition: ComparisonCandidate['disposition'] = candidate.account.duplicate_of_account ? 'duplicate' : candidate.account.chow_current_account ? 'historical' : selected.has(candidate.account.account_id) ? 'selected' : 'possible';
      return { accountId: candidate.account.account_id, disposition, signals: candidate.signals, fields: comparisonFields(location, candidate.account) };
    });
    return { id: hash({ location: location.id }), locationId: location.id, candidates, proposalIds: related.map(plan => plan.proposal.id), ruleCodes: [...new Set(related.flatMap(plan => plan.proposal.ruleCode ? [plan.proposal.ruleCode] : []))] };
  });
  for (const plan of plans.filter(plan => !plan.location && plan.proposal.accountId)) {
    const account = snapshot.accounts.find(account => account.account_id === plan.proposal.accountId);
    if (!account) continue;
    comparisons.push({ id: hash({ account: account.account_id }), accountId: account.account_id, candidates: [{ accountId: account.account_id, disposition: 'selected', signals: ['No website candidate passed the identity matching predicates'], fields: comparisonFields(undefined, account) }], proposalIds: [plan.proposal.id], ruleCodes: plan.proposal.ruleCode ? [plan.proposal.ruleCode] : [] });
  }
  const parent = parentAccount(snapshot.accounts);
  const represented = new Set(comparisons.flatMap(comparison => comparison.candidates.map(candidate => candidate.accountId)));
  for (const account of snapshot.accounts.filter(account => account.parent_id === parent.account_id && !represented.has(account.account_id))) {
    const incomplete = plans.find(plan => plan.proposal.ruleCode === 'incomplete_sources');
    comparisons.push({ id: hash({ account: account.account_id }), accountId: account.account_id, candidates: [{ accountId: account.account_id, disposition: account.duplicate_of_account ? 'duplicate' : account.chow_current_account ? 'historical' : 'possible', signals: [incomplete ? 'Source collection is incomplete; website absence cannot be established' : 'No website candidate passed the identity matching predicates'], fields: comparisonFields(undefined, account) }], proposalIds: incomplete ? [incomplete.proposal.id] : [], ruleCodes: [incomplete ? 'incomplete_sources' : 'missing_from_website'] });
  }
  return comparisons;
}
