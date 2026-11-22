import { useEffect, useState } from "react";

import type { Captain } from "@/lib/active";

/** Armada's own RPC, read without depending on Armada; none reads as nothing. */
async function armada(method: string): Promise<unknown> {
  try {
    const response = await fetch(`/api/v1/plugins/armada/rpc/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    const body = (await response.json()) as { ok?: boolean; result?: unknown };
    return body.ok === true ? body.result : null;
  } catch {
    return null;
  }
}

const isCaptain = (value: unknown): value is Captain =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Captain).threadId === "string" &&
  typeof (value as Captain).avatar?.seed === "string";

/** Armada's captains and project logos, read again each time the tab shows. */
export function useArmada(visible: boolean) {
  const [state, setState] = useState<{
    captains: Captain[];
    logos: Record<string, string>;
  }>({ captains: [], logos: {} });
  useEffect(() => {
    if (!visible) return;
    let live = true;
    void Promise.all([armada("captains_list"), armada("project_logos")]).then(
      ([captains, logos]) => {
        if (!live) return;
        setState({
          captains: Array.isArray(captains) ? captains.filter(isCaptain) : [],
          logos:
            typeof logos === "object" && logos !== null
              ? (logos as Record<string, string>)
              : {},
        });
      },
    );
    return () => {
      live = false;
    };
  }, [visible]);
  return state;
}
