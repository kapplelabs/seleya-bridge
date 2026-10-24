import { CalendarClock, Link2 } from "lucide-react";
import { useState } from "react";

import type { LinkPanelState, ScheduleState } from "../../shared/ipc.ts";
import { Button, Card, Pill, relativeTime, Switch, type Tone } from "./ui.tsx";

const STATE_VIEW: Record<LinkPanelState["state"], { label: string; tone: Tone }> = {
  online: { label: "Connected", tone: "success" },
  connecting: { label: "Connecting", tone: "primary" },
  offline: { label: "Can't reach Seleya", tone: "warning" },
  revoked: { label: "Unlinked in Seleya", tone: "destructive" },
  unlinked: { label: "Not linked", tone: "muted" },
};

const LAST_RUN_LABEL: Record<NonNullable<ScheduleState["lastRun"]>["status"], string> = {
  started: "running",
  completed: "done",
  failed: "failed",
  skipped: "skipped",
  cancelled: "stopped",
};

const timeOf = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

function ScheduleRow({ schedule, active }: { schedule: ScheduleState; active: boolean }) {
  const last = schedule.lastRun;
  return (
    <li className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-primary">
        <CalendarClock aria-hidden="true" className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{schedule.name}</span>
        <span className="text-xs text-muted-foreground">
          {active
            ? "Running now"
            : schedule.enabled && schedule.nextRunAt
              ? `Next ${timeOf(schedule.nextRunAt)}`
              : "Off"}
          {last && !active && ` · last ${LAST_RUN_LABEL[last.status]} ${relativeTime(last.at)}`}
        </span>
      </span>
      {last?.status === "failed" && <Pill tone="destructive">Failed</Pill>}
    </li>
  );
}

/** The link to a Seleya account: where schedules come from, and the switch that pauses them. */
export function LinkCard({ link }: { link: LinkPanelState }) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const view = STATE_VIEW[link.state];

  return (
    <Card
      id="seleya-account"
      title="Seleya account"
      action={link.linked && <Pill tone={view.tone}>{view.label}</Pill>}
    >
      {!link.linked ? (
        <p className="text-sm text-muted-foreground">
          {link.state === "revoked"
            ? "This Mac was unlinked in Seleya. Link it again from Seleya's AI providers page to run schedules."
            : "Link this Mac to your Seleya account from Seleya's AI providers page to run your agents on a schedule."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-primary">
              <Link2 aria-hidden="true" className="size-4" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{link.deviceName}</span>
              <span className="truncate text-xs text-muted-foreground">
                {link.server}
                {link.lastSyncAt && ` · synced ${relativeTime(link.lastSyncAt)}`}
              </span>
            </span>
          </div>

          {link.schedules.length > 0 ? (
            <ul aria-label="Schedules" className="flex flex-col divide-y">
              {link.schedules.map((schedule) => (
                <ScheduleRow key={schedule.id} schedule={schedule} active={link.activeScheduleId === schedule.id} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No schedules yet. Turn on "Run automatically" in Seleya.</p>
          )}

          <Switch
            id="schedules-paused"
            checked={!link.paused}
            label="Run schedules"
            description="Results stay on this Mac. Seleya only learns whether each run worked."
            onChange={(enabled) => {
              setSaving(true);
              void window.bridge.setSchedulesPaused(!enabled).finally(() => setSaving(false));
            }}
          />
          {saving && <p className="text-xs text-muted-foreground">Restarting the bridge…</p>}

          {!confirming ? (
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                Unlink
              </Button>
            </div>
          ) : (
            <div
              role="alertdialog"
              aria-labelledby="unlink-title"
              className="animate-fade-up rounded-xl border border-destructive/30 bg-destructive/5 p-3"
            >
              <p id="unlink-title" className="text-sm">
                Unlink this Mac from Seleya? Its schedules stop running here. Results already on this Mac stay.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" onClick={() => setConfirming(false)} autoFocus>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    void window.bridge.unlink();
                    setConfirming(false);
                  }}
                >
                  Unlink
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
