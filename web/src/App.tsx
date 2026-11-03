import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  Clock3,
  Globe2,
  History,
  LockKeyhole,
  Play,
  Plus,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  UsersRound,
  Workflow,
  X,
} from "lucide-react";
import type {
  AppState,
  RunDetail,
  Phase,
  Proposal,
  Schedule,
} from "../../shared/contracts";
import { Select } from "@tool-shed/tool-rack";
import { SourceTables, ComparisonView, ActualResult } from "./Evidence";
import { RuleLegend } from "./rules";
import { api, errorMessage } from "./api";
import { fraction, stageProgress, stages } from "./progress";
import { kindLabels, sourceLabels, stageDescriptions } from "./labels";
import { InfoTip, Meter, Modal, ProgressRow } from "./ui";
import ProposalCard from "./ProposalCard";
import Guide from "./Guide";
import ScheduleEditor from "./ScheduleEditor";
import ScheduleGroups from "./ScheduleGroups";
import { UtcClock } from "./Clock";
const emptySettings: AppState["settings"] = {
  credentialsConfigured: false,
  liveWritesEnabled: false,
  snapshotAvailable: false,
};
function dateTime(date?: string) {
  return date ? new Date(date).toLocaleString() : "Not yet";
}
function elapsed(start: string, end: number | string) {
  const seconds = Math.max(
    0,
    Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000),
  );
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
type RunView =
  | { kind: "idle" }
  | { kind: "current"; excludedRunId: string | null }
  | { kind: "saved"; runId: string };

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [runView, setRunView] = useState<RunView>({ kind: "idle" });
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [evidenceError, setEvidenceError] = useState("");
  const [detailVersion, setDetailVersion] = useState(0);
  const [connectionError, setConnectionError] = useState("");
  const [actionError, setActionError] = useState("");
  const [viewPhase, setViewPhase] = useState<Phase | "follow">("follow");
  const [tab, setTab] = useState<"workspace" | "guide">("workspace");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [kindFilter, setKindFilter] = useState("all");
  const [scheduleEditor, setScheduleEditor] = useState<{
    schedule: Schedule | null;
  } | null>(null);
  const [liveApproval, setLiveApproval] = useState<Proposal | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const refresh = useCallback(async () => {
    const fresh = await api.state();
    setState(fresh);
    setRunView((view) =>
      view.kind === "idle" && fresh.run?.status === "running"
        ? { kind: "current", excludedRunId: null }
        : view,
    );
    setConnectionError("");
    return fresh;
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const fresh = await api.state();
        if (!stopped) {
          setState(fresh);
          setRunView((view) =>
            view.kind === "idle" && fresh.run?.status === "running"
              ? { kind: "current", excludedRunId: null }
              : view,
          );
          setConnectionError("");
        }
      } catch (error) {
        if (!stopped) setConnectionError(errorMessage(error));
      }
      if (!stopped) timer = setTimeout(poll, 700);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  function inspectPhase(next: Phase) {
    setViewPhase(next);
    setTab("workspace");
  }
  const activeRun = state?.run ?? null;
  const viewedId =
    runView.kind === "saved"
      ? runView.runId
      : runView.kind === "current" && activeRun?.id !== runView.excludedRunId
        ? activeRun?.id
        : undefined;
  const hasRecordedRuns = state?.runs !== undefined;
  const historyRevision =
    state?.history.map((entry) => entry.id).join("|") ?? "";
  useEffect(() => {
    if (!hasRecordedRuns || !viewedId) {
      setDetail(null);
      setEvidenceError("");
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    setEvidenceError("");
    const load = async () => {
      try {
        const value = await api.runDetail(viewedId);
        if (!stopped) {
          setDetail(value);
          setEvidenceError("");
        }
      } catch (error) {
        if (!stopped) {
          setDetail(null);
          setEvidenceError(errorMessage(error));
          timer = setTimeout(load, 2000);
        }
      }
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [
    hasRecordedRuns,
    viewedId,
    activeRun?.updatedAt,
    historyRevision,
    detailVersion,
  ]);
  const viewedDetail = detail?.run.id === viewedId ? detail : null;
  const historical = Boolean(viewedId && viewedId !== activeRun?.id);
  const run = !viewedId
    ? null
    : historical
      ? (viewedDetail?.run ??
        state?.runs?.find((item) => item.id === viewedId) ??
        null)
      : activeRun;
  const phase = viewPhase === "follow" ? (run?.phase ?? "scrape") : viewPhase;
  const proposals =
    viewedDetail?.proposals ??
    (historical
      ? []
      : (state?.proposals.filter((p) => p.runId === run?.id) ?? []));
  const actionable =
    Boolean(run) &&
    !historical &&
    (!hasRecordedRuns || Boolean(viewedDetail?.actionable));
  const historyEntries = viewedDetail
    ? viewedDetail.events.map((event) => ({
        id: event.id,
        at: event.at,
        proposalId: event.proposalId,
        title:
          viewedDetail.proposals.find(
            (proposal) => proposal.id === event.proposalId,
          )?.title ?? event.proposalId,
        action: event.status,
        source: viewedDetail.run.source,
        detail: event.detail,
      }))
    : hasRecordedRuns || !run
      ? []
      : (state?.history ?? []);
  const settings = state?.settings ?? emptySettings;
  const progress = stageProgress(run, proposals);
  const overall = (progress.scrape + progress.compare + progress.review) / 3;
  const pending = proposals.filter(
    (p) => p.status === "pending" && p.kind !== "unchanged",
  ).length;
  const filtered = proposals.filter(
    (p) => kindFilter === "all" ? p.kind !== "unchanged" : p.kind === kindFilter,
  );
  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    setActionError("");
    try {
      await work();
      await refresh();
      setDetailVersion((version) => version + 1);
      return true;
    } catch (error) {
      setActionError(errorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function startRun() {
    setViewPhase("follow");
    setRunView({ kind: "current", excludedRunId: activeRun?.id ?? null });
    setDetail(null);
    setEvidenceError("");
    setLiveApproval(null);
    setConfirmed(false);
    await action(() => api.run("live"));
  }
  async function decide(p: Proposal, decision: "approve" | "reject") {
    if (!actionable) return;
    if (decision === "approve" && p.source === "live") {
      setConfirmed(false);
      setLiveApproval(p);
      return;
    }
    await action(() =>
      api.decide(p.id, { decision, revision: p.revision, runId: p.runId }),
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-content">
          <a
            className="brand"
            href="#workspace"
            onClick={() => setTab("workspace")}
          >
            <span className="brand-mark">
              <Workflow size={23} />
            </span>
            <span>
              Automations<span className="brand-small">REVIEW STUDIO</span>
            </span>
          </a>
          <div className="sidebar-section">
            <div className="nav-heading">
              <Workflow size={19} />
              <strong>Automations</strong>
              <InfoTip label="automations">
                Workflows collect sources, compare records and prepare changes
                for your review.
              </InfoTip>
            </div>
            <button
              className="workflow-nav"
              onClick={() => setTab("workspace")}
            >
              <Building2 size={19} />
              <strong>Bellhaven</strong>
              <ChevronDown size={16} />
            </button>
            <div className="stage-nav">
              <div className="stage-track" aria-label="Scrape connector">
                <span style={{ height: `${progress.scrape * 100}%` }} />
              </div>
              <div
                className="stage-track compare-track"
                aria-label="Compare connector"
              >
                <span style={{ height: `${progress.compare * 100}%` }} />
              </div>
              {stages.map((stage, index) => (
                <div className="stage-item" key={stage}>
                  <button
                    className={`stage-link ${tab === "workspace" && phase === stage ? "selected" : ""}`}
                    onClick={() => {
                      inspectPhase(stage);
                    }}
                    aria-current={
                      tab === "workspace" && phase === stage
                        ? "step"
                        : undefined
                    }
                  >
                    <span
                      aria-hidden="true"
                      className={`stage-dot ${run?.status !== "failed" && progress[stage] === 1 ? "done" : ""}`}
                    >
                      {run?.status !== "failed" && progress[stage] === 1 ? (
                        <Check size={12} />
                      ) : (
                        <span>{index + 1}</span>
                      )}
                    </span>
                    <span>{stage[0].toUpperCase() + stage.slice(1)}</span>
                  </button>
                  <InfoTip label={stage}>{stageDescriptions[stage]}</InfoTip>
                </div>
              ))}
            </div>
          </div>
          <div className="sidebar-section schedules-section">
            <div className="nav-heading">
              <CalendarClock size={19} />
              <strong>Schedules</strong>
              <InfoTip label="schedules">
                Scheduled runs prepare proposals. Keep this local server awake.
                Each real change still needs your approval.
              </InfoTip>
              <button
                className="icon-button small"
                aria-label="New schedule"
                disabled={!state}
                onClick={() => setScheduleEditor({ schedule: null })}
              >
                <Plus size={17} />
              </button>
            </div>
            <ScheduleGroups
              schedules={state?.schedules ?? []}
              edit={(schedule) => setScheduleEditor({ schedule })}
            />
            {!state?.schedules.length && (
              <button
                className="empty-schedule"
                disabled={!state}
                onClick={() => setScheduleEditor({ schedule: null })}
              >
                Create a schedule <Plus size={14} />
              </button>
            )}
          </div>
          <div className="sidebar-foot">
            <span
              className={`connection-dot ${connectionError ? "offline" : ""}`}
            />
            <span>
              {connectionError
                ? "Connection interrupted"
                : state
                  ? "Local workspace connected"
                  : "Connecting to workspace"}
            </span>
            <InfoTip label="local workspace">
              State refreshes from the local server approximately every 700
              milliseconds. Credentials never appear in the browser.
            </InfoTip>
          </div>
        </div>
      </aside>
      <main id="workspace">
        <header className="topbar">
          <nav className="tabs" aria-label="Bellhaven views">
            <button
              className={tab === "workspace" ? "active" : ""}
              onClick={() => setTab("workspace")}
            >
              Workspace
            </button>
            <button
              className={tab === "guide" ? "active" : ""}
              onClick={() => setTab("guide")}
            >
              How it works
            </button>
          </nav>
          <UtcClock />
        </header>
        {connectionError && (
          <p className="notice error" role="alert">
            Connection interrupted. {connectionError} Displayed data may be out
            of date.
          </p>
        )}
        {actionError && (
          <p className="notice error" role="alert">
            {actionError}
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setActionError("")}
            >
              <X size={16} />
            </button>
          </p>
        )}
        {tab === "guide" ? (
          <Guide />
        ) : (
          <>
            <div className="workspace-heading">
              <div>
                <div className="title-line">
                  <h1>{phase[0].toUpperCase() + phase.slice(1)}</h1>
                  <InfoTip label={`${phase} view`}>
                    {stageDescriptions[phase]}
                  </InfoTip>
                </div>
                {historical ? (
                  <span className="badge read-only">
                    <LockKeyhole size={13} /> Historical · read-only
                  </span>
                ) : viewedDetail && !viewedDetail.actionable ? (
                  <span className="badge read-only">
                    <LockKeyhole size={13} /> Read-only run
                  </span>
                ) : null}
                {run?.source === "snapshot" && (
                  <span className="badge">Saved snapshot</span>
                )}
                {run?.status === "failed" && (
                  <span className="badge failed-run">Run failed</span>
                )}
              </div>
              <div className="header-progress">
                <div className="header-progress-row">
                  <span>
                    Workflow
                    <InfoTip label="workflow progress">
                      Scrape, Compare and Review each contribute one third of
                      workflow progress.
                    </InfoTip>
                  </span>
                  <Meter value={overall} label="Overall workflow progress" />
                  <strong>{Math.round(overall * 100)}%</strong>
                </div>
                <div className="header-progress-row">
                  <span>
                    {phase[0].toUpperCase() + phase.slice(1)}
                    <InfoTip label="stage progress">
                      {phase === "review"
                        ? "Applied, rejected and unchanged proposals count as resolved. Failed, stale and uncertain changes remain unresolved."
                        : "Measured from the selected run's source and comparison counters."}
                    </InfoTip>
                  </span>
                  <Meter
                    value={progress[phase]}
                    label={`${phase} stage progress`}
                  />
                  <strong>{Math.round(progress[phase] * 100)}%</strong>
                </div>
                {run && (
                  <div className="header-timing">
                    <Clock3 size={13} />
                    <span>
                      Elapsed {elapsed(run.startedAt, run.finishedAt ?? now)}
                    </span>
                    {run.status === "running" && run.etaSeconds != null && (
                      <span>
                        Estimated {Math.ceil(run.etaSeconds)} sec remaining
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="run-controls">
                <button
                  className="run-button"
                  disabled={
                    !state ||
                    busy ||
                    activeRun?.status === "running" ||
                    Boolean(connectionError) ||
                    !settings.credentialsConfigured
                  }
                  onClick={startRun}
                >
                  {activeRun?.status === "running" ? (
                    <RefreshCw size={17} className="spin" />
                  ) : (
                    <Play size={17} fill="currentColor" />
                  )}
                  {activeRun?.status === "running" ? "Running" : "Run workflow"}
                </button>
              </div>
            </div>
            {evidenceError && (
              <p className="notice error" role="alert">
                Could not load this run's evidence. {evidenceError}
              </p>
            )}
            {viewedDetail?.evidenceQuality === "legacy-partial" &&
              viewedDetail.run.status !== "running" && (
                <p className="notice warning">
                  Legacy run · only the evidence actually recorded at the time
                  is available.
                </p>
              )}
            {state && !settings.credentialsConfigured && (
              <p className="notice warning">
                <LockKeyhole size={18} />
                Configure your own CRM credentials in the local .env file,
                then restart the server to run fresh data. See the repository
                setup instructions.
              </p>
            )}
            {run?.errors.map((error, i) => (
              <p className="notice error" role="alert" key={i}>
                {error}
              </p>
            ))}
            {phase === "scrape" && (
              <section className="card progress-card">
                <div className="card-heading">
                  <div className="heading-with-info">
                    <h2>Collecting sources</h2>
                    <InfoTip label="collecting sources">
                      Counts come directly from the server. Totals remain
                      unknown while discovery is incomplete.
                    </InfoTip>
                  </div>
                </div>
                <ProgressRow
                  icon={<Globe2 size={27} />}
                  title="Website"
                  unit="pages"
                  counter={
                    run?.progress.website ?? { completed: 0, total: null }
                  }
                  value={
                    run && run.status !== "failed" && progress.scrape === 1
                      ? 1
                      : fraction(
                          run?.progress.website ?? {
                            completed: 0,
                            total: null,
                          },
                        )
                  }
                />
                <ProgressRow
                  icon={<UsersRound size={27} />}
                  title="CRM"
                  unit="accounts"
                  counter={run?.progress.crm ?? { completed: 0, total: null }}
                  value={
                    run && run.status !== "failed" && progress.scrape === 1
                      ? 1
                      : fraction(
                          run?.progress.crm ?? { completed: 0, total: null },
                        )
                  }
                />
              </section>
            )}
            {phase === "scrape" && <SourceTables detail={viewedDetail} />}
            {phase === "compare" && (
              <section className="card progress-card">
                <div className="card-heading">
                  <div className="heading-with-info">
                    <h2>Comparing records</h2>
                    <InfoTip label="comparing records">
                      The engine compares identities across all parent accounts,
                      preserves billing history and explains each proposal.
                    </InfoTip>
                  </div>
                  <span className="badge">
                    <SearchCheck size={15} />
                    {proposals.length} proposals
                  </span>
                </div>
                <ProgressRow
                  icon={<SearchCheck size={27} />}
                  title="Comparison"
                  unit="locations"
                  counter={
                    run?.progress.compare ?? { completed: 0, total: null }
                  }
                  value={progress.compare}
                />
                <div className="kind-overview">
                  {Object.entries(kindLabels).map(([kind, label]) => (
                    <button
                      key={kind}
                      onClick={() => {
                        setKindFilter(kind);
                        inspectPhase("review");
                      }}
                    >
                      <strong>
                        {proposals.filter((p) => p.kind === kind).length}
                      </strong>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {phase === "compare" && <ComparisonView detail={viewedDetail} />}
            {phase === "review" && (
              <section className="review-section">
                <div className="review-toolbar">
                  <div className="heading-with-info">
                    <h2>{pending} to review</h2>
                    <InfoTip label="review outcomes">
                      Approved and rejected decisions count as resolved. Changes
                      that need investigation remain visible. Unchanged records
                      need no decision.
                    </InfoTip>
                  </div>
                  <div className="filters">
                    <label>
                      <span className="sr-only">Filter proposal kind</span>
                      <Select
                        value={kindFilter}
                        onChange={(e) => setKindFilter(e.target.value)}
                      >
                        <option value="all">All changes</option>
                        {Object.entries(kindLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </div>
                </div>
                <RuleLegend />
                {filtered.length ? (
                  <div className="proposal-list">
                    {filtered.map((p) => (
                      <ProposalCard
                        key={p.id}
                        proposal={p}
                        decide={decide}
                        busy={busy}
                        liveEnabled={settings.liveWritesEnabled}
                        readOnly={!actionable}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="card empty-state">
                    <SearchCheck size={32} />
                    <h2>
                      {proposals.length
                        ? "No matching proposals"
                        : run?.status === "running"
                          ? "Comparison is still running"
                          : "Your review queue is clear"}
                    </h2>
                    <p>
                      {proposals.length
                        ? "Try another filter to see the rest of this run."
                        : run
                          ? "Proposals will appear here when the comparison is ready."
                          : "Run the workflow to prepare proposals."}
                    </p>
                  </div>
                )}
              </section>
            )}
            <details className="history-panel">
              <summary>
                <History size={17} />
                <span>Run history</span>
                <span className="badge">{state?.runs?.length ?? historyEntries.length}</span>
                <ChevronDown size={16} />
              </summary>
              <div className="history-content">
                {state?.runs && (
                  <div className="saved-run-bar">
                    <label>
                      Saved run
                      <Select
                        aria-label="Saved run"
                        value={
                          runView.kind === "saved" ? runView.runId : (viewedId ?? "")
                        }
                        onChange={(event) => {
                          const id = event.target.value;
                          setRunView(
                            id ? { kind: "saved", runId: id } : { kind: "idle" },
                          );
                          setDetail(null);
                          setEvidenceError("");
                          setLiveApproval(null);
                          setConfirmed(false);
                          setViewPhase("follow");
                        }}
                      >
                        <option value="">Empty workspace</option>
                        {state.runs.map((item) => (
                          <option value={item.id} key={item.id}>
                            {dateTime(item.startedAt)} ·{" "}
                            {sourceLabels[item.source]} · {item.proposalCount}{" "}
                            proposals
                            {!item.evidenceAvailable && item.status !== "running"
                              ? " · legacy partial"
                              : ""}
                          </option>
                        ))}
                      </Select>
                    </label>
                  </div>
                )}
                {run && (
                  <p className="run-provenance">
                    {sourceLabels[run.source]} · {dateTime(run.startedAt)}
                  </p>
                )}
                {viewedDetail?.result && viewedDetail.input && (
                  <details className="recorded-result">
                    <summary>Actual local result</summary>
                    <ActualResult detail={viewedDetail} />
                  </details>
                )}
                {historyEntries.length ? (
                  historyEntries.map((entry) => (
                    <div
                      className={`history-row ${entry.action === "rejected" ? "rejected-event" : ""}`}
                      key={entry.id}
                    >
                      <span className="history-icon">
                        <History size={14} />
                      </span>
                      <div>
                        <strong>{entry.title}</strong>
                        <p>
                          {entry.action === "applied" ? "Approved · " : entry.action === "rejected" ? "Rejected · " : ""}
                          {sourceLabels[entry.source]} ·{" "}
                          {entry.detail}
                        </p>
                      </div>
                      <time dateTime={entry.at}>{dateTime(entry.at)}</time>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    Decisions and executions will appear here.
                  </p>
                )}
              </div>
            </details>
          </>
        )}
      </main>
      {scheduleEditor && state && (
        <ScheduleEditor
          schedule={scheduleEditor.schedule}
          state={state}
          close={() => setScheduleEditor(null)}
          save={async (body, id) => {
            await api.saveSchedule(body, id);
            await refresh();
          }}
        />
      )}
      {liveApproval && (
        <Modal
          title="Approve a real CRM change"
          onClose={() => setLiveApproval(null)}
        >
          <p>
            This will apply <strong>{liveApproval.title}</strong> to the live
            CRM.
          </p>
          <p className="notice warning">
            <ShieldCheck size={18} />
            The server will recheck this exact revision and current billing
            data. An approved write changes real records.
          </p>
          <p>{liveApproval.reason}</p>
          <label className="checkbox-label live-confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I have reviewed the evidence and authorize this real change.
          </label>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setLiveApproval(null)}>
              Cancel
            </button>
            <button
              disabled={
                !confirmed ||
                busy ||
                !actionable ||
                liveApproval.runId !== activeRun?.id
              }
              onClick={async () => {
                if (
                  await action(() =>
                    api.decide(liveApproval.id, {
                      decision: "approve",
                      revision: liveApproval.revision,
                      runId: liveApproval.runId,
                      confirmLive: true,
                    }),
                  )
                )
                  setLiveApproval(null);
              }}
            >
              {busy ? "Applying…" : "Approve live change"}
            </button>
          </div>
          {actionError && (
            <p role="alert" className="notice error">
              {actionError}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
