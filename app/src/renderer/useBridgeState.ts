import { useEffect, useState } from "react";

import type { BridgeState } from "../shared/ipc.ts";

/** The main process's latest state, kept current by its pushes. */
export function useBridgeState(): BridgeState | undefined {
  const [state, setState] = useState<BridgeState>();
  useEffect(() => {
    const unsubscribe = window.bridge.onState(setState);
    void window.bridge.getState().then((initial) => setState((current) => current ?? initial));
    return unsubscribe;
  }, []);
  return state;
}
