import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/** An Armada captain as its `captains_list` returns it. */
export interface Captain {
  threadId: string;
  avatar: { style: string; seed: string; image?: string };
}

/** A captain and its threads running now; `captain` is null for the rest. */
export interface ActiveGroup {
  captain: PluginSidebarThread | null;
  avatar: Captain["avatar"] | null;
  /** Whether the captain itself is running. */
  running: boolean;
  /** Running threads under it, newest first, without the captain. */
  threads: PluginSidebarThread[];
}

const BUSY = new Set(["starting", "active", "stopping"]);

export const isRunning = (thread: PluginSidebarThread): boolean =>
  BUSY.has(thread.status) || thread.activity.backgroundAgents > 0;

/**
 * Every running thread under the captain it was started from, in the
 * captains' order, and the threads under no captain last.
 */
export function activeGroups(
  threads: readonly PluginSidebarThread[],
  captains: readonly Captain[],
): ActiveGroup[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const captainIds = new Set(captains.map((captain) => captain.threadId));
  const captainOf = (thread: PluginSidebarThread): string | null => {
    const seen = new Set<string>();
    for (let at: PluginSidebarThread | undefined = thread; at && !seen.has(at.id); ) {
      if (captainIds.has(at.id)) return at.id;
      seen.add(at.id);
      at = at.parentThreadId === null ? undefined : byId.get(at.parentThreadId);
    }
    return null;
  };
  const under = new Map<string | null, PluginSidebarThread[]>();
  const runningCaptains = new Set<string>();
  for (const thread of threads.filter(isRunning)) {
    if (captainIds.has(thread.id)) {
      runningCaptains.add(thread.id);
      continue;
    }
    const key = captainOf(thread);
    under.set(key, [...(under.get(key) ?? []), thread]);
  }
  const newestFirst = (list: PluginSidebarThread[]) =>
    list.sort((a, b) => b.updatedAt - a.updatedAt);
  const groups: ActiveGroup[] = captains.flatMap((captain) => {
    const thread = byId.get(captain.threadId);
    const running = runningCaptains.has(captain.threadId);
    const workers = under.get(captain.threadId) ?? [];
    if (thread === undefined || (!running && workers.length === 0)) return [];
    return [{ captain: thread, avatar: captain.avatar, running, threads: newestFirst(workers) }];
  });
  const rest = under.get(null) ?? [];
  return rest.length === 0
    ? groups
    : [...groups, { captain: null, avatar: null, running: false, threads: newestFirst(rest) }];
}
