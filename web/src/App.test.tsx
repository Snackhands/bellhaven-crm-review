import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppState, Proposal } from "../../shared/contracts";
import App from "./App";
import { recordedDetail } from "./test-fixtures";

// Synthetic records are isolated test fixtures. They are never loaded by the app.
const proposal: Proposal = {
  id: "fixture-proposal",
  revision: "revision-exact-17",
  runId: "fixture-run",
  source: "snapshot",
  kind: "update",
  status: "pending",
  title: "Fixture residence",
  reason: "Verified street and phone identify this account.",
  changes: [
    {
      field: "name",
      label: "Name",
      before: "Old fixture",
      after: "Fixture residence",
    },
  ],
  evidence: [
    {
      label: "Address and phone match",
      detail: "Synthetic test evidence",
      url: "https://example.com/fixture",
    },
  ],
  warnings: [],
  current: { name: "Old fixture" },
  proposed: { name: "Fixture residence" },
};
function fixtureState(): AppState {
  return {
    workflows: [{ id: "bellhaven", name: "Bellhaven" }],
    run: null,
    proposals: [],
    history: [],
    schedules: [],
    settings: {
      credentialsConfigured: true,
      liveWritesEnabled: false,
      snapshotAvailable: true,
    },
  };
}
let state: AppState;
let preparedStatus: Proposal["status"];
let requests: {
  path: string;
  body: Record<string, unknown> | null;
  method: string;
}[];
beforeEach(() => {
  localStorage.clear();
  state = fixtureState();
  preparedStatus = "pending";
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
      const body = options?.body ? JSON.parse(String(options.body)) : null;
      requests.push({ path, body, method: options?.method ?? "GET" });
      if (path === "/api/state") return new Response(JSON.stringify(state));
      if (path.startsWith("/api/runs/") && state.run)
        return Response.json({ ...recordedDetail(), run: state.run, proposals: state.proposals });
      if (path === "/api/runs") {
        state.run = {
          id: "fixture-run",
          workflowId: "bellhaven",
          source: "snapshot",
          phase: "review",
          status: "ready",
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          progress: {
            website: { completed: 2, total: 2 },
            crm: { completed: 7, total: 7 },
            compare: { completed: 3, total: 3 },
          },
          message: "Fixture ready",
          errors: [],
          etaSeconds: null,
        };
        state.proposals = [{ ...proposal, status: preparedStatus }];
        return new Response(JSON.stringify(state.run));
      }
      if (path.endsWith("/decision")) {
        const updated = {
          ...proposal,
          source: state.proposals[0]?.source ?? "snapshot",
          status: body.decision === "approve" ? "applied" : "rejected",
        };
        return new Response(JSON.stringify(updated));
      }
      if (path === "/api/schedules") {
        const schedule = { ...body, id: "fixture-schedule", cron: "0 9 * * *" };
        return new Response(JSON.stringify(schedule));
      }
      return new Response(
        JSON.stringify({ error: "Unknown fixture request" }),
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

async function openSavedLatest(user: ReturnType<typeof userEvent.setup>) {
  if (!state.run) throw new Error("Expected a saved fixture run");
  state.runs = [{ ...state.run, evidenceAvailable: true, proposalCount: state.proposals.length }];
  await screen.findByText("Local workspace connected");
  await user.click(screen.getByText("Run history"));
  await user.selectOptions(await screen.findByRole("combobox", { name: "Saved run" }), state.run.id);
}

describe("workspace behavior", () => {
  it("shows failed collection counters without claiming completed source stages", async () => {
    const user = userEvent.setup();
    state.run = {
      id: "failed-run",
      workflowId: "bellhaven",
      source: "snapshot",
      status: "failed",
      phase: "review",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      progress: {
        website: { completed: 1, total: 2 },
        crm: { completed: 7, total: null },
        compare: { completed: 0, total: null },
      },
      message: "Collection incomplete",
      errors: [],
      etaSeconds: null,
    };
    render(<App />);
    await openSavedLatest(user);
    await screen.findByText("Run failed");
    const scrape = screen.getByRole("button", { name: "Scrape" });
    expect(scrape.querySelector(".done")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Compare" }).querySelector(".done"),
    ).toBeNull();
    await user.click(scrape);
    expect(screen.getByText("1 / 2 pages")).toBeTruthy();
    expect(screen.getByText("7 accounts · discovering")).toBeTruthy();
    expect(
      screen.getByRole("progressbar", { name: "Website progress" }).getAttribute("aria-valuenow"),
    ).toBe("50");
    expect(
      screen.getByRole("progressbar", { name: "CRM progress" }).getAttribute("aria-valuenow"),
    ).toBe("0");
    expect(screen.queryByText("100%")).toBeNull();
    state.run.progress = {
      website: { completed: 2, total: 2 },
      crm: { completed: 7, total: 7 },
      compare: { completed: 0, total: null },
    };
    await waitFor(() =>
      expect(
        screen.getByRole("progressbar", { name: "Website progress" }).getAttribute("aria-valuenow"),
      ).toBe("100"),
    );
    expect(scrape.querySelector(".done")).toBeNull();
    expect(screen.getByText("Run failed")).toBeTruthy();
  });
  it("shows CHOW changes as separate labeled successor and old-account rows", async () => {
    const user = userEvent.setup();
    render(<App />);
    const run = await screen.findByRole("button", { name: "Run workflow" });
    await waitFor(() => expect(run.hasAttribute("disabled")).toBe(false));
    const successor = {
      name: "Fixture successor",
      parent_id: "parent-fixture",
      billing_street: "10 Fixture Lane",
      lifetime_revenue: 0,
      outstanding_ar: 0,
    };
    const oldPatch = { chow_current_account: "(new account ID)" };
    await user.click(run);
    state.proposals = [{
      ...proposal,
      kind: "chow",
      current: {
        oldAccount: {
          name: "Historical fixture",
          chow_current_account: "previous-successor-fixture",
          lifetime_revenue: 1234,
          outstanding_ar: 56,
        },
      },
      proposed: { newAccount: successor, oldAccountPatch: oldPatch },
      changes: [
        {
          field: "newAccount", label: "Create successor account",
          before: null, after: successor,
        },
        {
          field: "oldAccountPatch", label: "Only change on old account",
          before: null, after: oldPatch,
        },
      ],
      billing: { lifetimeRevenue: 1234, outstandingAr: 56, protected: true },
    }];
    await screen.findByText("Billing protected");
    await user.click(screen.getByRole("button", { name: "Review" }));
    const primaryTable = screen.getAllByRole("table", { hidden: true })[0];
    expect(within(primaryTable).getByText("Create successor account")).toBeTruthy();
    expect(within(primaryTable).getByText("Only change on old account")).toBeTruthy();
    expect(within(primaryTable).getByText("Fixture successor")).toBeTruthy();
    expect(within(primaryTable).getByText("10 Fixture Lane")).toBeTruthy();
    expect(within(primaryTable).getByText("Lifetime revenue")).toBeTruthy();
    expect(within(primaryTable).getByText("Outstanding AR")).toBeTruthy();
    expect(within(primaryTable).getByText("Current CHOW account")).toBeTruthy();
    expect(within(primaryTable).getByText("previous-successor-fixture")).toBeTruthy();
    expect(within(primaryTable).getAllByText("0")).toHaveLength(2);
    expect(screen.getByText("$1,234.00")).toBeTruthy();
    expect(screen.getByText("$56.00")).toBeTruthy();
    expect(primaryTable.textContent).not.toContain('{"');
    const oldGroup = within(primaryTable).getByText("Only change on old account").closest("tr");
    expect(oldGroup?.nextElementSibling?.textContent).toContain("Current CHOW account");
    expect(oldGroup?.nextElementSibling?.nextElementSibling).toBeNull();
  });
  it("does not start on load and always requests live even with a saved snapshot", async () => {
    const user = userEvent.setup();
    render(<App />);
    const button = await screen.findByRole("button", { name: "Run workflow" });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    expect(requests.every((request) => request.path === "/api/state")).toBe(
      true,
    );
    expect(screen.queryByText(/demo/i)).toBeNull();
    await user.click(button);
    await screen.findByText("1 to review");
    expect(screen.queryByRole("combobox", { name: "Filter proposal status" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Filter proposal kind" })).toBeTruthy();
    expect(
      requests.find((request) => request.path === "/api/runs")?.body,
    ).toEqual({ source: "live", workflowId: "bellhaven" });
    await user.click(screen.getByRole("button", { name: "Review" }));
    await user.click(screen.getAllByText("Fixture residence")[0]);
    expect(screen.getAllByText("Old fixture").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(
        requests.find((request) => request.path.endsWith("/decision"))?.body,
      ).toEqual({ decision: "approve", revision: "revision-exact-17", runId: "fixture-run" }),
    );
  });
  it.each(["pending", "failed", "applying"] satisfies Proposal["status"][])(
    "keeps live %s approval behind deliberate confirmation with the exact revision",
    async (status) => {
      const user = userEvent.setup();
      state.settings = {
        credentialsConfigured: true,
        liveWritesEnabled: true,
        snapshotAvailable: false,
      };
      state.run = {
        id: "fixture-run",
        workflowId: "bellhaven",
        source: "live",
        phase: "review",
        status: "ready",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: {
          website: { completed: 1, total: 1 },
          crm: { completed: 1, total: 1 },
          compare: { completed: 1, total: 1 },
        },
        message: "Fixture live run",
        errors: [],
        etaSeconds: null,
      };
      state.proposals = [{ ...proposal, source: "live", status }];
      render(<App />);
      await openSavedLatest(user);
      await user.click((await screen.findAllByText("Fixture residence"))[0]);
      await user.click(
        screen.getByRole("button", {
          name: status === "pending" ? "Review approval" : "Review retry",
        }),
      );
      if (status !== "pending")
        expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
      const dialog = screen.getByRole("dialog");
      const approve = within(dialog).getByRole("button", {
        name: "Approve live change",
      });
      expect(approve.hasAttribute("disabled")).toBe(true);
      expect(
        requests.some((request) => request.path.endsWith("/decision")),
      ).toBe(false);
      await user.click(within(dialog).getByRole("checkbox"));
      await user.click(approve);
      await waitFor(() =>
        expect(
          requests.find((request) => request.path.endsWith("/decision"))?.body,
        ).toEqual({
          decision: "approve",
          revision: "revision-exact-17",
          runId: "fixture-run",
          confirmLive: true,
        }),
      );
    },
  );
  it.each(["failed", "applying"] satisfies Proposal["status"][])(
    "resumes a %s saved-snapshot change without offering rejection",
    async (status) => {
      preparedStatus = status;
      const user = userEvent.setup();
      render(<App />);
      const run = await screen.findByRole("button", { name: "Run workflow" });
      await waitFor(() => expect(run.hasAttribute("disabled")).toBe(false));
      await user.click(run);
      await user.click((await screen.findAllByText("Fixture residence"))[0]);
      expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
      await user.click(screen.getByRole("button", { name: "Resume change" }));
      await waitFor(() =>
        expect(
          requests.find((request) => request.path.endsWith("/decision"))?.body,
        ).toEqual({ decision: "approve", revision: "revision-exact-17", runId: "fixture-run" }),
      );
    },
  );
  it.each(["uncertain", "stale"] satisfies Proposal["status"][])(
    "keeps a %s proposal blocked with recovery guidance",
    async (status) => {
      preparedStatus = status;
      const user = userEvent.setup();
      render(<App />);
      const run = await screen.findByRole("button", { name: "Run workflow" });
      await waitFor(() => expect(run.hasAttribute("disabled")).toBe(false));
      await user.click(run);
      await user.click((await screen.findAllByText("Fixture residence"))[0]);
      expect(
        screen.queryByRole("button", {
          name: /Approve|Resume|Reject|Review retry/,
        }),
      ).toBeNull();
      expect(
        screen.getByText(
          status === "uncertain"
            ? /Inspect current CRM records/
            : /Run the workflow again to prepare a fresh review/,
        ),
      ).toBeTruthy();
      expect(
        requests.some((request) => request.path.endsWith("/decision")),
      ).toBe(false);
    },
  );
  it("groups schedules active first, preserves group order and opens the existing editor", async () => {
    const user = userEvent.setup();
    const entries = [
      { id: "inactive-a", enabled: false }, { id: "active-a", enabled: true },
      { id: "inactive-b", enabled: false }, { id: "active-b", enabled: true },
    ];
    state.schedules = entries.map(({ id, enabled }) => ({
      id, name: id, enabled, time: "09:00", timezone: "UTC", source: "snapshot",
      workflowId: "bellhaven", cron: "0 9 * * *", cadence: "daily", startDate: "2026-11-04",
    }));
    render(<App />);
    await screen.findByRole("button", { name: /^active-a/ });
    expect(screen.getByRole("button", { name: "Active 2" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Inactive 2" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /^inactive-a/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Inactive 2" }));
    expect(Array.from(document.querySelectorAll(".schedule-nav")).map((button) => button.textContent)).toEqual([
      "active-a09:00 · Active", "active-b09:00 · Active", "inactive-a09:00 · Inactive", "inactive-b09:00 · Inactive",
    ]);
    expect(state.schedules.map((schedule) => schedule.id)).toEqual(entries.map((entry) => entry.id));
    await user.click(screen.getByRole("button", { name: /^inactive-a/ }));
    expect(within(screen.getByRole("dialog")).getByDisplayValue("inactive-a")).toBeTruthy();
  });
  it("saves a user-named schedule inactive by default", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "New schedule" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    await user.click(screen.getByRole("button", { name: "New schedule" }));
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByRole("textbox", { name: "Schedule name" }),
      "Jordan morning check",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save schedule" }),
    );
    await waitFor(() =>
      expect(
        requests.find((request) => request.path === "/api/schedules")?.body,
      ).toMatchObject({
        name: "Jordan morning check",
        source: "live",
        workflowId: "bellhaven",
        enabled: false,
      }),
    );
  });
  it("shows setup guidance with no source and supports information Escape dismissal", async () => {
    state.settings.snapshotAvailable = false;
    state.settings.credentialsConfigured = false;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/Configure your own CRM credentials/);
    expect(
      screen
        .getByRole("button", { name: "Run workflow" })
        .hasAttribute("disabled"),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "About scrape view" }));
    expect(screen.getByRole("tooltip")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
  it("shows mutation failures to the user", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Run workflow" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    vi.mocked(fetch).mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ error: "Source capture unavailable" }), {
          status: 409,
        }),
    );
    await user.click(screen.getByRole("button", { name: "Run workflow" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Source capture unavailable",
    );
  });
});
