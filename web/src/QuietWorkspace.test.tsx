import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AppState } from "../../shared/contracts";
import App from "./App";
import { recordedDetail } from "./test-fixtures";
import { installGuideBrowserAPIs } from "./guide-test-browser";

let state: AppState;
let requests: { path: string; body: unknown }[];
beforeEach(() => {
  const detail = recordedDetail();
  state = {
    workflows: [{ id: "bellhaven", name: "Bellhaven" }],
    run: { ...detail.run, source: "live", status: "running", phase: "scrape" },
    proposals: [], history: [], schedules: [],
    settings: { credentialsConfigured: true, liveWritesEnabled: false, snapshotAvailable: true },
  };
  requests = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, options?: RequestInit) => {
    requests.push({ path, body: options?.body ? JSON.parse(String(options.body)) : null });
    if (path === "/api/state") return Response.json(state);
    if (path === "/api/runs") {
      const next = recordedDetail().run;
      state.run = { ...next, id: "new-live-run", source: "live", status: "running", phase: "scrape" };
      return Response.json(state.run);
    }
    return Response.json({ error: "Unexpected fixture request" }, { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const value = (label: string) => screen.getByRole("progressbar", { name: label }).getAttribute("aria-valuenow");
const connector = (label: string) => screen.getByLabelText(label).querySelector("span")?.style.height;

describe("quiet workspace", () => {
  it.each([true, false])("blocks fresh runs without credentials when snapshot availability is %s", async (snapshotAvailable) => {
    state.run = null;
    state.settings = { ...state.settings, credentialsConfigured: false, snapshotAvailable };
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/Configure your own CRM credentials/);
    const button = screen.getByRole("button", { name: "Run workflow" });
    expect(button.hasAttribute("disabled")).toBe(true);
    await user.click(button);
    expect(requests.some(({ path }) => path === "/api/runs")).toBe(false);
    expect(screen.queryByRole("combobox", { name: "Run source" })).toBeNull();
  });

  it.each([true, false])("requests live with configured credentials when snapshot availability is %s", async (snapshotAvailable) => {
    state.run = null;
    state.settings.snapshotAvailable = snapshotAvailable;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Local workspace connected");
    await user.click(screen.getByRole("button", { name: "Run workflow" }));
    await screen.findByRole("button", { name: "Running" });
    expect(requests.find(({ path }) => path === "/api/runs")?.body).toEqual({ source: "live", workflowId: "bellhaven" });
  });

  it("follows real phase changes, then keeps manual stage inspection until another run starts", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Local workspace connected");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Scrape");
    state.run = { ...state.run!, phase: "compare", progress: { ...state.run!.progress, compare: { completed: 1, total: 2 } } };
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Compare"), { timeout: 2000 });
    expect(value("compare stage progress")).toBe("50");
    await user.click(screen.getByRole("button", { name: "Scrape" }));
    state.run = { ...state.run!, phase: "review", status: "ready" };
    await waitFor(() => expect(screen.queryByRole("button", { name: "Running" })).toBeNull(), { timeout: 2000 });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Scrape");
    await user.click(screen.getByRole("button", { name: "Run workflow" }));
    await screen.findByRole("button", { name: "Running" });
    state.run = { ...state.run!, phase: "compare" };
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Compare"), { timeout: 2000 });
    expect(requests.find(({ path }) => path === "/api/runs")?.body).toEqual({ source: "live", workflowId: "bellhaven" });
  });

  it.each([false, true])(
    "follows the latest polled phase after a delayed start response, manual inspection %s",
    async (manualInspection) => {
      state.run = { ...state.run!, status: "ready", phase: "review" };
      let completeStart: ((response: Response) => void) | undefined;
      const pendingStart = new Promise<Response>((resolve) => {
        completeStart = resolve;
      });
      vi.mocked(fetch).mockImplementation(async (path, options) => {
        requests.push({
          path: String(path),
          body: options?.body ? JSON.parse(String(options.body)) : null,
        });
        if (path === "/api/state") return Response.json(state);
        if (path === "/api/runs") return pendingStart;
        return Response.json({ error: "Unexpected fixture request" }, { status: 404 });
      });
      const user = userEvent.setup();
      render(<App />);
      await screen.findByText("Local workspace connected");
      if (manualInspection) {
        await user.click(screen.getByRole("button", { name: "Scrape" }));
      }
      await user.click(screen.getByRole("button", { name: "Run workflow" }));
      await waitFor(() => expect(requests.some(({ path }) => path === "/api/runs")).toBe(true));
      const started = {
        ...recordedDetail().run,
        id: "fast-new-run", source: "live", status: "running", phase: "scrape",
      };
      state.run = {
        ...recordedDetail().run,
        id: "fast-new-run", source: "live",
        errors: ["Completed while the start response was pending"],
      };
      await screen.findByText("Completed while the start response was pending", {}, { timeout: 2000 });
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Review");
      if (!completeStart) throw new Error("Start request did not initialize");
      completeStart(Response.json(started));
      await waitFor(() => expect(screen.getByRole("button", { name: "Run workflow" }).hasAttribute("disabled")).toBe(false));
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Review");
    },
  );

  it.each(["sidebar", "history"])(
    "preserves a %s choice made while a start request is pending",
    async (selection) => {
      const current = recordedDetail();
      current.run.source = "live";
      const previous = recordedDetail();
      previous.run.id = "previous-run";
      previous.actionable = false;
      previous.proposals = previous.proposals.map((proposal) => ({
        ...proposal, runId: previous.run.id, title: "Historical proposal",
      }));
      state.run = current.run;
      state.proposals = current.proposals;
      state.runs = [current, previous].map((detail) => ({
        ...detail.run, evidenceAvailable: true, proposalCount: detail.proposals.length,
      }));
      let completeStart: ((response: Response) => void) | undefined;
      const pendingStart = new Promise<Response>((resolve) => {
        completeStart = resolve;
      });
      vi.mocked(fetch).mockImplementation(async (path, options) => {
        requests.push({
          path: String(path),
          body: options?.body ? JSON.parse(String(options.body)) : null,
        });
        if (path === "/api/state") return Response.json(state);
        if (path === "/api/runs") return pendingStart;
        if (path === `/api/runs/${current.run.id}`) return Response.json(current);
        if (path === `/api/runs/${previous.run.id}`) return Response.json(previous);
        return Response.json({ error: "Unexpected fixture request" }, { status: 404 });
      });
      const user = userEvent.setup();
      render(<App />);
      await screen.findByText("Local workspace connected");
      await user.click(screen.getByRole("button", { name: "Run workflow" }));
      await waitFor(() => expect(requests.some(({ path }) => path === "/api/runs")).toBe(true));
      if (selection === "sidebar") {
        await user.click(screen.getByRole("button", { name: "Compare" }));
      } else {
        await user.click(screen.getByText("Run history"));
        await user.selectOptions(screen.getByRole("combobox", { name: "Saved run" }), "previous-run");
        await user.click(screen.getByRole("button", { name: "Review" }));
        await screen.findByText("Historical proposal");
      }
      const started = { ...current.run, id: "new-live-run", phase: "scrape", status: "running" };
      current.run = { ...current.run, id: "new-live-run", phase: "review", status: "ready" };
      state.run = current.run;
      if (!completeStart) throw new Error("Start request did not initialize");
      completeStart(Response.json(started));
      await waitFor(() => expect(screen.getByRole("button", { name: "Run workflow" }).hasAttribute("disabled")).toBe(false));
      if (selection === "sidebar") {
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Compare");
      } else {
        expect(screen.getByRole("combobox", { name: "Saved run" })).toHaveProperty("value", "previous-run");
        expect(screen.getByText("Historical · read-only")).toBeTruthy();
        expect(screen.getByText("Historical proposal")).toBeTruthy();
      }
    },
  );

  it("keeps How it works open when the backend phase changes", async () => {
    installGuideBrowserAPIs();
    state.run = { ...state.run!, progress: { ...state.run!.progress, compare: { completed: 0, total: 1 } } };
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Local workspace connected");
    await user.click(screen.getByRole("button", { name: "How it works" }));
    state.run = { ...state.run!, phase: "compare", progress: { ...state.run!.progress, compare: { completed: 1, total: 1 } } };
    await waitFor(() => expect(connector("Compare connector")).toBe("100%"), { timeout: 2000 });
    expect(screen.getByRole("button", { name: "How it works" }).classList.contains("active")).toBe(true);
    expect(screen.queryByRole("heading", { level: 1, name: "Compare" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Compare");
  });

  it("uses separate measured source and comparison connectors while review advances", async () => {
    const user = userEvent.setup();
    state.run = { ...state.run!, status: "failed", phase: "review", progress: {
      website: { completed: 1, total: 2 }, crm: { completed: 0, total: 2 }, compare: { completed: 1, total: 4 },
    }, errors: ["Source request failed"], etaSeconds: 4 };
    state.proposals = recordedDetail().proposals;
    state.runs = [{ ...state.run, evidenceAvailable: true, proposalCount: state.proposals.length }];
    vi.mocked(fetch).mockImplementation(async (path) => {
      if (path === "/api/state") return Response.json(state);
      if (path === `/api/runs/${state.run?.id}`) return Response.json({ ...recordedDetail(), run: state.run, proposals: state.proposals });
      return Response.json({ error: "Unexpected fixture request" }, { status: 404 });
    });
    render(<App />);
    await screen.findByText("Local workspace connected");
    await user.click(screen.getByText("Run history"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Saved run" }), "run-a");
    await screen.findByText("Run failed");
    expect(connector("Scrape connector")).toBe("25%");
    expect(connector("Compare connector")).toBe("25%");
    expect(value("review stage progress")).toBe("0");
    expect(value("Overall workflow progress")).toBe("17");
    expect(screen.getByRole("alert").textContent).toBe("Source request failed");
    expect(screen.queryByText(/sec remaining/)).toBeNull();
    state.proposals = state.proposals.map((proposal) => ({ ...proposal, status: "applied" }));
    state.run = { ...state.run!, updatedAt: "2026-11-03T15:05:00Z" };
    await waitFor(() => expect(value("review stage progress")).toBe("100"), { timeout: 2000 });
    expect(connector("Scrape connector")).toBe("25%");
    expect(connector("Compare connector")).toBe("25%");
    expect(value("Overall workflow progress")).toBe("50");
    await user.click(screen.getByRole("button", { name: "Scrape" }));
    expect(value("scrape stage progress")).toBe("25");
  });

  it("keeps elapsed and only known running ETA in the header across stages", async () => {
    const user = userEvent.setup();
    state.run = { ...state.run!, etaSeconds: 8 };
    render(<App />);
    await screen.findByText("Estimated 8 sec remaining");
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByText(/Elapsed/).closest(".workspace-heading")).toBeTruthy();
    expect(screen.getByText("Estimated 8 sec remaining").closest(".workspace-heading")).toBeTruthy();
    state.run = { ...state.run!, etaSeconds: null };
    await waitFor(() => expect(screen.queryByText(/sec remaining/)).toBeNull(), { timeout: 2000 });
    expect(screen.queryByText("Estimate pending")).toBeNull();
  });
});
