import type { Account, RunDetail } from "../../shared/contracts";
// Synthetic fixtures stay in tests; no source capture is copied here.
export const account: Account = {
  account_id: "crm-a",
  name: "Captured CRM",
  parent_id: "parent-a",
  billing_street: "Old recorded street",
  billing_city: "Test City",
  billing_state: "TS",
  billing_zip: "00000",
  care_type: "Care",
  phone: "555-0100",
  status: "Active",
  lifetime_revenue: 30,
  outstanding_ar: 4,
  chow_current_account: "",
  duplicate_of_account: "",
  note: "",
};
export function recordedDetail(): RunDetail {
  return {
    run: {
      id: "run-a",
      workflowId: "bellhaven",
      sessionId: "session-a",
      source: "snapshot",
      status: "ready",
      phase: "review",
      startedAt: "2026-11-03T15:00:00Z",
      updatedAt: "2026-11-03T15:00:01Z",
      progress: {
        website: { completed: 1, total: 1 },
        crm: { completed: 1, total: 1 },
        compare: { completed: 1, total: 1 },
      },
      message: "Captured",
      errors: [],
      etaSeconds: null,
    },
    evidenceQuality: "complete",
    input: {
      id: "snapshot-a",
      capturedAt: "2026-11-03T14:59:00Z",
      locations: [
        {
          id: "site-a",
          name: "Captured website",
          street: "Site street",
          city: "Test City",
          state: "TS",
          zip: "00000",
          phone: "555-0100",
          careOfferings: ["Care"],
          sourceUrl: "https://example.com/site-a",
          fetchedAt: "2026-11-03T14:58:00Z",
        },
      ],
      accounts: [account],
      coverage: {
        websiteComplete: true,
        crmComplete: true,
        urls: ["https://example.com/directory"],
        errors: [],
      },
    },
    proposals: [
      {
        id: "proposal-a",
        revision: "revision-a",
        runId: "run-a",
        source: "snapshot",
        kind: "update",
        ruleCode: "field_update",
        status: "pending",
        title: "Recorded proposal",
        reason:
          "Engine-established identity uses exact local phone and address.",
        changes: [
          {
            field: "billing_street",
            label: "Street",
            before: "Old recorded street",
            after: "PROPOSED ONLY",
          },
        ],
        warnings: [],
        evidence: [],
        current: account,
        proposed: { billing_street: "PROPOSED ONLY" },
      },
    ],
    comparisons: [
      {
        id: "comparison-a",
        locationId: "site-a",
        candidates: [
          {
            accountId: "crm-a",
            disposition: "possible",
            signals: ["Recorded engine signal"],
            fields: [
              {
                field: "billing_street",
                label: "Street",
                website: "Server comparison website value",
                crm: "Server comparison CRM value",
                relation: "different",
              },
              {
                field: "phone",
                label: "Phone",
                website: "555-0100",
                crm: "5550100",
                relation: "normalized_equal",
              },
            ],
          },
        ],
        proposalIds: ["proposal-a"],
        ruleCodes: ["field_update"],
      },
    ],
    events: [],
    result: {
      at: "2026-11-03T15:02:00Z",
      accounts: [{ ...account, billing_street: "ACTUALLY RECORDED" }],
    },
    actionable: true,
  };
}
