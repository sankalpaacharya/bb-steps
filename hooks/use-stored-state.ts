import { useState } from "react";

import { readStored, writeStored } from "@/lib/storage";

export function useStoredState<T>(
  key: string,
  parse: (raw: string) => T | undefined,
  fallback: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState(() => readStored(key, parse, fallback));
  const set = (next: T) => {
    setValue(next);
    writeStored(key, JSON.stringify(next));
  };
  return [value, set];
}
