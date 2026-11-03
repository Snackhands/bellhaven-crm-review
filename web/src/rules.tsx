import {
  ArrowUpRight,
  Building2,
  Copy,
  GitBranch,
  HelpCircle,
  Landmark,
  Link2Off,
  ShieldAlert,
  TriangleAlert,
  UsersRound,
  Check,
} from "lucide-react";
import type { RuleCode } from "../../shared/contracts";

export const rules = {
  field_update: {
    label: "Field update",
    color: "#235ca0",
    background: "#eaf2ff",
    icon: ArrowUpRight,
    route: "Identity established → listed fields differ → propose update",
  },
  new_account: {
    label: "New account",
    color: "#286344",
    background: "#e9f5e9",
    icon: Building2,
    route: "Complete sources → no competing match → propose new account",
  },
  duplicate: {
    label: "Duplicate",
    color: "#6b4494",
    background: "#f1ebfa",
    icon: Copy,
    route:
      "Same corroborated identity and care → safe survivor → retire zero-billing duplicate",
  },
  ownership_change: {
    label: "Ownership change",
    color: "#77591e",
    background: "#f8f0d9",
    icon: GitBranch,
    route: "Parent differs → check revenue and AR",
    branches: [
      "Both values positive → approve a clean successor and only the old CHOW link; preserve all other old fields.",
      "Either value zero, with both finances valid → approve direct re-parenting.",
      "Missing or malformed finances → billing ambiguity; approval blocked.",
    ],
  },
  identity_ambiguity: {
    label: "Uncertain identity",
    color: "#825608",
    background: "#fff3d9",
    icon: HelpCircle,
    route:
      "Possible match → insufficient independent evidence → manual inspection",
  },
  competing_accounts: {
    label: "Competing accounts",
    color: "#a14335",
    background: "#ffede6",
    icon: UsersRound,
    route: "Multiple strong matches → conflicting identity → manual inspection",
  },
  billing_ambiguity: {
    label: "Billing ambiguity",
    color: "#824566",
    background: "#f9eaf3",
    icon: Landmark,
    route:
      "Billing, campus or PO Box ambiguity, or missing/malformed revenue or AR → manual inspection; approval blocked",
  },
  missing_from_website: {
    label: "Absent from website",
    color: "#506073",
    background: "#edf0f4",
    icon: Link2Off,
    route:
      "No website match → approve Needs Review status + append an evidence note only. Preserve ownership and billing; do not infer sale or closure. Already flagged → no change.",
  },
  incomplete_sources: {
    label: "Incomplete sources",
    color: "#a12e31",
    background: "#ffebeb",
    icon: ShieldAlert,
    route: "Source collection incomplete → block automatic account changes",
  },
  unchanged: {
    label: "Unchanged",
    color: "#526454",
    background: "#eef1e9",
    icon: Check,
    route:
      "Identity established → fields and parent agree → no decision needed",
  },
} satisfies Record<
  RuleCode,
  {
    label: string;
    color: string;
    background: string;
    icon: typeof Check;
    route: string;
    branches?: readonly string[];
  }
>;
export const ruleCodes = Object.keys(rules).filter(
  (code): code is RuleCode => code in rules,
);
export function RuleFlag({ code }: { code?: RuleCode }) {
  if (!code)
    return (
      <span className="badge">
        <TriangleAlert size={13} />
        Rule not recorded
      </span>
    );
  const rule = rules[code];
  const Icon = rule.icon;
  return (
    <span
      className="rule-flag"
      style={{
        color: rule.color,
        background: rule.background,
        borderColor: rule.color,
      }}
    >
      <Icon size={14} />
      {rule.label}
    </span>
  );
}
export function RuleLegend() {
  return (
    <details className="rule-legend">
      <summary>Rule legend</summary>
      <div>
        {ruleCodes.map((code) => (
          <RuleFlag code={code} key={code} />
        ))}
      </div>
    </details>
  );
}
