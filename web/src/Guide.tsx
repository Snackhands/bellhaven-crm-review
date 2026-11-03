import { useCallback, useId, useRef, useState } from "react";
import { ArrowRight, GitCompareArrows, Globe2, ShieldCheck } from "lucide-react";
import { DialogSurface } from "@tool-shed/tool-rack";
import type { RuleCode } from "../../shared/contracts";
import { guideStages, type GuideNode, type GuideStage } from "./guide-data";
import { RuleFlag, ruleCodes, rules } from "./rules";
import "./guide.css";

type Selection = { kind: "node"; node: GuideNode } | { kind: "rule"; code: RuleCode };
const stageIcons = { scrape: Globe2, compare: GitCompareArrows, review: ShieldCheck };

function Flowchart({ stage, selected, select }: {
  stage: GuideStage;
  selected: Selection;
  select: (selection: Selection) => void;
}) {
  const marker = useId();
  const height = (Math.max(...stage.nodes.map((node) => node.row)) + 1) * 124;
  const center = (node: GuideNode) => ({ x: 150 + node.column * 300, y: 44 + node.row * 124 });
  return (
    <div className="guide-flowchart" aria-label={`${stage.title} flowchart`} style={{ height }}>
      <svg viewBox={`0 0 900 ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="currentColor" /></marker></defs>
        {stage.edges.map((edge) => {
          const from = stage.nodes.find((node) => node.id === edge.from);
          const to = stage.nodes.find((node) => node.id === edge.to);
          if (!from || !to) return null;
          const a = center(from), b = center(to);
          const sameRow = a.y === b.y;
          const startY = a.y + 32;
          const endY = sameRow ? b.y + 36 : b.y - 35;
          const middleY = sameRow ? a.y + 56 : (startY + endY) / 2;
          return <path key={`${edge.from}-${edge.to}`} d={`M ${a.x} ${startY} V ${middleY} H ${b.x} V ${endY}`} markerEnd={`url(#${marker})`} />;
        })}
      </svg>
      {stage.edges.map((edge) => {
        const from = stage.nodes.find((node) => node.id === edge.from);
        const to = stage.nodes.find((node) => node.id === edge.to);
        if (!from || !to) return null;
        const a = center(from), b = center(to);
        const sameRow = a.y === b.y;
        const labelX = from.row === 0 && from.column !== to.column ? a.x : b.x;
        return <span key={`${edge.from}-${edge.to}`} className="guide-edge-label" style={{ left: `${(sameRow ? (a.x + b.x) / 2 : labelX) / 9}%`, top: sameRow ? a.y + 56 : (a.y + b.y) / 2 }}>{edge.label}</span>;
      })}
      {stage.nodes.map((node) => (
        <button type="button" key={node.id} className="guide-graph-node" data-kind={node.kind}
          aria-pressed={selected.kind === "node" && selected.node.id === node.id}
          style={{ left: `${(150 + node.column * 300) / 9}%`, top: 44 + node.row * 124 }}
          onClick={() => select({ kind: "node", node })}>
          <span>{node.kind}</span><strong>{node.label}</strong>
        </button>
      ))}
    </div>
  );
}

const comparePositions: Record<string, { x: number; y: number; width: number }> = {
  website: { x: 78, y: 90, width: 148 },
  crm: { x: 78, y: 250, width: 148 },
  identity: { x: 300, y: 170, width: 146 },
  business: { x: 518, y: 170, width: 156 },
  proposed: { x: 794, y: 50, width: 164 },
  inspect: { x: 794, y: 170, width: 164 },
  aligned: { x: 794, y: 290, width: 164 },
};
const compareOutcomeRules: Partial<Record<string, RuleCode>> = {
  proposed: "field_update", inspect: "identity_ambiguity", aligned: "unchanged",
};

function CompareFlowchart({ stage, selected, select }: {
  stage: GuideStage;
  selected: Selection;
  select: (selection: Selection) => void;
}) {
  const marker = useId();
  const edges = stage.edges.map((edge) => {
    const from = comparePositions[edge.from], to = comparePositions[edge.to];
    const startX = from.x + from.width / 2;
    const endX = to.x - to.width / 2;
    const bendX = edge.from === "business" ? 636 : (startX + endX) / 2;
    return {
      ...edge,
      path: `M ${startX} ${from.y} H ${bendX} V ${to.y} H ${endX}`,
      labelX: edge.from === "business" ? 674 : (startX + endX) / 2,
      labelY: edge.from === "identity" ? from.y - 23 : edge.from === "business" ? to.y : from.y,
    };
  });
  return (
    <div className="guide-compare-scroll" role="region" aria-label="Compare map, scroll horizontally" tabIndex={0}>
      <div className="guide-flowchart guide-compare-flowchart" aria-label={`${stage.title} flowchart`}>
        <svg viewBox="0 0 880 340" preserveAspectRatio="none" aria-hidden="true">
          <defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="context-stroke" /></marker></defs>
          {edges.map((edge) => {
            const outcomeCode = compareOutcomeRules[edge.to];
            return <path key={`${edge.from}-${edge.to}`} data-from={edge.from} data-to={edge.to}
              d={edge.path} style={{ color: outcomeCode && rules[outcomeCode].color }} markerEnd={`url(#${marker})`} />;
          })}
        </svg>
        {edges.map((edge) => <span key={`${edge.from}-${edge.to}`} className="guide-edge-label"
          style={{ left: `${edge.labelX / 8.8}%`, top: edge.labelY, width: edge.from === "identity" ? 64 : undefined }}>{edge.label}</span>)}
        {stage.nodes.map((node) => {
          const position = comparePositions[node.id];
          const outcomeCode = compareOutcomeRules[node.id];
          const outcome = outcomeCode ? rules[outcomeCode] : null;
          return <button type="button" key={node.id} className="guide-graph-node" data-kind={node.kind} data-node={node.id}
            aria-label={`${node.kind}: ${node.label}`} aria-pressed={selected.kind === "node" && selected.node.id === node.id}
            style={{ left: `${position.x / 8.8}%`, top: position.y, width: `${position.width / 8.8}%`,
              color: outcome?.color, background: outcome?.background, borderColor: outcome?.color }}
            onClick={() => select({ kind: "node", node })}>
            <span>{node.kind}</span><strong>{node.label}</strong>
          </button>;
        })}
      </div>
    </div>
  );
}

function StageContent({ stage }: { stage: GuideStage }) {
  const [selected, select] = useState<Selection>({ kind: "node", node: stage.nodes[0] });
  const node = selected.kind === "node" ? selected.node : null;
  const rule = selected.kind === "rule" ? rules[selected.code] : null;
  return (
    <div className="guide-stage-content">
      {stage.id === "scrape" && <p className="guide-replay-note">Live scan reads the website + CRM API. Saved snapshot replays the preserved local capture.</p>}
      <div className={`guide-stage-layout${stage.id === "compare" ? " guide-stage-layout--compare" : ""}`}>
        <div>
          <p className="guide-diagram-hint">Select a node to see its explanation.</p>
          {stage.id === "compare" ? <>
            <CompareFlowchart stage={stage} selected={selected} select={select} />
            <p className="guide-pan-hint">Swipe or scroll the map to follow the full flow.</p>
          </> : <Flowchart stage={stage} selected={selected} select={select} />}
          {stage.id === "compare" && <div className="guide-rule-picker" aria-label="Business rule routes">
            <h3>Explore every rule</h3>
            <div>{ruleCodes.map((code) => <button type="button" key={code} aria-pressed={selected.kind === "rule" && selected.code === code}
              onClick={() => select({ kind: "rule", code })}><RuleFlag code={code} /></button>)}</div>
          </div>}
        </div>
        <aside className="guide-node-detail" aria-label="Selected explanation" aria-live="polite">
          {node && <><span className="guide-detail-kind">{node.kind}</span><h3>{node.label}</h3><p>{node.detail}</p>
            {node.rules && <div className="guide-detail-rules">{node.rules.map((code) => <button type="button" key={code} onClick={() => select({ kind: "rule", code })}><RuleFlag code={code} /><ArrowRight size={14} /></button>)}</div>}
          </>}
          {rule && selected.kind === "rule" && <><RuleFlag code={selected.code} /><h3>{rule.label}</h3><p>{rule.route}</p>
            {selected.code === "ownership_change" && <ul>{rules.ownership_change.branches.map((branch) => <li key={branch}>{branch}</li>)}</ul>}
            {selected.code === "duplicate" && <p>Retire and link only a supported zero-billing loser with zero revenue and zero AR to a safe survivor. Never delete an account or retire a historical CHOW record.</p>}
            {selected.code === "unchanged" && <p>No action needed · no approval.</p>}
          </>}
        </aside>
      </div>
      <div className="guide-stage-output"><ArrowRight size={18} /><span>Output</span><strong>{stage.output}</strong></div>
    </div>
  );
}

export default function Guide() {
  const [stage, setStage] = useState<GuideStage | null>(null);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const resetDialogScroll = useCallback(() => {
    const dialog = contentRef.current?.closest("dialog");
    if (dialog) {
      dialog.scrollTop = 0;
      dialog.scrollLeft = 0;
    }
    const compareMap = contentRef.current?.querySelector<HTMLElement>(".guide-compare-scroll");
    if (compareMap) compareMap.scrollLeft = 0;
  }, []);
  return (
    <section className="guide guide-overview">
      <div className="section-heading"><h1>How it works</h1></div>
      <p className="guide-intro">From source evidence to a decision you can check. Explore each stage.</p>
      <div className="guide-stage-tiles" aria-label="Workflow stages">
        {guideStages.map((item, index) => {
          const Icon = stageIcons[item.id];
          return <button type="button" className="guide-stage-tile" key={item.id} aria-haspopup="dialog" aria-label={`Explore ${item.title}`}
            onClick={(event) => { triggerRef.current = event.currentTarget; setStage(item); setOpen(true); }}>
            <span className="guide-tile-top"><Icon size={28} /><span>0{index + 1}</span></span>
            <strong>{item.title}</strong><span>{item.summary}</span><span className="guide-tile-open">Explore stage <ArrowRight size={18} /></span>
          </button>;
        })}
      </div>
      <p className="guide-explainer-note">These diagrams explain the workflow. Your source tables, findings and recorded results live in Workspace.</p>
      {stage && <DialogSurface open={open} onClose={() => setOpen(false)} title={stage.title} subtitle={stage.summary}
        triggerRef={triggerRef} onVisible={resetDialogScroll} panelSelector=".sidebar" className="guide-workspace-dialog">
        <div ref={contentRef}><StageContent key={stage.id} stage={stage} /></div>
      </DialogSurface>}
    </section>
  );
}
