import { z } from "zod";
import type {
  AppState,
  Account,
  RunDetail,
  DecisionRequest,
  Proposal,
  Run,
  Schedule,
  ScheduleInput,
  SourceMode,
} from "../../shared/contracts";
const source = z.enum(["demo", "snapshot", "live"]);
const counter = z.object({
  completed: z.number(),
  total: z.number().nullable(),
});
const runSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  source,
  sessionId: z.string().optional(),
  status: z.enum(["running", "ready", "failed"]),
  phase: z.enum(["scrape", "compare", "review"]),
  startedAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().optional(),
  progress: z.object({ website: counter, crm: counter, compare: counter }),
  message: z.string(),
  errors: z.array(z.string()),
  etaSeconds: z.number().nullable(),
  snapshotId: z.string().optional(),
}) satisfies z.ZodType<Run>;
const ruleCodeSchema = z.enum([
  "field_update",
  "new_account",
  "duplicate",
  "ownership_change",
  "identity_ambiguity",
  "competing_accounts",
  "billing_ambiguity",
  "missing_from_website",
  "incomplete_sources",
  "unchanged",
]);
const proposalSchema = z.object({
  id: z.string(),
  revision: z.string(),
  runId: z.string(),
  source,
  kind: z.enum([
    "update",
    "create",
    "duplicate",
    "chow",
    "needs_review",
    "unchanged",
  ]),
  ruleCode: ruleCodeSchema.optional(),
  status: z.enum([
    "pending",
    "approved",
    "rejected",
    "applying",
    "applied",
    "stale",
    "failed",
    "uncertain",
  ]),
  title: z.string(),
  accountId: z.string().optional(),
  locationId: z.string().optional(),
  reason: z.string(),
  changes: z.array(
    z.object({
      field: z.string(),
      label: z.string(),
      before: z.unknown(),
      after: z.unknown(),
    }),
  ),
  evidence: z.array(
    z.object({
      label: z.string(),
      detail: z.string(),
      url: z.string().optional(),
    }),
  ),
  warnings: z.array(z.string()),
  current: z.record(z.string(), z.unknown()),
  proposed: z.record(z.string(), z.unknown()),
  billing: z
    .object({
      lifetimeRevenue: z.number().nullable(),
      outstandingAr: z.number().nullable(),
      protected: z.boolean(),
    })
    .optional(),
  error: z.string().optional(),
  resultAccountId: z.string().optional(),
}) satisfies z.ZodType<Proposal>;
const scheduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  workflowId: z.string(),
  time: z.string(),
  timezone: z.string(),
  source,
  enabled: z.boolean(),
  cron: z.string(),
  lastRunAt: z.string().optional(),
  nextRunAt: z.string().optional(),
  cadence: z
    .enum(["once", "hourly", "daily", "weekly", "biweekly", "monthly"])
    .optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
}) satisfies z.ZodType<Schedule>;
const runSummarySchema = runSchema.extend({
  evidenceAvailable: z.boolean(),
  proposalCount: z.number(),
});
const accountSchema = z
  .object({
    account_id: z.string(),
    name: z.string(),
    parent_id: z.string(),
    parent_name: z.string().optional(),
    billing_street: z.string(),
    billing_city: z.string(),
    billing_state: z.string(),
    billing_zip: z.string(),
    care_type: z.string(),
    status: z.string(),
    phone: z.string(),
    lifetime_revenue: z.union([z.number(), z.string(), z.null()]),
    outstanding_ar: z.union([z.number(), z.string(), z.null()]),
    chow_current_account: z.string(),
    duplicate_of_account: z.string(),
    note: z.string(),
    updated_at: z.string().optional(),
    created_by_candidate: z.boolean().optional(),
  })
  .catchall(z.unknown()) satisfies z.ZodType<Account>;
const snapshotSchema = z.object({
  id: z.string(),
  capturedAt: z.string(),
  accounts: z.array(accountSchema),
  locations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      street: z.string(),
      city: z.string(),
      state: z.string(),
      zip: z.string(),
      careOfferings: z.array(z.string()),
      phone: z.string(),
      sourceUrl: z.string(),
      fetchedAt: z.string(),
    }),
  ),
  coverage: z.object({
    websiteComplete: z.boolean(),
    crmComplete: z.boolean(),
    urls: z.array(z.string()),
    errors: z.array(z.string()),
  }),
});
const runDetailSchema = z.object({
  run: runSchema,
  evidenceQuality: z.enum(["complete", "legacy-partial"]),
  input: snapshotSchema.nullable(),
  proposals: z.array(proposalSchema),
  comparisons: z.array(
    z.object({
      id: z.string(),
      locationId: z.string().optional(),
      accountId: z.string().optional(),
      candidates: z.array(
        z.object({
          accountId: z.string(),
          disposition: z.enum([
            "selected",
            "possible",
            "duplicate",
            "historical",
          ]),
          signals: z.array(z.string()),
          fields: z.array(
            z.object({
              field: z.string(),
              label: z.string(),
              website: z.unknown(),
              crm: z.unknown(),
              relation: z.enum([
                "equal",
                "normalized_equal",
                "different",
                "missing",
                "not_comparable",
              ]),
            }),
          ),
        }),
      ),
      proposalIds: z.array(z.string()),
      ruleCodes: z.array(ruleCodeSchema),
    }),
  ),
  events: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      runId: z.string(),
      proposalId: z.string(),
      status: proposalSchema.shape.status,
      detail: z.string(),
      resultAccountId: z.string().optional(),
    }),
  ),
  result: z
    .object({ accounts: z.array(accountSchema), at: z.string() })
    .nullable(),
  actionable: z.boolean(),
}) satisfies z.ZodType<RunDetail>;
const stateSchema = z.object({
  runs: z.array(runSummarySchema).optional(),
  localWorkspace: z
    .object({
      sessionId: z.string(),
      createdAt: z.string(),
      baselineSnapshotId: z.string().optional(),
      baselineCapturedAt: z.string().optional(),
      canReset: z.boolean(),
    })
    .nullable()
    .optional(),
  workflows: z.array(z.object({ id: z.string(), name: z.string() })),
  run: runSchema.nullable(),
  proposals: z.array(proposalSchema),
  history: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      proposalId: z.string(),
      title: z.string(),
      action: z.string(),
      source,
      detail: z.string(),
    }),
  ),
  schedules: z.array(scheduleSchema),
  settings: z.object({
    credentialsConfigured: z.boolean(),
    liveWritesEnabled: z.boolean(),
    snapshotAvailable: z.boolean(),
  }),
}) satisfies z.ZodType<AppState>;
export const configSchema = z.object({
  cron: z.string(),
  command: z.string(),
  timezone: z.string(),
  note: z.string(),
});
export type CronConfig = z.infer<typeof configSchema>;
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const controller = body === undefined ? new AbortController() : undefined;
  const timer = controller
    ? setTimeout(() => controller.abort(), 10000)
    : undefined;
  const unexpectedResponse =
    "The server returned an unexpected response. Refresh or check the server logs.";
  try {
    const response = await fetch(
      `/api${path}`,
      body === undefined
        ? { cache: "no-store", signal: controller?.signal }
        : {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new Error(
        response.ok
          ? unexpectedResponse
          : `Request failed (${response.status}).`,
      );
    }
    if (!response.ok) {
      const error = z.object({ error: z.string() }).safeParse(json);
      throw new Error(
        error.success ? error.data.error : `Request failed (${response.status}).`,
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Error(unexpectedResponse);
    return parsed.data;
  } catch (error) {
    if (controller?.signal.aborted)
      throw new Error("The request timed out. Try again.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export const api = {
  state: () => request("/state", stateSchema),
  runs: () => request("/runs", z.array(runSummarySchema)),
  runDetail: (id: string) =>
    request(`/runs/${encodeURIComponent(id)}`, runDetailSchema),
  resetLocal: (expectedSessionId: string) =>
    request("/local-working-copy/reset", stateSchema, { expectedSessionId }),
  run: (mode: SourceMode) =>
    request("/runs", runSchema, { source: mode, workflowId: "bellhaven" }),
  decide: (id: string, body: DecisionRequest) =>
    request(
      `/proposals/${encodeURIComponent(id)}/decision`,
      proposalSchema,
      body,
    ),
  saveSchedule: (body: ScheduleInput, id?: string) =>
    request(
      id ? `/schedules/${encodeURIComponent(id)}` : "/schedules",
      scheduleSchema,
      body,
      id ? "PATCH" : "POST",
    ),
  config: (id: string) =>
    request(`/schedules/${encodeURIComponent(id)}/config`, configSchema),
};

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Try again.";
}
