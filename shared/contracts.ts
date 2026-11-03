export type SourceMode = 'demo' | 'snapshot' | 'live';
export type Phase = 'scrape' | 'compare' | 'review';
export type Account = {
  account_id: string; name: string; parent_id: string; parent_name?: string;
  billing_street: string; billing_city: string; billing_state: string; billing_zip: string;
  care_type: string; status: string; phone: string;
  lifetime_revenue: number | string | null; outstanding_ar: number | string | null;
  chow_current_account: string; duplicate_of_account: string; note: string;
  updated_at?: string; created_by_candidate?: boolean;
  [key: string]: unknown;
};
export type Location = {
  id: string; name: string; street: string; city: string; state: string; zip: string;
  careOfferings: string[]; phone: string; sourceUrl: string; fetchedAt: string;
};
export type Counter = { completed: number; total: number | null };
export type CollectionProgress = {
  website: Counter; crm: Counter; message: string;
};
export type Snapshot = {
  id: string; capturedAt: string; locations: Location[]; accounts: Account[];
  coverage: { websiteComplete: boolean; crmComplete: boolean; urls: string[]; errors: string[] };
};
export type CollectOptions = {
  websiteUrl: string; apiBase: string; token: string; outputDir: string;
  onProgress?: (progress: CollectionProgress) => void;
};
export type Run = {
  id: string; workflowId: string; source: SourceMode;
  sessionId?: string;
  status: 'running' | 'ready' | 'failed'; phase: Phase;
  startedAt: string; updatedAt: string; finishedAt?: string;
  progress: { website: Counter; crm: Counter; compare: Counter };
  message: string; errors: string[]; etaSeconds: number | null; snapshotId?: string;
};
export type ProposalKind = 'update' | 'create' | 'duplicate' | 'chow' | 'needs_review' | 'unchanged';
export type RuleCode = 'field_update' | 'new_account' | 'duplicate' | 'ownership_change' | 'identity_ambiguity' | 'competing_accounts' | 'billing_ambiguity' | 'missing_from_website' | 'incomplete_sources' | 'unchanged';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'applying' | 'applied' | 'stale' | 'failed' | 'uncertain';
export type FieldChange = { field: string; label: string; before: unknown; after: unknown };
export type Evidence = { label: string; detail: string; url?: string };
export type Proposal = {
  id: string; revision: string; runId: string; source: SourceMode; kind: ProposalKind;
  ruleCode?: RuleCode;
  status: ProposalStatus; title: string; accountId?: string; locationId?: string;
  reason: string; changes: FieldChange[]; evidence: Evidence[]; warnings: string[];
  current: Record<string, unknown>; proposed: Record<string, unknown>;
  billing?: { lifetimeRevenue: number | null; outstandingAr: number | null; protected: boolean };
  error?: string; resultAccountId?: string;
};
export type HistoryEntry = { id: string; at: string; proposalId: string; title: string; action: string; source: SourceMode; detail: string };
export type Schedule = {
  id: string; name: string; workflowId: string; time: string; timezone: string;
  source: SourceMode; enabled: boolean; cron: string; lastRunAt?: string; nextRunAt?: string;
  cadence?: 'once' | 'hourly' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
  startDate?: string; endDate?: string;
};
export type ScheduleInput = Omit<Schedule, 'id' | 'cron' | 'lastRunAt' | 'nextRunAt' | 'endDate'> & { endDate?: string | null };
export type ComparisonField = {
  field: string; label: string; website: unknown; crm: unknown;
  relation: 'equal' | 'normalized_equal' | 'different' | 'missing' | 'not_comparable';
};
export type ComparisonCandidate = {
  accountId: string; disposition: 'selected' | 'possible' | 'duplicate' | 'historical';
  signals: string[]; fields: ComparisonField[];
};
export type Comparison = {
  id: string; locationId?: string; accountId?: string;
  candidates: ComparisonCandidate[]; proposalIds: string[]; ruleCodes: RuleCode[];
};
export type RunSummary = Run & { evidenceAvailable: boolean; proposalCount: number };
export type ReviewEvent = {
  id: string; at: string; runId: string; proposalId: string;
  status: ProposalStatus; detail: string; resultAccountId?: string;
};
export type RunDetail = {
  run: Run; evidenceQuality: 'complete' | 'legacy-partial'; input: Snapshot | null;
  proposals: Proposal[]; comparisons: Comparison[]; events: ReviewEvent[];
  result: { accounts: Account[]; at: string } | null; actionable: boolean;
};
export type LocalWorkspace = {
  sessionId: string; createdAt: string; baselineSnapshotId?: string;
  baselineCapturedAt?: string; canReset: boolean;
};
export type Workflow = { id: string; name: string };
export type AppState = {
  workflows: Workflow[]; run: Run | null; proposals: Proposal[]; history: HistoryEntry[];
  schedules: Schedule[];
  runs?: RunSummary[]; localWorkspace?: LocalWorkspace | null;
  settings: { credentialsConfigured: boolean; liveWritesEnabled: boolean; snapshotAvailable: boolean };
};
export type DecisionRequest = { decision: 'approve' | 'reject'; revision: string; runId: string; confirmLive?: boolean };

