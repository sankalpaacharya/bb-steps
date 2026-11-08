import { useEffect, useState } from "react";

const LIVE_TICK_MS = 1_000;

/** A time that moves every second while `live`, and holds still otherwise. */
export function useLiveNow(live: boolean): number {
  const [time, setTime] = useState(Date.now);
  useEffect(() => {
    if (!live) return;
    setTime(Date.now());
    const timer = setInterval(() => setTime(Date.now()), LIVE_TICK_MS);
    return () => clearInterval(timer);
  }, [live]);
  return time;
}
