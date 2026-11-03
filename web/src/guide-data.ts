import type { RuleCode } from "../../shared/contracts";

export type GuideNode = {
  id: string;
  label: string;
  kind: "input" | "process" | "decision" | "output";
  column: number;
  row: number;
  detail: string;
  rules?: readonly RuleCode[];
};
export type GuideEdge = { from: string; to: string; label: string };
export type GuideStage = {
  id: "scrape" | "compare" | "review";
  title: string;
  summary: string;
  output: string;
  nodes: readonly [GuideNode, ...GuideNode[]];
  edges: readonly GuideEdge[];
};

export const guideStages: readonly GuideStage[] = [
  {
    id: "scrape", title: "Scrape", summary: "Read both sources. Check coverage.", output: "Website + CRM source tables",
    nodes: [
      { id: "website", label: "Public website", kind: "input", column: 0, row: 0, detail: "A live run discovers location links from the public website and directory pages. It captures location names, full addresses, phone numbers and care offerings with their source URLs." },
      { id: "crm", label: "CRM API", kind: "input", column: 2, row: 0, detail: "A live run reads every CRM account page across all parents, without a facility-name filter. It captures account IDs, parent relationships, contact fields, care offerings, revenue, AR, status and links needed for comparison." },
      { id: "capture", label: "Save source evidence", kind: "process", column: 1, row: 1, detail: "The run saves the collected website locations and CRM accounts as inspectable source tables. A saved snapshot run replays the preserved local capture. Replay does not make fresh website or CRM requests." },
      { id: "coverage", label: "Collection complete?", kind: "decision", column: 1, row: 2, detail: "The collector checks discovery, page coverage and source failures. Incomplete collection cannot establish that an account is new or absent and blocks automatic account changes." },
      { id: "incomplete", label: "Block changes", kind: "output", column: 0, row: 3, detail: "Inspect the collection issue and collect complete sources before an automatic account change can proceed.", rules: ["incomplete_sources"] },
      { id: "tables", label: "Two source tables", kind: "output", column: 2, row: 3, detail: "Open the Website and CRM source tables to inspect the actual captured rows. Complete sources feed the Compare stage. This diagram explains the workflow; it is not a live run counter." },
    ],
    edges: [
      { from: "website", to: "capture", label: "Locations" }, { from: "crm", to: "capture", label: "All accounts" },
      { from: "capture", to: "coverage", label: "Check coverage" }, { from: "coverage", to: "incomplete", label: "No" }, { from: "coverage", to: "tables", label: "Yes" },
    ],
  },
  {
    id: "compare", title: "Compare", summary: "Match identities. Explain each outcome.", output: "Proposals, inspection flags + unchanged records",
    nodes: [
      { id: "website", label: "Website table", kind: "input", column: 0, row: 0, detail: "Website names, addresses, phones and care offerings describe the current public listing. They are evidence, not permission to change an account." },
      { id: "crm", label: "CRM table", kind: "input", column: 2, row: 0, detail: "CRM records across all parents supply existing identities, relationships, billing fields and historical links." },
      { id: "identity", label: "Match identity", kind: "process", column: 1, row: 1, detail: "Compare address, phone, name and care offerings. A fuzzy name alone cannot select an account. Conflicting strong candidates or insufficient independent evidence require inspection.", rules: ["identity_ambiguity", "competing_accounts"] },
      { id: "business", label: "Check business rules", kind: "decision", column: 1, row: 2, detail: "Check competing matches, duplicate safety, parent ownership, valid revenue and AR, field differences and website coverage. Choose a rule below to see its exact route." },
      { id: "proposed", label: "Propose a change", kind: "output", column: 0, row: 3, detail: "Supported changes enter Review with their evidence and exact field differences. Website absence permits only a Needs Review flag and evidence note. No account is changed by comparison.", rules: ["field_update", "new_account", "duplicate", "ownership_change", "missing_from_website"] },
      { id: "inspect", label: "Manual inspection", kind: "output", column: 1, row: 3, detail: "Uncertain identity, competing accounts, billing ambiguity and incomplete sources block automatic account changes. Resolve the evidence before approval.", rules: ["identity_ambiguity", "competing_accounts", "billing_ambiguity", "incomplete_sources"] },
      { id: "aligned", label: "Already aligned", kind: "output", column: 2, row: 3, detail: "The established identity, fields and parent already agree. No account change, decision or approval is needed.", rules: ["unchanged"] },
    ],
    edges: [
      { from: "website", to: "identity", label: "Listing evidence" }, { from: "crm", to: "identity", label: "Account evidence" },
      { from: "identity", to: "business", label: "Candidates" }, { from: "business", to: "proposed", label: "Supported change" },
      { from: "business", to: "inspect", label: "Unresolved" }, { from: "business", to: "aligned", label: "Fields agree" },
    ],
  },
  {
    id: "review", title: "Review", summary: "Inspect evidence. Decide. Verify the result.", output: "Recorded decision + actual execution result",
    nodes: [
      { id: "evidence", label: "Open flag + evidence", kind: "input", column: 1, row: 0, detail: "Expand a review item to see the rule, matching signals, source evidence and proposed before/after fields. Inspection-only items cannot be approved; unchanged items need no decision." },
      { id: "decision", label: "Your decision", kind: "decision", column: 1, row: 1, detail: "Approval applies only to the exact proposal revision you reviewed. Live approval also requires the configured write gate and your explicit confirmation. Schedules only prepare proposals." },
      { id: "reject", label: "Record rejection", kind: "output", column: 0, row: 2, detail: "Rejection changes no account. The app durably records the decision and evidence fingerprint, so the same unchanged evidence stays rejected on a rerun and after restart. Changed evidence may create a new review." },
      { id: "recheck", label: "Recheck current record", kind: "process", column: 2, row: 2, detail: "Before execution the engine rechecks current records, identity, finances and the approved revision. Stale or changed evidence blocks the write and requires fresh review. Unknown finances stay blocked." },
      { id: "failure", label: "Stop + record issue", kind: "output", column: 1, row: 3, detail: "A failed recheck prevents the write. Execution failures or uncertain outcomes remain visible with recorded evidence. An uncertain create is not blindly retried; inspect the result before another change." },
      { id: "write", label: "Write + read back", kind: "process", column: 2, row: 3, detail: "An approved local replay writes to the private local working copy. An approved live action writes to the real CRM, then reads the actual result back. Proposed values alone are not proof of execution." },
      { id: "result", label: "Recorded result", kind: "output", column: 2, row: 4, detail: "The review history records decisions and execution status. Saved-snapshot runs also store actual account before/after results in the local working copy. Live changes are verified by readback and in the CRM browser; live runs do not store an account before/after result table. Applied changes should be aligned on a later comparison. Rejections retain their unchanged evidence. Prior history remains available when the local working copy is reset." },
    ],
    edges: [
      { from: "evidence", to: "decision", label: "Exact revision" }, { from: "decision", to: "reject", label: "Reject" },
      { from: "decision", to: "recheck", label: "Approve" }, { from: "recheck", to: "failure", label: "Stale / blocked" },
      { from: "recheck", to: "write", label: "Valid" }, { from: "write", to: "failure", label: "Failed / uncertain" }, { from: "write", to: "result", label: "Verified" },
    ],
  },
];
