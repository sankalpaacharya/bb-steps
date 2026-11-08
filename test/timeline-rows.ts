/** Timeline rows shaped like bb's, at seconds after T0. */
const T0 = 1_800_000_000_000;
export const at = (seconds: number) => T0 + seconds * 1000;

let seq = 0;
export const base = (turnId: string | null, from: number, to: number | null) => ({
  id: `row-${(seq += 1)}`,
  threadId: "thr",
  turnId,
  sourceSeqStart: seq,
  sourceSeqEnd: seq,
  startedAt: at(from),
  createdAt: at(to ?? from),
});

export const prompt = (turnId: string | null, from: number, text: string) => ({
  ...base(turnId, from, from),
  kind: "conversation",
  role: "user",
  text,
  turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
});

export const reply = (turnId: string, from: number) => ({
  ...base(turnId, from, from),
  kind: "conversation",
  role: "assistant",
  text: "Done.",
  turnRequest: null,
});

export const work = (
  turnId: string | null,
  from: number,
  to: number | null,
  workKind: string,
  fields: Record<string, unknown> = {},
) => ({
  ...base(turnId, from, to),
  kind: "work",
  workKind,
  status: to === null ? "pending" : "completed",
  completedAt: to === null ? null : at(to),
  ...fields,
});

export const command = (
  turnId: string | null,
  from: number,
  to: number | null,
  text: string,
  activityIntents: unknown[] = [],
) =>
  work(turnId, from, to, "command", {
    command: text,
    cwd: "/repo",
    output: "",
    exitCode: 0,
    activityIntents,
  });

export const thought = (
  turnId: string,
  from: number,
  to: number,
  detail: string,
) => ({
  ...base(turnId, from, to),
  kind: "system",
  systemKind: "operation",
  operationKind: "reasoning",
  title: "Thought",
  detail,
  status: "completed",
  completedAt: at(to),
});
