import { useState } from "react";

import { ConnectorsCard } from "./components/ConnectorsCard.tsx";
import { LinkCard } from "./components/LinkCard.tsx";
import { LogPanel } from "./components/LogPanel.tsx";
import { PairedBrowsers } from "./components/PairedBrowsers.tsx";
import { PairingCard } from "./components/PairingCard.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { statusView, StatusHero } from "./components/StatusHero.tsx";
import { cn, Dot } from "./components/ui.tsx";
import { useBridgeState } from "./useBridgeState.ts";

type Tab = "overview" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "settings", label: "Settings" },
];

export function App() {
  const state = useBridgeState();
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div id="bridge-panel" className="flex h-full flex-col">
      {/* The title bar: macOS draws the window buttons on the left of this strip. */}
      <header id="panel-header" className="drag-region flex h-13 shrink-0 items-center justify-between gap-3 pr-4 pl-20">
        <h1 className="text-sm font-semibold">Seleya Bridge</h1>
        {state && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Dot tone={statusView(state).tone} />
            {statusView(state).label}
          </span>
        )}
      </header>

      <div role="tablist" aria-label="Sections" className="mx-4 grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            id={`tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            onClick={() => setTab(item.id)}
            className={cn(
              "no-drag h-8 rounded-lg text-sm font-medium transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none",
              tab === item.id ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <main
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        // Settings ends in a sticky Save bar that sits on the bottom edge.
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 *:shrink-0",
          tab === "overview" && "pb-4",
        )}
      >
        {!state ? (
          <div className="skeleton h-44 rounded-2xl" aria-busy="true" />
        ) : tab === "overview" ? (
          <>
            <StatusHero state={state} />
            {state.pairing && <PairingCard pairing={state.pairing} />}
            <PairedBrowsers paired={state.paired} />
            <LinkCard link={state.link} />
            <ConnectorsCard
              connectors={state.connectors}
              running={state.status === "running"}
              onOpenSettings={() => setTab("settings")}
            />
            <div className="mt-auto pt-1">
              <LogPanel />
            </div>
          </>
        ) : (
          <SettingsPanel state={state} />
        )}
      </main>
    </div>
  );
}
