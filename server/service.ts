import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { AppState, CollectOptions, CollectionProgress, DecisionRequest, Run, Snapshot, SourceMode } from '../shared/contracts.js';
import { comparisonsFor, reconcile } from './domain.js';
import { Store } from './store.js';
import { LiveAdapter, LocalAdapter, type CrmAdapter } from './adapters.js';
import { AppError, executePlan } from './executor.js';
import { snapshotSchema } from './schema.js';
import { collectSnapshot, loadCapturedSnapshot, readAccounts } from './sources/index.js';

export type ServiceOptions = {
  store: Store; captureDir: string; websiteUrl: string; apiBase: string; token: string;
  liveWritesEnabled: boolean;
  collect?: (options: CollectOptions) => Promise<Snapshot>;
  loadCapture?: (directory: string) => Promise<Snapshot>;
  adapter?: (source: SourceMode) => CrmAdapter;
  demoSnapshot?: Snapshot;
};
export class ReviewService {
  private busy = false;
  private completion: Promise<void> | null = null;
  constructor(readonly options: ServiceOptions) {}
  get isBusy(): boolean { return this.busy; }
  get store(): Store { return this.options.store; }
  state(): AppState {
    const run = this.store.latestRun();
    return { workflows: [{ id: 'bellhaven', name: 'Bellhaven' }], run,
      proposals: run ? this.store.proposals(run.id) : [], history: this.store.history(), schedules: this.store.schedules(), runs: this.store.runs(), localWorkspace: this.store.workspace(),
      settings: { credentialsConfigured: Boolean(this.options.token), liveWritesEnabled: this.options.liveWritesEnabled,
        snapshotAvailable: Boolean(this.store.baseline()) || existsSync(resolve(this.options.captureDir, 'snapshot.json')) || existsSync(resolve(this.options.captureDir, 'manifest.json')) || Boolean(this.options.loadCapture) } };
  }
  private adapter(source: SourceMode): CrmAdapter {
    if (this.options.adapter) return this.options.adapter(source);
    if (source !== 'live') return new LocalAdapter(this.store, source);
    return new LiveAdapter({ apiBase: this.options.apiBase, token: this.options.token, writesEnabled: this.options.liveWritesEnabled,
      readAccounts: () => readAccounts({ apiBase: this.options.apiBase, token: this.options.token }) });
  }
  private async snapshot(source: SourceMode, onProgress?: (progress: CollectionProgress) => void): Promise<Snapshot> {
    if (source === 'live') {
      if (!this.options.token) throw new AppError('Configure CRM_TOKEN in the local .env file before a live scan.');
      const snapshot = snapshotSchema.parse(await (this.options.collect ?? collectSnapshot)({ websiteUrl: this.options.websiteUrl, apiBase: this.options.apiBase,
        token: this.options.token, outputDir: resolve(this.options.captureDir, '..', 'live-captures', randomUUID()), onProgress }));
      this.store.saveSnapshot(source, snapshot); return snapshot;
    }
    const captured = this.store.session().reset ? this.store.baseline(source) : source === 'demo' ? this.options.demoSnapshot : await (this.options.loadCapture ?? loadCapturedSnapshot)(this.options.captureDir);
    if (!captured) throw new AppError('No internal synthetic snapshot was provided.');
    const snapshot = snapshotSchema.parse(captured);
    this.store.pinBaseline(source, snapshot);
    this.store.seedAccounts(source, snapshot.accounts);
    const accounts = await this.adapter(source).list();
    const current = { ...snapshot, accounts };
    this.store.saveSnapshot(source, current);
    onProgress?.({ website: { completed: snapshot.coverage.urls.length, total: snapshot.coverage.urls.length }, crm: { completed: accounts.length, total: accounts.length }, message: 'Private captured evidence loaded. Simulation changes stay local.' });
    return current;
  }
  startRun(source: SourceMode): Run {
    if (this.busy) throw new AppError('A scan or approval is already in progress.', 409);
    this.busy = true;
    const now = new Date().toISOString();
    const run: Run = { id: randomUUID(), workflowId: 'bellhaven', source, ...(source !== 'live' ? { sessionId: this.store.session().sessionId } : {}), status: 'running', phase: 'scrape', startedAt: now, updatedAt: now,
      progress: { website: { completed: 0, total: null }, crm: { completed: 0, total: null }, compare: { completed: 0, total: null } }, message: source === 'live' ? 'Collecting current website and CRM evidence.' : 'Loading private captured evidence.', errors: [], etaSeconds: null };
    this.store.activateRun(run);
    this.completion = this.performRun(run).finally(() => { this.busy = false; this.completion = null; });
    return run;
  }
  async waitForRun(): Promise<void> { await this.completion; }
  private async performRun(run: Run): Promise<void> {
    try {
      const snapshot = await this.snapshot(run.source, progress => {
        run.progress.website = progress.website; run.progress.crm = progress.crm;
        run.message = progress.message; run.updatedAt = new Date().toISOString();
        const complete = progress.website.completed + progress.crm.completed;
        const total = progress.website.total !== null && progress.crm.total !== null ? progress.website.total + progress.crm.total : null;
        run.etaSeconds = complete >= 3 && total !== null && total > complete ? Math.ceil((Date.now() - Date.parse(run.startedAt)) / 1000 / complete * (total - complete)) : null;
        this.store.saveRun(run);
      });
      this.store.saveRunInput(run.id, snapshot);
      run.phase = 'compare'; run.message = 'Comparing identity, ownership, billing, and duplicate evidence.'; run.snapshotId = snapshot.id;
      run.progress.compare = { completed: 0, total: snapshot.locations.length }; run.updatedAt = new Date().toISOString(); this.store.saveRun(run);
      const plans = reconcile(snapshot, run.source, run.id, this.store.proposalScope(run));
      this.store.bindPlans(run.id, plans, snapshot, comparisonsFor(snapshot, plans));
      run.progress.compare.completed = snapshot.locations.length;
      run.status = snapshot.coverage.crmComplete && snapshot.coverage.websiteComplete && !snapshot.coverage.errors.length ? 'ready' : 'failed';
      run.phase = 'review'; run.finishedAt = new Date().toISOString(); run.updatedAt = run.finishedAt;
      run.message = run.status === 'ready' ? 'Evidence is ready for review. Every write requires an exact-revision approval.' : 'Collection is incomplete. Account changes are blocked.';
      run.errors = snapshot.coverage.errors; run.etaSeconds = null; this.store.saveRun(run);
    } catch (error) {
      run.status = 'failed'; run.finishedAt = new Date().toISOString(); run.updatedAt = run.finishedAt;
      run.message = error instanceof Error ? error.message : 'Scan failed.'; run.errors = [run.message]; run.etaSeconds = null; this.store.saveRun(run);
    }
  }
  resetLocal(expectedSessionId: string): AppState {
    if (this.busy) throw new AppError('A scan or approval is already in progress.', 409);
    try { this.store.resetLocal(expectedSessionId); }
    catch (error) { throw new AppError(error instanceof Error ? error.message : 'Local reset failed.', 409); }
    return this.state();
  }
  async decide(id: string, request: DecisionRequest): Promise<AppState['proposals'][number]> {
    if (this.busy) throw new AppError('A scan or approval is already in progress.', 409);
    const active = this.store.latestRun();
    if (!active || active.id !== request.runId || active.status !== 'ready' || (active.source !== 'live' && active.sessionId !== this.store.session().sessionId)) throw new AppError('This run is historical or its local session changed. Open the current review queue.', 409);
    if (!this.store.proposals(active.id).some(proposal => proposal.id === id)) throw new AppError('Proposal does not belong to this run.', 409);
    const plan = this.store.getPlan(id);
    if (!plan) throw new AppError('Proposal not found.', 404);
    if (plan.proposal.runId !== request.runId) throw new AppError('Proposal does not belong to this run.', 409);
    if (plan.proposal.revision !== request.revision) throw new AppError('This revision is out of date. Refresh the review queue.', 409);
    if (request.decision === 'reject') {
      if (plan.proposal.status !== 'pending' && plan.proposal.status !== 'rejected') throw new AppError('An execution or closed decision cannot be rejected.', 409);
      if (plan.proposal.status !== 'rejected') {
        plan.proposal.status = 'rejected'; this.store.savePlan(plan); this.store.record(plan.proposal, 'rejected', 'Rejected by the reviewer. Identical evidence keeps this decision on future scans.');
      }
      return plan.proposal;
    }
    if (plan.proposal.source === 'live') {
      if (!this.options.liveWritesEnabled) throw new AppError('Live writes are disabled. Configure LIVE_WRITES_ENABLED=true locally when you are ready to approve real writes.', 403);
      if (request.confirmLive !== true) throw new AppError('Explicit confirmation of this real CRM write is required.', 400);
    }
    this.busy = true; this.store.withWriteRun(request.runId);
    try { return await executePlan({ plan, adapter: this.adapter(plan.proposal.source), store: this.store, refresh: () => this.snapshot(plan.proposal.source) }); }
    finally { this.store.withWriteRun(null); this.busy = false; }
  }
}
