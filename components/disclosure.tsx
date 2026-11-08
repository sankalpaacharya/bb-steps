import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Icon } from "./ui/icon";

export const EASE_OUT = "duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]";

/** The chevron of a row that opens, turned down while open. */
export function Disclosure({ open }: { open: boolean }) {
  return (
    <Icon
      name="ChevronRight"
      className={cn(
        "size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
        EASE_OUT,
        open && "rotate-90",
      )}
      aria-hidden
    />
  );
}

/**
 * Content that grows open and folds away. It mounts on first open and stays,
 * so folding animates; it clips rather than scrolls, so sticky content inside
 * still sticks to the panel.
 */
export function Collapsible({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return (
    <div
      inert={!open}
      aria-hidden={!open}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows,opacity] duration-[180ms] ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="min-h-0 min-w-0 overflow-clip">{opened ? children : null}</div>
    </div>
  );
}
