# Bellhaven CRM Review

Assessment brief and implementation handoff for a small, human-reviewed CRM reconciliation system.

**Current status: context only. No application has been built, no authenticated CRM snapshot has been fetched, and no CRM records have been changed by this project.**

## Start here on the MacBook

Open this repository in Codex on the MacBook where the application will be demonstrated. Read this document before implementing. The prior chat is not required; this file preserves the task requirements and agreed approach.

Suggested opening instruction:

> Read README.md and inspect the local environment. Help me build the smallest complete solution for this assessment on this MacBook. First explain the concrete plan briefly and arrange local credential entry. Inspect the actual website and CRM data before choosing matching rules. Explain consequential decisions in plain language as we build. Keep all CRM mutations behind explicit review-app approval. Leave the real review queue available for my narrated recording, then help me finish and verify the corrected CRM. Track actual time honestly.

The user wants to understand the system well enough to explain its rules, inspect its results, and direct a small live change. Use concise explanations and familiar tables/workflow concepts. AI-assisted implementation is explicitly permitted. Do not imply the user independently wrote code they did not write.

## Assignment and deliverables

This is the Clipboard Sales Operations Analyst take-home assessment. Bellhaven Senior Living is a fictional operator; the token selects the candidate's isolated CRM sandbox, containing approximately 120 accounts of mixed quality.

- Expected effort is approximately two focused hours; deadline is 48 hours after workspace registration. The exact registration time/deadline has not been captured here: establish it with the user rather than assuming an extension.
- Scrape every Bellhaven location: name, address, city, state, ZIP, and care offerings.
- Match locations to existing CRM accounts and classify confident matches, matches needing corrections, missing accounts, and accounts currently under Bellhaven that no longer appear on the website.
- Build a small local review app displaying each proposed change and supporting evidence. Support approval and rejection. Nothing writes to the CRM without approval.
- Include daily schedule configuration, such as a cron example or GitHub Actions workflow. It does not need to be active. Daily collection and comparison must preserve the human approval gate.
- Reruns must be safe and must not re-propose unchanged items that have already been decided, including rejected proposals.
- The finished deliverable includes the **corrected CRM**, not merely an application or a pending queue. The user must review and apply justified changes before submission.
- Submit a repository or accepted file-sharing link, a roughly two-minute narrated demo link, actual time spent, and a short writeup explaining matching, choices, and AI use. The user will handle their writeup and narration, with assistance as requested.
- The recording must show a few proposals and their evidence, at least one approval and one rejection, and an approved change appearing in the CRM browser. Record while genuine proposals remain available; do not fabricate review history for the video. The video link must be viewable by anyone with the link.
- The assignment specifies a 45-minute live walkthrough with a demonstration, explanation, and a small live system change. Do not assume the change is limited to input data or UI sorting. Whether AI tools are permitted in the live interview is not yet confirmed.

## Sources and access

- Website: https://analyst-assessment-production.up.railway.app
- Community directory: https://analyst-assessment-production.up.railway.app/communities
- API base: https://analyst-assessment-production.up.railway.app/api/v1
- Interactive docs: https://analyst-assessment-production.up.railway.app/api/docs
- OpenAPI schema: https://analyst-assessment-production.up.railway.app/api/openapi.json

The personal token and personal CRM-browser URL are intentionally absent from this repository. Obtain them from the user's assessment workspace through local configuration. The CRM browser is read-only; mutations use the API. Inspect the supplied curl example to establish the exact authentication header rather than guessing it.

Public inspection on November 1, 2026 found:

- The homepage advertised 35 communities, but the directory reported 34 across three pages.
- The homepage linked a newly welcomed community, Bellhaven Meadows of Findlay. Investigate the count discrepancy and all relevant links; these observations do not establish the final correct total.
- The API exposed GET/POST accounts, GET/PATCH individual accounts, contact endpoints, and GET /me. Account listing supports page and page_size as well as filters.
- The OpenAPI schema did not fully describe account request/response bodies. Inspect authenticated read responses and supplied instructions before designing mutations.
- The user observed 29 child accounts under Bellhaven. This was not independently verified and may change. A count difference does not tell us how many accounts to create.

Refresh these observations during implementation. Do not hardcode counts, IDs, expected fixes, or facility-specific answers.

## Required CRM rules

Accounts are records for both companies and facilities. A facility's parent_id points to a company account's ID. A matching name alone does not establish identity or ownership.

Valid statuses are Active, Inactive, and Needs Review. The note field holds explanations. There is no merge or delete operation.

For a supported duplicate conclusion, choose a surviving account. On the losing account, set duplicate_of_account to the survivor's ID and set status to Inactive. Explain the selection and preserve unrelated fields. Distinguish a duplicate from an intentionally preserved historical billing account.

### Billing / change of ownership (CHOW)

Before moving an account to a different parent, inspect lifetime_revenue and outstanding_ar. AR means accounts receivable, not annual recurring revenue.

If **lifetime_revenue > 0 AND outstanding_ar > 0**:

1. Do not re-parent the old account.
2. Preserve its existing fields, including financial values, name, parent, status, and notes.
3. Create a new facility account under the correct parent.
4. Set only chow_current_account on the OLD account to the new account's ID.

Otherwise, re-parent the existing account directly if the evidence and approval support doing so. Do not copy historical revenue or receivables into the new account. Unknown or malformed financial values must not silently become zero.

Enforce this rule at execution time using current CRM values. If a fresh read changes the proposed action, stop and regenerate for review instead of silently applying a materially different action.

## Implementation approach

Keep the architecture small and understandable. No technology stack has been selected. Prefer a straightforward local app, explicit rules, and durable local decision storage over unnecessary infrastructure. No paid provider or LLM calls inside the pipeline are required.

1. Fetch all required CRM pages and website pages into local snapshots with timestamps and source URLs.
2. Develop and test matching against those snapshots to avoid unnecessary network requests.
3. Normalize names and addresses while retaining original evidence. Use multiple identity signals and examine competing candidates; name similarity alone is insufficient.
4. Search across the entire account set, not only Bellhaven's current children. A facility may already exist under an old owner or old name.
5. Show current values, proposed values, source evidence, reasoning, uncertainty, and billing consequences in the review app. Distinguish unchanged matches from actionable proposals.
6. On approval, re-read affected records, check preconditions, execute the approved operation, read back the result, and persist its outcome.
7. Store stable proposal identities, approved/rejected decisions, and execution progress durably. Explain how genuinely changed evidence produces a new review without resurfacing an unchanged rejected proposal.
8. Rerun against fresh data and verify previously decided items do not return and no extra accounts are created.

A daily scan discovers discrepancies; it does not grant permission to write. A website omission alone does not prove sale or closure. Incomplete scraping must not generate confident removal decisions. Use Needs Review where uncertainty warrants it and explain what evidence is missing.

## Focused failure checks

- Failed or partial scraping: flag the run and prevent false conclusions from missing pages.
- Ambiguous matches or duplicates: expose competing evidence instead of guessing.
- CRM changes since proposal creation: invalidate stale proposals when relevant fields differ.
- Failed/timed-out writes: check whether the operation landed before retrying.
- CHOW creation succeeds but linking fails: retain the new ID and recover without creating a second account.
- Repeated approvals, rejected proposals, and restarted processes: durable state prevents repeated operations.
- Relevant source changes after a decision: distinguish new evidence from an identical proposal.

Test these meaningful risks with local fixtures or mocked writes before the user works through their real review queue. Do not test destructive scenarios on their assessed CRM state.

## Finish checklist

- [ ] Complete location discovery and explain any count discrepancy.
- [ ] Fetch and inspect the complete CRM dataset.
- [ ] Working scraper, matching logic, and evidence-backed review app.
- [ ] Billing, duplicate, approval, retry, and persistent-decision behavior verified.
- [ ] Schedule configuration included but not activated without a request.
- [ ] User records the narrated approve/reject demonstration.
- [ ] User reviews remaining proposals and applies justified corrections.
- [ ] Readback confirms expected CRM changes and preserved billing history.
- [ ] Fresh rerun demonstrates safe behavior.
- [ ] README updated with actual setup, usage, architecture, tests, and limitations.
- [ ] Time report, writeup, repo link, and viewable video link prepared.

## Repository hygiene

Keep tokens, local environment files, personal workspace URLs, CRM snapshots, decision databases, logs, and recordings out of the public repository. Commit code, documentation, safe synthetic fixtures, and configuration examples. Scan the staged diff before publishing. This initial commit contains handoff documentation only; do not present it as an implemented or validated system.
