import type { Counter, Phase, Proposal, Run } from "../../shared/contracts";
export const stages: Phase[] = ["scrape", "compare", "review"];
export function fraction(counter: Counter): number {
  return counter.total !== null && counter.total > 0
    ? Math.min(1, Math.max(0, counter.completed / counter.total))
    : 0;
}
export function reviewProgress(proposals: Proposal[]): Counter {
  return {
    completed: proposals.filter(
      (p) =>
        p.kind === "unchanged" ||
        p.status === "applied" ||
        p.status === "rejected",
    ).length,
    total: proposals.length,
  };
}
export function stageProgress(
  run: Run | null,
  proposals: Proposal[],
): Record<Phase, number> {
  if (!run) return { scrape: 0, compare: 0, review: 0 };
  const phaseIndex = stages.indexOf(run.phase);
  const review = reviewProgress(proposals);
  return {
    scrape:
      (run.status === "running" && phaseIndex > 0) || run.status === "ready"
        ? 1
        : (fraction(run.progress.website) + fraction(run.progress.crm)) / 2,
    compare:
      (run.status === "running" && phaseIndex > 1) || run.status === "ready"
        ? 1
        : fraction(run.progress.compare),
    review: run.status === "ready" && review.total === 0 ? 1 : fraction(review),
  };
}
export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
export function safeUrl(value?: string): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return;
  }
}

export function flattenRecord(
  record: object,
  prefix = "",
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, value]) => {
      const label = prefix ? `${prefix}.${key}` : key;
      return value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
        ? Object.entries(flattenRecord(value, label))
        : [[label, value]];
    }),
  );
}
