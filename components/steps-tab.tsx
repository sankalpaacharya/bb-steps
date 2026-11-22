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

import { useLiveNow } from "@/lib/clock";
import { MAX_TURNS, rpcContract } from "@/lib/rpc";
import { dayLabel, messageFrom, messageText, runsOf } from "@/lib/step-flow";
import {
  STEP_KINDS,
  STEP_KIND_IDS,
  extendTo,
  type ChildThread,
  type FocusedSteps,
  type Step,
  type TurnSteps,
} from "@/lib/steps";
import { FOCUS_RING, PANEL_ROW, durationTone } from "@/lib/styles";
import { formatElapsed } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Note } from "./section";
import { Icon } from "./ui/icon";
import { StepFlow, type OpenFile, type RowContext } from "./step-row";

/** Messages read at first, and how many more each scroll to the end adds. */
const TURNS_PAGE = 10;

const TEXT_BUTTON = `cursor-pointer rounded-md px-2 py-1 text-2xs text-muted-foreground hover:bg-accent/60 hover:text-foreground ${FOCUS_RING}`;

const ALL_THREADS = "all-threads";

const clockMinutes = (time: number): string =>
  new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const turnTitle = (turn: TurnSteps): string =>
  messageText(turn.prompt) || "Automatic turn";

/** Where the turn's time went: one grey bar, then the three biggest kinds. */
function TimeSplit({ totals }: { totals: TurnSteps["totals"] }) {
  const parts = STEP_KIND_IDS.map((kind) => [kind, totals[kind]] as const)
    .filter(([, ms]) => ms > 0)
    .sort((a, b) => b[1] - a[1]);
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div aria-hidden className="flex h-1 gap-px overflow-hidden rounded-full">
        {parts.map(([kind, ms], index) => (
          <span
            key={kind}
            title={`${STEP_KINDS[kind].label} ${formatElapsed(ms)}`}
            className="h-full"
            style={{
              flex: `${ms} 1 0%`,
              backgroundColor: `color-mix(in oklab, var(--foreground) ${Math.max(55 - index * 15, 12)}%, transparent)`,
            }}
          />
        ))}
      </div>
      <p className="m-0 flex gap-3 truncate text-[11px] leading-4 text-muted-foreground tabular-nums">
        {parts.slice(0, 3).map(([kind, ms]) => (
          <span key={kind}>
            {STEP_KINDS[kind].label}{" "}
            <span className="font-medium text-foreground">{formatElapsed(ms)}</span>
          </span>
        ))}
      </p>
    </div>
  );
}

function Header({
  title,
  detail,
  history,
  children,
}: {
  title: string;
  detail: ReactNode;
  history: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 pt-2.5 pb-2.5">
      <div className="flex items-center gap-2">
        <p className="m-0 min-w-0 flex-1 truncate text-[13px] leading-5 font-medium text-foreground">
          {title}
        </p>
        {history}
      </div>
      <p className="m-0 flex gap-1.5 truncate text-[11px] leading-4 text-muted-foreground tabular-nums">
        {detail}
      </p>
      {children}
    </header>
  );
}

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
        className={cn(PANEL_ROW, "h-7 items-center gap-2 px-2", selected && "bg-accent")}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            selected ? "text-foreground" : "text-foreground/70",
          )}
        >
          {turnTitle(turn)}
        </span>
        <span
          className={cn(
            "shrink-0 text-[11px] tabular-nums",
            turn.running ? "text-primary" : "text-muted-foreground",
          )}
        >
          {turn.running ? "Now" : formatElapsed(wall)}
        </span>
      </button>
    </li>
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

/** The thread's other messages, one click away instead of always on screen. */
function History({
  steps,
  selected,
  now,
  onPick,
  onLoadMore,
}: {
  steps: FocusedSteps;
  /** The turn on screen, or all threads. */
  selected: string;
  now: number;
  onPick: (turnId: string) => void;
  onLoadMore: (() => void) | null;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event.type === "pointerdown" && root.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const pick = (turnId: string) => {
    onPick(turnId);
    setOpen(false);
  };
  const count = `${steps.turns.length}${steps.hasOlder ? "+" : ""}`;
  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex h-6 cursor-pointer items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-state-hover hover:text-foreground aria-expanded:bg-state-active aria-expanded:text-foreground",
          FOCUS_RING,
        )}
      >
        {count} {steps.turns.length === 1 ? "message" : "messages"}
        <Icon name="ChevronDown" fallback="ChevronRight" className="size-3" aria-hidden />
      </button>
      {open ? (
        <nav
          aria-label="Messages"
          onKeyDown={moveThroughMessages}
          className="absolute top-full right-0 z-20 mt-1 max-h-[60vh] w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-150 ease-out motion-reduce:animate-none"
        >
          <ol className="m-0 flex flex-col gap-px p-0">
            {steps.allThreads.length === 0 ? null : (
              <li className="list-none">
                <button
                  type="button"
                  aria-current={selected === ALL_THREADS ? "true" : undefined}
                  onClick={() => pick(ALL_THREADS)}
                  className={cn(
                    PANEL_ROW,
                    "h-7 items-center gap-2 px-2",
                    selected === ALL_THREADS && "bg-accent",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground/70">
                    All threads
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {steps.allThreads.length}
                  </span>
                </button>
              </li>
            )}
            {steps.turns.map((turn, index) => {
              const day = dayLabel(turn.startedAt, Date.now());
              const previous = steps.turns[index - 1];
              return (
                <Fragment key={turn.id}>
                  {previous !== undefined &&
                  dayLabel(previous.startedAt, Date.now()) === day ? null : (
                    <li className="list-none px-2 pt-2 pb-0.5 text-[11px] font-medium text-muted-foreground">
                      {day}
                    </li>
                  )}
                  <MessageRow
                    turn={turn}
                    selected={turn.id === selected}
                    now={now}
                    onSelect={() => pick(turn.id)}
                  />
                </Fragment>
              );
            })}
            {onLoadMore === null ? null : <LoadMore onVisible={onLoadMore} />}
          </ol>
        </nav>
      ) : null}
    </div>
  );
}

const SECTION = "m-0 flex justify-between px-2 pt-3 pb-1 text-[11px] text-muted-foreground";

/** What is running right now, down to a subagent's current step. */
function NowCard({
  turn,
  current,
  threads,
  context,
}: {
  turn: TurnSteps;
  current: Step | null;
  threads: readonly ChildThread[];
  context: RowContext;
}) {
  const running = runsOf(turn.steps, context.now, threads).filter(
    (node) => node.status === "running",
  );
  const nested =
    current !== null && !running.some((node) => node.id === current.id)
      ? current
      : null;
  return (
    <section className="mx-1 mt-2 rounded-lg border border-border bg-card p-1">
      <h3 className={cn(SECTION, "pt-1")}>Now</h3>
      {running.length > 0 ? (
        <StepFlow steps={turn.steps} threads={threads} context={context} running />
      ) : (
        <p className="m-0 flex h-7 items-center px-2 text-[13px] text-muted-foreground animate-shine">
          Thinking
        </p>
      )}
      {nested === null ? null : (
        <p className="m-0 flex h-6 items-center gap-2 pr-2 pl-8 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate font-mono animate-shine">
            {nested.target || nested.verb}
          </span>
          <span className="shrink-0 text-xs tabular-nums">
            {formatElapsed(Math.max(context.now - nested.startedAt, 0))}
          </span>
        </p>
      )}
    </section>
  );
}

function useExpanded() {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return { expanded, toggle };
}

const stepCount = (steps: readonly Step[]): number =>
  steps.reduce((sum, step) => sum + 1 + stepCount(step.children), 0);

function TurnBody({
  turn,
  current,
  now,
  openFile,
  threadId,
  turns,
  threads,
}: {
  turn: TurnSteps;
  current: Step | null;
  now: number;
  openFile: OpenFile;
  threadId: string;
  turns: number;
  /** Threads this message started. */
  threads: readonly ChildThread[];
}) {
  const { expanded, toggle } = useExpanded();
  const context: RowContext = {
    threadId,
    turns,
    turnStartedAt: turn.startedAt,
    now,
    expanded,
    onToggle: toggle,
    openFile,
  };
  const live =
    turn.running ||
    turn.steps.some((step) => step.status === "running") ||
    threads.some((thread) => thread.status === "running");
  if (turn.steps.length + threads.length === 0 && !live) return <Note>No steps yet.</Note>;
  return (
    <div className="flex flex-col pb-3">
      {live ? (
        <NowCard turn={turn} current={current} threads={threads} context={context} />
      ) : null}
      <h3 className={SECTION}>
        <span>{live ? "Earlier in this turn" : "Steps"}</span>
        <span className="tabular-nums">{stepCount(turn.steps)} steps</span>
      </h3>
      <StepFlow
        steps={turn.steps}
        threads={threads}
        context={context}
        running={live ? false : undefined}
      />
    </div>
  );
}

/** Every thread under this one, newest first. */
function AllThreads({
  threads,
  now,
  threadId,
  turns,
  openFile,
}: {
  threads: readonly ChildThread[];
  now: number;
  threadId: string;
  turns: number;
  openFile: OpenFile;
}) {
  const { expanded, toggle } = useExpanded();
  return (
    <div className="pt-1 pb-3">
      <StepFlow
        steps={[]}
        threads={threads}
        context={{
          threadId,
          turns,
          turnStartedAt: Math.min(...threads.map((thread) => thread.startedAt)),
          now,
          expanded,
          onToggle: toggle,
          openFile,
        }}
      />
    </div>
  );
}

/**
 * A side panel tab with what the thread is doing now and where the time went:
 * the running message, or the newest, with the others in a menu.
 */
export function StepsTab({ threadId }: ExperimentalThreadActionTabProps) {
  const visible = experimental_useTabVisible();
  const [turns, setTurns] = useState(TURNS_PAGE);
  const [pick, setPick] = useState<{ threadId: string; turnId: string } | null>(
    null,
  );
  const choice = pick?.threadId === threadId ? pick.turnId : null;
  const picked = choice === ALL_THREADS ? null : choice;
  const { data, error, refetch } = experimental_useRpcQuery({
    contract: rpcContract,
    method: "thread_steps",
    input: { threadId, turns, turnId: picked },
    enabled: visible,
  });
  const [kept, setKept] = useState(data);
  if (data !== undefined && data !== kept) setKept(data);
  const steps = data ?? (kept?.threadId === threadId ? kept : undefined);
  const childRunning =
    steps?.allThreads.some((child) => child.status === "running") ?? false;
  const now = useLiveNow((steps?.running ?? false) || childRunning);

  const sidebarThreads = experimental_useSidebarThreads().threads;
  const hostId =
    sidebarThreads.find((thread) => thread.id === threadId)?.host?.id ?? null;
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

  if (steps === undefined)
    return (
      <div className="flex h-full flex-col gap-2 overflow-y-auto p-3">
        {error === null ? (
          <Note>Loading steps…</Note>
        ) : (
          <div className="flex items-center gap-2">
            <Note className="min-w-0 flex-1">
              Could not read this thread's steps: {error.message}
            </Note>
            <button type="button" onClick={() => void refetch()} className={TEXT_BUTTON}>
              Retry
            </button>
          </div>
        )}
      </div>
    );
  if (steps.turns.length === 0)
    return (
      <div className="p-3">
        <Note>No steps yet. They show here as the agent works.</Note>
      </div>
    );

  const showAll = choice === ALL_THREADS;
  const focused = steps.turns.find((turn) => turn.id === steps.focus);
  const waiting = picked !== null && picked !== steps.focus;
  const canLoadMore =
    steps.hasOlder && steps.turnsRead === turns && turns < MAX_TURNS;
  const history = (
    <History
      steps={steps}
      selected={showAll ? ALL_THREADS : (picked ?? steps.focus ?? "")}
      now={now}
      onPick={(turnId) => setPick({ threadId, turnId })}
      onLoadMore={
        canLoadMore ? () => setTurns(Math.min(turns + TURNS_PAGE, MAX_TURNS)) : null
      }
    />
  );

  let header: ReactNode;
  let body: ReactNode;
  if (showAll) {
    const running = steps.allThreads.filter((thread) => thread.status === "running").length;
    header = (
      <Header
        title="All threads"
        detail={`${steps.allThreads.length} threads${running > 0 ? `, ${running} running` : ""}`}
        history={history}
      />
    );
    body = (
      <AllThreads
        threads={steps.allThreads}
        now={childRunning ? now : Date.now()}
        threadId={threadId}
        turns={turns}
        openFile={openFile}
      />
    );
  } else if (focused === undefined || waiting) {
    header = <Header title="Loading…" detail="" history={history} />;
    body = <Note>Loading steps…</Note>;
  } else {
    const turn = extendTo(focused, now);
    const total = Math.max((turn.spans.at(-1)?.to ?? now) - turn.startedAt, 0);
    const fromId = messageFrom(turn.prompt);
    const from =
      fromId === null
        ? null
        : (sidebarThreads.find((thread) => thread.id === fromId)?.title ?? "another thread");
    header = (
      <Header
        title={turnTitle(turn)}
        detail={
          <>
            {from === null ? null : <span className="truncate">from {from}</span>}
            {from === null ? null : <span aria-hidden>·</span>}
            <span>{clockMinutes(turn.startedAt)}</span>
            <span aria-hidden>·</span>
            <span className={cn(turn.running ? "text-foreground" : durationTone(total))}>
              {formatElapsed(total)}
            </span>
          </>
        }
        history={history}
      >
        <TimeSplit totals={turn.totals} />
      </Header>
    );
    body = (
      <TurnBody
        key={turn.id}
        turn={turn}
        current={turn.running ? steps.now : null}
        now={turn.running || childRunning ? now : 0}
        openFile={openFile}
        threadId={threadId}
        turns={turns}
        threads={steps.children}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto px-1">{body}</div>
    </div>
  );
}
