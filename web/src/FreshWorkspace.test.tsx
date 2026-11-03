import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppState, RunDetail } from "../../shared/contracts";
import App from "./App";
import { recordedDetail } from "./test-fixtures";

let state: AppState;
let latest: RunDetail;
let paths: string[];
beforeEach(() => {
  latest = recordedDetail();
  state = {
    workflows: [{ id: "bellhaven", name: "Bellhaven" }],
    run: latest.run,
    proposals: latest.proposals,
    runs: [{ ...latest.run, evidenceAvailable: true, proposalCount: 1 }],
    history: [],
    schedules: [],
    settings: { credentialsConfigured: true, liveWritesEnabled: true, snapshotAvailable: true },
  };
  paths = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    paths.push(path);
    if (path === "/api/state") return Response.json(state);
    if (path === `/api/runs/${latest.run.id}`) return Response.json(latest);
    return Response.json({ error: "Run could not start" }, { status: 503 });
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const progress = (name: string) => screen.getByRole("progressbar", { name }).getAttribute("aria-valuenow");

async function selectLatest(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText("Run history"));
  await user.selectOptions(screen.getByRole("combobox", { name: "Saved run" }), "run-a");
}

describe("fresh workspace", () => {
  it("opens completed runs in an empty Scrape workspace and retains latest history", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Local workspace connected");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Scrape");
    expect(progress("Overall workflow progress")).toBe("0");
    expect(progress("Website progress")).toBe("0");
    expect(screen.getByText("No website records captured.")).toBeTruthy();
    expect(screen.getByText("No CRM accounts captured.")).toBeTruthy();
    expect(screen.queryByText("Recorded proposal")).toBeNull();
    expect(screen.queryByText(/Elapsed/)).toBeNull();
    expect(paths).toEqual(["/api/state"]);
    await selectLatest(user);
    await screen.findByText("Recorded proposal");
    await user.selectOptions(screen.getByRole("combobox", { name: "Saved run" }), "");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Scrape");
    expect(progress("Overall workflow progress")).toBe("0");
    expect(screen.queryByText("Recorded proposal")).toBeNull();
    expect(state.runs).toHaveLength(1);
  });

  it("adopts a running job on load using its actual counters", async () => {
    latest.run = { ...latest.run, status: "running", phase: "scrape", progress: {
      website: { completed: 1, total: 4 }, crm: { completed: 3, total: null }, compare: { completed: 0, total: null },
    } };
    latest.input = null;
    latest.proposals = [];
    latest.actionable = false;
    state.run = latest.run;
    state.proposals = [];
    render(<App />);
    await screen.findByText("1 / 4 pages");
    expect(screen.getByText("3 accounts · discovering")).toBeTruthy();
    expect(progress("Website progress")).toBe("25");
    expect(screen.getByRole("button", { name: "Running" }).hasAttribute("disabled")).toBe(true);
    await screen.findByText(/Collection in progress/);
  });

  it("clears the selected old run before start replies and ignores its delayed detail and polls", async () => {
    let completeDetail: (response: Response) => void = () => { throw new Error("Missing detail request"); };
    let completeStart: (response: Response) => void = () => { throw new Error("Missing start request"); };
    const oldDetail = new Promise<Response>((resolve) => { completeDetail = resolve; });
    const start = new Promise<Response>((resolve) => { completeStart = resolve; });
    vi.mocked(fetch).mockImplementation(async (path) => {
      paths.push(String(path));
      if (path === "/api/state") return Response.json(state);
      if (path === "/api/runs") return start;
      if (path === "/api/runs/run-a") return oldDetail;
      return Response.json({ error: "No captured input yet" }, { status: 404 });
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Local workspace connected");
    await selectLatest(user);
    await screen.findByText("Recorded proposal");
    await user.click(screen.getByRole("button", { name: "Run workflow" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Scrape");
    expect(progress("Overall workflow progress")).toBe("0");
    expect(screen.queryByText("Recorded proposal")).toBeNull();
    await act(async () => { completeDetail(Response.json(latest)); });
    await waitFor(() => expect(paths.filter((path) => path === "/api/state").length).toBeGreaterThan(1), { timeout: 2000 });
    expect(progress("Overall workflow progress")).toBe("0");
    expect(screen.queryByText("Captured website")).toBeNull();
    expect(screen.queryByText(/Elapsed/)).toBeNull();
    const next = { ...latest.run, id: "new-run", status: "running", phase: "scrape", progress: {
      website: { completed: 0, total: null }, crm: { completed: 0, total: null }, compare: { completed: 0, total: null },
    } } satisfies RunDetail["run"];
    state.run = next;
    state.proposals = [];
    await screen.findByRole("button", { name: "Running" }, { timeout: 2000 });
    expect(progress("Website progress")).toBe("0");
    expect(screen.queryByText("Captured website")).toBeNull();
    await act(async () => { completeStart(Response.json(next)); });
  });

  it("keeps failed starts empty with an error and saved history available", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Local workspace connected");
    await selectLatest(user);
    await screen.findByText("Recorded proposal");
    await user.click(screen.getByRole("button", { name: "Run workflow" }));
    await screen.findByText("Run could not start");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Scrape");
    expect(progress("Overall workflow progress")).toBe("0");
    expect(screen.queryByText("Recorded proposal")).toBeNull();
    expect(screen.queryByText("Captured website")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Saved run" }).textContent).toContain("Saved snapshot");
    await user.selectOptions(screen.getByRole("combobox", { name: "Saved run" }), "run-a");
    await screen.findByText("Recorded proposal");
  });
});
