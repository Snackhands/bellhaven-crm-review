import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Account, Comparison, HistoryEntry, LocalWorkspace, Location, Proposal, ReviewEvent, Run, RunDetail, RunSummary, Schedule, Snapshot, SourceMode } from '../shared/contracts.js';
import { normalize, street, type Execution, type ProposalPlan } from './domain.js';
import { accountSchema, locationSchema, snapshotSchema, sourceSchema } from './schema.js';

const counter = z.object({ completed: z.number(), total: z.number().nullable() });
const runSchema = z.object({ id: z.string(), workflowId: z.string(), source: sourceSchema, sessionId: z.string().optional(), status: z.enum(['running', 'ready', 'failed']), phase: z.enum(['scrape', 'compare', 'review']), startedAt: z.string(), updatedAt: z.string(), finishedAt: z.string().optional(), progress: z.object({ website: counter, crm: counter, compare: counter }), message: z.string(), errors: z.array(z.string()), etaSeconds: z.number().nullable(), snapshotId: z.string().optional() });
const proposalSchema = z.object({ id: z.string(), revision: z.string(), runId: z.string(), source: sourceSchema, ruleCode: z.enum(['field_update', 'new_account', 'duplicate', 'ownership_change', 'identity_ambiguity', 'competing_accounts', 'billing_ambiguity', 'missing_from_website', 'incomplete_sources', 'unchanged']).optional(), kind: z.enum(['update', 'create', 'duplicate', 'chow', 'needs_review', 'unchanged']), status: z.enum(['pending', 'approved', 'rejected', 'applying', 'applied', 'stale', 'failed', 'uncertain']), title: z.string(), accountId: z.string().optional(), locationId: z.string().optional(), reason: z.string(), changes: z.array(z.object({ field: z.string(), label: z.string(), before: z.unknown(), after: z.unknown() })), evidence: z.array(z.object({ label: z.string(), detail: z.string(), url: z.string().optional() })), warnings: z.array(z.string()), current: z.record(z.string(), z.unknown()), proposed: z.record(z.string(), z.unknown()), billing: z.object({ lifetimeRevenue: z.number().nullable(), outstandingAr: z.number().nullable(), protected: z.boolean() }).optional(), error: z.string().optional(), resultAccountId: z.string().optional() });
const operationSchema = z.discriminatedUnion('kind', [z.object({ kind: z.literal('patch'), accountId: z.string(), patch: z.record(z.string(), z.unknown()) }), z.object({ kind: z.literal('create'), fields: accountSchema.omit({ account_id: true }) }), z.object({ kind: z.literal('chow'), accountId: z.string(), fields: accountSchema.omit({ account_id: true }) }), z.object({ kind: z.literal('none') })]);
const planSchema = z.object({ proposal: proposalSchema, operation: operationSchema, preconditions: z.array(accountSchema), location: locationSchema.nullable(), websiteComplete: z.boolean(), crmComplete: z.boolean() });
const executionSchema = z.object({ stage: z.enum(['prepared', 'creating', 'created', 'patching', 'done', 'uncertain']), baselineIds: z.array(z.string()).optional(), resultAccountId: z.string().optional(), error: z.string().optional() });
const scheduleSchema = z.object({ id: z.string(), name: z.string(), workflowId: z.string(), time: z.string(), timezone: z.string(), source: sourceSchema, enabled: z.boolean(), cron: z.string(), lastRunAt: z.string().optional(), nextRunAt: z.string().optional(), cadence: z.enum(['once', 'hourly', 'daily', 'weekly', 'biweekly', 'monthly']).optional(), startDate: z.string().optional(), endDate: z.string().optional() });
const historySchema = z.object({ id: z.string(), at: z.string(), proposalId: z.string(), title: z.string(), action: z.string(), source: sourceSchema, detail: z.string() });
const comparisonSchema = z.object({ id: z.string(), locationId: z.string().optional(), accountId: z.string().optional(), candidates: z.array(z.object({ accountId: z.string(), disposition: z.enum(['selected', 'possible', 'duplicate', 'historical']), signals: z.array(z.string()), fields: z.array(z.object({ field: z.string(), label: z.string(), website: z.unknown(), crm: z.unknown(), relation: z.enum(['equal', 'normalized_equal', 'different', 'missing', 'not_comparable']) })) })), proposalIds: z.array(z.string()), ruleCodes: z.array(proposalSchema.shape.ruleCode.unwrap()) });
const bundleSchema = z.object({ input: snapshotSchema, proposals: z.array(proposalSchema), comparisons: z.array(comparisonSchema) });
const eventSchema = z.object({ id: z.string(), at: z.string(), runId: z.string(), proposalId: z.string(), status: proposalSchema.shape.status, detail: z.string(), resultAccountId: z.string().optional() });
const resultSchema = z.object({ accounts: z.array(accountSchema), at: z.string() });
const sessionSchema = z.object({ sessionId: z.string(), createdAt: z.string(), reset: z.boolean() });
function decode<T>(row: Record<string, unknown> | undefined, schema: z.ZodType<T>): T | null {
  return row && typeof row.json === 'string' ? schema.parse(JSON.parse(row.json)) : null;
}
function samePhysicalLocation(left: Location, right: Location): boolean {
  const address = street(left.street); const state = normalize(left.state);
  if (!address || !state || address !== street(right.street) || state !== normalize(right.state)) return false;
  const city = normalize(left.city); const zip = left.zip.trim().slice(0, 5);
  return Boolean(city && city === normalize(right.city) || zip && zip === right.zip.trim().slice(0, 5));
}
export class Store {
  readonly db: DatabaseSync;
  private writeRunId: string | null = null;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, json TEXT NOT NULL, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS run_items (run_id TEXT NOT NULL, proposal_id TEXT NOT NULL, ordinal INTEGER NOT NULL, PRIMARY KEY(run_id,proposal_id));
      CREATE TABLE IF NOT EXISTS executions (proposal_id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, json TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots (source TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (source TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(source,id));
      CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_sessions (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS original_captures (source TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS legacy_run_views (run_id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS run_inputs (run_id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS run_evidence (run_id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS review_events (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_results (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schedule_slots (schedule_id TEXT PRIMARY KEY, slot TEXT NOT NULL);
    `);
    if (!this.meta('session')) {
      const session = { sessionId: randomUUID(), createdAt: new Date().toISOString(), reset: false };
      this.transaction(() => {
        this.db.prepare('INSERT INTO local_sessions(id,json) VALUES(?,?)').run(session.sessionId, JSON.stringify(session));
        this.setMeta('session', session.sessionId);
        for (const source of ['snapshot', 'demo'] as const) {
          this.db.prepare('UPDATE accounts SET source=? WHERE source=?').run(this.accountScope(source), source);
        }
        const latest = decode(this.db.prepare('SELECT json FROM runs ORDER BY created DESC,rowid DESC LIMIT 1').get(), runSchema);
        if (latest) this.setMeta('activeRun', latest.id);
        for (const row of this.db.prepare('SELECT json FROM runs').all()) {
          const run = decode(row, runSchema);
          if (run && run.source !== 'live' && !run.sessionId) this.saveRun({ ...run, sessionId: session.sessionId });
        }
      });
    }
    for (const row of this.db.prepare('SELECT json FROM runs').all()) {
      const run = decode(row, runSchema);
      if (run && !this.hasEvidence(run.id)) {
        const proposals = this.proposals(run.id).map(proposal => ({ ...proposal, runId: run.id }));
        this.db.prepare('INSERT OR IGNORE INTO legacy_run_views(run_id,json) VALUES(?,?)').run(run.id, JSON.stringify(proposals));
      }
      if (run?.status === 'running') this.saveRun({ ...run, status: 'failed', updatedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), message: 'The app stopped during this scan. Start a fresh scan.', errors: [...run.errors, 'Scan interrupted by restart.'] });
    }
    for (const row of this.db.prepare('SELECT json FROM proposals').all()) {
      const plan = decode(row, planSchema);
      if (plan?.proposal.status === 'applying') this.savePlan({ ...plan, proposal: { ...plan.proposal, status: 'failed', error: 'Execution interrupted. Reapprove to check its saved progress before any retry.' } });
    }
  }
  close(): void { this.db.close(); }
  saveRun(run: Run): void { this.db.prepare('INSERT INTO runs(id,json,created) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(run.id, JSON.stringify(run), run.startedAt); }
  latestRun(): Run | null { const id = this.meta('activeRun'); return typeof id === 'string' ? this.getRun(id) : null; }
  activateRun(run: Run): void { this.saveRun(run); this.setMeta('activeRun', run.id); }
  getRun(id: string): Run | null { return decode(this.db.prepare('SELECT json FROM runs WHERE id=?').get(id), runSchema); }
  savePlan(plan: ProposalPlan): void {
    const previous = this.getPlan(plan.proposal.id);
    this.transaction(() => {
      this.db.prepare('INSERT OR REPLACE INTO proposals(id,json) VALUES(?,?)').run(plan.proposal.id, JSON.stringify(plan));
      if (previous && (this.hasEvidence(plan.proposal.runId) || this.db.prepare('SELECT 1 FROM legacy_run_views WHERE run_id=?').get(plan.proposal.runId)) && (previous.proposal.status !== plan.proposal.status || previous.proposal.error !== plan.proposal.error || previous.proposal.resultAccountId !== plan.proposal.resultAccountId)) {
        const event: ReviewEvent = { id: randomUUID(), at: new Date().toISOString(), runId: plan.proposal.runId, proposalId: plan.proposal.id, status: plan.proposal.status, detail: plan.proposal.error ?? plan.proposal.status, ...(plan.proposal.resultAccountId ? { resultAccountId: plan.proposal.resultAccountId } : {}) };
        this.db.prepare('INSERT INTO review_events(id,run_id,json) VALUES(?,?,?)').run(event.id, event.runId, JSON.stringify(event));
      }
    });
  }
  getPlan(id: string): ProposalPlan | null { return decode(this.db.prepare('SELECT json FROM proposals WHERE id=?').get(id), planSchema); }
  bindPlans(runId: string, plans: ProposalPlan[], input?: Snapshot, comparisons: Comparison[] = []): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [ordinal, plan] of plans.entries()) {
        const previous = this.getPlan(plan.proposal.id);
        if (previous) plan.proposal = { ...plan.proposal, status: previous.proposal.status, error: previous.proposal.error, resultAccountId: previous.proposal.resultAccountId };
        const execution = this.execution(plan.proposal.id);
        if (execution?.stage === 'uncertain') plan.proposal = { ...plan.proposal, status: 'uncertain', error: execution.error ?? 'An earlier create has an uncertain result. Inspect its saved progress before proceeding.' };
        if (plan.proposal.status !== 'rejected' && plan.proposal.status !== 'applied') {
          const conflict = this.createConflict(plan);
          if (conflict) plan.proposal = { ...plan.proposal, status: 'uncertain', ...conflict };
        }
        this.savePlan(plan);
        this.db.prepare('INSERT INTO run_items(run_id,proposal_id,ordinal) VALUES(?,?,?)').run(runId, plan.proposal.id, ordinal);
      }
      if (input) this.db.prepare('INSERT INTO run_evidence(run_id,json) VALUES(?,?)').run(runId, JSON.stringify({ input, proposals: plans.map(plan => plan.proposal), comparisons }));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  proposals(runId: string): Proposal[] {
    const frozen = this.frozenProposals(runId);
    if (frozen) return frozen;
    return this.db.prepare('SELECT p.json FROM run_items r JOIN proposals p ON p.id=r.proposal_id WHERE r.run_id=? ORDER BY ordinal').all(runId).map(row => decode(row, planSchema)).filter(item => item !== null).map(item => item.proposal);
  }
  saveExecution(id: string, execution: Execution): void { this.db.prepare('INSERT OR REPLACE INTO executions(proposal_id,json) VALUES(?,?)').run(id, JSON.stringify(execution)); }
  execution(id: string): Execution | null { return decode(this.db.prepare('SELECT json FROM executions WHERE proposal_id=?').get(id), executionSchema); }
  createConflict(plan: ProposalPlan): { error: string; resultAccountId?: string } | null {
    if (plan.operation.kind !== 'create' && plan.operation.kind !== 'chow') return null;
    for (const row of this.db.prepare('SELECT proposal_id,json FROM executions').all()) {
      if (typeof row.proposal_id !== 'string' || row.proposal_id === plan.proposal.id) continue;
      const execution = decode(row, executionSchema);
      if (!execution || !['creating', 'created', 'patching', 'uncertain'].includes(execution.stage)) continue;
      const prior = this.getPlan(row.proposal_id);
      if (!prior || prior.proposal.source !== plan.proposal.source || (plan.proposal.source !== 'live' && this.getRun(prior.proposal.runId)?.sessionId !== this.getRun(plan.proposal.runId)?.sessionId) || (prior.operation.kind !== 'create' && prior.operation.kind !== 'chow')) continue;
      if (!execution.resultAccountId && (execution.stage === 'creating' || execution.stage === 'uncertain')) {
        return { error: `An earlier create or CHOW operation (${prior.proposal.id}) has no confirmed result account ID. New creates and CHOWs for this source are paused pending manual investigation; no new account will be created.` };
      }
      const sameLocation = plan.location && prior.location && (plan.location.id === prior.location.id || Boolean(plan.location.sourceUrl && plan.location.sourceUrl === prior.location.sourceUrl));
      const samePhysicalIdentity = execution.resultAccountId && plan.location && prior.location && samePhysicalLocation(plan.location, prior.location);
      const sameOldAccount = plan.operation.kind === 'chow' && prior.operation.kind === 'chow' && plan.operation.accountId === prior.operation.accountId;
      if (!sameLocation && !samePhysicalIdentity && !sameOldAccount) continue;
      return { error: `An earlier create or CHOW operation (${prior.proposal.id}) has an unresolved result. Inspect its saved progress before approving a replacement; no new account will be created.`, ...(execution.resultAccountId ? { resultAccountId: execution.resultAccountId } : {}) };
    }
    return null;
  }
  history(): HistoryEntry[] { return this.db.prepare('SELECT json FROM history ORDER BY at DESC,rowid DESC LIMIT 250').all().map(row => decode(row, historySchema)).filter((item): item is HistoryEntry => item !== null); }
  record(proposal: Proposal, action: string, detail: string): void {
    const entry: HistoryEntry = { id: randomUUID(), at: new Date().toISOString(), proposalId: proposal.id, title: proposal.title, source: proposal.source, action, detail };
    this.db.prepare('INSERT INTO history(id,json,at) VALUES(?,?,?)').run(entry.id, JSON.stringify(entry), entry.at);
  }
  snapshot(source: SourceMode): Snapshot | null { return decode(this.db.prepare('SELECT json FROM snapshots WHERE source=?').get(source), snapshotSchema); }
  saveSnapshot(source: SourceMode, snapshot: Snapshot): void { this.db.prepare('INSERT OR REPLACE INTO snapshots(source,json) VALUES(?,?)').run(source, JSON.stringify(snapshot)); }
  seedAccounts(source: SourceMode, accounts: Account[]): void {
    if (this.meta(`seeded:${this.accountScope(source)}`)) return;
    if (this.db.prepare('SELECT 1 FROM accounts WHERE source=? LIMIT 1').get(this.accountScope(source))) { this.setMeta(`seeded:${this.accountScope(source)}`, true); return; }
    for (const account of accounts) this.putAccount(source, account);
    this.setMeta(`seeded:${this.accountScope(source)}`, true);
  }
  accounts(source: SourceMode): Account[] { return this.db.prepare('SELECT json FROM accounts WHERE source=? ORDER BY id').all(this.accountScope(source)).map(row => decode(row, accountSchema)).filter((item): item is Account => item !== null); }
  account(source: SourceMode, id: string): Account | null { return decode(this.db.prepare('SELECT json FROM accounts WHERE source=? AND id=?').get(this.accountScope(source), id), accountSchema); }
  putAccount(source: SourceMode, account: Account): void { this.db.prepare('INSERT OR REPLACE INTO accounts(source,id,json) VALUES(?,?,?)').run(this.accountScope(source), account.account_id, JSON.stringify(account)); }
  schedules(): Schedule[] { return this.db.prepare('SELECT json FROM schedules ORDER BY rowid').all().map(row => decode(row, scheduleSchema)).filter((item): item is Schedule => item !== null); }
  schedule(id: string): Schedule | null { return decode(this.db.prepare('SELECT json FROM schedules WHERE id=?').get(id), scheduleSchema); }
  saveSchedule(schedule: Schedule): void { this.db.prepare('INSERT OR REPLACE INTO schedules(id,json) VALUES(?,?)').run(schedule.id, JSON.stringify(schedule)); }
  claimScheduleSlot(id: string, slot: string): boolean {
    const row = this.db.prepare('SELECT slot FROM schedule_slots WHERE schedule_id=?').get(id);
    if (row?.slot === slot) return false;
    this.db.prepare('INSERT OR REPLACE INTO schedule_slots(schedule_id,slot) VALUES(?,?)').run(id, slot); return true;
  }
  private meta(key: string): unknown {
    const row = this.db.prepare('SELECT json FROM metadata WHERE key=?').get(key);
    return typeof row?.json === 'string' ? JSON.parse(row.json) : null;
  }
  private setMeta(key: string, value: unknown): void { this.db.prepare('INSERT OR REPLACE INTO metadata(key,json) VALUES(?,?)').run(key, JSON.stringify(value)); }
  private transaction<T>(work: () => T): T {
    if (this.db.isTransaction) return work();
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  session(): z.infer<typeof sessionSchema> {
    const id = this.meta('session');
    if (typeof id !== 'string') throw new Error('Local session is unavailable.');
    const session = decode(this.db.prepare('SELECT json FROM local_sessions WHERE id=?').get(id), sessionSchema);
    if (!session) throw new Error('Local session is unavailable.');
    return session;
  }
  proposalScope(run: Run): string | undefined {
    if (run.source === 'live' || !run.sessionId) return undefined;
    const session = decode(this.db.prepare('SELECT json FROM local_sessions WHERE id=?').get(run.sessionId), sessionSchema);
    return session?.reset ? session.sessionId : undefined;
  }
  private accountScope(source: SourceMode): string { return source === 'live' ? source : `${source}:${this.session().sessionId}`; }
  baseline(source: SourceMode = 'snapshot'): Snapshot | null { return decode(this.db.prepare('SELECT json FROM original_captures WHERE source=?').get(source), snapshotSchema); }
  pinBaseline(source: SourceMode, snapshot: Snapshot): void {
    if (source === 'live') return;
    this.db.prepare('INSERT OR IGNORE INTO original_captures(source,json) VALUES(?,?)').run(source, JSON.stringify(snapshot));
  }
  workspace(): LocalWorkspace {
    const session = this.session(); const baseline = this.baseline();
    return { sessionId: session.sessionId, createdAt: session.createdAt, baselineSnapshotId: baseline?.id, baselineCapturedAt: baseline?.capturedAt, canReset: Boolean(baseline) };
  }
  resetLocal(expectedSessionId: string): void {
    this.transaction(() => {
      if (this.session().sessionId !== expectedSessionId) throw new Error('The local session changed. Refresh before resetting.');
      if (!this.baseline()) throw new Error('No preserved original capture is available. Run a private snapshot scan first.');
      const session = { sessionId: randomUUID(), createdAt: new Date().toISOString(), reset: true };
      this.db.prepare('INSERT INTO local_sessions(id,json) VALUES(?,?)').run(session.sessionId, JSON.stringify(session));
      this.setMeta('session', session.sessionId); this.setMeta('activeRun', null);
      for (const source of ['snapshot', 'demo'] as const) { const baseline = this.baseline(source); if (baseline) this.seedAccounts(source, baseline.accounts); }
    });
  }
  saveRunInput(runId: string, input: Snapshot): void { this.db.prepare('INSERT INTO run_inputs(run_id,json) VALUES(?,?)').run(runId, JSON.stringify(input)); }
  hasEvidence(runId: string): boolean { return Boolean(this.db.prepare('SELECT 1 FROM run_evidence WHERE run_id=? UNION ALL SELECT 1 FROM run_inputs WHERE run_id=? LIMIT 1').get(runId, runId)); }
  private events(runId: string): ReviewEvent[] { return this.db.prepare('SELECT json FROM review_events WHERE run_id=? ORDER BY rowid').all(runId).map(row => decode(row, eventSchema)).filter(item => item !== null); }
  private frozenProposals(runId: string): Proposal[] | null {
    const bundle = decode(this.db.prepare('SELECT json FROM run_evidence WHERE run_id=?').get(runId), bundleSchema);
    const proposals = bundle?.proposals ?? decode(this.db.prepare('SELECT json FROM legacy_run_views WHERE run_id=?').get(runId), z.array(proposalSchema));
    if (!proposals) return null;
    const events = this.events(runId);
    return proposals.map(proposal => {
      const event = events.findLast(event => event.proposalId === proposal.id);
      return event ? { ...proposal, status: event.status, error: ['failed', 'stale', 'uncertain'].includes(event.status) ? event.detail : undefined, ...(event.resultAccountId ? { resultAccountId: event.resultAccountId } : {}) } : proposal;
    });
  }
  runs(): RunSummary[] { return this.db.prepare('SELECT json FROM runs ORDER BY created DESC,rowid DESC').all().map(row => decode(row, runSchema)).filter(run => run !== null).map(run => ({ ...run, evidenceAvailable: this.hasEvidence(run.id), proposalCount: this.proposals(run.id).length })); }
  runDetail(id: string): RunDetail | null {
    const run = this.getRun(id); if (!run) return null;
    const bundle = decode(this.db.prepare('SELECT json FROM run_evidence WHERE run_id=?').get(id), bundleSchema);
    const input = bundle?.input ?? decode(this.db.prepare('SELECT json FROM run_inputs WHERE run_id=?').get(id), snapshotSchema);
    const result = decode(this.db.prepare('SELECT json FROM local_results WHERE run_id=? ORDER BY rowid DESC LIMIT 1').get(id), resultSchema);
    return { run, evidenceQuality: input ? 'complete' : 'legacy-partial', input, proposals: this.proposals(id), comparisons: bundle?.comparisons ?? [], events: this.events(id), result, actionable: this.latestRun()?.id === id && run.status === 'ready' && (run.source === 'live' || run.sessionId === this.session().sessionId) };
  }
  withWriteRun(runId: string | null): void { this.writeRunId = runId; }
  writeLocalAccount(source: SourceMode, account: Account): void {
    this.transaction(() => {
      this.putAccount(source, account);
      if (source === 'live' || !this.writeRunId) return;
      const result = { accounts: this.accounts(source), at: new Date().toISOString() };
      this.db.prepare('INSERT INTO local_results(id,run_id,json) VALUES(?,?,?)').run(randomUUID(), this.writeRunId, JSON.stringify(result));
    });
  }

}
