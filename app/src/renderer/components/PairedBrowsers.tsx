import { Globe } from "lucide-react";
import { useState } from "react";

import type { PairedBrowserState } from "../../shared/ipc.ts";
import { Button, Card, hostOf, relativeTime } from "./ui.tsx";

export function PairedBrowsers({ paired }: { paired: PairedBrowserState[] }) {
  const [confirming, setConfirming] = useState(false);
  const count = paired.length;

  return (
    <Card
      id="paired-browsers"
      title="Connected browsers"
      action={
        count > 0 &&
        !confirming && (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            Forget all
          </Button>
        )
      }
    >
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">
          No browser is paired yet. In Seleya, choose <span className="font-medium text-foreground">Connect Claude
          local</span> and enter the code that appears here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {paired.map((browser) => (
            <li key={browser.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <span className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-primary">
                <Globe aria-hidden="true" className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{hostOf(browser.origin)}</span>
                <span className="text-xs text-muted-foreground">
                  Paired {relativeTime(browser.createdAt)}
                  {browser.lastUsedAt && ` · used ${relativeTime(browser.lastUsedAt)}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {confirming && (
        <div
          role="alertdialog"
          aria-labelledby="forget-title"
          className="mt-3 animate-fade-up rounded-xl border border-destructive/30 bg-destructive/5 p-3"
        >
          <p id="forget-title" className="text-sm">
            Forget {count === 1 ? "this browser" : `all ${count} browsers`}? Seleya will need a new pairing code.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" onClick={() => setConfirming(false)} autoFocus>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                void window.bridge.revokeAll();
                setConfirming(false);
              }}
            >
              Forget
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
