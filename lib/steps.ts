import { z } from "zod";

export const STEP_KIND_IDS = [
  "read",
  "run",
  "edit",
  "web",
  "agent",
  "think",
  "wait",
  "tool",
] as const;

export type StepKind = (typeof STEP_KIND_IDS)[number];

interface StepKindInfo {
  /** What the agent was doing, for the legend and the Now line. */
  label: string;
  /**
   * Which kind owns an instant two steps share: the lowest rank wins, so
   * parallel steps are never counted twice.
   */
  rank: number;
  /** A fill that reads on light and dark panels alike. */
  color: string;
  /** How the expanded row shows the step's detail. */
  detail: "code" | "prose";
  /** The host icon on the step's node. */
  icon: string;
  /** What one step of this kind is called. */
  type: string;
}

/** Every step kind and how it is drawn: "think" is model time, "wait" is the user's. */
export const STEP_KINDS: Record<StepKind, StepKindInfo> = {
  wait: {
    label: "Waiting on you",
    rank: 0,
    color: "oklch(0.62 0.15 45)",
    detail: "prose",
    icon: "MessageSquare",
    type: "Question",
  },
  edit: {
    label: "Writing",
    rank: 1,
    color: "oklch(0.62 0.15 80)",
    detail: "code",
    icon: "EditFile",
    type: "Edit",
  },
  run: {
    label: "Running",
    rank: 2,
    color: "oklch(0.62 0.15 150)",
    detail: "code",
    icon: "Terminal",
    type: "Command",
  },
  read: {
    label: "Reading",
    rank: 3,
    color: "oklch(0.62 0.15 220)",
    detail: "code",
    icon: "FileText",
    type: "Read",
  },
  web: {
    label: "Web",
    rank: 4,
    color: "oklch(0.62 0.15 285)",
    detail: "code",
    icon: "Browser",
    type: "Web",
  },
  agent: {
    label: "Subagents",
    rank: 5,
    color: "oklch(0.62 0.15 340)",
    detail: "prose",
    icon: "UserRound",
    type: "Subagent",
  },
  tool: {
    label: "Tools",
    rank: 6,
    color: "oklch(0.58 0.03 250)",
    detail: "code",
    icon: "ToolCase",
    type: "Tool",
  },
  think: {
    label: "Thinking",
    rank: 7,
    color: "currentColor",
    detail: "prose",
    icon: "Brain",
    type: "Thought",
  },
};

const stepKindSchema = z.enum(STEP_KIND_IDS);
const stepStatusSchema = z.enum(["running", "done", "error", "interrupted"]);

export const stepSchema = z.object({
  id: z.string(),
  kind: stepKindSchema,
  verb: z.string(),
  target: z.string(),
  detail: z.string().nullable(),
  /** An absolute file path the preview can open. */
  path: z.string().nullable(),
  startedAt: z.number(),
  /** Null while running. */
  endedAt: z.number().nullable(),
  status: stepStatusSchema,
  /** A subagent's own steps. */
  get children(): z.ZodArray<typeof stepSchema> {
    return z.array(stepSchema);
  },
});

export type Step = z.infer<typeof stepSchema>;

/** A stretch of a turn's wall clock, owned by a step or, with none, the model. */
const spanSchema = z.object({
  kind: stepKindSchema,
  from: z.number(),
  to: z.number(),
  stepId: z.string().nullable(),
});

export type Span = z.infer<typeof spanSchema>;

const turnStepsSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  running: z.boolean(),
  steps: z.array(stepSchema),
  /** Contiguous, covering the turn from its start to its end (or now). */
  spans: z.array(spanSchema),
  /** Milliseconds per kind, summing exactly to the turn's wall time. */
  totals: z.record(stepKindSchema, z.number()),
});

export type TurnSteps = z.infer<typeof turnStepsSchema>;

export const threadStepsSchema = z.object({
  threadId: z.string(),
  running: z.boolean(),
  /** The step the agent is in right now, the deepest one inside a subagent. */
  now: stepSchema.nullable(),
  /** Newest first. */
  turns: z.array(turnStepsSchema),
  /** The thread has turns older than these. */
  hasOlder: z.boolean(),
});

export type ThreadSteps = z.infer<typeof threadStepsSchema>;

export const childThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: stepStatusSchema,
  startedAt: z.number(),
  /** Null while it runs. */
  endedAt: z.number().nullable(),
});

export type ChildThread = z.infer<typeof childThreadSchema>;

export const focusedStepsSchema = threadStepsSchema.extend({
  /** Threads started during the turn in focus, at any depth under this one. */
  children: z.array(childThreadSchema),
  /** Every thread under this one, whichever message started it. */
  allThreads: z.array(childThreadSchema),
  /** The one turn sent with its steps; the others are only listed. */
  focus: z.string().nullable(),
  /** The `turns` this answer read, so a reader knows when it has caught up. */
  turnsRead: z.number(),
});

export type FocusedSteps = z.infer<typeof focusedStepsSchema>;

/** Expanded rows show this much of a step's detail at most. */
const DETAIL_CAP = 4000;
const TARGET_CAP = 160;
const PROMPT_CAP = 2000;

const clip = (text: string, cap: number): string =>
  text.length > cap ? `${text.slice(0, cap - 1)}…` : text;

const oneLine = (text: string): string =>
  clip(text.replace(/\s+/g, " ").trim(), TARGET_CAP);

const basename = (path: string): string =>
  path.split("/").filter(Boolean).at(-1) ?? path;

const absolute = (path: string | null | undefined, cwd?: string | null) => {
  if (path === null || path === undefined || path === "") return null;
  if (path.startsWith("/")) return path;
  return cwd?.startsWith("/") ? `${cwd.replace(/\/$/, "")}/${path}` : null;
};

const HEREDOC = /\s*<<-?\s*['"]?\w+['"]?/;
const WRITE_HEREDOC = /^cat\s*>\s*(\S+)\s*<</;
const REDIRECT = /\s+(?:\d?>>?|&>)\s*\S+|\s*\d>&\d/g;
const SETUP = /^(?:cd\s|\w+=\S*$|export\s|set\s)/;

/** One part of a command chain as people say it. */
function gistOf(part: string): string {
  const write = WRITE_HEREDOC.exec(part);
  if (write !== null) return `Wrote ${write[1]}`;
  const heredoc = HEREDOC.test(part);
  const bare = part.replace(HEREDOC, "").replace(REDIRECT, "").trim();
  return heredoc && /\s-$/.test(bare) ? `${bare.slice(0, -2)} script` : bare;
}

/**
 * A command's gist from its first line: the parts that do the work, without
 * moving into a folder, setting variables, redirects or heredoc markers.
 */
function shortCommand(command: string): string {
  const first = command.trim().split("\n")[0] ?? "";
  const parts = first
    .split(/\s*(?:&&|\|\||;)\s*/)
    .map((part) => part.trim())
    .filter((part) => part !== "" && !SETUP.test(part))
    .map(gistOf)
    .filter((part) => part !== "");
  return oneLine(parts.length > 0 ? parts.join(" && ") : first);
}

function urlTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return oneLine(`${parsed.host}${path}`);
  } catch {
    return oneLine(url);
  }
}

interface Face {
  kind: StepKind;
  verb: string;
  target: string;
  detail: string | null;
  path: string | null;
}

type ReadFace = (row: unknown) => Face | null;

const face =
  <S extends z.ZodType>(schema: S, read: (row: z.output<S>) => Face): ReadFace =>
  (row) => {
    const parsed = schema.safeParse(row);
    return parsed.success ? read(parsed.data) : null;
  };

const presentationSchema = z
  .object({
    label: z.object({ completed: z.string() }).partial().optional(),
    title: z.string().optional(),
    detail: z.string().optional(),
  })
  .optional()
  .catch(undefined);

const intentSchema = z.object({
  type: z.string(),
  path: z.string().nullish(),
  query: z.string().nullish(),
});

/** Shell intents that only look at files, and the verb each reads as. */
const READ_INTENT_VERBS: Record<string, string> = {
  read: "Read",
  list_files: "Listed",
  search: "Searched",
};

function commandFace({
  command,
  cwd,
  activityIntents: intents,
}: {
  command: string;
  cwd?: string | null;
  activityIntents: z.output<typeof intentSchema>[];
}): Face {
  const reading =
    intents.length > 0 &&
    intents.every((intent) => READ_INTENT_VERBS[intent.type] !== undefined);
  if (!reading)
    return {
      kind: "run",
      verb: "Ran",
      target: shortCommand(command),
      detail: command,
      path: null,
    };
  const first = intents[0]!;
  const names = [
    ...new Set(
      intents.flatMap((intent) =>
        intent.type === "read" && intent.path ? [basename(intent.path)] : [],
      ),
    ),
  ];
  const named =
    first.type === "read"
      ? names.length > 1
        ? `${names[0]} +${names.length - 1}`
        : names[0]
      : first.type === "search"
        ? (first.query ?? first.path)
        : first.path;
  const paths = intents.flatMap((intent) =>
    intent.path ? [intent.path] : [],
  );
  return {
    kind: "read",
    verb: READ_INTENT_VERBS[first.type]!,
    target: named ? oneLine(named) : shortCommand(command),
    detail: command,
    path: paths.length === 1 ? absolute(paths[0], cwd) : null,
  };
}

const SEARCH_VERBS: Record<string, string> = {
  content: "Searched",
  path: "Found files",
  list: "Listed",
};

const CHANGE_VERBS: Record<string, string> = {
  add: "Created",
  delete: "Deleted",
};

/** How each work row reads as a step. A kind missing here is a generic tool step. */
const WORK_FACES: Record<string, ReadFace> = {
  command: face(
    z.object({
      command: z.string(),
      cwd: z.string().nullish(),
      activityIntents: z.array(intentSchema).catch([]),
    }),
    commandFace,
  ),
  "file-read": face(z.object({ path: z.string() }), ({ path }) => ({
    kind: "read",
    verb: "Read",
    target: basename(path),
    detail: path,
    path: absolute(path),
  })),
  "image-view": face(z.object({ path: z.string() }), ({ path }) => ({
    kind: "read",
    verb: "Viewed",
    target: basename(path),
    detail: path,
    path: absolute(path),
  })),
  search: face(
    z.object({
      query: z.string(),
      mode: z.string().nullish(),
      path: z.string().nullish(),
    }),
    ({ query, mode, path }) => ({
      kind: "read",
      verb: SEARCH_VERBS[mode ?? ""] ?? "Searched",
      target: oneLine(query || (path ?? "")),
      detail: path ? `${query}\nin ${path}` : query,
      path: null,
    }),
  ),
  "file-change": face(
    z.object({
      change: z.object({
        path: z.string(),
        kind: z.string().nullish(),
        diffStats: z
          .object({ added: z.number(), removed: z.number() })
          .nullish()
          .catch(null),
      }),
    }),
    ({ change }) => ({
      kind: "edit",
      verb: CHANGE_VERBS[change.kind ?? ""] ?? "Edited",
      target: basename(change.path),
      detail: change.diffStats
        ? `${change.path}\n+${change.diffStats.added} −${change.diffStats.removed}`
        : change.path,
      path: absolute(change.path),
    }),
  ),
  "web-search": face(
    z.object({ queries: z.array(z.string()) }),
    ({ queries }) => ({
      kind: "web",
      verb: "Searched the web",
      target: oneLine(queries[0] ?? ""),
      detail: queries.join("\n"),
      path: null,
    }),
  ),
  "web-fetch": face(
    z.object({ url: z.string(), prompt: z.string().nullish() }),
    ({ url, prompt }) => ({
      kind: "web",
      verb: "Fetched",
      target: urlTarget(url),
      detail: prompt ? `${url}\n\n${prompt}` : url,
      path: null,
    }),
  ),
  delegation: face(
    z.object({
      description: z.string().nullish(),
      subagentType: z.string().nullish(),
      background: z.boolean().catch(false),
      presentation: presentationSchema,
    }),
    ({ description, subagentType, background, presentation }) => {
      const about = presentation?.detail ?? subagentType ?? "A subagent";
      return {
        kind: "agent",
        verb: "Subagent",
        target: oneLine(description ?? subagentType ?? "Subagent"),
        detail: background ? `${about}, in the background` : about,
        path: null,
      };
    },
  ),
  workflow: face(
    z.object({
      workflowName: z.string().nullish(),
      description: z.string(),
    }),
    ({ workflowName, description }) => ({
      kind: "agent",
      verb: "Ran workflow",
      target: oneLine(workflowName ?? description),
      detail: description,
      path: null,
    }),
  ),
  approval: face(
    z.object({
      target: z.object({ toolName: z.string().nullish() }).catch({}),
    }),
    ({ target }) => ({
      kind: "wait",
      verb: "Asked to approve",
      target: target.toolName ?? "an action",
      detail: null,
      path: null,
    }),
  ),
  question: face(
    z.object({
      questions: z.array(z.object({ prompt: z.string() })).catch([]),
    }),
    ({ questions }) => ({
      kind: "wait",
      verb: "Asked you",
      target: oneLine(questions[0]?.prompt ?? "a question"),
      detail: questions.map((question) => question.prompt).join("\n\n") || null,
      path: null,
    }),
  ),
  form: face(z.object({ title: z.string() }), ({ title }) => ({
    kind: "wait",
    verb: "Asked you",
    target: oneLine(title),
    detail: null,
    path: null,
  })),
  "plan-steps": face(
    z.object({
      steps: z.array(z.unknown()).catch([]),
      explanation: z.string().nullish(),
    }),
    ({ steps, explanation }) => ({
      kind: "tool",
      verb: "Planned",
      target: `${steps.length} steps`,
      detail: explanation ?? null,
      path: null,
    }),
  ),
  "image-generation": face(
    z.object({ prompt: z.string().nullish(), path: z.string().nullish() }),
    ({ prompt, path }) => ({
      kind: "tool",
      verb: "Made an image",
      target: oneLine(prompt ?? (path ? basename(path) : "")),
      detail: prompt ?? null,
      path: absolute(path),
    }),
  ),
};

/** Any work row, known or not: its presentation names it. */
const toolFace = face(
  z.object({
    workKind: z.string().catch("tool"),
    toolName: z.string().nullish(),
    toolArgs: z.unknown().optional(),
    presentation: presentationSchema,
  }),
  ({ workKind, toolName, toolArgs, presentation }) => {
    const args =
      toolArgs === undefined || toolArgs === null
        ? null
        : JSON.stringify(toolArgs, null, 2);
    return {
      kind: "tool",
      verb: presentation?.label?.completed ?? toolName ?? workKind,
      target: oneLine(presentation?.title ?? toolName ?? ""),
      detail: args,
      path: null,
    };
  },
);

/** System operations that take time, and how they read. Other system rows are notices. */
const OPERATION_FACES: Record<string, (detail: string | null) => Face> = {
  reasoning: (detail) => ({
    kind: "think",
    verb: "Thought",
    target: detail === null ? "" : oneLine(detail),
    detail,
    path: null,
  }),
  compaction: () => ({
    kind: "think",
    verb: "Compacted context",
    target: "",
    detail: null,
    path: null,
  }),
  "thread-provisioning": () => ({
    kind: "tool",
    verb: "Set up",
    target: "the environment",
    detail: null,
    path: null,
  }),
};

const operationSchema = z.object({
  systemKind: z.literal("operation"),
  operationKind: z.string(),
  detail: z.string().nullish(),
});

const replySchema = z.object({ text: z.string() });

function faceOf(row: Row): Face | null {
  if (row.kind === "conversation" && row.role === "assistant") {
    const text = replySchema.safeParse(row.raw).data?.text ?? "";
    return text === ""
      ? null
      : {
          kind: "think",
          verb: "Replied",
          target: oneLine(text),
          detail: text,
          path: null,
        };
  }
  if (row.kind === "work")
    return WORK_FACES[row.workKind ?? ""]?.(row.raw) ?? toolFace(row.raw);
  if (row.kind !== "system") return null;
  const operation = operationSchema.safeParse(row.raw);
  if (!operation.success) return null;
  return (
    OPERATION_FACES[operation.data.operationKind]?.(
      operation.data.detail ?? null,
    ) ?? null
  );
}

/** The fields every row is read by, with the raw row kept for its kind's own fields. */
const rowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  workKind: z.string().optional().catch(undefined),
  role: z.string().optional().catch(undefined),
  turnId: z.string().nullish().catch(null),
  startedAt: z.number(),
  createdAt: z.number().optional().catch(undefined),
  completedAt: z.number().nullish().catch(null),
  status: z.string().nullish().catch(null),
  text: z.string().optional().catch(undefined),
  turnRequest: z
    .object({ status: z.string() })
    .nullish()
    .catch(null),
  children: z.array(z.unknown()).nullish().catch(null),
  childRows: z.array(z.unknown()).nullish().catch(null),
});

type Row = z.output<typeof rowSchema> & { raw: unknown };

function parseRow(raw: unknown): Row | null {
  const parsed = rowSchema.safeParse(raw);
  return parsed.success ? { ...parsed.data, raw } : null;
}

/** When a row last changed, which is when it ended unless it is still going. */
const rowEnd = (row: Row): number =>
  row.completedAt ?? row.createdAt ?? row.startedAt;

const STATUSES: Record<string, Step["status"]> = {
  completed: "done",
  error: "error",
  interrupted: "interrupted",
};

function toStep(row: Row, live: boolean): Step | null {
  const look = faceOf(row);
  if (look === null) return null;
  const children = (row.childRows ?? [])
    .map(parseRow)
    .flatMap((child) => {
      const step = child === null ? null : toStep(child, live);
      return step === null ? [] : [step];
    })
    .sort((a, b) => a.startedAt - b.startedAt);
  const pending = row.status === "pending";
  const childRunning = children.some((child) => child.status === "running");
  const running = (pending && live) || childRunning;
  const status: Step["status"] = running
    ? "running"
    : pending
      ? "interrupted"
      : (STATUSES[row.status ?? ""] ?? "done");
  const childEnd = Math.max(
    ...children.map((child) => child.endedAt ?? child.startedAt),
  );
  return {
    id: row.id,
    ...look,
    detail: look.detail === null ? null : clip(look.detail, DETAIL_CAP),
    startedAt: row.startedAt,
    endedAt: running ? null : Math.max(rowEnd(row), childEnd),
    status,
    children,
  };
}

const zeroTotals = (): Record<StepKind, number> => ({
  read: 0,
  run: 0,
  edit: 0,
  web: 0,
  agent: 0,
  think: 0,
  wait: 0,
  tool: 0,
});

/**
 * Who owns each instant of [from, to]: the highest-ranked step active then,
 * the latest started on a tie, or the model when no step is. A step with no
 * end runs to `now` while running and is an instant otherwise.
 */
function attribute(
  steps: readonly Step[],
  from: number,
  to: number,
  now: number,
): Span[] {
  const clamp = (time: number) => Math.min(Math.max(time, from), to);
  const intervals = steps
    .map((step) => ({
      step,
      from: clamp(step.startedAt),
      to: clamp(
        step.endedAt ?? (step.status === "running" ? now : step.startedAt),
      ),
    }))
    .filter((interval) => interval.to > interval.from);
  const cuts = [
    ...new Set([
      from,
      to,
      ...intervals.flatMap((interval) => [interval.from, interval.to]),
    ]),
  ].sort((a, b) => a - b);
  const spans: Span[] = [];
  for (let index = 0; index + 1 < cuts.length; index += 1) {
    const start = cuts[index]!;
    const end = cuts[index + 1]!;
    let owner: Step | null = null;
    for (const interval of intervals) {
      if (interval.from > start || interval.to < end) continue;
      const step = interval.step;
      if (
        owner === null ||
        STEP_KINDS[step.kind].rank < STEP_KINDS[owner.kind].rank ||
        (STEP_KINDS[step.kind].rank === STEP_KINDS[owner.kind].rank &&
          step.startedAt >= owner.startedAt)
      )
        owner = step;
    }
    const kind = owner?.kind ?? "think";
    const stepId = owner?.id ?? null;
    const last = spans.at(-1);
    if (last !== undefined && last.kind === kind && last.stepId === stepId)
      last.to = end;
    else spans.push({ kind, from: start, to: end, stepId });
  }
  return spans;
}

/** The span under a time; the last one at or past the end. */
const OUTPUT_CAP = 20_000;

const outputRowSchema = z.object({
  id: z.string(),
  output: z.string().nullish().catch(null),
  children: z.array(z.unknown()).nullish().catch(null),
  childRows: z.array(z.unknown()).nullish().catch(null),
});

/** What a step printed or handed back, or null when bb kept none. */
export function outputOfRow(
  rows: readonly unknown[],
  stepId: string,
): string | null {
  for (const row of rows) {
    const parsed = outputRowSchema.safeParse(row);
    if (!parsed.success) continue;
    const { id, output, children, childRows } = parsed.data;
    if (id === stepId) return output ? clip(output, OUTPUT_CAP) : null;
    const found = outputOfRow([...(children ?? []), ...(childRows ?? [])], stepId);
    if (found !== null) return found;
  }
  return null;
}

function totalsOf(spans: readonly Span[]): Record<StepKind, number> {
  const totals = zeroTotals();
  for (const span of spans) totals[span.kind] += span.to - span.from;
  return totals;
}

/**
 * A running turn carried forward to `now` on the client, between reads: its
 * last span, the step or the model still going, grows to now.
 */
/** Keeps the steps of one turn, the newest unless named, and lists the rest. */
export function focusTurn(
  steps: ThreadSteps,
  turnId: string | null,
  turnsRead: number,
  descendants: readonly ChildThread[] = [],
): FocusedSteps {
  const focus =
    steps.turns.find((turn) => turn.id === turnId) ?? steps.turns[0] ?? null;
  const newer = focus === null ? undefined : steps.turns[steps.turns.indexOf(focus) - 1];
  const children =
    focus === null
      ? []
      : descendants.filter(
          (child) =>
            child.startedAt >= focus.startedAt &&
            (newer === undefined || child.startedAt < newer.startedAt),
        );
  return {
    ...steps,
    focus: focus?.id ?? null,
    turnsRead,
    children,
    allThreads: [...descendants],
    turns: steps.turns.map((turn) =>
      turn === focus
        ? turn
        : {
            ...turn,
            steps: [],
            spans: turn.running ? turn.spans : [],
            totals: totalsOf([]),
          },
    ),
  };
}

export function extendTo(turn: TurnSteps, now: number): TurnSteps {
  if (!turn.running) return turn;
  const last = turn.spans.at(-1);
  const from = last?.to ?? turn.startedAt;
  if (now <= from) return turn;
  const spans =
    last === undefined
      ? [{ kind: "think" as const, from, to: now, stepId: null }]
      : [...turn.spans.slice(0, -1), { ...last, to: now }];
  return { ...turn, spans, totals: totalsOf(spans) };
}

interface Group {
  id: string;
  prompt: Row | null;
  turn: Row | null;
  rows: Row[];
}

/**
 * Rows into turns, oldest first. A finished turn may come as a turn row whose
 * children are its rows, after its prompt with no turn id; the live turn comes
 * as flat rows sharing a turn id. A prompt still waiting for its turn, while
 * the thread runs, is a turn of its own.
 */
function groupTurns(rows: readonly unknown[], running: boolean): Group[] {
  const groups: Group[] = [];
  const byId = new Map<string, Group>();
  let waiting: Row | null = null;
  const groupFor = (id: string): Group => {
    let group = byId.get(id);
    if (group === undefined) {
      group = { id, prompt: waiting, turn: null, rows: [] };
      waiting = null;
      byId.set(id, group);
      groups.push(group);
    }
    return group;
  };
  const isPrompt = (row: Row) =>
    row.kind === "conversation" &&
    row.role === "user" &&
    row.turnRequest?.status !== "rejected";
  const place = (row: Row, group: Group) => {
    if (isPrompt(row)) group.prompt ??= row;
    else group.rows.push(row);
  };
  for (const raw of rows) {
    const row = parseRow(raw);
    if (row === null) continue;
    if (row.kind === "turn" && row.turnId) {
      const group = groupFor(row.turnId);
      group.turn = row;
      for (const child of row.children ?? []) {
        const parsed = parseRow(child);
        if (parsed !== null) place(parsed, group);
      }
    } else if (row.turnId) place(row, groupFor(row.turnId));
    else if (isPrompt(row)) waiting = row;
  }
  const trailing = waiting as Row | null;
  if (trailing !== null && running)
    groups.push({
      id: `waiting:${trailing.id}`,
      prompt: trailing,
      turn: null,
      rows: [],
    });
  return groups;
}

function buildTurn(
  group: Group,
  running: boolean,
  threadRunning: boolean,
  now: number,
): TurnSteps | null {
  const steps = group.rows
    .flatMap((row) => {
      const step = toStep(row, threadRunning);
      return step === null ? [] : [step];
    })
    .sort((a, b) => a.startedAt - b.startedAt);
  const starts = [
    group.prompt?.startedAt,
    group.turn?.startedAt,
    ...group.rows.map((row) => row.startedAt),
  ].filter((time) => time !== undefined);
  if (starts.length === 0) return null;
  const startedAt = group.prompt?.startedAt ?? Math.min(...starts);
  const endedAt = running
    ? null
    : Math.max(
        startedAt,
        group.turn?.completedAt ?? startedAt,
        ...group.rows.map(rowEnd),
      );
  const spans = attribute(
    steps,
    startedAt,
    endedAt ?? Math.max(now, startedAt),
    now,
  );
  return {
    id: group.id,
    prompt: clip(group.prompt?.text?.trim() || "Automatic turn", PROMPT_CAP),
    startedAt,
    endedAt,
    running,
    steps,
    spans,
    totals: totalsOf(spans),
  };
}

/** The deepest running step, taking the latest started at each level. */
function currentStep(steps: readonly Step[]): Step | null {
  const running = steps.filter((step) => step.status === "running").at(-1);
  if (running === undefined) return null;
  return currentStep(running.children) ?? running;
}

/** A thread's timeline rows as steps per turn, and where each turn's time went. */
export function buildThreadSteps(
  rows: readonly unknown[],
  options: { threadId: string; running: boolean; now: number; hasOlder: boolean },
): ThreadSteps {
  const groups = groupTurns(rows, options.running);
  const turns = groups.flatMap((group, index) => {
    const live = options.running && index === groups.length - 1;
    const turn = buildTurn(group, live, options.running, options.now);
    return turn === null ? [] : [turn];
  });
  const newest = turns.at(-1);
  return {
    threadId: options.threadId,
    running: options.running,
    now: newest?.running ? currentStep(newest.steps) : null,
    turns: turns.reverse(),
    hasOlder: options.hasOlder,
  };
}
