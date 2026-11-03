import {
  Check,
  ChevronDown,
  LockKeyhole,
  ShieldCheck,
  ExternalLink,
  X,
} from "lucide-react";
import type { FieldChange, Proposal } from "../../shared/contracts";
import { displayValue, flattenRecord, safeUrl } from "./progress";
import { kindLabels, sourceLabels } from "./labels";
import { RuleFlag } from "./rules";
import { InfoTip } from "./ui";

const fieldLabels: Record<string, string> = {
  parent_id: "Parent account",
  billing_street: "Street",
  billing_city: "City",
  billing_state: "State",
  billing_zip: "ZIP",
  care_type: "Care offerings",
  lifetime_revenue: "Lifetime revenue",
  outstanding_ar: "Outstanding AR",
  chow_current_account: "Current CHOW account",
  duplicate_of_account: "Duplicate of",
};
function fieldLabel(field: string): string {
  const label = fieldLabels[field] ?? field.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
function structuredFields(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? flattenRecord(value)
    : null;
}
function ChangeRows({
  change,
  current,
}: {
  change: FieldChange;
  current: Record<string, unknown>;
}) {
  const before = structuredFields(change.before);
  const after = structuredFields(change.after);
  if (!before && !after) {
    return (
      <tr>
        <th scope="row">{change.label}</th>
        <td>{displayValue(change.before)}</td>
        <td className="changed-value">{displayValue(change.after)}</td>
      </tr>
    );
  }
  const keys = Array.from(
    new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  );
  return (
    <>
      <tr className="change-group">
        <th colSpan={3}>{change.label}</th>
      </tr>
      {keys.map((key) => (
        <tr key={key}>
          <th scope="row">{fieldLabel(key)}</th>
          <td>
            {displayValue(
              before?.[key] ??
                (change.field === "oldAccountPatch"
                  ? current[`oldAccount.${key}`]
                  : undefined),
            )}
          </td>
          <td className="changed-value">{displayValue(after?.[key])}</td>
        </tr>
      ))}
    </>
  );
}
export default function ProposalCard({
  proposal: p,
  decide,
  busy,
  liveEnabled,
  readOnly = false,
}: {
  proposal: Proposal;
  decide: (p: Proposal, decision: "approve" | "reject") => void;
  busy: boolean;
  liveEnabled: boolean;
  readOnly?: boolean;
}) {
  const pending = p.status === "pending";
  const resumable = p.status === "failed" || p.status === "applying";
  const actionable = !readOnly && (pending || resumable);
  const approvalAllowed =
    actionable &&
    p.kind !== "needs_review" &&
    p.kind !== "unchanged" &&
    (p.source !== "live" || liveEnabled);
  const current = flattenRecord(p.current);
  const proposed = flattenRecord(p.proposed);
  const currentKeys = Object.keys(current);
  const proposedKeys = Object.keys(proposed);
  return (
    <details className={`proposal-card status-${p.status}`}>
      <summary>
        <span className="proposal-chevron">
          <ChevronDown size={22} />
        </span>
        <span className="proposal-name">
          {p.title}
          <span className="proposal-kind">{kindLabels[p.kind]}</span>
        </span>
        <RuleFlag code={p.ruleCode} />
        {p.billing?.protected && (
          <span className="badge brass">
            <LockKeyhole size={13} />
            Billing protected
          </span>
        )}
        {(p.status === "applied" || p.status === "rejected") && (
          <span className="badge">
            {p.status === "applied" ? "Approved" : "Rejected"}
          </span>
        )}
      </summary>
      <div className="proposal-body">
        {readOnly && (
          <p className="notice">
            Read-only evidence. Decisions are available only on the active run.
          </p>
        )}
        <p className="reason">{p.reason}</p>
        {p.warnings.map((warning, i) => (
          <p className="notice warning" key={i}>
            <ShieldCheck size={17} />
            {warning}
          </p>
        ))}
        {p.error && (
          <p className="notice error" role="alert">
            {p.error}
          </p>
        )}
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Current</th>
                <th>Proposed</th>
              </tr>
            </thead>
            <tbody>
              {p.changes.map((change) => (
                <ChangeRows
                  key={change.field}
                  change={change}
                  current={current}
                />
              ))}
            </tbody>
          </table>
        </div>
        {p.changes.length === 0 && (
          <p className="muted">No field changes are proposed.</p>
        )}
        {p.billing && (
          <div className="billing">
            <LockKeyhole size={16} />
            <span>
              Lifetime revenue{" "}
              <strong>
                {p.billing.lifetimeRevenue === null
                  ? "Unknown"
                  : p.billing.lifetimeRevenue.toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                    })}
              </strong>
            </span>
            <span>
              Outstanding AR{" "}
              <strong>
                {p.billing.outstandingAr === null
                  ? "Unknown"
                  : p.billing.outstandingAr.toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                    })}
              </strong>
            </span>
          </div>
        )}
        <div className="evidence-heading">
          <strong>Evidence</strong>
          <InfoTip label="evidence">
            Evidence comes from this run's sources. Approval rechecks live
            records and billing safeguards before writing.
          </InfoTip>
        </div>
        <ul className="evidence-list">
          {p.evidence.map((item, i) => (
            <li key={i}>
              <Check size={16} />
              <span>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </span>
              {safeUrl(item.url) && (
                <a href={safeUrl(item.url)} target="_blank" rel="noreferrer">
                  Source <ExternalLink size={13} />
                </a>
              )}
            </li>
          ))}
        </ul>
        {(currentKeys.length > 0 || proposedKeys.length > 0) && (
          <details className="record-details">
            <summary>Full record comparison</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Current</th>
                    <th>Proposed</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(new Set([...currentKeys, ...proposedKeys])).map(
                    (key) => (
                      <tr key={key}>
                        <th scope="row">
                          {key
                            .replace("successor.", "New account · ")
                            .replace("oldAccount.", "Protected account · ")
                            .replaceAll("_", " ")}
                        </th>
                        <td>{displayValue(current[key])}</td>
                        <td>{displayValue(proposed[key])}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </details>
        )}
        {p.resultAccountId && (
          <p className="muted">Result account: {p.resultAccountId}</p>
        )}
        <div className="proposal-footer">
          <span className="proposal-revision muted">
            {sourceLabels[p.source]}
            <InfoTip label="proposal revision">
              Exact revision {p.revision}. Approval is tied to this revision;
              changed records require fresh review.
            </InfoTip>
          </span>
          {actionable && p.kind !== "unchanged" && (
            <div className="button-row">
              {pending && (
                <button
                  className="secondary reject-button"
                  onClick={() => decide(p, "reject")}
                  disabled={busy}
                >
                  <X size={16} />
                  Reject
                </button>
              )}
              <button
                onClick={() => decide(p, "approve")}
                disabled={!approvalAllowed || busy}
              >
                <Check size={16} />
                {p.source === "live"
                  ? resumable
                    ? "Review retry"
                    : "Review approval"
                  : resumable
                    ? "Resume change"
                    : "Approve"}
              </button>
            </div>
          )}
        </div>
        {actionable && p.source === "live" && !liveEnabled && (
          <p className="notice warning">
            Live writes are disabled on the server.
          </p>
        )}
        {p.status === "uncertain" && (
          <p className="notice warning">
            The write outcome is uncertain. Inspect current CRM records before
            starting a new scan.
          </p>
        )}
        {p.status === "stale" && (
          <p className="notice warning">
            Records changed after this proposal. Run the workflow again to
            prepare a fresh review.
          </p>
        )}
        {p.kind === "needs_review" && (
          <p className="notice warning">
            This match needs manual investigation. Automatic approval is
            unavailable.
          </p>
        )}
      </div>
    </details>
  );
}
