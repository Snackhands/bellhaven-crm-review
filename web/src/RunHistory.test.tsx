import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppState, RunDetail } from "../../shared/contracts";
import App from "./App";
import { recordedDetail } from "./test-fixtures";
let current: RunDetail;
let old: RunDetail;
let state: AppState;
let requests: { path: string; body?: Record<string, unknown> }[];
beforeEach(() => {
  current = recordedDetail();
  old = recordedDetail();
  old.run.id = "old-run";
  old.run.sessionId = "old-session";
  old.run.startedAt = "2026-11-02T15:00:00Z";
  old.proposals = old.proposals.map((proposal) => ({
    ...proposal,
    id: "old-proposal",
    runId: "old-run",
    title: "Historical proposal",
  }));
  old.actionable = false;
  state = {
    workflows: [{ id: "bellhaven", name: "Bellhaven" }],
    run: current.run,
    proposals: current.proposals,
    runs: [current, old].map((detail) => ({
      ...detail.run,
      evidenceAvailable: true,
      proposalCount: detail.proposals.length,
    })),
    history: [],
    schedules: [],
    localWorkspace: {
      sessionId: "session-a",
      createdAt: current.run.startedAt,
      baselineCapturedAt: "2026-11-01T00:00:00Z",
      canReset: true,
    },
    settings: {
      snapshotAvailable: true,
      credentialsConfigured: false,
      liveWritesEnabled: false,
    },
  };
  requests = [];
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options?: RequestInit) => {
      const body = options?.body ? JSON.parse(String(options.body)) : undefined;
      requests.push({ path, body });
      if (path === "/api/state") return Response.json(state);
      if (path === "/api/runs/run-a") return Response.json(current);
      if (path === "/api/runs/old-run") return Response.json(old);
      if (path.endsWith("/decision"))
        return Response.json(current.proposals[0]);
      return Response.json(
        { error: "Unknown fixture request" },
        { status: 404 },
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function openSavedLatest() {
  const user = userEvent.setup();
  await screen.findByText("Local workspace connected");
  await user.click(screen.getByText("Run history"));
  await user.selectOptions(screen.getByRole("combobox", { name: "Saved run" }), "run-a");
}
describe("saved runs and local session", () => {
  it("shows only completed decision labels in history and preserves all event explanations and times", async () => {
    const statuses = ["pending", "approved", "applying", "failed", "uncertain", "stale", "applied", "rejected"] satisfies RunDetail["events"][number]["status"][];
    current.events = statuses.map((status, index) => ({
      id: `event-${index}`, at: current.run.startedAt, runId: current.run.id,
      proposalId: "proposal-a", status, detail: `Event explanation ${index}.`,
    }));
    render(<App />);
    await openSavedLatest();
    await screen.findAllByText(/Event explanation 0/);
    const rows = document.querySelectorAll(".history-row");
    expect(rows).toHaveLength(statuses.length);
    statuses.forEach((status, index) => {
      const row = rows[index];
      const text = row.querySelector("p")?.textContent ?? "";
      expect(text).toContain(`Event explanation ${index}.`);
      expect(text.includes("Approved")).toBe(status === "applied");
      expect(text.includes("Rejected")).toBe(status === "rejected");
      expect(text).not.toMatch(new RegExp(`\\b${status}\\b`));
      expect(row.querySelector("time")?.getAttribute("dateTime")).toBe(current.run.startedAt);
    });
    expect(requests.some((request) => request.path.endsWith("/decision"))).toBe(false);
  });
  it("loads immutable historical evidence and offers no decision controls", async () => {
    old.actionable = true;
    const user = userEvent.setup();
    render(<App />);
    await openSavedLatest();
    await screen.findByText("Recorded proposal");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Saved run" }),
      "old-run",
    );
    await screen.findByText("Historical proposal");
    await user.click(screen.getByText("Historical proposal"));
    expect(screen.getByText("Historical · read-only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Scrape" }));
    expect(screen.getByText("Captured website")).toBeTruthy();
    expect(requests.some((request) => request.path.endsWith("/decision"))).toBe(
      false,
    );
  });
  it("treats missing input as pending while running and preserves completed legacy warnings", async () => {
    current.run.status = "running";
    current.run.phase = "scrape";
    current.input = null;
    current.comparisons = [];
    current.proposals = [];
    current.evidenceQuality = "legacy-partial";
    current.actionable = false;
    state.proposals = [];
    state.runs = [
      { ...current.run, evidenceAvailable: false, proposalCount: 0 },
      {
        ...old.run,
        status: "running",
        evidenceAvailable: false,
        proposalCount: 0,
      },
    ];
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/Collection in progress.*saves its input/);
    await user.click(screen.getByText("Run history"));
    expect(screen.queryByText(/Legacy run/)).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Saved run" }).textContent,
    ).not.toContain("legacy partial");
    await user.click(screen.getByRole("button", { name: "Compare" }));
    expect(
      screen.getByText(/Comparison in progress.*matching finishes/),
    ).toBeTruthy();
    current.run.status = "ready";
    current.run.updatedAt = "2026-11-03T15:01:00Z";
    await screen.findByText(/Legacy run · only the evidence actually recorded/);
    expect(
      screen.getByText("This legacy run has no recorded field comparisons."),
    ).toBeTruthy();
  });
  it("keeps selected-run events separate from today's workspace history", async () => {
    old.events = [
      {
        id: "old-event",
        at: old.run.startedAt,
        runId: old.run.id,
        proposalId: "old-proposal",
        status: "rejected",
        detail: "Historical decision evidence",
      },
    ];
    state.history = [
      {
        id: "current-event",
        at: current.run.startedAt,
        proposalId: "proposal-a",
        title: "Current workspace event",
        action: "applied",
        source: "snapshot",
        detail: "Today's unrelated event",
      },
    ];
    const user = userEvent.setup();
    render(<App />);
    await openSavedLatest();
    await screen.findByText("Recorded proposal");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Saved run" }),
      "old-run",
    );
    await screen.findAllByText(/Historical decision evidence/);
    expect(screen.getAllByText(/Historical decision evidence/)).toHaveLength(2);
    expect(screen.queryByText(/Today's unrelated event/)).toBeNull();
  });
  it("sends the current run identity with the exact revision", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSavedLatest();
    await user.click(await screen.findByText("Recorded proposal"));
    const reject = await screen.findByRole("button", { name: "Reject" });
    await waitFor(() => expect(reject.hasAttribute("disabled")).toBe(false));
    await user.click(reject);
    expect(
      requests.find((request) => request.path.endsWith("/decision"))?.body,
    ).toEqual({ decision: "reject", revision: "revision-a", runId: "run-a" });
  });
  it("keeps the saved latest run read-only when the server disallows decisions", async () => {
    current.actionable = false;
    const user = userEvent.setup();
    render(<App />);
    await openSavedLatest();
    await user.click(await screen.findByText("Recorded proposal"));
    expect(screen.getByText("Read-only run")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(requests.some((request) => request.path.endsWith("/decision"))).toBe(false);
  });
  it("offers no reset control or reset request while keeping saved sessions", async () => {
    const user = userEvent.setup();
    render(<App />);
    await openSavedLatest();
    await screen.findByText("Recorded proposal");
    expect(screen.queryByRole("button", { name: /Reset/ })).toBeNull();
    await user.click(screen.getByText("Run history"));
    expect(screen.getByRole("combobox", { name: "Saved run" }).textContent).toContain("Saved snapshot");
    expect(requests.some((request) => request.path.includes("reset"))).toBe(false);
    expect(state.runs).toHaveLength(2);
  });
  it("keeps selection and actual results collapsed inside Run history, with no empty result card", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Local workspace connected");
    const history = screen.getByText("Run history").closest("details");
    expect(history?.open).toBe(false);
    expect(history?.querySelector("summary .badge")?.textContent).toBe("2");
    expect(screen.getByRole("combobox", { name: "Saved run" }).closest(".history-panel")).toBe(history);
    await openSavedLatest();
    await screen.findByText("Recorded proposal");
    await waitFor(() => expect(document.querySelector(".recorded-result")?.hasAttribute("open")).toBe(false));
    expect(document.querySelector(".actual-result")?.closest(".history-panel")).toBe(history);
    expect(screen.getAllByText("Saved snapshot").some((label) => label.closest(".workspace-heading"))).toBe(true);
    await user.click(screen.getByText("Run history"));
    expect(screen.getByRole("combobox", { name: "Saved run" })).toBeTruthy();
    current.result = null;
    current.run.updatedAt = "2026-11-03T15:03:00Z";
    await waitFor(() => expect(document.querySelector(".actual-result")).toBeNull(), { timeout: 2000 });
    expect(screen.queryByText(/No actual account result/)).toBeNull();
  });
  it("uses active run busy state during history inspection and follows the selected latest run", async () => {
    current.run.status = "running";
    current.run.phase = "scrape";
    current.run.progress.website = { completed: 1, total: 2 };
    current.run.progress.crm = { completed: 0, total: null };
    current.run.progress.compare = { completed: 0, total: null };
    current.actionable = false;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Local workspace connected");
    await user.click(screen.getByText("Run history"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Saved run" }), "old-run");
    await screen.findByText("Historical · read-only");
    expect(screen.getByRole("button", { name: "Running" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("progressbar", { name: "review stage progress" }).getAttribute("aria-valuenow")).toBe("0");
    current.run.phase = "compare";
    current.run.updatedAt = "2026-11-03T15:04:00Z";
    await waitFor(() => expect(requests.filter(({ path }) => path === "/api/state").length).toBeGreaterThan(1), { timeout: 2000 });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Review");
    await user.selectOptions(screen.getByRole("combobox", { name: "Saved run" }), "run-a");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Compare");
    current.run.phase = "review";
    current.run.updatedAt = "2026-11-03T15:05:00Z";
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Review"), { timeout: 2000 });
    expect(screen.queryByText("Historical · read-only")).toBeNull();
  });
  it("blocks decisions while a current run detail is unavailable", async () => {
    vi.mocked(fetch).mockImplementation(async (path) =>
      path === "/api/state"
        ? Response.json(state)
        : Response.json({ error: "Evidence unavailable" }, { status: 409 }),
    );
    const user = userEvent.setup();
    render(<App />);
    await openSavedLatest();
    await user.click(await screen.findByText("Recorded proposal"));
    await screen.findByText(/Could not load this run's evidence/);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });
});
