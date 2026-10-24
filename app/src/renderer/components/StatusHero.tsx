import { ExternalLink, FileJson, Play, RotateCw, Square } from "lucide-react";

import type { BridgeState } from "../../shared/ipc.ts";
import seleyaMark from "../assets/seleya-mark.svg";
import { Button, cn, Pill, type Tone } from "./ui.tsx";

interface StatusView {
  tone: Tone;
  label: string;
  headline: string;
  detail: string;
}

export function statusView(state: BridgeState): StatusView {
  const address = `127.0.0.1:${state.port}`;
  switch (state.status) {
    case "starting":
      return { tone: "warning", label: "Starting", headline: "Starting…", detail: `Opening ${address}` };
    case "running":
      return state.busy
        ? {
            tone: "primary",
            label: "Working",
            headline: "Claude is answering",
            detail: "A request from Seleya is running on this Mac.",
          }
        : {
            tone: "success",
            label: "Running",
            headline: "Ready for Seleya",
            detail: `Listening on ${address} · v${state.version}`,
          };
    case "stopping":
      return { tone: "warning", label: "Stopping", headline: "Stopping…", detail: "Finishing open requests" };
    case "stopped":
      return {
        tone: "muted",
        label: "Off",
        headline: "Bridge is off",
        detail: "Seleya can't reach Claude on this Mac until you start it.",
      };
    case "error":
      return {
        tone: "destructive",
        label: "Error",
        headline: "Couldn't start the bridge",
        detail: state.error?.message ?? "Something went wrong.",
      };
  }
}

interface StatusHeroProps {
  state: BridgeState;
}

export function StatusHero({ state }: StatusHeroProps) {
  const view = statusView(state);
  const running = state.status === "running";
  const moving = state.status === "starting" || state.busy;

  return (
    <section
      id="status-hero"
      aria-label="Bridge status"
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-card p-5 shadow-float transition-colors duration-300",
        running && "bg-aurora-soft",
      )}
    >
      <div className="flex items-start gap-4">
        <img
          src={seleyaMark}
          alt=""
          className={cn(
            "size-12 shrink-0 transition-opacity duration-300",
            moving && "motion-safe:animate-orb-breathe",
            (state.status === "stopped" || state.status === "error") && "opacity-40 grayscale",
          )}
        />
        <div role="status" aria-atomic="true" className="flex min-w-0 flex-1 flex-col gap-1">
          <Pill tone={view.tone}>{view.label}</Pill>
          <p className="mt-1 text-xl font-semibold tracking-tight">{view.headline}</p>
          <p className={cn("text-sm", state.status === "error" ? "text-destructive" : "text-muted-foreground")}>
            {view.detail}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {(running || state.status === "starting") && (
          <>
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => void window.bridge.openSeleya()}
              disabled={!state.seleyaUrl}
            >
              <ExternalLink aria-hidden="true" />
              Open Seleya Provider
            </Button>
            <Button onClick={() => void window.bridge.stop()} disabled={!running}>
              <Square aria-hidden="true" />
              Stop
            </Button>
          </>
        )}
        {state.status === "stopped" && (
          <Button variant="primary" className="flex-1" onClick={() => void window.bridge.start()}>
            <Play aria-hidden="true" />
            Start bridge
          </Button>
        )}
        {state.status === "stopping" && (
          <Button className="flex-1" disabled>
            Stopping…
          </Button>
        )}
        {state.status === "error" && (
          <>
            <Button variant="primary" className="flex-1" onClick={() => void window.bridge.start()}>
              <RotateCw aria-hidden="true" />
              Try again
            </Button>
            {state.error?.kind === "config" && (
              <Button onClick={() => void window.bridge.openConfigFile()}>
                <FileJson aria-hidden="true" />
                Open config
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
