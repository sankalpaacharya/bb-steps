import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import { activeGroups } from "@/lib/active";

const thread = (
  id: string,
  over: Partial<PluginSidebarThread> = {},
): PluginSidebarThread =>
  ({
    id,
    displayTitle: id,
    parentThreadId: null,
    status: "active",
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0 },
    updatedAt: 0,
    ...over,
  }) as PluginSidebarThread;

const captain = (threadId: string) => ({ threadId, avatar: { style: "micah", seed: threadId } });

const shape = (groups: ReturnType<typeof activeGroups>) =>
  groups.map((group) => [
    group.captain?.id ?? "other",
    group.running,
    group.threads.map((item) => item.id),
  ]);

describe("active threads", () => {
  it("puts each running thread under its captain, at any depth, and the rest under Other", () => {
    const threads = [
      thread("cap", { status: "idle" }),
      thread("w1", { parentThreadId: "cap", updatedAt: 1 }),
      thread("w2", { parentThreadId: "w1", updatedAt: 2 }),
      thread("done", { parentThreadId: "cap", status: "idle" }),
      thread("solo"),
    ];
    expect(shape(activeGroups(threads, [captain("cap")]))).toEqual([
      ["cap", false, ["w2", "w1"]],
      ["other", false, ["solo"]],
    ]);
  });

  it("leaves out captains with nothing running, and counts background agents as running", () => {
    const threads = [
      thread("idle-cap", { status: "idle" }),
      thread("cap", {
        status: "idle",
        activity: { workflows: 0, backgroundAgents: 1, backgroundCommands: 0, planMode: 0 },
      }),
    ];
    expect(shape(activeGroups(threads, [captain("idle-cap"), captain("cap")]))).toEqual([
      ["cap", true, []],
    ]);
  });
});
