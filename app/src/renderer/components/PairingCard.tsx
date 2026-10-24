import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import type { PairingState } from "../../shared/ipc.ts";
import { Button, hostOf } from "./ui.tsx";

/** A pairing code lives two minutes (pairing.ts). */
const CODE_TTL_MS = 2 * 60 * 1000;

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function PairingCard({ pairing }: { pairing: PairingState }) {
  const now = useNow(1000);
  const [copied, setCopied] = useState(false);
  const left = Math.max(0, Date.parse(pairing.expiresAt) - now);
  const minutes = Math.floor(left / 60_000);
  const seconds = String(Math.floor((left % 60_000) / 1000)).padStart(2, "0");

  useEffect(() => setCopied(false), [pairing.code]);

  const copy = () => {
    void window.bridge.copyCode();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section
      id="pairing-card"
      aria-labelledby="pairing-title"
      className="animate-fade-up rounded-2xl border bg-card p-4 shadow-float ring-2 ring-primary/30"
    >
      <h2 id="pairing-title" className="text-sm font-semibold">
        Pairing request
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{hostOf(pairing.origin)}</span> wants to connect. Enter this
        code in Seleya.
      </p>

      <p
        aria-label={`Pairing code ${pairing.code.split("").join(" ")}`}
        className="mt-4 flex items-center justify-center gap-1.5 font-mono text-3xl font-semibold tabular-nums select-text"
      >
        {pairing.code.split("").map((digit, index) => (
          <span key={index} className={index === 3 ? "ml-3" : undefined}>
            <span className="flex h-12 w-10 items-center justify-center rounded-xl border bg-background">
              {digit}
            </span>
          </span>
        ))}
      </p>

      <div className="mt-4 flex items-center gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear"
              style={{ width: `${(left / CODE_TTL_MS) * 100}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Expires in {minutes}:{seconds}
          </p>
        </div>
        <Button size="sm" onClick={copy} aria-live="polite">
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copied" : "Copy code"}
        </Button>
      </div>
    </section>
  );
}
