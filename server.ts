import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { MAX_TURNS, rpcContract, stepsTag } from "./lib/rpc";
import {
  buildThreadSteps,
  focusTurn,
  outputOfRow,
  type ChildThread,
} from "./lib/steps";

/** Thread statuses with a turn under way. */
const RUNNING_STATUSES = new Set(["active", "starting", "pending"]);

/** Thread events that only stream text or counters, and so change no step. */
const DELTA_EVENTS = new Set([
  "item/agentMessage/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/plan/delta",
  "thread/tokenUsage/updated",
  "thread/contextWindowUsage/updated",
  "provider/rateLimits/updated",
  "item/toolCall/progress",
  "item/mcpToolCall/progress",
  "item/backgroundTask/progress",
  "turn/diff/updated",
]);

type TimelineRead = Extract<
  Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["timeline"]>>,
  { rows: unknown }
>;
type TimelineRow = TimelineRead["rows"][number];

/** How far down a thread's children are followed. */
const MAX_THREAD_DEPTH = 4;

/** History read for one thread opened from another. */
const THREAD_RUN_SEGMENTS = 41;

/** Enough pages for the longest Steps list, should a thread read short. */
const MAX_TIMELINE_PAGES = 40;

/** Changes to one thread within this window refresh its steps once. */
const STEPS_COALESCE_MS = 700;

export default async function plugin(bb: BbPluginApi) {
  /** bb caps one read, so older history comes back a page at a time. */
  const readTimeline = async (threadId: string, segments: number) => {
    const byId = new Map<string, TimelineRow>();
    let older: { anchorId: string; anchorSeq: number } | null = null;
    let rows: TimelineRow[] = [];
    let read = 0;
    for (let page = 0; page < MAX_TIMELINE_PAGES; page += 1) {
      const timeline: TimelineRead = await bb.sdk.threads.timeline({
        threadId,
        includeNestedRows: "true",
        segmentLimit: String(segments - read),
        ...(older === null
          ? {}
          : {
              beforeAnchorId: older.anchorId,
              beforeAnchorSeq: String(older.anchorSeq),
            }),
      });
      for (const row of timeline.timelinePage?.olderRowUpdates ?? [])
        if (byId.has(row.id)) byId.set(row.id, row);
      rows = [...timeline.rows, ...rows];
      for (const row of timeline.rows) byId.set(row.id, row);
      older = timeline.timelinePage?.olderCursor ?? null;
      read += timeline.timelinePage?.returnedSegmentCount ?? segments;
      if (older === null || read >= segments) break;
    }
    const seen = new Set<string>();
    const merged = rows.flatMap((row) => {
      if (seen.has(row.id)) return [];
      seen.add(row.id);
      return [byId.get(row.id) ?? row];
    });
    return { rows: merged, hasOlder: older !== null };
  };

  /** Which thread started which, so a child's change refreshes its parents. */
  const parentOf = new Map<string, string>();

  /** Every thread under this one, a few levels deep, as Agent Graph walks them. */
  const readDescendants = async (threadId: string): Promise<ChildThread[]> => {
    const found: ChildThread[] = [];
    let frontier = [threadId];
    for (let depth = 0; depth < MAX_THREAD_DEPTH && frontier.length > 0; depth += 1) {
      const levels = await Promise.all(
        frontier.map(async (parentThreadId) => ({
          parentThreadId,
          children: await bb.sdk.threads.list({
            parentThreadId,
            includeHidden: true,
            limit: 100,
          }),
        })),
      );
      frontier = [];
      for (const { parentThreadId, children } of levels) {
        for (const child of children) {
          parentOf.set(child.id, parentThreadId);
          frontier.push(child.id);
          const running = RUNNING_STATUSES.has(child.status);
          found.push({
            id: child.id,
            title: child.title ?? child.titleFallback ?? "Untitled thread",
            status: running
              ? "running"
              : child.status === "error"
                ? "error"
                : "done",
            startedAt: child.createdAt,
            endedAt: running ? null : child.updatedAt,
          });
        }
      }
    }
    return found;
  };

  bb.rpc.register(rpcContract, {
    thread_steps: async ({ threadId, turns, turnId }) => {
      const [thread, timeline, descendants] = await Promise.all([
        bb.sdk.threads.get({ threadId }),
        readTimeline(threadId, turns + 1),
        readDescendants(threadId),
      ]);
      const steps = buildThreadSteps(timeline.rows, {
        threadId,
        running: RUNNING_STATUSES.has(thread.status),
        now: Date.now(),
        hasOlder: timeline.hasOlder,
      });
      return focusTurn(
        { ...steps, turns: steps.turns.slice(0, MAX_TURNS) },
        turnId,
        turns,
        descendants,
      );
    },

    thread_run: async ({ threadId }) => {
      const [thread, timeline] = await Promise.all([
        bb.sdk.threads.get({ threadId }),
        readTimeline(threadId, THREAD_RUN_SEGMENTS),
      ]);
      const { turns } = buildThreadSteps(timeline.rows, {
        threadId,
        running: RUNNING_STATUSES.has(thread.status),
        now: Date.now(),
        hasOlder: timeline.hasOlder,
      });
      return { steps: [...turns].reverse().flatMap((turn) => turn.steps) };
    },

    step_output: async ({ threadId, stepId, turns }) => {
      const { rows } = await readTimeline(threadId, turns + 1);
      return { output: outputOfRow(rows, stepId) };
    },
  });

  const changedThreads = new Set<string>();
  let stepsTimer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = bb.sdk.subscribe({
    event: "thread:changed",
    callback: (event) => {
      const types = event.metadata?.eventTypes;
      if (types?.length && types.every((type) => DELTA_EVENTS.has(type)))
        return;
      if (event.id === undefined) return;
      for (
        let id: string | undefined = event.id;
        id !== undefined && !changedThreads.has(id);
        id = parentOf.get(id)
      )
        changedThreads.add(id);
      stepsTimer ??= setTimeout(() => {
        stepsTimer = null;
        const tags = [...changedThreads].map(stepsTag);
        changedThreads.clear();
        bb.rpc.experimental_invalidate(tags);
      }, STEPS_COALESCE_MS);
    },
  });
  bb.onDispose(() => {
    unsubscribe();
    if (stepsTimer !== null) clearTimeout(stepsTimer);
  });

  bb.log.info("loaded");
}
