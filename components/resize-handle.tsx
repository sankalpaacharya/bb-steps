import { useState, type KeyboardEvent, type PointerEvent } from "react";

import { useStoredState } from "@/hooks/use-stored-state";
import { FOCUS_RING } from "@/lib/styles";
import { cn } from "@/lib/utils";

const KEY_STEP = 24;

const parseSize = (raw: string): number | undefined => {
  const value: unknown = JSON.parse(raw);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

/**
 * A pane's size. A drag moves it live and stores it once on release, so the
 * pane opens at the same size next time; zero stored means the default.
 */
export function useStoredSize(
  key: string,
  { min, max, initial }: { min: number; max: () => number; initial: () => number },
) {
  const [stored, setStored] = useStoredState(key, parseSize, 0);
  const [dragging, setDragging] = useState<number | null>(null);
  const clamp = (size: number) => Math.round(Math.min(Math.max(size, min), max()));
  return {
    size: clamp(dragging ?? (stored || initial())),
    min,
    drag: (next: number) => setDragging(clamp(next)),
    commit: (next: number) => {
      setDragging(null);
      setStored(clamp(next));
    },
    reset: () => {
      setDragging(null);
      setStored(0);
    },
  };
}

/**
 * The edge of a pane; drag it, or use the arrow keys. A "y" handle sits on
 * top of its pane and an "x" handle on its right, so up and right grow it.
 */
export function ResizeHandle({
  axis,
  label,
  pane,
  className,
}: {
  axis: "x" | "y";
  label: string;
  pane: ReturnType<typeof useStoredSize>;
  className: string;
}) {
  const [start, setStart] = useState<{ at: number; size: number } | null>(null);
  const pointer = (event: PointerEvent<HTMLDivElement>): number =>
    axis === "y" ? event.clientY : event.clientX;
  const sizeAt = (event: PointerEvent<HTMLDivElement>): number => {
    if (start === null) return pane.size;
    const moved = pointer(event) - start.at;
    return start.size + (axis === "y" ? -moved : moved);
  };
  const [grow, shrink] =
    axis === "y" ? ["ArrowUp", "ArrowDown"] : ["ArrowRight", "ArrowLeft"];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === grow) pane.commit(pane.size + KEY_STEP);
    else if (event.key === shrink) pane.commit(pane.size - KEY_STEP);
    else return;
    event.preventDefault();
  };
  return (
    <div
      role="separator"
      aria-orientation={axis === "y" ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuenow={pane.size}
      aria-valuemin={pane.min}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setStart({ at: pointer(event), size: pane.size });
      }}
      onPointerMove={(event) => {
        if (start !== null) pane.drag(sizeAt(event));
      }}
      onPointerUp={(event) => {
        if (start === null) return;
        pane.commit(sizeAt(event));
        setStart(null);
      }}
      onPointerCancel={() => setStart(null)}
      onDoubleClick={pane.reset}
      onKeyDown={onKeyDown}
      className={cn(
        "group/resize z-10 flex touch-none",
        axis === "y"
          ? "cursor-row-resize items-center"
          : "cursor-col-resize justify-center",
        FOCUS_RING,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "bg-transparent transition-colors duration-150 group-hover/resize:bg-ring/60",
          axis === "y" ? "h-0.5 w-full" : "h-full w-0.5",
          start !== null && "bg-ring",
        )}
      />
    </div>
  );
}
