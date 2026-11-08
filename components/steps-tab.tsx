import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  experimental_useRpcQuery,
  experimental_useSidebarThreads,
  experimental_useTabVisible,
  useBbNavigate,
  type ExperimentalThreadActionTabProps,
} from "@get-bb/plugin-sdk/app";

import { useStoredState } from "@/hooks/use-stored-state";
import { useLiveNow } from "@/lib/clock";
import { MAX_TURNS, rpcContract } from "@/lib/rpc";
import { dayLabel, messageText } from "@/lib/step-flow";
import {
  STEP_KINDS,
  STEP_KIND_IDS,
  extendTo,
  type Step,
  type StepKind,
  type TurnSteps,
} from "@/lib/steps";
import { FOCUS_RING, HEADER_ACTION, PANEL_ROW } from "@/lib/styles";
import { formatElapsed } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ResizeHandle, useStoredSize } from "./resize-handle";
import { Note } from "./section";
import { Icon } from "./ui/icon";
import {
  StepFlow,
  WATERFALL_COLUMNS,
  type OpenFile,
  type RowContext,
} from "./step-row";

/** Messages read at first, and how many more each scroll to the end adds. */
const TURNS_PAGE = 10;

const SIDEBAR_KEY = "armada:steps-sidebar-width";
const SIDEBAR_OPEN_KEY = "armada:steps-sidebar-open";
const parseOpen = (raw: string): boolean | undefined => {
  const value: unknown = JSON.parse(raw);
  return typeof value === "boolean" ? value : undefined;
};
const SIDEBAR_WIDTH = { min: 120, max: () => 420, initial: () => 208 };

const CHIP = `inline-flex h-5 cursor-pointer items-center gap-1 rounded text-2xs text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:underline aria-pressed:underline-offset-4 ${FOCUS_RING}`;

const TEXT_BUTTON = `cursor-pointer rounded-md px-2 py-1 text-2xs text-muted-foreground hover:bg-accent/60 hover:text-foreground ${FOCUS_RING}`;

function Legend({
  totals,
  filter,
  onFilter,
}: {
  totals: TurnSteps["totals"];
  filter: StepKind | null;
  onFilter: (kind: StepKind | null) => void;
}) {
  const kinds = STEP_KIND_IDS.filter((kind) => totals[kind] > 0).sort(
    (a, b) => totals[b] - totals[a],
  );
  return (
    <div
      role="group"
      aria-label="Show one kind"
      className="flex flex-wrap gap-x-3"
    >
      {kinds.map((kind) => (
        <button
          key={kind}
          type="button"
          aria-pressed={filter === kind}
          title={
            kind === "think"
              ? "The model thinking or writing, between and during its steps"
              : undefined
          }
          onClick={() => onFilter(filter === kind ? null : kind)}
          className={CHIP}
        >
          {STEP_KINDS[kind].label}
          <span className="tabular-nums">
            {formatElapsed(totals[kind])}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The times across the top of the waterfall. */
function TimeAxis({ wall }: { wall: number }) {
  return (
    <div className={cn(WATERFALL_COLUMNS, "h-4 text-[10px] tabular-nums text-muted-foreground")}>
      <span />
      <span className="flex justify-between">
        <span>0s</span>
        <span>{formatElapsed(wall)}</span>
      </span>
    </div>
  );
}

/** What this message is doing right now, one quiet line under its title. */
function NowLine({ step, now }: { step: Step | null; now: number }) {
  if (step === null) return null;
  return (
    <p className="m-0 flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon
        name="Spinner"
        aria-hidden
        className="size-3 shrink-0 animate-spin motion-reduce:animate-none"
      />
      <span className="min-w-0 truncate">{step.target || STEP_KINDS[step.kind].label}</span>
      <span className="shrink-0 tabular-nums">
        {formatElapsed(Math.max(now - step.startedAt, 0))}
      </span>
    </p>
  );
}

function TurnBody({
  turn,
  now,
  openFile,
  threadId,
  turns,
  current,
}: {
  turn: TurnSteps;
  now: number;
  openFile: OpenFile;
  threadId: string;
  turns: number;
  /** The step under way, when this message is the one running. */
  current: Step | null;
}) {
  const [filter, setFilter] = useState<StepKind | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const toggle = (stepId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(stepId)) next.add(stepId);
      return next;
    });
  const shown =
    filter === null
      ? turn.steps.filter((step) => step.kind !== "think")
      : turn.steps.filter((step) => step.kind === filter);
  const turnEndedAt = turn.spans.at(-1)?.to ?? now;
  const context: RowContext = {
    threadId,
    turns,
    turnStartedAt: turn.startedAt,
    turnEndedAt,
    now,
    expanded,
    onToggle: toggle,
    openFile,
  };

  return (
    <div className="flex flex-col pb-3">
      <div className="sticky top-0 z-10 flex flex-col gap-2 bg-sidebar px-2 pt-3 pb-2">
        <div className="flex items-baseline gap-3">
          <p className="m-0 min-w-0 flex-1 truncate text-[13px] leading-5 font-medium text-foreground">
            {messageText(turn.prompt)}
          </p>
          <p className="m-0 shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatElapsed(Math.max(turnEndedAt - turn.startedAt, 0))}
          </p>
        </div>
        <NowLine step={current} now={now} />
        <Legend totals={turn.totals} filter={filter} onFilter={setFilter} />
        {shown.length > 0 ? (
          <TimeAxis wall={Math.max(turnEndedAt - turn.startedAt, 0)} />
        ) : null}
      </div>
      <div>
        {shown.length > 0 ? (
          <StepFlow steps={shown} context={context} />
        ) : (
          <Note>
            {filter === "think"
              ? "This is the model thinking and writing between its steps."
              : filter === null
                ? "Only thinking in this message. Pick Thinking to read it."
                : "No steps of this kind."}
          </Note>
        )}
      </div>
    </div>
  );
}

const clockMinutes = (time: number): string =>
  new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function MessageRow({
  turn,
  selected,
  now,
  onSelect,
}: {
  turn: TurnSteps;
  selected: boolean;
  now: number;
  onSelect: () => void;
}) {
  const wall = Math.max((turn.endedAt ?? now) - turn.startedAt, 0);
  return (
    <li className="list-none">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        title={`${turn.prompt}\nSent at ${clockMinutes(turn.startedAt)}`}
        onClick={onSelect}
        className={cn(
          PANEL_ROW,
          "h-7 items-center gap-2 px-2",
          selected && "bg-accent",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            selected ? "text-foreground" : "text-foreground/70",
          )}
        >
          {messageText(turn.prompt)}
        </span>
        {turn.running ? (
          <Icon
            name="Spinner"
            aria-label="Running"
            className="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
          />
        ) : (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatElapsed(wall)}
          </span>
        )}
      </button>
    </li>
  );
}

function SidebarToggle({
  open,
  onToggle,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const label = open ? "Hide messages" : "Show messages";
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className={cn(HEADER_ACTION, className)}
    >
      <Icon name="PanelLeft" className="size-3.5" aria-hidden />
    </button>
  );
}

/** Up and down move through the messages, opening each one. */
function moveThroughMessages(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = Array.from(event.currentTarget.querySelectorAll("button"));
  const from = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next = rows[from + (event.key === "ArrowDown" ? 1 : -1)];
  if (next === undefined) return;
  event.preventDefault();
  next.focus();
  next.click();
}

/** Reads the next messages once the end of the list scrolls into view. */
function LoadMore({ onVisible }: { onVisible: () => void }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const element = end.current;
    if (element === null) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onVisible();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [onVisible]);
  return <li ref={end} aria-hidden className="h-px list-none" />;
}

/**
 * A side panel tab with where the thread's time went: a list of the thread's
 * messages, and the waterfall of the one picked, the newest until one is.
 */
export function StepsTab({ threadId }: ExperimentalThreadActionTabProps) {
  const visible = experimental_useTabVisible();
  const [turns, setTurns] = useState(TURNS_PAGE);
  const sidebar = useStoredSize(SIDEBAR_KEY, SIDEBAR_WIDTH);
  const [sidebarOpen, setSidebarOpen] = useStoredState(
    SIDEBAR_OPEN_KEY,
    parseOpen,
    true,
  );
  const [pick, setPick] = useState<{ threadId: string; turnId: string } | null>(
    null,
  );
  const picked = pick?.threadId === threadId ? pick.turnId : null;
  const { data, error, refetch } = experimental_useRpcQuery({
    contract: rpcContract,
    method: "thread_steps",
    input: { threadId, turns, turnId: picked },
    enabled: visible,
  });
  const [kept, setKept] = useState(data);
  if (data !== undefined && data !== kept) setKept(data);
  const steps = data ?? (kept?.threadId === threadId ? kept : undefined);
  const now = useLiveNow(steps?.running ?? false);

  const hostId =
    experimental_useSidebarThreads().threads.find(
      (thread) => thread.id === threadId,
    )?.host?.id ?? null;
  const navigate = useBbNavigate();
  const openFile = useMemo<OpenFile>(
    () =>
      hostId === null
        ? null
        : (path) =>
            navigate.experimental_openFilePreview({
              target: { kind: "host", hostId, path },
              location: null,
            }),
    [hostId, navigate],
  );

  let body: ReactNode;
  if (steps === undefined)
    body =
      error === null ? (
        <Note>Loading steps…</Note>
      ) : (
        <div className="flex items-center gap-2">
          <Note className="min-w-0 flex-1">
            Could not read this thread's steps: {error.message}
          </Note>
          <button
            type="button"
            onClick={() => void refetch()}
            className={TEXT_BUTTON}
          >
            Retry
          </button>
        </div>
      );
  else if (steps.turns.length === 0)
    body = <Note>No steps yet. They show here as the agent works.</Note>;
  else {
    const focused = steps.turns.find((turn) => turn.id === steps.focus);
    const waiting = picked !== null && picked !== steps.focus;
    const canLoadMore =
      steps.hasOlder && steps.turnsRead === turns && turns < MAX_TURNS;
    return (
      <div className="flex h-full min-h-0">
        {sidebarOpen ? (
          <div
            className="relative shrink-0"
            style={{ width: sidebar.size, maxWidth: "70%" }}
          >
            <nav
              aria-label="Messages"
              onKeyDown={moveThroughMessages}
              className="h-full overflow-y-auto border-r border-border px-1.5 pb-1.5"
            >
              <ol className="m-0 flex flex-col gap-px p-0">
                {steps.turns.map((turn, index) => {
                  const day = dayLabel(turn.startedAt, Date.now());
                  const previous = steps.turns[index - 1];
                  return (
                    <Fragment key={turn.id}>
                      {previous !== undefined &&
                      dayLabel(previous.startedAt, Date.now()) === day ? null : (
                        <li className="sticky top-0 z-[1] list-none bg-sidebar px-2 pt-2.5 pb-1 text-[11px] font-medium text-muted-foreground">
                          {day}
                        </li>
                      )}
                      <MessageRow
                        turn={turn}
                        selected={turn.id === (picked ?? steps.focus)}
                        now={now}
                        onSelect={() => setPick({ threadId, turnId: turn.id })}
                      />
                    </Fragment>
                  );
                })}
                {canLoadMore ? (
                  <LoadMore
                    onVisible={() =>
                      setTurns(Math.min(turns + TURNS_PAGE, MAX_TURNS))
                    }
                  />
                ) : null}
              </ol>
            </nav>
            <ResizeHandle
              axis="x"
              label="Resize messages"
              pane={sidebar}
              className="absolute inset-y-0 -right-1 w-2"
            />
            <SidebarToggle
              open
              onToggle={() => setSidebarOpen(false)}
              className="absolute top-1.5 right-2 z-[2]"
            />
          </div>
        ) : (
          <div className="flex w-9 shrink-0 justify-center border-r border-border pt-1.5">
            <SidebarToggle open={false} onToggle={() => setSidebarOpen(true)} />
          </div>
        )}
        <div className="min-w-0 flex-1 overflow-y-auto px-1">
          {focused === undefined || waiting ? (
            <div className="p-2">
              <Note>Loading steps…</Note>
            </div>
          ) : (
            <TurnBody
              key={focused.id}
              turn={extendTo(focused, now)}
              now={focused.running ? now : 0}
              openFile={openFile}
              threadId={threadId}
              turns={turns}
              current={focused.running ? steps.now : null}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-3">{body}</div>
  );
}
