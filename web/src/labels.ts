import type { SourceMode, Proposal, Phase } from "../../shared/contracts";
export const sourceLabels: Record<SourceMode, string> = {
  demo: "Internal fixture",
  snapshot: "Saved snapshot",
  live: "Fresh data",
};
export const kindLabels: Record<Proposal["kind"], string> = {
  update: "Update",
  create: "New account",
  duplicate: "Duplicate",
  chow: "Ownership change",
  needs_review: "Needs inspection",
  unchanged: "Unchanged",
};
export const stageDescriptions: Record<Phase, string> = {
  scrape:
    "Collect website locations and all CRM accounts. Source errors remain visible and block unsafe proposals.",
  compare:
    "Match identities across parents using address, phone, name and care offerings. Ambiguous matches need inspection.",
  review:
    "Inspect the exact field changes and evidence. Only your explicit approval can apply a change.",
};
