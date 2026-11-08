import { useState, type CSSProperties, type ReactNode } from "react";
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";

import {
  runsOf,
  visibleRuns,
  type RunNode,
  type VisibleRun,
} from "@/lib/step-flow";
import { rpcContract } from "@/lib/rpc";
import {
  STEP_KINDS,
  type ChildThread,
  type Step,
  type StepKind,
} from "@/lib/steps";
import { FOCUS_RING, PANEL_ROW } from "@/lib/styles";
import { formatElapsed, formatOffset } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Collapsible, Disclosure } from "./disclosure";
import { Icon } from "./ui/icon";

export type OpenFile = ((path: string) => void) | null;

/** What every row in one list shares. */
export interface RowContext {
  threadId: string;
  turns: number;
  turnStartedAt: number;
  turnEndedAt: number;
  now: number;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  openFile: OpenFile;
}

const SMALL_BUTTON = `inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-2xs text-muted-foreground hover:bg-accent/60 hover:text-foreground ${FOCUS_RING}`;

const PROSE_CLAMP_CHARS = 320;

const CODE_BLOCK =
  "m-0 max-h-48 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-2xs leading-relaxed break-all whitespace-pre-wrap text-foreground/80";

/** Name column and timeline column of a waterfall row, and of its time axis. */
export const WATERFALL_COLUMNS =
  "grid grid-cols-[minmax(0,min(56%,18rem))_minmax(0,1fr)_4rem]";

/** Each level of nesting steps right by this. */
const INDENT = 16;

/** A run's own time; a folded run is its steps' time, without the gaps. */
const lengthOfRun = (run: RunNode, now: number): number =>
  run.count === null
    ? Math.max((run.endedAt ?? now) - run.startedAt, 0)
    : run.children.reduce((sum, child) => sum + lengthOfRun(child, now), 0);

function Node({
  kind,
  icon,
  running = false,
  failed = false,
}: {
  kind: StepKind;
  icon: string;
  running?: boolean;
  failed?: boolean;
}) {
  return (
    <Icon
      name={running ? "Spinner" : icon}
      fallback="Zap"
      aria-hidden
      className={cn(
        "size-4 shrink-0",
        kind === "think" && "text-muted-foreground",
        failed && "text-destructive-text",
        running && "animate-spin motion-reduce:animate-none",
      )}
      style={kind === "think" || failed ? undefined : { color: STEP_KINDS[kind].color }}
    />
  );
}

function Prose({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  const long = text.length > PROSE_CLAMP_CHARS || text.split("\n").length > 6;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <p
        className={cn(
          "m-0 whitespace-pre-wrap text-xs leading-relaxed text-foreground/80",
          long && !all && "line-clamp-6",
        )}
      >
        {text}
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setAll((current) => !current)}
          className={cn(SMALL_BUTTON, "-ml-1.5")}
        >
          {all ? "Show less" : "Show all"}
        </button>
      ) : null}
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="m-0 text-xs font-medium text-foreground">{title}</h4>
      {children}
    </section>
  );
}

function StepOutput({ step, context }: { step: Step; context: RowContext }) {
  const { data, error } = experimental_useRpcQuery({
    contract: rpcContract,
    method: "step_output",
    input: { threadId: context.threadId, stepId: step.id, turns: context.turns },
  });
  if (error !== null)
    return (
      <DetailSection title="Output">
        <p className="m-0 text-2xs text-muted-foreground">Could not read the output.</p>
      </DetailSection>
    );
  if (data === undefined || data.output === null) return null;
  return (
    <DetailSection title="Output">
      {STEP_KINDS[step.kind].detail === "code" ? (
        <pre className={CODE_BLOCK}>{data.output}</pre>
      ) : (
        <Prose text={data.output} />
      )}
    </DetailSection>
  );
}

const STATUS_WORD: Record<Step["status"], string> = {
  running: "Running",
  done: "Success",
  error: "Failed",
  interrupted: "Stopped",
};

const clockTime = (time: number): string =>
  new Date(time).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

function StepFacts({ step }: { step: Step }) {
  return (
    <p className="m-0 inline-flex flex-wrap items-center gap-x-1.5 text-2xs tabular-nums text-muted-foreground">
      {step.status === "done" ? (
        <Icon name="Check" className="size-3 text-success-foreground" aria-hidden />
      ) : null}
      <span>{STATUS_WORD[step.status]}</span>
      <span>
        {clockTime(step.startedAt)}
        {step.endedAt === null ? "" : ` to ${clockTime(step.endedAt)}`}
      </span>
    </p>
  );
}

function StepDetail({ step, context }: { step: Step; context: RowContext }) {
  const { path } = step;
  const { openFile } = context;
  const thought = step.kind === "think";
  return (
    <div className="flex flex-col gap-2 pt-1 pr-2 pb-3">
      <StepFacts step={step} />
      {step.detail === null ? null : (
        <DetailSection title={thought ? "Thinking" : "Input"}>
          {STEP_KINDS[step.kind].detail === "code" ? (
            <pre className={CODE_BLOCK}>{step.detail}</pre>
          ) : (
            <Prose text={step.detail} />
          )}
        </DetailSection>
      )}
      {thought || step.status === "running" ? null : (
        <StepOutput step={step} context={context} />
      )}
      {path === null || openFile === null ? null : (
        <button
          type="button"
          onClick={() => openFile(path)}
          className={cn(SMALL_BUTTON, "-ml-1.5 self-start")}
        >
          <Icon name="FileText" className="size-3.5" aria-hidden />
          Open file
        </button>
      )}
    </div>
  );
}

/** A run's bar at its real place on the turn's time axis. */
function Bars({ row, context }: { row: VisibleRun; context: RowContext }) {
  const { node } = row;
  const { now, turnStartedAt, turnEndedAt } = context;
  const wall = Math.max(turnEndedAt - turnStartedAt, 1);
  const percent = (time: number) =>
    Math.min(Math.max(((time - turnStartedAt) / wall) * 100, 0), 100);
  const from = percent(node.startedAt);
  const to = percent(node.endedAt ?? now);
  const running = node.status === "running";
  const segment = (start: number, end: number, key?: string) => (
    <span
      key={key}
      className={cn(
        "absolute inset-y-0 min-w-0.5 rounded-[2px]",
        node.status === "error"
          ? "bg-destructive-text"
          : running
            ? "animate-pulse bg-primary motion-reduce:animate-none"
            : "bg-foreground/40 group-hover/run:bg-foreground/60",
      )}
      style={{ left: `${start}%`, width: `${end - start}%` }}
    />
  );
  return (
    <span className="relative block h-full">
      <span className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2">
        {node.count === null ? (
          segment(from, to)
        ) : (
          <>
            <span
              className="absolute inset-y-0 rounded-[2px] bg-foreground/[0.07]"
              style={{ left: `${from}%`, width: `${to - from}%` }}
            />
            {node.children.map((child) =>
              segment(
                percent(child.startedAt),
                percent(child.endedAt ?? now),
                child.id,
              ),
            )}
          </>
        )}
      </span>
    </span>
  );
}

/** Turns read for an opened thread, so its output can be found again. */
const THREAD_TURNS = 40;

/** A thread started from this one, opened in place on the same timeline. */
function ThreadSteps({
  thread,
  depth,
  context,
}: {
  thread: ChildThread;
  depth: number;
  context: RowContext;
}) {
  const { data, error } = experimental_useRpcQuery({
    contract: rpcContract,
    method: "thread_run",
    input: { threadId: thread.id },
  });
  const note = (text: string) => (
    <p
      className="m-0 py-1 pr-2 text-2xs text-muted-foreground"
      style={{ paddingLeft: INDENT * depth + 8 }}
    >
      {text}
    </p>
  );
  if (error !== null) return note("Could not read this thread's steps.");
  if (data === undefined) return note("Loading steps…");
  const steps = data.steps.filter((step) => step.kind !== "think");
  if (steps.length === 0) return note("No steps in this thread yet.");
  return (
    <StepFlow
      steps={steps}
      depth={depth}
      context={{ ...context, threadId: thread.id, turns: THREAD_TURNS }}
    />
  );
}

function RunRow({ row, context }: { row: VisibleRun; context: RowContext }) {
  const { node, depth } = row;
  const open = context.expanded.has(node.id);
  const length = lengthOfRun(node, context.now);
  const offset = formatOffset(node.startedAt - context.turnStartedAt);
  const indent = INDENT * depth;
  return (
    <li data-step={node.id} className="list-none">
      <button
        type="button"
        aria-expanded={open}
        title={`${node.title}\n${node.place}\nStarted at ${offset}, took ${formatElapsed(length)}`}
        onClick={() => context.onToggle(node.id)}
        className={cn(
          PANEL_ROW,
          WATERFALL_COLUMNS,
          "group/run h-7 items-stretch rounded-md px-2",
          open && "bg-accent",
        )}
      >
        <span
          className="flex min-w-0 items-center gap-2 pr-2"
          style={{ paddingLeft: indent }}
        >
          <Node
            kind={node.kind}
            icon={node.icon}
            running={node.status === "running"}
            failed={node.status === "error"}
          />
          <span
            className={cn(
              "truncate text-[13px] text-foreground",
              node.status === "running" && "animate-shine",
            )}
          >
            {node.title}
          </span>
          <span
            className={cn(
              "ml-auto shrink-0",
              node.children.length === 0 &&
                node.thread === null &&
                !open &&
                "opacity-0 group-hover/run:opacity-100 group-focus-visible/run:opacity-100",
            )}
          >
            <Disclosure open={open} />
          </span>
        </span>
        <Bars row={row} context={context} />
        <span className="self-center text-right text-xs tabular-nums text-muted-foreground">
          {formatElapsed(length)}
        </span>
      </button>
      {node.thread === null ? null : (
        <Collapsible open={open}>
          <ThreadSteps thread={node.thread} depth={depth + 1} context={context} />
        </Collapsible>
      )}
      {node.step === null ? null : (
        <Collapsible open={open}>
          <div style={{ paddingLeft: indent + 34 }}>
            <StepDetail step={node.step} context={context} />
          </div>
        </Collapsible>
      )}
    </li>
  );
}

/**
 * The turn as a waterfall: each step has its bar on one shared timeline, so
 * slow and parallel steps show. Open rows show their input, output and steps.
 */
export function StepFlow({
  steps,
  threads,
  context,
  depth = 0,
}: {
  steps: readonly Step[];
  /** Threads started alongside these steps, drawn in time order among them. */
  threads?: readonly ChildThread[];
  context: RowContext;
  depth?: number;
}) {
  const rows = visibleRuns(
    runsOf(steps, context.now, threads),
    context.expanded,
    depth,
  );
  return (
    <ol className="m-0 flex flex-col p-0">
      {rows.map((row) => (
        <RunRow key={row.node.id} row={row} context={context} />
      ))}
    </ol>
  );
}
