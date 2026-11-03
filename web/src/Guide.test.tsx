import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Proposal } from "../../shared/contracts";
import Guide from "./Guide";
import { guideStages } from "./guide-data";
import ProposalCard from "./ProposalCard";
import { ruleCodes, rules } from "./rules";
import { recordedDetail } from "./test-fixtures";
import { installGuideBrowserAPIs } from "./guide-test-browser";

beforeEach(installGuideBrowserAPIs);
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function proposalFor(ruleCode: Proposal["ruleCode"], kind: Proposal["kind"]): Proposal {
  return { ...recordedDetail().proposals[0], ruleCode, kind };
}
async function openStage(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: `Explore ${name}` }));
  return screen.getByRole("dialog", { name });
}
async function selectRule(code: keyof typeof rules) {
  await userEvent.click(within(screen.getByLabelText("Business rule routes")).getByRole("button", { name: rules[code].label }));
  return screen.getByLabelText("Selected explanation");
}

describe("progressive workflow guide", () => {
  it("starts with three readable stages and no open diagram", () => {
    render(<Guide />);
    expect(within(screen.getByLabelText("Workflow stages")).getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(rules.ownership_change.route)).toBeNull();
  });
  it.each(["Scrape", "Compare", "Review"])("opens %s with labelled connected nodes and one explanation", async (stage) => {
    render(<Guide />);
    const dialog = await openStage(stage);
    expect(within(dialog).getByLabelText(`${stage} flowchart`).querySelectorAll("svg > path").length).toBeGreaterThan(3);
    expect(within(dialog).getAllByLabelText("Selected explanation")).toHaveLength(1);
    expect(within(dialog).getByText(/Output/)).toBeTruthy();
  });
  it("routes Compare through four horizontal columns with all seven selectable nodes", async () => {
    render(<Guide />);
    const dialog = await openStage("Compare");
    const chart = within(dialog).getByLabelText("Compare flowchart");
    const graphNodes = within(chart).getAllByRole("button");
    expect(graphNodes).toHaveLength(7);
    const [website, crm, identity, business, proposed, inspect, aligned] = graphNodes;
    const x = (node: HTMLElement) => Number.parseFloat(node.style.left);
    const y = (node: HTMLElement) => Number.parseFloat(node.style.top);
    expect(x(website)).toBe(x(crm));
    expect(y(website)).toBeLessThan(y(crm));
    expect(x(crm)).toBeLessThan(x(identity));
    expect(x(identity)).toBeLessThan(x(business));
    expect(x(business)).toBeLessThan(x(proposed));
    expect(x(proposed)).toBe(x(inspect));
    expect(x(inspect)).toBe(x(aligned));
    expect(y(proposed)).toBeLessThan(y(inspect));
    expect(y(inspect)).toBeLessThan(y(aligned));
    expect(y(identity)).toBe(y(business));
    const compare = guideStages.find((stage) => stage.id === "compare");
    expect(compare).toBeTruthy();
    for (const node of compare?.nodes ?? []) {
      await userEvent.click(within(chart).getByRole("button", { name: `${node.kind}: ${node.label}` }));
      expect(within(screen.getByLabelText("Selected explanation")).getByText(node.detail)).toBeTruthy();
    }
  });
  it("connects every Compare route from the source right port to the destination left port", async () => {
    render(<Guide />);
    const dialog = await openStage("Compare");
    const chart = within(dialog).getByLabelText("Compare flowchart");
    const compare = guideStages.find((stage) => stage.id === "compare");
    const paths = Array.from(chart.querySelectorAll<SVGPathElement>("svg > path"));
    expect(paths).toHaveLength(6);
    expect(paths.map((path) => `${path.dataset.from}-${path.dataset.to}`)).toEqual(compare?.edges.map((edge) => `${edge.from}-${edge.to}`));
    for (const path of paths) {
      const source = chart.querySelector<HTMLButtonElement>(`[data-node="${path.dataset.from}"]`);
      const destination = chart.querySelector<HTMLButtonElement>(`[data-node="${path.dataset.to}"]`);
      if (!source || !destination) throw new Error("A Compare route has no selectable endpoint");
      const route = path.getAttribute("d")?.match(/^M ([\d.]+) ([\d.]+) H ([\d.]+) V ([\d.]+) H ([\d.]+)$/);
      if (!route) throw new Error("A Compare route must leave and enter horizontally");
      const [, startX, startY, bendX, endY, endX] = route.map(Number);
      const rightPort = (Number.parseFloat(source.style.left) + Number.parseFloat(source.style.width) / 2) * 8.8;
      const leftPort = (Number.parseFloat(destination.style.left) - Number.parseFloat(destination.style.width) / 2) * 8.8;
      expect(startX).toBeCloseTo(rightPort);
      expect(startY).toBe(Number.parseFloat(source.style.top));
      expect(endX).toBeCloseTo(leftPort);
      expect(endY).toBe(Number.parseFloat(destination.style.top));
      expect(bendX).toBeGreaterThan(startX);
      expect(bendX).toBeLessThan(endX);
      expect(path.getAttribute("marker-end")).toMatch(/^url\(#.+\)$/);
    }
    for (const edge of compare?.edges ?? []) expect(within(chart).getByText(edge.label)).toBeTruthy();
  });
  it("places Compare rules and its explanation below the map, inside a separate pan region", async () => {
    render(<Guide />);
    const dialog = await openStage("Compare");
    const layout = dialog.querySelector(".guide-stage-layout--compare");
    const chart = within(dialog).getByLabelText("Compare flowchart");
    const panRegion = within(dialog).getByRole("region", { name: "Compare map, scroll horizontally" });
    const picker = within(dialog).getByLabelText("Business rule routes");
    const detail = within(dialog).getByLabelText("Selected explanation");
    expect(panRegion.contains(chart)).toBe(true);
    expect(panRegion.tabIndex).toBe(0);
    expect(panRegion.contains(picker)).toBe(false);
    expect(panRegion.contains(detail)).toBe(false);
    expect(chart.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(picker.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(detail.parentElement).toBe(layout);
    expect(within(picker).getAllByRole("button")).toHaveLength(10);
  });
  it.each(["Scrape", "Review"])("preserves the %s vertical map and side explanation layout", async (name) => {
    render(<Guide />);
    const dialog = await openStage(name);
    const chart = within(dialog).getByLabelText(`${name} flowchart`);
    expect(dialog.querySelector(".guide-stage-layout--compare")).toBeNull();
    expect(dialog.querySelector(".guide-compare-scroll")).toBeNull();
    expect(within(dialog).queryByLabelText("Business rule routes")).toBeNull();
    const paths = Array.from(chart.querySelectorAll("svg > path"));
    expect(paths.every((path) => /^M [\d.]+ [\d.]+ V /.test(path.getAttribute("d") ?? ""))).toBe(true);
  });
  it("explains live collection, complete coverage and saved capture replay separately", async () => {
    render(<Guide />);
    const dialog = await openStage("Scrape");
    expect(within(dialog).getByText(/Saved snapshot replays/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: /CRM API/ }));
    expect(screen.getByLabelText("Selected explanation").textContent).toMatch(/every CRM account page across all parents/);
    await userEvent.click(within(dialog).getByRole("button", { name: /Save source evidence/ }));
    expect(screen.getByLabelText("Selected explanation").textContent).toMatch(/does not make fresh website or CRM requests/);
    await userEvent.click(within(dialog).getByRole("button", { name: /Collection complete/ }));
    expect(screen.getByLabelText("Selected explanation").textContent).toMatch(/blocks automatic account changes/);
  });
  it("makes all ten registry rules discoverable without expanding ten explanations", async () => {
    render(<Guide />);
    await openStage("Compare");
    const routes = screen.getByLabelText("Business rule routes");
    expect(within(routes).getAllByRole("button")).toHaveLength(10);
    for (const code of ruleCodes) {
      const detail = await selectRule(code);
      expect(within(detail).getByText(rules[code].route)).toBeTruthy();
      expect(within(routes).getByText(rules[code].label).style.color).toBeTruthy();
    }
  });
  it.each(["chow", "update"] satisfies Proposal["kind"][])("explains both ownership branches and permits the engine's %s proposal", async (kind) => {
    const decide = vi.fn();
    render(<><Guide /><ProposalCard proposal={proposalFor("ownership_change", kind)} decide={decide} busy={false} liveEnabled={false} /></>);
    const dialog = await openStage("Compare");
    const detail = await selectRule("ownership_change");
    expect(within(detail).getByText(/Both values positive.*old CHOW link/)).toBeTruthy();
    expect(within(detail).getByText(/Either value zero.*direct re-parenting/)).toBeTruthy();
    expect(within(detail).getByText(/Missing or malformed finances.*approval blocked/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(screen.getByText("Recorded proposal"));
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ ruleCode: "ownership_change", kind }), "approve");
  });
  it("limits absence to a review flag and note, and duplicates to a supported zero-billing loser", async () => {
    render(<Guide />);
    await openStage("Compare");
    const absence = await selectRule("missing_from_website");
    expect(within(absence).getByText(/Preserve ownership and billing; do not infer sale or closure/)).toBeTruthy();
    const duplicate = await selectRule("duplicate");
    expect(within(duplicate).getByText(/supported zero-billing loser.*Never delete/)).toBeTruthy();
  });
  it("keeps unknown finances blocked and unchanged records free of approval", async () => {
    render(<Guide />);
    await openStage("Compare");
    expect(within(await selectRule("billing_ambiguity")).getByText(/missing\/malformed revenue or AR.*approval blocked/)).toBeTruthy();
    expect(within(await selectRule("unchanged")).getByText("No action needed · no approval.")).toBeTruthy();
  });
  it("explains approval rechecks, actual readback, uncertain outcomes and durable rejection", async () => {
    render(<Guide />);
    const dialog = await openStage("Review");
    for (const [node, expected] of [
      ["Your decision", /exact proposal revision.*explicit confirmation/],
      ["Recheck current record", /Stale or changed evidence blocks the write/],
      ["Write + read back", /reads the actual result back/],
      ["Stop + record issue", /uncertain create is not blindly retried/],
      ["Record rejection", /Rejection changes no account.*after restart/],
    ] satisfies [string, RegExp][]) {
      await userEvent.click(within(dialog).getByRole("button", { name: new RegExp(node.replace(/[+]/g, "\\+")) }));
      expect(screen.getByLabelText("Selected explanation").textContent).toMatch(expected);
    }
  });
  it("restores focus to whichever tile opened the shared dialog", async () => {
    render(<Guide />);
    for (const name of ["Review", "Scrape", "Compare"]) {
      const dialog = await openStage(name);
      await userEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(document.activeElement).toBe(screen.getByRole("button", { name: `Explore ${name}` }));
    }
  });
  it("accepts native Escape cancellation and outside clicks, but ignores inside drags", async () => {
    render(<Guide />);
    let dialog = await openStage("Scrape");
    fireEvent(dialog, new MouseEvent("pointerdown", { bubbles: true, clientX: -10, clientY: -10 }));
    fireEvent.click(dialog, { clientX: -10, clientY: -10 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    dialog = await openStage("Review");
    fireEvent.pointerDown(within(dialog).getByRole("button", { name: /Your decision/ }));
    fireEvent.click(dialog, { clientX: -10, clientY: -10 });
    expect(screen.getByRole("dialog")).toBe(dialog);
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("retains the dialog through the 220ms exit and restores focus after it finishes", async () => {
    render(<Guide />);
    const dialog = await openStage("Compare");
    let finishExit: (() => void) | undefined;
    const animation = dialog.animate([], 0);
    const animate = vi.spyOn(dialog, "animate").mockImplementation((_frames, options) => {
      expect(typeof options === "object" && options?.duration).toBe(220);
      Object.defineProperty(animation, "finished", { value: new Promise<void>((resolve) => { finishExit = resolve; }) });
      return animation;
    });
    animate.mockClear();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    expect(animate).toHaveBeenCalledOnce();
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.dataset.trMotion).toBe("closing");
    finishExit?.();
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Explore Compare" }));
  });
  it("uses the visible sidebar boundary for workspace placement and releases scroll lock", async () => {
    const sidebar = document.createElement("aside");
    sidebar.className = "sidebar";
    sidebar.getBoundingClientRect = () => new DOMRect(24, 24, 268, 900);
    document.body.append(sidebar);
    render(<Guide />);
    const dialog = await openStage("Scrape");
    expect(dialog.style.getPropertyValue("--tr-panel-offset")).toBe("292px");
    expect(document.body.style.overflow).toBe("hidden");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(document.body.style.overflow).toBe("");
    sidebar.remove();
  });
  it("settles immediately with reduced motion", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<Guide />);
    const dialog = await openStage("Review");
    expect(dialog.dataset.trMotion).toBe("open");
    await userEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(Element.prototype.animate).not.toHaveBeenCalled();
  });
  it.each([
    ["missing_from_website", "update", true],
    ["billing_ambiguity", "needs_review", false],
    ["unchanged", "unchanged", null],
  ] satisfies [Proposal["ruleCode"], Proposal["kind"], boolean | null][])("preserves the %s approval contract", async (ruleCode, kind, enabled) => {
    const decide = vi.fn();
    render(<ProposalCard proposal={proposalFor(ruleCode, kind)} decide={decide} busy={false} liveEnabled={false} />);
    await userEvent.click(screen.getByText("Recorded proposal"));
    const approve = screen.queryByRole("button", { name: "Approve" });
    if (enabled === null) { expect(approve).toBeNull(); return; }
    expect(approve?.hasAttribute("disabled")).toBe(!enabled);
    if (enabled && approve) {
      await userEvent.click(approve);
      expect(decide).toHaveBeenCalledWith(expect.objectContaining({ ruleCode, kind }), "approve");
    }
  });

  it("distinguishes saved account results from live verification in recorded results", async () => {
    render(<Guide />);
    const dialog = await openStage("Review");
    await userEvent.click(within(dialog).getByRole("button", { name: /Recorded result/ }));
    const detail = screen.getByLabelText("Selected explanation");
    expect(detail.textContent).toMatch(/history records decisions and execution status/);
    expect(detail.textContent).toMatch(/Saved-snapshot runs also store actual account before\/after results/);
    expect(detail.textContent).toMatch(/Live changes are verified by readback and in the CRM browser/);
    expect(detail.textContent).toMatch(/live runs do not store an account before\/after result table/);
  });
  it("opens each stage at the top after the previous stage was scrolled", async () => {
    render(<Guide />);
    const compare = await openStage("Compare");
    compare.scrollTop = 800;
    compare.scrollLeft = 20;
    expect(compare.scrollTop).toBe(800);
    await userEvent.click(within(compare).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const review = await openStage("Review");
    expect(review).toBe(compare);
    await waitFor(() => expect(review.scrollTop).toBe(0));
    expect(review.scrollLeft).toBe(0);
    expect(within(review).getByRole("button", { name: /Open flag \+ evidence/ })).toBeTruthy();
  });
  it("returns the Compare map to its inputs when reopening the same stage", async () => {
    render(<Guide />);
    const dialog = await openStage("Compare");
    const map = within(dialog).getByRole("region", { name: "Compare map, scroll horizontally" });
    map.scrollLeft = 536;
    expect(map.scrollLeft).toBe(536);
    await userEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const reopened = await openStage("Compare");
    expect(reopened).toBe(dialog);
    expect(within(reopened).getByRole("region", { name: "Compare map, scroll horizontally" })).toBe(map);
    await waitFor(() => expect(map.scrollLeft).toBe(0));
  });
  it("places the failure branch label in the clear gap below its row", async () => {
    render(<Guide />);
    const dialog = await openStage("Review");
    const write = within(dialog).getByRole("button", { name: /Write \+ read back/ });
    const result = within(dialog).getByRole("button", { name: /Recorded result/ });
    const label = within(dialog).getByText("Failed / uncertain");
    const labelTop = Number.parseFloat(label.style.top);
    expect(labelTop).toBeGreaterThan(Number.parseFloat(write.style.top) + 32);
    expect(labelTop).toBeLessThan(Number.parseFloat(result.style.top) - 32);
    expect(labelTop).not.toBe(Number.parseFloat(within(dialog).getByText("Stale / blocked").style.top));
    expect(labelTop).not.toBe(Number.parseFloat(within(dialog).getByText("Valid").style.top));
  });

});
