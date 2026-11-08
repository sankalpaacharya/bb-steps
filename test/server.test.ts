import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import plugin from "../server";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A `thread:changed` listener, typed loosely since the SDK does not export its event. */
type ThreadListener = (event: never) => void;

async function load(
  options: {
    timeline?: { status: string; rows: unknown[]; pages?: unknown[] };
  } = {},
) {
  const listeners = new Set<ThreadListener>();
  const { bb, harness } = createFakePluginHost({
    pluginId: "steps",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) =>
          ({ id: threadId, status: options.timeline?.status ?? "idle" }) as never,
        timeline: async () =>
          (options.timeline?.pages?.shift() as never) ??
          ({
            rows: options.timeline?.rows ?? [],
            timelinePage: { olderCursor: null },
          }) as never,
      },
      subscribe: ({ callback }: { callback: ThreadListener }) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    },
  });
  await plugin(bb);
  const since = {
    calls: (callPath?: string) =>
      harness.sdk.calls.filter(
        (call) => callPath === undefined || call.path === callPath,
      ),
    invalidations: () => harness.experimental_rpcInvalidations,
  };
  const threadChanged = (id: string, eventTypes?: string[]) => {
    const event = {
      type: "changed",
      entity: "thread",
      changes: ["events-appended"],
      id,
      metadata: eventTypes === undefined ? undefined : { eventTypes },
    };
    for (const listener of listeners) listener(event as never);
  };
  return { bb, harness, since, threadChanged, listeners };
}

describe("thread steps", () => {
  const rows = [
    {
      id: "p",
      threadId: "thr_a",
      turnId: "t1",
      sourceSeqStart: 1,
      sourceSeqEnd: 1,
      startedAt: 1_000,
      createdAt: 1_000,
      kind: "conversation",
      role: "user",
      text: "check it",
      turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
    },
    {
      id: "c",
      threadId: "thr_a",
      turnId: "t1",
      sourceSeqStart: 2,
      sourceSeqEnd: 2,
      startedAt: 2_000,
      createdAt: 2_000,
      kind: "work",
      workKind: "command",
      status: "pending",
      completedAt: null,
      command: "npm run check",
      output: "a very long output",
      exitCode: null,
      activityIntents: [],
    },
  ];

  it("reads one more segment than the turns asked for, with subagents' rows, and runs a running thread's steps to now", async () => {
    const { harness, since } = await load({
      timeline: { status: "active", rows },
    });
    const steps = (await harness.callRpc("thread_steps", {
      threadId: "thr_a",
      turns: 10,
      turnId: null,
    })) as { running: boolean; now: { target: string } | null };
    expect(since.calls("threads.timeline").map((call) => call.args)).toEqual([
      [{ threadId: "thr_a", includeNestedRows: "true", segmentLimit: "11" }],
    ]);
    expect(steps.running).toBe(true);
    expect(steps.now?.target).toBe("npm run check");
    expect(JSON.stringify(steps)).not.toContain("a very long output");
  });

  it("pages back through older history until it has read enough", async () => {
    const page = (segment: string, cursor: boolean) => ({
      rows: [{ ...rows[0], id: `row-${segment}` }],
      timelinePage: {
        returnedSegmentCount: 5,
        olderCursor: cursor ? { anchorId: `a-${segment}`, anchorSeq: 7 } : null,
      },
    });
    const { harness, since } = await load({
      timeline: {
        status: "idle",
        rows: [],
        pages: [page("new", true), page("old", true)],
      },
    });
    const steps = (await harness.callRpc("thread_steps", {
      threadId: "thr_a",
      turns: 9,
      turnId: null,
    })) as { hasOlder: boolean; turnsRead: number };
    expect(since.calls("threads.timeline").map((call) => call.args[0])).toEqual([
      { threadId: "thr_a", includeNestedRows: "true", segmentLimit: "10" },
      {
        threadId: "thr_a",
        includeNestedRows: "true",
        segmentLimit: "5",
        beforeAnchorId: "a-new",
        beforeAnchorSeq: "7",
      },
    ]);
    expect(steps).toMatchObject({ hasOlder: true, turnsRead: 9 });
  });

  it("refuses more than 200 turns", async () => {
    const { harness } = await load();
    await expect(
      harness.callRpc("thread_steps", {
        threadId: "thr_a",
        turns: 201,
        turnId: null,
      }),
    ).rejects.toThrow();
  });

  it("refreshes a thread's steps once per burst of changes, ignoring streamed text", async () => {
    vi.useFakeTimers();
    const { since, threadChanged } = await load();
    threadChanged("thr_a", ["item/agentMessage/delta"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(since.invalidations()).toEqual([]);
    threadChanged("thr_a", ["item/started"]);
    threadChanged("thr_a", ["item/completed"]);
    threadChanged("thr_b");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(since.invalidations()).toEqual([["steps:thr_a", "steps:thr_b"]]);
  });

  it("stops listening when the plugin unloads", async () => {
    const { harness, listeners } = await load();
    expect(listeners.size).toBe(1);
    await harness.dispose();
    expect(listeners.size).toBe(0);
  });
});
