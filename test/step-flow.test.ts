import { describe, expect, it } from "vitest";

import {
  commandFolder,
  dayLabel,
  flowOf,
  groupTitle,
  messageText,
  runsOf,
  stepPlace,
  tildePath,
  visibleRuns,
} from "@/lib/step-flow";
import type { Step } from "@/lib/steps";

const step = (id: string, over: Partial<Step> = {}): Step => ({
  id,
  kind: "read",
  verb: "Read",
  target: `${id}.ts`,
  detail: null,
  path: null,
  startedAt: 0,
  endedAt: 100,
  status: "done",
  children: [],
  ...over,
});

const thought = (id: string, ms: number): Step =>
  step(id, { kind: "think", verb: "Thought", target: "", endedAt: ms });

const shape = (items: ReturnType<typeof flowOf>) =>
  items.map((item) =>
    item.type === "group"
      ? `group:${item.steps.map((s) => s.id).join(",")}`
      : `${item.type}:${item.step.id}`,
  );

describe("the step flow", () => {
  it("folds three or more of the same action in a row into one card", () => {
    const items = flowOf(
      [step("a"), step("b"), step("c"), step("r", { kind: "run", verb: "Ran" })],
      0,
    );
    expect(shape(items)).toEqual(["group:a,b,c", "step:r"]);
    const [group] = items;
    expect(group?.type === "group" ? groupTitle(group.steps) : null).toBe(
      "Read 3 files",
    );
  });

  it("keeps two in a row as their own cards", () => {
    expect(shape(flowOf([step("a"), step("b")], 0))).toEqual(["step:a", "step:b"]);
  });

  it("keeps every thought in the flow, each one ending a run", () => {
    const items = flowOf(
      [step("a"), thought("t1", 500), step("b"), step("c"), thought("t2", 22_000), step("d")],
      0,
    );
    expect(shape(items)).toEqual(["step:a", "thought:t1", "step:b", "step:c", "thought:t2", "step:d"]);
  });

  it("never folds the running step away", () => {
    const items = flowOf(
      [step("a"), step("b"), step("c"), step("d", { status: "running", endedAt: null })],
      0,
    );
    expect(shape(items)).toEqual(["group:a,b,c", "step:d"]);
  });

  it("says where a step happened", () => {
    expect(tildePath("/Users/sam/work/app")).toBe("~/work/app");
    expect(commandFolder("cd ~/work/app && npm test")).toBe("~/work/app");
    expect(commandFolder("npm test")).toBeNull();
    expect(stepPlace(step("a", { path: "/Users/sam/work/app/lib/a.ts" }))).toBe(
      "Read in ~/work/app/lib",
    );
    expect(
      stepPlace(step("r", { kind: "run", verb: "Ran", detail: "cd /home/sam/app && make" })),
    ).toBe("Ran in ~/app");
    expect(
      stepPlace(step("s", { kind: "agent", verb: "Subagent", children: [step("x"), step("y")] })),
    ).toBe("Subagent, 2 steps");
  });

  it("nests a subagent's steps and a folded run under their rows, only while open", () => {
    const agent = step("agent", {
      kind: "agent",
      verb: "Subagent",
      target: "Find it",
      children: [step("x"), step("y")],
    });
    const runs = runsOf([step("a"), step("b"), step("c"), agent], 0);
    expect(runs.map((run) => [run.title, run.count])).toEqual([
      ["Read 3 files", 3],
      ["Find it", null],
    ]);
    const rows = (open: string[]) =>
      visibleRuns(runs, new Set(open)).map(
        ({ node, depth }) => `${depth}:${node.title}`,
      );
    expect(rows([])).toEqual(["0:Read 3 files", "0:Find it"]);
    expect(rows(["agent"])).toEqual([
      "0:Read 3 files",
      "0:Find it",
      "1:x.ts",
      "1:y.ts",
    ]);
  });
});

describe("threads in the waterfall", () => {
  it("sits among the steps in time order, and opens as a thread", () => {
    const runs = runsOf(
      [step("a", { startedAt: 0 }), step("b", { kind: "run", verb: "Ran", startedAt: 20 })],
      0,
      [{ id: "w", title: "Worker", status: "running", startedAt: 10, endedAt: null }],
    );
    expect(runs.map((run) => run.title)).toEqual(["a.ts", "Worker", "b.ts"]);
    expect(runs[1]!.thread?.id).toBe("w");
  });
});

describe("the message list", () => {
  it("shows a message's own words, without the skills in front", () => {
    expect(messageText("/frontend-design:frontend-design yeah build it")).toBe("yeah build it");
    expect(messageText("/a /b:c go")).toBe("go");
    expect(messageText("dude /pstack:unslop this")).toBe("dude /pstack:unslop this");
    expect(messageText("/Users/sam/file.ts is broken")).toBe("/Users/sam/file.ts is broken");
    expect(messageText("/pstack:unslop")).toBe("unslop");
  });

  it("names the day a message was sent", () => {
    const now = new Date(2026, 10, 8, 12).getTime();
    expect(dayLabel(new Date(2026, 10, 8, 1).getTime(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 7, 23).getTime(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 10, 6, 9).getTime(), now)).toContain("6");
  });
});
