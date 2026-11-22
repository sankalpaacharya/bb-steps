import { useState, type ReactNode } from "react";
import {
  experimental_ThreadStatusGlyph as ThreadStatusGlyph,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

import type { ActiveGroup } from "@/lib/active";
import { faceOf } from "@/lib/avatar";
import { FOCUS_RING, PANEL_ROW } from "@/lib/styles";
import { formatElapsed } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Disclosure } from "./disclosure";

const OPEN_KEY = "steps:active-open";

function useRememberedOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setOpen((current) => {
      try {
        localStorage.setItem(OPEN_KEY, String(!current));
      } catch {
        // A blocked store only forgets the choice.
      }
      return !current;
    });
  return [open, toggle];
}

function Avatar({ group, logos }: { group: ActiveGroup; logos: Record<string, string> }) {
  const { avatar, captain } = group;
  if (avatar === null || captain === null) return null;
  const logo =
    avatar.style === "logo" ? (avatar.image ?? logos[captain.projectId]) : undefined;
  return (
    <img
      alt=""
      src={logo ?? faceOf(avatar.seed)}
      className={cn(
        "size-4 shrink-0 rounded-[4px] object-contain",
        logo !== undefined && "bg-white ring-1 ring-black/10 ring-inset",
      )}
    />
  );
}

function Row({
  thread,
  label,
  lead,
  indent,
  selected,
  now,
  running,
  onPick,
}: {
  thread: PluginSidebarThread;
  label: string;
  lead: ReactNode;
  indent: boolean;
  selected: boolean;
  now: number;
  running: boolean;
  onPick: (threadId: string) => void;
}) {
  return (
    <li className="list-none">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        title={thread.displayTitle}
        onClick={() => onPick(thread.id)}
        className={cn(
          PANEL_ROW,
          "h-7 items-center gap-2 px-2",
          indent && "pl-8",
          selected && "bg-accent",
        )}
      >
        {lead}
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            selected ? "text-foreground" : "text-foreground/75",
            lead !== null && "font-medium",
          )}
        >
          {label}
        </span>
        {running ? (
          <>
            <ThreadStatusGlyph indicator={thread.indicator} size="compact" />
            <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {formatElapsed(Math.max(now - thread.updatedAt, 0))}
            </span>
          </>
        ) : null}
      </button>
    </li>
  );
}

/**
 * Every thread running now across bb, under its captain, to inspect one in
 * this tab. Picking changes only what the tab shows, never the chat.
 */
export function ActivePicker({
  groups,
  logos,
  selected,
  now,
  onPick,
}: {
  groups: readonly ActiveGroup[];
  logos: Record<string, string>;
  selected: string;
  now: number;
  onPick: (threadId: string) => void;
}) {
  const [open, toggle] = useRememberedOpen();
  const count = groups.reduce(
    (sum, group) => sum + group.threads.length + (group.running ? 1 : 0),
    0,
  );
  if (count === 0)
    return (
      <p className="m-0 shrink-0 border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
        Nothing is running right now.
      </p>
    );
  return (
    <section className="shrink-0 border-b border-border px-1 py-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className={cn(
          "flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground hover:text-foreground",
          FOCUS_RING,
        )}
      >
        <span>Active</span>
        <span className="tabular-nums">{count}</span>
        <Disclosure open={open} />
      </button>
      {open ? (
        <ol className="m-0 flex max-h-[40vh] flex-col gap-px overflow-y-auto p-0">
          {groups.map((group) => (
            <li key={group.captain?.id ?? "other"} className="list-none">
              <ol className="m-0 flex flex-col gap-px p-0">
                {group.captain === null ? (
                  <li className="list-none px-2 pt-1.5 pb-0.5 text-[11px] font-medium text-muted-foreground">
                    Other
                  </li>
                ) : (
                  <Row
                    thread={group.captain}
                    label={group.captain.displayTitle}
                    lead={<Avatar group={group} logos={logos} />}
                    indent={false}
                    selected={group.captain.id === selected}
                    now={now}
                    running={group.running}
                    onPick={onPick}
                  />
                )}
                {group.threads.map((thread) => (
                  <Row
                    key={thread.id}
                    thread={thread}
                    label={thread.displayTitle}
                    lead={null}
                    indent={group.captain !== null}
                    selected={thread.id === selected}
                    now={now}
                    running
                    onPick={onPick}
                  />
                ))}
              </ol>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
