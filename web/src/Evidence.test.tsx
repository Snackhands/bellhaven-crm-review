import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Proposal } from "../../shared/contracts";
import { ActualResult, ComparisonView, SourceTables } from "./Evidence";
import { RuleFlag, rules } from "./rules";
import ProposalCard from "./ProposalCard";
import Guide from "./Guide";
import { installGuideBrowserAPIs } from "./guide-test-browser";

import { recordedDetail } from "./test-fixtures";
const decisionCases = [
  ["pending", null],
  ["approved", null],
  ["applying", null],
  ["failed", null],
  ["uncertain", null],
  ["stale", null],
  ["applied", "Approved"],
  ["rejected", "Rejected"],
] satisfies [Proposal["status"], string | null][];
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("recorded evidence", () => {
  it.each(decisionCases)("shows only a completed decision label for a %s proposal", (status, label) => {
    const proposal = { ...recordedDetail().proposals[0], status, error: "Inspect the recorded evidence before continuing." };
    render(<ProposalCard proposal={proposal} decide={() => undefined} busy={false} liveEnabled={false} />);
    const summary = document.querySelector(".proposal-card > summary");
    expect(summary?.querySelector(".badge")?.textContent ?? null).toBe(label);
    expect(screen.queryByText(status, { exact: true })).toBeNull();
    expect(screen.getByText("Field update")).toBeTruthy();
    expect(screen.getByRole("alert", { hidden: true }).textContent).toBe(proposal.error);
    expect(screen.getByText(proposal.reason)).toBeTruthy();
  });
  it.each(decisionCases)("keeps actual-result event explanation and time without a %s enum label", (status, label) => {
    const detail = recordedDetail();
    const at = "2026-11-03T15:03:00Z";
    detail.events = [{ id: "event-a", at, runId: detail.run.id, proposalId: "proposal-a", status, detail: "Recorded execution explanation." }];
    render(<ActualResult detail={detail} />);
    const event = document.querySelector(".result-events > p");
    expect(event?.textContent).toBe(`${new Date(at).toLocaleString()} · ${label ? `${label} · ` : ""}Recorded execution explanation.`);
    expect(screen.queryByText(status, { exact: true })).toBeNull();
  });
  it("renders empty source cards without fabricated capture metadata", () => {
    render(<SourceTables detail={null} />);
    expect(screen.getByRole("heading", { name: "Website locations" }).closest(".card")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "CRM accounts" }).closest(".card")).toBeTruthy();
    expect(screen.getByText("No website records captured.")).toBeTruthy();
    expect(screen.getByText("No CRM accounts captured.")).toBeTruthy();
    expect(screen.queryByText(/Snapshot|captured at|Time not recorded/)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("searches captured tables and preserves source links, counts and times", async () => {
    const user = userEvent.setup();
    render(<SourceTables detail={recordedDetail()} />);
    expect(screen.getByText("Captured website")).toBeTruthy();
    expect(screen.getAllByText("Captured CRM")[0]).toBeTruthy();
    expect(screen.getAllByText(/1 of 1 records/)).toHaveLength(2);
    expect(
      screen.getAllByRole("link", { name: "Source" })[0].getAttribute("href"),
    ).toBe("https://example.com/site-a");
    await user.type(
      screen.getByRole("searchbox", { name: "Search website" }),
      "no matching record",
    );
    expect(screen.getByText(/0 of 1 records/)).toBeTruthy();
    expect(screen.queryByText("Captured website")).toBeNull();
    expect(screen.getAllByText("Captured CRM")[0]).toBeTruthy();
  });
  it("uses backend comparisons and explains relationships without rematching", () => {
    render(<ComparisonView detail={recordedDetail()} />);
    expect(screen.getByText("Server comparison website value")).toBeTruthy();
    expect(screen.getByText("Server comparison CRM value")).toBeTruthy();
    expect(screen.getByText("Recorded engine signal")).toBeTruthy();
    expect(screen.getByText("Different")).toBeTruthy();
    expect(screen.getByText("Normalized match")).toBeTruthy();
    expect(screen.getByText("possible")).toBeTruthy();
    expect(screen.getByText(/Engine-established identity/)).toBeTruthy();
    expect(
      document.querySelectorAll(".comparison-connector > svg > path"),
    ).toHaveLength(2);
  });
  it("shows CRM-only absence without claiming closure", () => {
    const detail = recordedDetail();
    detail.comparisons[0] = {
      id: "absent",
      accountId: "crm-a",
      candidates: [],
      proposalIds: [],
      ruleCodes: ["missing_from_website"],
    };
    render(<ComparisonView detail={detail} />);
    expect(screen.getByText("CRM-only record")).toBeTruthy();
    expect(
      screen.getByText(/Absence alone does not establish closure/),
    ).toBeTruthy();
  });
  it("shows actual result values separately from unapplied proposals", () => {
    render(<ActualResult detail={recordedDetail()} />);
    expect(screen.getByText("Old recorded street")).toBeTruthy();
    expect(screen.getByText("ACTUALLY RECORDED")).toBeTruthy();
    expect(screen.queryByText("PROPOSED ONLY")).toBeNull();
    expect(screen.getByText(/including any partial progress/)).toBeTruthy();
  });
  it("shows pending collection and comparison evidence for an in-progress run", () => {
    const detail = recordedDetail();
    detail.run.status = "running";
    detail.input = null;
    detail.comparisons = [];
    detail.evidenceQuality = "legacy-partial";
    render(
      <>
        <SourceTables detail={detail} />
        <ComparisonView detail={detail} />
      </>,
    );
    expect(
      screen.getByText(/Collection in progress.*saves its input/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Comparison in progress.*matching finishes/),
    ).toBeTruthy();
    expect(screen.queryByText(/legacy/i)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("never invents evidence or account results for legacy runs", () => {
    const detail = recordedDetail();
    detail.input = null;
    detail.result = null;
    detail.evidenceQuality = "legacy-partial";
    render(
      <>
        <SourceTables detail={detail} />
        <ActualResult detail={detail} />
      </>,
    );
    expect(
      screen.getByText(/Historical source tables are unavailable/),
    ).toBeTruthy();
    expect(screen.getByText(/No actual account result/)).toBeTruthy();
    expect(screen.queryByText("PROPOSED ONLY")).toBeNull();
  });
  it("uses the same rule colors and icons in review and branching guide; Reject is red", async () => {
    installGuideBrowserAPIs();
    const user = userEvent.setup();
    const detail = recordedDetail();
    render(
      <>
        <RuleFlag code="field_update" />
        <ProposalCard
          proposal={detail.proposals[0]}
          decide={() => undefined}
          busy={false}
          liveEnabled={false}
        />
        <Guide />
      </>,
    );
    await user.click(screen.getByText("Recorded proposal"));
    expect(
      screen
        .getByRole("button", { name: "Reject" })
        .classList.contains("reject-button"),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Explore Compare" }));
    const route = screen.getByLabelText("Business rule routes");
    await user.click(within(route).getByRole("button", { name: "Field update" }));
    expect(within(screen.getByLabelText("Selected explanation")).getByText(rules.field_update.route)).toBeTruthy();
    for (const flag of screen.getAllByText("Field update").filter((element) => element.closest(".rule-flag"))) {
      expect(flag.closest(".rule-flag")?.getAttribute("style")).toContain(
        rules.field_update.color.replace("#235ca0", "rgb(35, 92, 160)"),
      );
      expect(flag.querySelector("svg")).toBeTruthy();
    }
  });
});
