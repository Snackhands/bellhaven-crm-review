# Bellhaven CRM Review

A local app that scrapes Bellhaven locations, compares them with CRM accounts, and proposes changes for human approval. Approved changes are written through the CRM API and read back for verification.

## Run locally

Requires Node 24 and npm.

```sh
git clone https://github.com/Snackhands/bellhaven-crm-review.git
cd bellhaven-crm-review
npm ci
npm --prefix web ci
cp .env.example .env
```

Enter your authorized `CRM_TOKEN` in `.env`, then run `npm start`. Open [localhost:3001](http://localhost:3001). The server binds to the local computer only. Without a token, the app starts with configuration guidance. Tokens, captured records and the SQLite database are excluded from Git.

`LIVE_WRITES_ENABLED=false` is the default. To enable real approvals, set it to `true` in `.env` and restart. Each real change still requires explicit confirmation in the app. Scanning and scheduling never approve changes.

## Workflow

1. **Scrape.** Run workflow collects fresh website pages and paginated CRM accounts. Inspect the source tables and actual collection progress.
2. **Compare.** Inspect candidate accounts, field differences and evidence supporting each proposed action.
3. **Review.** Expand a proposal, inspect its before/after values and approve or reject it. Approval rechecks current evidence, writes only the proposed changes, and verifies the result through the API.

Run history preserves inputs, proposals and review events. A new browser session starts with an empty workspace; previous runs remain available in history. The How it works tab explains the business rules.

## Matching and business rules

- Match identity using address, locality, care offerings, phone and name evidence across all CRM parents. A name alone is insufficient. Conflicting candidates remain manual findings.
- Normalize street abbreviations, phone formatting and care-label aliases. Do not replace a billing PO Box merely because the website lists a physical address.
- Propose supported field corrections and missing accounts. Website absence alone proposes `Needs Review` with an explanatory note; it does not establish sale or closure.
- A supported duplicate is marked `Inactive`, linked through `duplicate_of_account`, and given an explanatory note. The app does not merge or delete records.
- Before changing ownership, inspect `lifetime_revenue` and `outstanding_ar`. If both are positive, create a clean account under the correct parent and change only the old account's `chow_current_account` link. Preserve the old account's parent, finances and other fields. If either financial value is zero, re-parent the existing account directly. Unknown financial values block the operation.
- Outgoing CRM statuses are only `Active`, `Inactive` and `Needs Review`.

## Safe reruns and recovery

Decisions and execution steps persist in SQLite. Unchanged rejected proposals are not presented for decision again. Applied changes reconcile as unchanged; materially changed evidence can generate a new proposal.

Stale approvals stop before writing. Failed patches are checked through readback. Interrupted ownership changes retain the new account ID so a retry resumes linking without creating another account. An unresolved account-creation result blocks further creation until investigated; it is never blindly retried.

Browser reads time out after ten seconds. State polling reconnects automatically, and failed evidence loads retry after two seconds. Errors show readable messages or HTTP status codes. These retries never replay CRM mutations.

The API has no documented atomic conditional-write or idempotency mechanism. Avoid simultaneous manual CRM edits while approving. There is no live CRM reset. Keep the local state database if review history and rejection decisions must survive a move to another machine.

## Daily scheduling

Create a named schedule in the sidebar and choose its timezone, start date and cadence. Daily is supported alongside once, hourly, weekly, biweekly and monthly. Schedules only prepare a review queue.

The app checks schedules every 15 seconds while running. [The cron example](config/daily-scan.example) checks saved schedules every minute and can run while the app is stopped. Configure its project directory and Node/npm path before installing it.

The computer must be awake. Missed minutes are not backfilled, and failed scans require another run. A busy app may miss a schedule if it remains busy for the full due minute. See [scheduler verification and limits](docs/SCHEDULER-QA.md).

## Verification

```sh
npm test
npm --prefix web test
npm run typecheck
npm --prefix web run build
```

The verified version passes **108 backend tests and 162 interface tests**. Tests use synthetic fixtures, local databases and mocked or local HTTP services. They cover matching, billing preservation, duplicates, stale approvals, uncertain writes, reruns, restart recovery, recurrence and interface recovery. See [verification summary](docs/VERIFICATION.md).

Built with TypeScript, Node 24, Express, SQLite, React and Vite. AI assisted implementation and review. Reused UI components are documented in [Tool Rack provenance](docs/TOOL-RACK-PROVENANCE.md).
