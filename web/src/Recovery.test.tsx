import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AppState } from "../../shared/contracts";
import App from "./App";
import { recordedDetail } from "./test-fixtures";

function fixtureState(): AppState {
  const detail = recordedDetail();
  return {
    workflows: [{ id: "bellhaven", name: "Bellhaven" }],
    run: detail.run, proposals: detail.proposals,
    runs: [{ ...detail.run, evidenceAvailable: true, proposalCount: detail.proposals.length }],
    history: [], schedules: [],
    settings: { credentialsConfigured: true, liveWritesEnabled: false, snapshotAvailable: true },
  };
}
async function flush() {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
async function selectRun(id = "run-a") {
  fireEvent.click(screen.getByText("Run history"));
  fireEvent.change(screen.getByRole("combobox", { name: "Saved run" }), { target: { value: id } });
  await flush();
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.open = true; },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser read recovery", () => {
  it("resumes state polling after a hanging GET times out", async () => {
    let stateCalls = 0;
    vi.stubGlobal("fetch", vi.fn((path: string, options?: RequestInit) => {
      if (path !== "/api/state") throw new Error("Unexpected fixture request");
      if (++stateCalls > 1) return Promise.resolve(Response.json(fixtureState()));
      return new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
      });
    }));
    render(<App />);
    await advance(10000);
    expect(screen.getByRole("alert").textContent).toContain("The request timed out.");
    expect(stateCalls).toBe(1);
    await advance(700);
    expect(stateCalls).toBe(2);
    expect(screen.getByText("Local workspace connected")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("recovers evidence after a settled failure while state metadata stays unchanged", async () => {
    const state = fixtureState();
    let detailCalls = 0;
    let stateCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (path === "/api/state") { stateCalls++; return Response.json(state); }
      if (path === "/api/runs/run-a") {
        return ++detailCalls === 1
          ? Response.json({ error: "Temporary evidence failure" }, { status: 503 })
          : Response.json(recordedDetail());
      }
      throw new Error("Unexpected fixture request");
    }));
    render(<App />);
    await flush();
    await selectRun();
    expect(screen.getByText(/Could not load this run's evidence/).textContent).toContain("Temporary evidence failure");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    await advance(1999);
    expect(detailCalls).toBe(1);
    await advance(1);
    expect(detailCalls).toBe(2);
    expect(stateCalls).toBeGreaterThan(1);
    expect(screen.queryByText(/Could not load this run's evidence/)).toBeNull();
    fireEvent.click(screen.getByText("Recorded proposal"));
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    await advance(6000);
    expect(detailCalls).toBe(2);
  });

  it("does not overlap evidence retry requests while the retry is pending", async () => {
    let detailCalls = 0;
    let finish: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/api/state") return Promise.resolve(Response.json(fixtureState()));
      if (++detailCalls === 1) return Promise.resolve(Response.json({ error: "Temporary failure" }, { status: 503 }));
      return new Promise<Response>((resolve) => { finish = resolve; });
    }));
    render(<App />);
    await flush();
    await selectRun();
    await advance(2000);
    expect(detailCalls).toBe(2);
    await advance(9000);
    expect(detailCalls).toBe(2);
    await act(async () => { finish?.(Response.json(recordedDetail())); });
    await flush();
    expect(screen.queryByText(/Could not load this run's evidence/)).toBeNull();
    await advance(3000);
    expect(detailCalls).toBe(2);
  });

  it.each(["navigation", "unmount"])("cancels a scheduled evidence retry on %s", async (end) => {
    let detailCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (path: string) => {
      if (path === "/api/state") return Response.json(fixtureState());
      detailCalls++;
      return Response.json({ error: "Temporary failure" }, { status: 503 });
    }));
    const view = render(<App />);
    await flush();
    await selectRun();
    expect(detailCalls).toBe(1);
    if (end === "unmount") view.unmount();
    else {
      fireEvent.change(screen.getByRole("combobox", { name: "Saved run" }), { target: { value: "" } });
      await flush();
    }
    await advance(5000);
    expect(detailCalls).toBe(1);
    expect(screen.queryByText(/Could not load this run's evidence/)).toBeNull();
  });

  it.each(["success", "failure"])("ignores a late evidence %s after selecting another run", async (result) => {
    const state = fixtureState();
    const old = recordedDetail();
    old.run.id = "old-run";
    old.proposals = [];
    old.actionable = false;
    state.runs?.push({ ...old.run, evidenceAvailable: true, proposalCount: 0 });
    let finish: ((response: Response) => void) | undefined;
    let detailCalls = 0;
    vi.stubGlobal("fetch", vi.fn((path: string) => {
      if (path === "/api/state") return Promise.resolve(Response.json(state));
      detailCalls++;
      if (path === "/api/runs/old-run") return Promise.resolve(Response.json(old));
      return new Promise<Response>((resolve) => { finish = resolve; });
    }));
    render(<App />);
    await flush();
    await selectRun();
    fireEvent.change(screen.getByRole("combobox", { name: "Saved run" }), { target: { value: "old-run" } });
    await flush();
    expect(screen.getByText("Historical · read-only")).toBeTruthy();
    await act(async () => {
      finish?.(result === "success" ? Response.json(recordedDetail()) : Response.json({ error: "Obsolete failure" }, { status: 503 }));
    });
    await flush();
    await advance(3000);
    expect(detailCalls).toBe(2);
    expect(screen.queryByText(/Could not load this run's evidence/)).toBeNull();
    expect(screen.getByText("Historical · read-only")).toBeTruthy();
    expect(screen.queryByText("Recorded proposal")).toBeNull();
  });

  it("keeps a user-approved mutation pending beyond ten seconds and sends it only once", async () => {
    const state = fixtureState();
    const detail = recordedDetail();
    detail.run.source = "live";
    detail.proposals[0].source = "live";
    state.run = detail.run;
    state.proposals = detail.proposals;
    state.settings.liveWritesEnabled = true;
    let finish: ((response: Response) => void) | undefined;
    const decisions: RequestInit[] = [];
    vi.stubGlobal("fetch", vi.fn((path: string, options?: RequestInit) => {
      if (path === "/api/state") return Promise.resolve(Response.json(state));
      if (path === "/api/runs/run-a") return Promise.resolve(Response.json(detail));
      if (path.endsWith("/decision")) {
        decisions.push(options ?? {});
        return new Promise<Response>((resolve) => { finish = resolve; });
      }
      throw new Error("Unexpected fixture request");
    }));
    render(<App />);
    await flush();
    await selectRun();
    fireEvent.click(screen.getByText("Recorded proposal"));
    fireEvent.click(screen.getByRole("button", { name: "Review approval" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve live change" }));
    await advance(11000);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].signal).toBeUndefined();
    expect(within(dialog).getByRole("button", { name: "Applying…" }).hasAttribute("disabled")).toBe(true);
    expect(within(dialog).queryByRole("alert")).toBeNull();
    await act(async () => { finish?.(Response.json({ ...detail.proposals[0], status: "applied" })); });
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(decisions).toHaveLength(1);
  });
});
