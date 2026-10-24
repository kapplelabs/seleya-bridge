import type { BridgeState } from "../../shared/ipc.ts";
import { Card, Dot } from "./ui.tsx";

interface ConnectorsCardProps {
  connectors: BridgeState["connectors"];
  running: boolean;
  onOpenSettings: () => void;
}

export function ConnectorsCard({ connectors, running, onOpenSettings }: ConnectorsCardProps) {
  const { wanted, discovering, items, skipped } = connectors;

  return (
    <Card id="connectors" title="Claude can read (read-only)">
      {!wanted ? (
        <p className="text-sm text-muted-foreground">
          No connectors. To let Claude read Gmail, Calendar, Slack and the rest,{" "}
          <button type="button" className="font-medium text-primary hover:underline" onClick={onOpenSettings}>
            turn them on in Settings
          </button>
          .
        </p>
      ) : discovering ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">Looking up your claude.ai connectors…</p>
          <div className="flex gap-2" aria-hidden="true">
            {[72, 96, 64].map((width) => (
              <span key={width} className="skeleton h-7 rounded-full" style={{ width }} />
            ))}
          </div>
        </div>
      ) : !running ? (
        <p className="text-sm text-muted-foreground">Start the bridge to look them up.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          None connected in your claude.ai account. Connect them on claude.ai, then restart the bridge.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              title={
                item.state === "connected"
                  ? `${item.toolCount} read-only ${item.toolCount === 1 ? "tool" : "tools"}`
                  : item.error
              }
              className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs font-medium"
            >
              <Dot tone={item.state === "connected" ? "success" : "destructive"} />
              {item.name}
              {item.state === "unavailable" && <span className="text-muted-foreground">· unavailable</span>}
            </li>
          ))}
        </ul>
      )}
      {wanted && !discovering && skipped.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">Not connected here: {skipped.join(", ")}</p>
      )}
    </Card>
  );
}
