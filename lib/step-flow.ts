import {
  STEP_KINDS,
  type ChildThread,
  type Step,
  type StepKind,
} from "./steps";

/** This many steps in a row with the same verb fold into one card. */
export const GROUP_MIN = 3;

export type FlowItem =
  | { type: "step"; step: Step }
  | { type: "group"; id: string; steps: readonly Step[] }
  | { type: "thought"; step: Step };

const lengthOf = (step: Step, now: number): number =>
  Math.max((step.endedAt ?? now) - step.startedAt, 0);

const sameRun = (a: Step, b: Step): boolean =>
  a.kind === b.kind && a.verb === b.verb && a.children.length === 0;

/**
 * Steps in order as cards to read top to bottom: long thoughts become notes
 * between cards, short ones drop out, and runs of the same action fold into
 * one card. A running step never folds, so what is happening now stays in view.
 */
export function flowOf(steps: readonly Step[], now: number): FlowItem[] {
  const items: FlowItem[] = [];
  let run: Step[] = [];
  const flush = () => {
    if (run.length >= GROUP_MIN)
      items.push({ type: "group", id: `group:${run[0]!.id}`, steps: run });
    else for (const step of run) items.push({ type: "step", step });
    run = [];
  };
  for (const step of steps) {
    if (step.kind === "think") {
      flush();
      items.push({ type: "thought", step });
      continue;
    }
    const last = run.at(-1);
    if (
      last !== undefined &&
      (!sameRun(last, step) || step.status === "running")
    )
      flush();
    run.push(step);
  }
  flush();
  return items;
}

const HOME = /^\/(?:Users|home)\/[^/]+(?=\/|$)/;

/** A path as people read it: the home folder as `~`. */
export const tildePath = (path: string): string => path.replace(HOME, "~");

const parentOf = (path: string): string => {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? path : path.slice(0, cut);
};

const CD_PREFIX = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)/;

/** The folder a command ran in, when it starts by changing into one. */
export function commandFolder(command: string): string | null {
  const match = CD_PREFIX.exec(command);
  if (match === null) return null;
  return tildePath(match[1]!.replace(/^["']|["']$/g, ""));
}

/** The muted second line of a step's card. */
export function stepPlace(step: Step): string {
  if (step.kind === "agent")
    return step.children.length === 1
      ? "Subagent, 1 step"
      : `Subagent, ${step.children.length} steps`;
  if (step.path !== null) return `${step.verb} in ${tildePath(parentOf(step.path))}`;
  if (step.detail !== null && (step.kind === "run" || step.kind === "read")) {
    const folder = commandFolder(step.detail);
    if (folder !== null) return `${step.verb} in ${folder}`;
  }
  return step.verb;
}

const GROUP_NOUNS: Record<string, [string, string]> = {
  Read: ["file", "files"],
  Viewed: ["image", "images"],
  Edited: ["file", "files"],
  Created: ["file", "files"],
  Deleted: ["file", "files"],
  Ran: ["command", "commands"],
  Searched: ["search", "searches"],
  Listed: ["folder", "folders"],
  Fetched: ["page", "pages"],
};

/** A folded run's title: "Read 6 files", "Ran 4 commands". */
export function groupTitle(steps: readonly Step[]): string {
  const verb = steps[0]?.verb ?? "";
  const nouns = GROUP_NOUNS[verb];
  if (nouns === undefined) return `${verb} ${steps.length} times`;
  return `${verb} ${steps.length} ${steps.length === 1 ? nouns[0] : nouns[1]}`;
}

/** Actions within a kind that read better with their own icon. */
const VERB_ICONS: Record<string, string> = {
  Searched: "Search",
  "Searched the web": "Search",
  Listed: "Folder",
  Replied: "MessageSquare",
};

const iconOf = (step: Pick<Step, "kind" | "verb">): string =>
  VERB_ICONS[step.verb] ?? STEP_KINDS[step.kind].icon;

/** One row of the run tree: a step, a thought, or a folded run of steps. */
export interface RunNode {
  id: string;
  kind: StepKind;
  icon: string;
  title: string;
  place: string;
  startedAt: number;
  endedAt: number | null;
  status: Step["status"];
  /** The step behind the row; a folded run has none of its own. */
  step: Step | null;
  children: readonly RunNode[];
  /** How many steps a folded run holds. */
  count: number | null;
  /** The thread this row opens, when it stands for one. */
  thread: ChildThread | null;
}

function stepNode(step: Step, now: number): RunNode {
  const thought = step.kind === "think";
  const failed = step.status === "error";
  const place = thought ? step.target : stepPlace(step);
  return {
    id: step.id,
    kind: step.kind,
    icon: iconOf(step),
    title: thought
      ? step.status === "running"
        ? "Thinking"
        : step.verb
      : step.target || step.verb,
    place: failed ? `Failed: ${place}` : place,
    startedAt: step.startedAt,
    endedAt: step.endedAt,
    status: step.status,
    step,
    children: step.children.length > 0 ? runsOf(step.children, now) : [],
    count: null,
    thread: null,
  };
}

function groupNode(id: string, steps: readonly Step[], now: number): RunNode {
  const first = steps[0]!;
  const last = steps.at(-1)!;
  return {
    id,
    kind: first.kind,
    icon: iconOf(first),
    title: groupTitle(steps),
    place: steps.map((step) => step.target).join(", "),
    startedAt: first.startedAt,
    endedAt: last.endedAt,
    status: steps.some((step) => step.status === "error") ? "error" : "done",
    step: null,
    children: steps.map((step) => stepNode(step, now)),
    count: steps.length,
    thread: null,
  };
}

const threadNode = (thread: ChildThread): RunNode => ({
  id: thread.id,
  kind: "agent",
  icon: "MessageSquare",
  title: thread.title,
  place: "Thread",
  startedAt: thread.startedAt,
  endedAt: thread.endedAt,
  status: thread.status,
  step: null,
  children: [],
  count: null,
  thread,
});

/** Steps, and the threads started alongside them, as rows of the waterfall. */
export function runsOf(
  steps: readonly Step[],
  now: number,
  threads: readonly ChildThread[] = [],
): RunNode[] {
  const rows = flowOf(steps, now).map((item) =>
    item.type === "group"
      ? groupNode(item.id, item.steps, now)
      : stepNode(item.step, now),
  );
  return [...rows, ...threads.map(threadNode)].sort(
    (a, b) => a.startedAt - b.startedAt,
  );
}

/** A row to draw, and how far it sits under its parents. */
export interface VisibleRun {
  node: RunNode;
  depth: number;
}

/** The rows on screen: open rows are followed by their children. */
export function visibleRuns(
  nodes: readonly RunNode[],
  open: ReadonlySet<string>,
  depth = 0,
): VisibleRun[] {
  return nodes.flatMap((node) => {
    const row: VisibleRun = { node, depth };
    return open.has(node.id) && node.children.length > 0
      ? [row, ...visibleRuns(node.children, open, depth + 1)]
      : [row];
  });
}

const LEADING_COMMANDS = /^(?:\/[\w:-]+(?:\s+|$))+/;

/** A message's own words, without the skill commands in front; a bare command names itself. */
export function messageText(prompt: string): string {
  const commands = LEADING_COMMANDS.exec(prompt)?.[0] ?? "";
  const text = prompt.slice(commands.length).trim();
  return text || commands.trim().split(":").at(-1)!.replace(/^\//, "");
}

const startOfDay = (time: number): number =>
  new Date(time).setHours(0, 0, 0, 0);

/** The day a message belongs under in the list. */
export function dayLabel(time: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(time)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(time).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}
