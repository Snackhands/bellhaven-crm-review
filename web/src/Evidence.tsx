import { useState } from "react";
import { Select } from "@tool-shed/tool-rack";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Minus,
  TriangleAlert,
} from "lucide-react";
import type {
  Account,
  ComparisonField,
  RunDetail,
  Snapshot,
} from "../../shared/contracts";
import { displayValue, safeUrl } from "./progress";
import { RuleFlag, RuleLegend, rules } from "./rules";

function stamp(value?: string) {
  return value ? new Date(value).toLocaleString() : "Time not recorded";
}
function SourceLink({ value }: { value: unknown }) {
  const url = typeof value === "string" ? safeUrl(value) : undefined;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      Source <ExternalLink size={12} />
    </a>
  ) : (
    <span className="muted">Not recorded</span>
  );
}
function matches(record: object, query: string) {
  return Object.values(record).some((value) =>
    displayValue(value).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
}
export function SourceTables({ detail }: { detail: RunDetail | null }) {
  const [websiteQuery, setWebsiteQuery] = useState("");
  const [crmQuery, setCrmQuery] = useState("");
  const snapshot = detail?.input;
  if (!snapshot)
    return (
      <div className="source-tables">
        <p className="notice">
          {detail?.run.status === "running"
            ? "Collection in progress. Captured records will appear when this run saves its input."
            : detail?.evidenceQuality === "legacy-partial"
              ? "Legacy run: captured input was not recorded. Historical source tables are unavailable."
              : "Captured records will appear here when this run has saved its input."}
        </p>
        <section className="card evidence-card">
          <div className="evidence-heading-row">
            <h2>Website locations</h2>
          </div>
          <p className="empty-evidence">No website records captured.</p>
        </section>
        <section className="card evidence-card">
          <div className="evidence-heading-row">
            <h2>CRM accounts</h2>
          </div>
          <p className="empty-evidence">No CRM accounts captured.</p>
        </section>
      </div>
    );
  const locations = snapshot.locations.filter((location) =>
    matches(location, websiteQuery),
  );
  const accounts = snapshot.accounts.filter((account) =>
    matches(account, crmQuery),
  );
  return (
    <div className="source-tables">
      <section className="card evidence-card">
        <div className="evidence-heading-row">
          <div>
            <h2>Website locations</h2>
            <p>
              {locations.length} of {snapshot.locations.length} records ·
              captured {stamp(snapshot.capturedAt)}
            </p>
          </div>
          <label className="search-field">
            Search website
            <input
              type="search"
              value={websiteQuery}
              onChange={(event) => setWebsiteQuery(event.target.value)}
              placeholder="Name, address, care…"
            />
          </label>
        </div>
        {!snapshot.coverage.websiteComplete && (
          <p className="notice warning">Website collection is incomplete.</p>
        )}
        <div className="table-scroll">
          <table className="source-table">
            <thead>
              <tr>
                <th>Name / ID</th>
                <th>Address</th>
                <th>Care / phone</th>
                <th>Fetched / source</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((location) => (
                <tr key={location.id}>
                  <th scope="row">
                    {location.name}
                    <small>{location.id}</small>
                  </th>
                  <td>
                    {location.street}
                    <small>
                      {[location.city, location.state, location.zip]
                        .filter(Boolean)
                        .join(", ")}
                    </small>
                  </td>
                  <td>
                    {location.careOfferings.join(", ")}
                    <small>{location.phone || "No phone recorded"}</small>
                  </td>
                  <td>
                    {stamp(location.fetchedAt)}
                    <small>
                      <SourceLink value={location.sourceUrl} />
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!locations.length && (
          <p className="empty-evidence">
            No website records match this search.
          </p>
        )}
      </section>
      <section className="card evidence-card">
        <div className="evidence-heading-row">
          <div>
            <h2>CRM accounts</h2>
            <p>
              {accounts.length} of {snapshot.accounts.length} records · captured{" "}
              {stamp(snapshot.capturedAt)}
            </p>
          </div>
          <label className="search-field">
            Search CRM
            <input
              type="search"
              value={crmQuery}
              onChange={(event) => setCrmQuery(event.target.value)}
              placeholder="Account, parent, address…"
            />
          </label>
        </div>
        {!snapshot.coverage.crmComplete && (
          <p className="notice warning">CRM collection is incomplete.</p>
        )}
        <AccountTable accounts={accounts} />
        {!accounts.length && (
          <p className="empty-evidence">No CRM accounts match this search.</p>
        )}
      </section>
      <details className="coverage-details">
        <summary>Collection sources and coverage</summary>
        <p>
          Snapshot {snapshot.id} · Website{" "}
          {snapshot.coverage.websiteComplete ? "complete" : "incomplete"} · CRM{" "}
          {snapshot.coverage.crmComplete ? "complete" : "incomplete"}
        </p>
        {snapshot.coverage.urls.map((url) => (
          <div key={url}>
            <SourceLink value={url} />
          </div>
        ))}
        {snapshot.coverage.errors.map((error, index) => (
          <p className="notice error" key={index}>
            {error}
          </p>
        ))}
      </details>
    </div>
  );
}
export function AccountTable({ accounts }: { accounts: Account[] }) {
  return (
    <div className="table-scroll">
      <table className="source-table">
        <thead>
          <tr>
            <th>Account / parent</th>
            <th>Address / care</th>
            <th>Status / billing</th>
            <th>Recorded details</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.account_id}>
              <th scope="row">
                {account.name}
                <small>
                  {account.account_id} ·{" "}
                  {account.parent_name || account.parent_id || "No parent"}
                </small>
              </th>
              <td>
                {account.billing_street}
                <small>
                  {[
                    account.billing_city,
                    account.billing_state,
                    account.billing_zip,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </small>
                <small>
                  {account.care_type} · {account.phone || "No phone"}
                </small>
              </td>
              <td>
                {account.status}
                <small>Revenue {displayValue(account.lifetime_revenue)}</small>
                <small>AR {displayValue(account.outstanding_ar)}</small>
              </td>
              <td>
                <details>
                  <summary>All fields</summary>
                  <dl className="record-fields">
                    {Object.entries(account).map(([field, value]) => (
                      <div key={field}>
                        <dt>{field.replaceAll("_", " ")}</dt>
                        <dd>{displayValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
                <small>Updated {stamp(account.updated_at)}</small>
                <SourceLink
                  value={account.sourceUrl ?? account.source_url ?? account.url}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const relations: Record<
  ComparisonField["relation"],
  { text: string; color: string; icon: typeof Check }
> = {
  equal: { text: "Exact match", color: "#526454", icon: Check },
  normalized_equal: { text: "Normalized match", color: "#526454", icon: Check },
  different: { text: "Different", color: "#235ca0", icon: ArrowRight },
  missing: { text: "Missing value", color: "#825608", icon: TriangleAlert },
  not_comparable: { text: "Not comparable", color: "#506073", icon: Minus },
};
function comparisonTitle(
  detail: RunDetail,
  locationId?: string,
  accountId?: string,
) {
  return (
    detail.input?.locations.find((location) => location.id === locationId)
      ?.name ??
    detail.input?.accounts.find((account) => account.account_id === accountId)
      ?.name ??
    (locationId
      ? locationId
      : accountId
        ? `CRM-only · ${accountId}`
        : "Source coverage")
  );
}
export function ComparisonView({ detail }: { detail: RunDetail | null }) {
  const [selectedId, setSelectedId] = useState("");
  if (!detail?.comparisons.length)
    return (
      <p className="notice">
        {detail?.run.status === "running"
          ? "Comparison in progress. Field differences will appear when matching finishes."
          : detail?.evidenceQuality === "legacy-partial"
            ? "This legacy run has no recorded field comparisons."
            : "Field comparisons appear after the engine finishes matching."}
      </p>
    );
  const selected =
    detail.comparisons.find((comparison) => comparison.id === selectedId) ??
    detail.comparisons[0];
  const source = detail.input?.locations.find(
    (location) => location.id === selected.locationId,
  );
  const associated = detail.proposals.filter((proposal) =>
    selected.proposalIds.includes(proposal.id),
  );
  return (
    <section className="card evidence-card comparison-view">
      <div className="evidence-heading-row">
        <div>
          <h2>Compare captured records</h2>
          <p>
            {detail.comparisons.length} recorded comparisons · matching comes
            from the engine
          </p>
        </div>
        <label>
          Location or CRM-only finding
          <Select
            aria-label="Comparison location"
            value={selected.id}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {detail.comparisons.map((comparison) => (
              <option value={comparison.id} key={comparison.id}>
                {comparisonTitle(
                  detail,
                  comparison.locationId,
                  comparison.accountId,
                )}
                {!comparison.locationId && comparison.accountId
                  ? " · CRM only"
                  : ""}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="comparison-context">
        <div>
          <strong>
            {source
              ? source.name
              : selected.accountId
                ? "CRM-only record"
                : "Collection coverage"}
          </strong>
          <p>
            {source
              ? [source.street, source.city, source.state, source.zip]
                  .filter(Boolean)
                  .join(", ")
              : selected.accountId
                ? "No matching location was found on the captured website. Absence alone does not establish closure."
                : "The engine recorded a source-level finding."}
          </p>
          {source && <SourceLink value={source.sourceUrl} />}
        </div>
        <div className="rule-flags">
          {selected.ruleCodes.map((code) => (
            <RuleFlag code={code} key={code} />
          ))}
        </div>
      </div>
      {selected.candidates.map((candidate) => {
        const account = detail.input?.accounts.find(
          (item) => item.account_id === candidate.accountId,
        );
        const color = selected.ruleCodes[0]
          ? rules[selected.ruleCodes[0]].color
          : "#506073";
        return (
          <article
            className="candidate-comparison"
            key={candidate.accountId}
            style={{ borderColor: color }}
          >
            <div className="candidate-heading">
              <strong>{account?.name ?? candidate.accountId}</strong>
              <span className="badge">{candidate.disposition}</span>
              <small>
                {candidate.accountId}
                {account
                  ? ` · ${account.parent_name || account.parent_id || "No parent"}`
                  : ""}
              </small>
            </div>
            <ul className="match-signals">
              {candidate.signals.map((signal, index) => (
                <li key={index}>
                  <Check size={13} />
                  {signal}
                </li>
              ))}
            </ul>
            <div className="table-scroll">
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Website capture</th>
                    <th>Relationship</th>
                    <th>CRM capture</th>
                  </tr>
                </thead>
                <tbody>
                  {candidate.fields.map((field) => {
                    const relation = relations[field.relation];
                    const Icon = relation.icon;
                    return (
                      <tr
                        key={field.field}
                        className={`relation-${field.relation}`}
                      >
                        <th scope="row">{field.label}</th>
                        <td>{displayValue(field.website)}</td>
                        <td
                          className="comparison-connector"
                          style={{ color: relation.color }}
                        >
                          <svg
                            viewBox="0 0 120 12"
                            preserveAspectRatio="none"
                            aria-hidden="true"
                          >
                            <path
                              d="M1 6 H119"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeDasharray={
                                field.relation === "missing" ||
                                field.relation === "not_comparable"
                                  ? "4 4"
                                  : undefined
                              }
                            />
                            <circle cx="2" cy="6" r="2" fill="currentColor" />
                            <circle cx="118" cy="6" r="2" fill="currentColor" />
                          </svg>
                          <span>
                            <Icon size={12} />
                            {relation.text}
                          </span>
                        </td>
                        <td>{displayValue(field.crm)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        );
      })}
      {!selected.candidates.length && (
        <p className="notice">
          No CRM candidate was recorded for this finding.
        </p>
      )}
      <div className="comparison-justification">
        <h3>Why this route</h3>
        {associated.map((proposal) => (
          <div key={proposal.id}>
            <RuleFlag code={proposal.ruleCode} />
            <p>{proposal.reason}</p>
            {proposal.warnings.map((warning, index) => (
              <p className="notice warning" key={index}>
                {warning}
              </p>
            ))}
          </div>
        ))}
      </div>
      <RuleLegend />
    </section>
  );
}
function changedFields(before: Account | undefined, after: Account) {
  return Object.keys(after).filter(
    (key) => JSON.stringify(before?.[key]) !== JSON.stringify(after[key]),
  );
}
function ActualChanges({
  input,
  accounts,
}: {
  input: Snapshot;
  accounts: Account[];
}) {
  return (
    <>
      {accounts.map((after) => {
        const before = input.accounts.find(
          (account) => account.account_id === after.account_id,
        );
        const fields = changedFields(before, after);
        if (!fields.length) return null;
        return (
          <details className="actual-account" key={after.account_id} open>
            <summary>
              {after.name} · {after.account_id} ·{" "}
              {before
                ? `${fields.length} changed fields`
                : "New recorded account"}
            </summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Before this run</th>
                    <th>Actual recorded result</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field) => (
                    <tr key={field}>
                      <th scope="row">{field.replaceAll("_", " ")}</th>
                      <td>{displayValue(before?.[field])}</td>
                      <td className="changed-value">
                        {displayValue(after[field])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
    </>
  );
}
export function ActualResult({ detail }: { detail: RunDetail | null }) {
  const [showAll, setShowAll] = useState(false);
  const result = detail?.result;
  if (!result || !detail?.input)
    return (
      <section className="card evidence-card actual-result">
        <h2>Actual local result</h2>
        <p>
          No actual account result has been recorded for this run yet. Proposed
          changes above are awaiting a recorded result.
        </p>
      </section>
    );
  const changed = result.accounts.filter(
    (account) =>
      changedFields(
        detail.input?.accounts.find(
          (before) => before.account_id === account.account_id,
        ),
        account,
      ).length > 0,
  );
  return (
    <section className="card evidence-card actual-result">
      <div className="evidence-heading-row">
        <div>
          <h2>Actual local result</h2>
          <p>
            Recorded {stamp(result.at)} · {result.accounts.length} accounts ·{" "}
            {changed.length} changed since this run's input
          </p>
        </div>
        <button className="secondary" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show changes" : "Show all result accounts"}
        </button>
      </div>
      <p className="notice">
        These are the recorded account values after local execution, including
        any partial progress.
      </p>
      {showAll ? (
        <AccountTable accounts={result.accounts} />
      ) : (
        <>
          <ActualChanges input={detail.input} accounts={changed} />
          {!changed.length && (
            <p>No account values differ from this run's captured input.</p>
          )}
        </>
      )}
      {detail.events.length > 0 && (
        <details className="result-events">
          <summary>
            Run decision and execution events · {detail.events.length}
          </summary>
          {detail.events.map((event) => (
            <p key={event.id}>
              {stamp(event.at)} · {event.status === "applied" ? "Approved · " : event.status === "rejected" ? "Rejected · " : ""}
              {event.detail}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
