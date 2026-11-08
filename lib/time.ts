const pad = (value: number): string => String(value).padStart(2, "0");

/** How long a step or turn took: "0.2s", "8s", "3m 02s", "1h 12m". */
export function formatElapsed(ms: number): string {
  if (ms < 950) {
    const tenths = Math.round(Math.max(ms, 0) / 100);
    if (tenths > 0) return `0.${tenths}s`;
    return ms > 0 ? "<0.1s" : "0s";
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${pad(seconds % 60)}s`;
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

/** Where in a turn a step started: "0:41", "12:03", "1:02:09". */
export function formatOffset(ms: number): string {
  const seconds = Math.floor(Math.max(ms, 0) / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}:${pad(seconds % 60)}`;
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}:${pad(seconds % 60)}`;
}
