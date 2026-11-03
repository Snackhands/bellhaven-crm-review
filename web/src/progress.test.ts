import { describe, expect, it } from "vitest";
import { fraction, safeUrl, stageProgress } from "./progress";
import type { Run } from "../../shared/contracts";
describe("measured progress", () => {
  it("does not fabricate progress for unknown totals", () => {
    expect(fraction({ completed: 12, total: null })).toBe(0);
  });
  it("shares measured run progress across sidebar and horizontal meters", () => {
    const run: Run = {
      id: "fixture",
      workflowId: "bellhaven",
      source: "snapshot",
      status: "running",
      phase: "scrape",
      startedAt: "",
      updatedAt: "",
      progress: {
        website: { completed: 2, total: 4 },
        crm: { completed: 20, total: 40 },
        compare: { completed: 0, total: null },
      },
      message: "",
      errors: [],
      etaSeconds: null,
    };
    expect(stageProgress(run, [])).toEqual({
      scrape: 0.5,
      compare: 0,
      review: 0,
    });
  });
  it("only exposes http or https evidence links", () => {
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("https://example.com/source")).toBe(
      "https://example.com/source",
    );
  });
  it.each(["scrape", "compare", "review"] satisfies Run["phase"][])(
    "keeps failed %s runs at their measured partial progress",
    (phase) => {
      const run: Run = {
        id: "failed-fixture",
        workflowId: "bellhaven",
        source: "snapshot",
        status: "failed",
        phase,
        startedAt: "",
        updatedAt: "",
        progress: {
          website: { completed: 1, total: 2 },
          crm: { completed: 7, total: null },
          compare: { completed: 1, total: 4 },
        },
        message: "Incomplete collection",
        errors: [],
        etaSeconds: null,
      };
      expect(stageProgress(run, [])).toEqual({
        scrape: 0.25, compare: 0.25, review: 0,
      });
      expect(stageProgress({ ...run, status: "ready" }, [])).toEqual({
        scrape: 1, compare: 1, review: 1,
      });
      expect(
        stageProgress({ ...run, status: "running", phase: "review" }, []),
      ).toEqual({ scrape: 1, compare: 1, review: 0 });
    },
  );
});
