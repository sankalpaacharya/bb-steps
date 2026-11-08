export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A clickable row in the side panel, on the panel's accent. */
export const PANEL_ROW = `flex w-full cursor-pointer rounded-md text-left hover:bg-accent/60 ${FOCUS_RING}`;

export const HEADER_ACTION = `grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground aria-expanded:bg-state-active aria-expanded:text-foreground ${FOCUS_RING}`;
