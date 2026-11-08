import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { rpcContract, stepsTag } from "./lib/rpc";
import { buildThreadSteps, focusTurn, outputOfRow } from "./lib/steps";

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

  bb.rpc.register(rpcContract, {
    thread_steps: async ({ threadId, turns, turnId }) => {
      const [thread, timeline] = await Promise.all([
        bb.sdk.threads.get({ threadId }),
        readTimeline(threadId, turns + 1),
      ]);
      const steps = buildThreadSteps(timeline.rows, {
        threadId,
        running: RUNNING_STATUSES.has(thread.status),
        now: Date.now(),
        hasOlder: timeline.hasOlder,
      });
      return focusTurn(steps, turnId, turns);
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
      changedThreads.add(event.id);
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
