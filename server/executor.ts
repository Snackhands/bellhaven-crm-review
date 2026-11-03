import type { Account, Proposal, Snapshot } from '../shared/contracts.js';
import { accountVersion, canonical, locationVersion, reconcile, sameFields, type AccountFields, type Execution, type ProposalPlan } from './domain.js';
import type { CrmAdapter } from './adapters.js';
import type { Store } from './store.js';

export class AppError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const message = (error: unknown): string => error instanceof Error ? error.message : 'Unknown execution error';
function createMatches(account: Account, fields: AccountFields): boolean { return sameFields(account, fields); }
export async function executePlan(options: {
  plan: ProposalPlan; adapter: CrmAdapter; store: Store; refresh: () => Promise<Snapshot>;
}): Promise<Proposal> {
  const { plan, adapter, store } = options;
  const proposal = plan.proposal;
  let execution: Execution = store.execution(proposal.id) ?? { stage: 'prepared' };
  function save(status: Proposal['status'], detail?: string): Proposal {
    plan.proposal = { ...plan.proposal, status, error: detail, ...(execution.resultAccountId ? { resultAccountId: execution.resultAccountId } : {}) };
    store.savePlan(plan); return plan.proposal;
  }
  function checkpoint(stage: Execution['stage'], update: Partial<Execution> = {}): void {
    execution = { ...execution, ...update, stage }; store.saveExecution(proposal.id, execution);
  }
  function stop(status: 'stale' | 'failed' | 'uncertain', detail: string): Proposal {
    if (status === 'uncertain') checkpoint('uncertain', { error: detail });
    const result = save(status, detail); store.record(result, status, detail); return result;
  }
  async function exactPreconditions(skipIds: string[] = []): Promise<boolean> {
    for (const expected of plan.preconditions) {
      if (skipIds.includes(expected.account_id)) continue;
      const current = await adapter.get(expected.account_id);
      if (accountVersion(current) !== accountVersion(expected)) return false;
    }
    return true;
  }
  function sameApprovedOperation(snapshot: Snapshot): boolean {
    const run = store.getRun(proposal.runId);
    return reconcile(snapshot, proposal.source, proposal.runId, run ? store.proposalScope(run) : undefined).some(item => item.proposal.id === proposal.id && item.proposal.revision === proposal.revision && canonical(item.operation) === canonical(plan.operation));
  }
  if (proposal.status === 'applied') return proposal;
  if (proposal.status === 'rejected' || proposal.status === 'stale') throw new AppError('This decision is closed. Run a fresh scan for changed evidence.', 409);
  if (plan.operation.kind === 'none') throw new AppError('This item needs manual investigation and has no safe write to approve.', 409);
  if (execution.stage === 'uncertain') throw new AppError('An earlier create has an uncertain result. Inspect the CRM before resolving it; the app will not create a second account.', 409);
  const conflict = store.createConflict(plan);
  if (conflict) {
    plan.proposal = { ...plan.proposal, status: 'uncertain', ...conflict };
    store.savePlan(plan); store.record(plan.proposal, 'uncertain', conflict.error); return plan.proposal;
  }
  try {
    const fresh = await options.refresh();
    if (!fresh.coverage.websiteComplete || !fresh.coverage.crmComplete || fresh.coverage.errors.length) return stop('stale', 'Fresh collection is incomplete. Run a new scan before approval.');
    const operation = plan.operation;
    if (operation.kind === 'patch') {
      const current = await adapter.get(operation.accountId);
      if ((execution.stage === 'patching' || execution.stage === 'done') && sameFields(current, operation.patch)) {
        checkpoint('done'); const result = save('applied'); store.record(result, 'applied', 'Readback confirmed the previous patch succeeded.'); return result;
      }
      if (!sameApprovedOperation(fresh) || !await exactPreconditions()) return stop('stale', 'CRM or website evidence changed. No patch was retried; run a fresh scan and review the new revision.');
      save('applying');
      checkpoint('patching');
      try { await adapter.patch(operation.accountId, operation.patch); }
      catch (error) {
        const check = await adapter.get(operation.accountId).catch(() => null);
        if (!check || !sameFields(check, operation.patch)) return stop('failed', `Patch was not confirmed. Saved preconditions must still match before a retry. ${message(error)}`);
      }
      const readback = await adapter.get(operation.accountId);
      if (!sameFields(readback, operation.patch)) return stop('failed', 'CRM readback did not match the approved patch. Inspect the record before retrying.');
      checkpoint('done'); const result = save('applied'); store.record(result, 'applied', 'Approved fields verified by CRM readback.'); return result;
    }
    if (execution.stage === 'prepared') {
      if (!sameApprovedOperation(fresh) || !await exactPreconditions()) return stop('stale', 'CRM or website evidence changed after this proposal. Run a new scan and review the new revision.');
    } else if (plan.location && !fresh.locations.some(location => location.id === plan.location?.id && locationVersion(location) === locationVersion(plan.location))) {
      return stop('stale', 'Website evidence changed during execution. Saved progress is retained for inspection.');
    }
    save('applying');
    if (execution.stage === 'creating') {
      const newMatches = (await adapter.list()).filter(account => !execution.baselineIds?.includes(account.account_id) && createMatches(account, operation.fields));
      if (newMatches.length !== 1 || !newMatches[0]) return stop('uncertain', 'A create was interrupted and its unique result could not be established. No retry will create another account.');
      checkpoint('created', { resultAccountId: newMatches[0].account_id });
    }
    if (execution.stage === 'prepared') {
      if (!await exactPreconditions()) return stop('stale', 'An affected account changed before create. Review a new scan.');
      checkpoint('creating', { baselineIds: (await adapter.list()).map(account => account.account_id) });
      try {
        const created = await adapter.create(operation.fields);
        checkpoint('created', { resultAccountId: created.account_id });
      } catch (error) {
        const accounts = await adapter.list().catch(() => null);
        const matches = accounts?.filter(account => !execution.baselineIds?.includes(account.account_id) && createMatches(account, operation.fields));
        if (!matches || matches.length !== 1 || !matches[0]) return stop('uncertain', `Create outcome could not be established. The app will not repeat it. ${message(error)}`);
        checkpoint('created', { resultAccountId: matches[0].account_id });
      }
    }
    const newId = execution.resultAccountId;
    if (!newId) return stop('uncertain', 'The create journal has no result account ID. Inspect the CRM before proceeding.');
    const created = await adapter.get(newId);
    if (!createMatches(created, operation.fields)) return stop('stale', 'The created account differs from the approved values. The saved ID is retained; no second account will be created.');
    if (operation.kind === 'chow') {
      const old = await adapter.get(operation.accountId);
      const original = plan.preconditions.find(account => account.account_id === operation.accountId);
      if (!original) return stop('failed', 'The CHOW record has no saved precondition.');
      if (old.chow_current_account === newId) {
        const expected = { ...original, chow_current_account: newId };
        if (accountVersion(old) !== accountVersion(expected)) return stop('stale', 'The old account has changes beyond the approved CHOW link. Inspect the saved account IDs.');
      } else {
        const withoutSuccessor = { ...fresh, accounts: fresh.accounts.filter(account => account.account_id !== newId) };
        if (!sameApprovedOperation(withoutSuccessor) || !await exactPreconditions()) return stop('stale', 'The old account, parent, or competing identity evidence changed after creation. The new ID is saved; no link or duplicate create was attempted.');
        checkpoint('patching');
        try { await adapter.patch(operation.accountId, { chow_current_account: newId }); }
        catch (error) {
          const check = await adapter.get(operation.accountId).catch(() => null);
          if (!check || check.chow_current_account !== newId) return stop('failed', `New account ${newId} is saved. Linking was not confirmed; reapproval resumes this link without creating another account. ${message(error)}`);
        }
      }
      const readback = await adapter.get(operation.accountId);
      if (accountVersion(readback) !== accountVersion({ ...original, chow_current_account: newId })) return stop('failed', 'CHOW readback did not confirm preservation of every old field. The saved new account ID is retained.');
    }
    checkpoint('done'); const result = save('applied'); store.record(result, 'applied', operation.kind === 'chow' ? `New account ${newId} verified. Old fields preserved with only the CHOW link changed.` : `Created account ${newId} verified by readback.`); return result;
  } catch (error) {
    if (execution.stage === 'creating') return stop('uncertain', `Create result needs inspection. ${message(error)}`);
    return stop('failed', message(error));
  }
}
