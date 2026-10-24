import { ChevronDown, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "./ui.tsx";

const REFRESH_MS = 2000;

/** Footer: where the bridge can be reached from, and its last log lines on demand. */
export function LogPanel() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const load = () => void window.bridge.getLog().then(setLines);
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [open]);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [lines]);

  return (
    <footer id="panel-footer" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Lock aria-hidden="true" className="size-3.5" />
          Only this Mac can reach the bridge.
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="bridge-log"
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          {open ? "Hide log" : "Show log"}
          <ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <pre
          id="bridge-log"
          className="max-h-48 overflow-auto rounded-xl border bg-card p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
        >
          {lines.length === 0 ? "Nothing logged yet." : lines.join("\n")}
          <div ref={end} />
        </pre>
      )}
    </footer>
  );
}
