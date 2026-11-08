import { describe, expect, it } from "vitest";

import {
  buildThreadSteps,
  extendTo,
  focusTurn,
  outputOfRow,
  type Step,
  type TurnSteps,
} from "../lib/steps";
import timeline from "./fixtures/timeline.json";
import { at, base, command, prompt, reply, thought, work } from "./timeline-rows";

const build = (
  rows: unknown[],
  { running = false, now = at(1000) } = {},
) =>
  buildThreadSteps(rows, { threadId: "thr", running, now, hasOlder: false });

const onlyTurn = (rows: unknown[], options?: Parameters<typeof build>[1]) => {
  const { turns } = build(rows, options);
  expect(turns).toHaveLength(1);
  return turns[0]!;
};

const wall = (turn: TurnSteps) =>
  (turn.endedAt ?? 0) - turn.startedAt;

const sum = (turn: TurnSteps) =>
  Object.values(turn.totals).reduce((total, ms) => total + ms, 0);

const faces = (steps: Step[]) =>
  steps.map(({ kind, verb, target }) => ({ kind, verb, target }));

describe("what kind of step a row is", () => {
  it("counts a shell command that only reads, lists or searches as reading, and anything else as running", () => {
    const turn = onlyTurn([
      prompt("t1", 0, "look around"),
      command("t1", 1, 2, "cd /repo && sed -n 1,40p lib/forest.ts", [
        { type: "read", command: "sed", name: "sed", path: "lib/forest.ts" },
      ]),
      command("t1", 3, 4, "ls lib", [
        { type: "list_files", command: "ls lib", path: "lib" },
      ]),
      command("t1", 5, 6, "grep -rn needle lib", [
        { type: "search", command: "grep", path: "lib", query: "needle" },
      ]),
      command("t1", 7, 8, "cat a.ts && npm test", [
        { type: "read", command: "cat", name: "cat", path: "a.ts" },
        { type: "unknown", command: "npm test" },
      ]),
      command("t1", 9, 10, "cd /repo && npm run check"),
    ]);
    expect(faces(turn.steps)).toEqual([
      { kind: "read", verb: "Read", target: "forest.ts" },
      { kind: "read", verb: "Listed", target: "lib" },
      { kind: "read", verb: "Searched", target: "needle" },
      { kind: "run", verb: "Ran", target: "cat a.ts && npm test" },
      { kind: "run", verb: "Ran", target: "npm run check" },
    ]);
    expect(turn.steps[0]!.path).toBe("/repo/lib/forest.ts");
    expect(turn.steps[4]!.detail).toBe("cd /repo && npm run check");
  });

  it("names a command by the parts that do the work", () => {
    const turn = onlyTurn([
      prompt("t1", 0, "go"),
      command("t1", 1, 2, "bb plugin reload armada >/dev/null 2>&1; cd ~/shot && node steps.mjs dark"),
      command("t1", 3, 4, "cat > ag.mjs <<'EOF'\nconsole.log(1)\nEOF"),
      command("t1", 5, 6, "cd ~/repo && python3 - <<'EOF'\nprint(1)\nEOF"),
      command("t1", 7, 8, "R=/tmp/x; ls $R | head -3"),
    ]);
    expect(turn.steps.map((step) => step.target)).toEqual([
      "bb plugin reload armada && node steps.mjs dark",
      "Wrote ag.mjs",
      "python3 script",
      "ls $R | head -3",
    ]);
  });

  it("reads file reads, edits, web, questions and reasoning as their own kinds, and an unknown kind as a tool", () => {
    const turn = onlyTurn([
      prompt("t1", 0, "go"),
      work("t1", 1, 2, "file-read", { path: "/repo/README.md" }),
      work("t1", 3, 4, "file-change", {
        change: {
          path: "/repo/lib/a.ts",
          kind: "update",
          movePath: null,
          diff: null,
          diffStats: { added: 3, removed: 1 },
        },
      }),
      work("t1", 5, 6, "web-fetch", {
        url: "https://docs.example.com/guide",
        prompt: null,
        pattern: null,
      }),
      work("t1", 7, 8, "web-search", { queries: ["bb plugins"] }),
      work("t1", 9, 20, "question", {
        questions: [{ prompt: "Which one?" }],
      }),
      work("t1", 21, 22, "approval", {
        approvalKind: "permission-grant",
        target: { itemId: "i", toolName: "Bash" },
      }),
      thought("t1", 23, 25, "Weighing the options."),
      work("t1", 26, 27, "teleport", {
        presentation: {
          label: { pending: "Teleporting", completed: "Teleported" },
          icon: { glyph: "Zap" },
          title: "the moon",
        },
      }),
    ]);
    expect(faces(turn.steps)).toEqual([
      { kind: "read", verb: "Read", target: "README.md" },
      { kind: "edit", verb: "Edited", target: "a.ts" },
      { kind: "web", verb: "Fetched", target: "docs.example.com/guide" },
      { kind: "web", verb: "Searched the web", target: "bb plugins" },
      { kind: "wait", verb: "Asked you", target: "Which one?" },
      { kind: "wait", verb: "Asked to approve", target: "Bash" },
      { kind: "think", verb: "Thought", target: "Weighing the options." },
      { kind: "tool", verb: "Teleported", target: "the moon" },
    ]);
    expect(turn.steps[1]!.path).toBe("/repo/lib/a.ts");
  });

  it("gives a subagent its own steps, and lasts until its last one ends", () => {
    const turn = onlyTurn([
      prompt("t1", 0, "research"),
      work("t1", 1, 1.05, "delegation", {
        toolName: "delegation",
        background: true,
        description: "Find prior art",
        subagentType: "general-purpose",
        output: "launched",
        childRows: [
          work("t1", 2, 3, "web-fetch", { url: "https://a.dev", prompt: null }),
          work("t1", 4, 30, "file-read", { path: "/notes.md" }),
        ],
      }),
      reply("t1", 40),
    ]);
    const [agent] = turn.steps;
    expect(agent).toMatchObject({
      kind: "agent",
      target: "Find prior art",
      startedAt: at(1),
      endedAt: at(30),
    });
    expect(faces(agent!.children)).toEqual([
      { kind: "web", verb: "Fetched", target: "a.dev" },
      { kind: "read", verb: "Read", target: "notes.md" },
    ]);
    expect(turn.totals.agent).toBe(29_000);
  });

  it("never fails on a row it cannot read, and skips it", () => {
    const turn = onlyTurn([
      prompt("t1", 0, "go"),
      { kind: "work", workKind: "command" },
      null,
      command("t1", 1, 2, "make"),
    ]);
    expect(faces(turn.steps)).toEqual([
      { kind: "run", verb: "Ran", target: "make" },
    ]);
  });
});

describe("turns", () => {
  it("reads a finished turn row with its children after the prompt that started it", () => {
    const { turns } = build([
      prompt(null, 0, "first ask"),
      {
        ...base("t1", 0, 50),
        kind: "turn",
        status: "completed",
        summaryCount: 2,
        completedAt: at(50),
        children: [command("t1", 1, 5, "make"), reply("t1", 49)],
      },
      prompt("t2", 60, "second ask"),
      command("t2", 61, 70, "make test"),
      reply("t2", 72),
    ]);
    expect(
      turns.map(({ prompt: text, startedAt, endedAt, steps }) => ({
        text,
        startedAt,
        endedAt,
        steps: steps.filter((step) => step.verb !== "Replied").length,
      })),
    ).toEqual([
      { text: "second ask", startedAt: at(60), endedAt: at(72), steps: 1 },
      { text: "first ask", startedAt: at(0), endedAt: at(50), steps: 1 },
    ]);
  });

  it("keeps a steer in the turn it joined, under the turn's first prompt", () => {
    const { turns } = build([
      prompt("t1", 0, "build it"),
      command("t1", 1, 2, "make"),
      prompt("t1", 3, "also add tests"),
      command("t1", 4, 5, "make test"),
    ]);
    expect(turns.map((turn) => [turn.prompt, turn.steps.length])).toEqual([
      ["build it", 2],
    ]);
  });

  it("shows a prompt still waiting for its turn as a running turn with no steps", () => {
    const { turns, running } = build(
      [prompt("t1", 0, "one"), reply("t1", 5), prompt(null, 10, "two")],
      { running: true, now: at(14) },
    );
    expect(running).toBe(true);
    expect(turns[0]).toMatchObject({
      prompt: "two",
      running: true,
      endedAt: null,
      steps: [],
      totals: { think: 4000 },
    });
    expect(turns[1]).toMatchObject({ prompt: "one", running: false });
  });

  it("calls a turn without a prompt an automatic turn", () => {
    expect(onlyTurn([command("t1", 1, 2, "make")]).prompt).toBe(
      "Automatic turn",
    );
  });
});

describe("where a turn's time went", () => {
  it("adds up to the turn's wall time exactly, even when steps overlap", () => {
    const turn = onlyTurn([
      prompt("t1", 0, "go"),
      command("t1", 2, 12, "npm test"),
      work("t1", 4, 8, "file-read", { path: "/a.ts" }),
      work("t1", 6, 9, "file-change", {
        change: { path: "/a.ts", kind: "update" },
      }),
      reply("t1", 20),
    ]);
    expect(wall(turn)).toBe(20_000);
    expect(sum(turn)).toBe(20_000);
    expect(turn.totals).toMatchObject({
      edit: 3000,
      run: 7000,
      read: 0,
      think: 10_000,
    });
  });

  it("gives the time between steps to the model, as thinking with no step", () => {
    const turn = onlyTurn([
      prompt("t1", 0, "go"),
      command("t1", 5, 6, "ls"),
      reply("t1", 10),
    ]);
    expect(turn.spans.map(({ kind, stepId }) => [kind, stepId !== null])).toEqual([
      ["think", false],
      ["run", true],
      ["think", false],
    ]);
    expect(turn.totals.think).toBe(9000);
  });

  it("runs a running turn and its running step up to now", () => {
    const { turns, now } = build(
      [
        prompt("t1", 0, "go"),
        command("t1", 2, 3, "ls"),
        command("t1", 5, null, "npm run check"),
      ],
      { running: true, now: at(20) },
    );
    const turn = turns[0]!;
    expect(turn).toMatchObject({ running: true, endedAt: null });
    expect(sum(turn)).toBe(20_000);
    expect(turn.totals.run).toBe(16_000);
    expect(now).toMatchObject({ target: "npm run check", status: "running" });
  });

  it("names the step inside a running subagent as what is happening now", () => {
    const { now } = build(
      [
        prompt("t1", 0, "go"),
        work("t1", 1, null, "delegation", {
          description: "Explore",
          childRows: [
            work("t1", 2, 3, "file-read", { path: "/a.ts" }),
            work("t1", 4, null, "file-read", { path: "/b.ts" }),
          ],
        }),
      ],
      { running: true, now: at(9) },
    );
    expect(now).toMatchObject({ verb: "Read", target: "b.ts" });
  });

  it("marks a step left pending in a stopped thread as interrupted, not running", () => {
    const { turns, now } = build([
      prompt("t1", 0, "go"),
      command("t1", 1, null, "sleep 100"),
    ]);
    expect(turns[0]!.steps[0]!.status).toBe("interrupted");
    expect(now).toBeNull();
  });

  it("carries a running turn forward to a later now", () => {
    const turn = build(
      [prompt("t1", 0, "go"), command("t1", 2, null, "npm test")],
      { running: true, now: at(10) },
    ).turns[0]!;
    const later = extendTo(turn, at(15));
    expect(later.totals.run).toBe(13_000);
    expect(sum(later)).toBe(15_000);
  });
});

describe("a real thread", () => {
  const steps = build(timeline, { running: true, now: Date.now() });

  it("reads every turn, newest first, each adding up to its wall time", () => {
    expect(steps.turns.map((turn) => turn.prompt.slice(0, 24))).toEqual([
      "/frontend-design:fronten",
      "also what happens when s",
      "also can u put the way t",
    ]);
    for (const turn of steps.turns.slice(1)) expect(sum(turn)).toBe(wall(turn));
  });

  it("finds the question, the subagents and their own steps, and the edit inside one", () => {
    const [, research, theme] = steps.turns;
    expect(
      research!.steps
        .filter((step) => step.verb !== "Replied")
        .map((step) => step.kind),
    ).toEqual([
      "read",
      "think",
      "think",
      "wait",
      "think",
      "think",
      "agent",
      "agent",
    ]);
    const editing = theme!.steps.find((step) => step.kind === "agent")!;
    expect(faces(editing.children)).toContainEqual({
      kind: "edit",
      verb: "Created",
      target: "color-mode.ts",
    });
  });

  it("shows the newest turn's last command as running, and as now", () => {
    expect(steps.now).toMatchObject({ kind: "run", status: "running" });
  });
});

describe("a step's output", () => {
  it("finds it on nested rows, and is null when bb kept none", () => {
    const rows = [
      { id: "turn", children: [{ id: "cmd", output: "3 passed" }, { id: "read" }] },
      { id: "agent", childRows: [{ id: "inner", output: "done" }], output: "report" },
      "not a row",
    ];
    expect(outputOfRow(rows, "cmd")).toBe("3 passed");
    expect(outputOfRow(rows, "inner")).toBe("done");
    expect(outputOfRow(rows, "agent")).toBe("report");
    expect(outputOfRow(rows, "read")).toBeNull();
    expect(outputOfRow(rows, "missing")).toBeNull();
  });
});

describe("the turn in focus", () => {
  const steps = buildThreadSteps(
    [
      prompt("t1", 0, "first"),
      command("t1", 1, 2, "ls"),
      prompt("t2", 10, "second"),
      command("t2", 11, 12, "pwd"),
    ],
    { threadId: "thr", running: false, now: at(100), hasOlder: false },
  );
  const stepCounts = (turnId: string | null) =>
    focusTurn(steps, turnId, 10).turns.map((turn) => turn.steps.length);

  it("sends the newest turn's steps until one is named", () => {
    expect(stepCounts(null)).toEqual([1, 0]);
    expect(focusTurn(steps, null, 10).focus).toBe(steps.turns[0]!.id);
  });

  it("sends the named turn's steps, and still lists every turn", () => {
    const older = steps.turns[1]!.id;
    expect(stepCounts(older)).toEqual([0, 1]);
    expect(focusTurn(steps, older, 10).turns.map((turn) => turn.prompt)).toEqual([
      "second",
      "first",
    ]);
  });
});

describe("threads a message started", () => {
  const steps = buildThreadSteps(
    [prompt("t1", 0, "first"), reply("t1", 5), prompt("t2", 10, "second"), reply("t2", 15)],
    { threadId: "thr", running: false, now: at(100), hasOlder: false },
  );
  const thread = (id: string, at_: number) => ({
    id,
    title: id,
    status: "done" as const,
    startedAt: at(at_),
    endedAt: at(at_ + 1),
  });
  const all = [thread("early", 7), thread("late", 12)];

  it("belongs to the message it started under, until the next one", () => {
    const older = steps.turns[1]!.id;
    expect(focusTurn(steps, older, 10, all).children.map((t) => t.id)).toEqual(["early"]);
    expect(focusTurn(steps, null, 10, all).children.map((t) => t.id)).toEqual(["late"]);
    expect(focusTurn(steps, null, 10, all).allThreads).toHaveLength(2);
  });
});
