/**
 * When a schedule fires (docs/server-link.md §6.4): wall-clock times on given weekdays, in the schedule's
 * own IANA time zone. A time that doesn't exist on a day clocks spring forward is moved forward by the
 * jump (02:30 becomes 03:30, as Go's time.Date does); a time that happens twice fires the first time.
 */
import { z } from "zod";

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type Day = (typeof DAYS)[number];

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM");
const days = z.array(z.enum(DAYS)).min(1).max(7);

export const timingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("weekly"), days, time: clock }),
  z.object({
    kind: z.literal("interval"),
    days,
    from: clock,
    to: clock,
    every_minutes: z.number().int().min(1).max(1440),
  }),
]);
export type Timing = z.infer<typeof timingSchema>;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** How far to look for the next or previous occurrence: a weekly schedule always has one within 8 days. */
const SEARCH_DAYS = 9;
/** Sunday first, as Date.getUTCDay counts. */
const WEEKDAY_NAMES: Day[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const minutesOf = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

/** Minutes after midnight the schedule fires on each of its days. */
function slots(timing: Timing, minIntervalMinutes: number): number[] {
  if (timing.kind === "weekly") return [minutesOf(timing.time)];
  const from = minutesOf(timing.from);
  const to = minutesOf(timing.to);
  const every = Math.max(timing.every_minutes, minIntervalMinutes);
  const result: number[] = [];
  for (let minute = from; minute <= Math.max(from, to); minute += every) result.push(minute);
  return result;
}

/** The time zone's offset from UTC at `instant`, in milliseconds (east positive). */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
  const local = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
  return local - Math.floor(instant / MINUTE_MS) * MINUTE_MS;
}

/** The instant a wall-clock time (as if it were UTC, in ms) happens in `timeZone`. */
function instantOf(wall: number, timeZone: string): number {
  // The offsets on either side of any change that day; at most one change happens within a few hours.
  const before = wall - offsetAt(wall - 12 * 60 * MINUTE_MS, timeZone);
  const after = wall - offsetAt(wall + 12 * 60 * MINUTE_MS, timeZone);
  const real = [before, after].filter((instant) => instant + offsetAt(instant, timeZone) === wall);
  // A time that happens twice: the first one. A time that never happens (the gap): `before`, read on the
  // offset from before the jump, which is the wall time moved forward by the jump.
  return real.length > 0 ? Math.min(...real) : before;
}

/** The local calendar date at `instant`, as days since the epoch. */
function localDay(instant: number, timeZone: string): number {
  return Math.floor((instant + offsetAt(instant, timeZone)) / DAY_MS);
}

/** Every occurrence on local days [firstDay, lastDay], in order. */
function occurrences(timing: Timing, timeZone: string, firstDay: number, lastDay: number, minInterval: number) {
  const wanted = new Set<Day>(timing.days);
  const minutes = slots(timing, minInterval);
  const result: number[] = [];
  for (let day = firstDay; day <= lastDay; day++) {
    const weekday = WEEKDAY_NAMES[new Date(day * DAY_MS).getUTCDay()];
    if (!weekday || !wanted.has(weekday)) continue;
    for (const minute of minutes) result.push(instantOf(day * DAY_MS + minute * MINUTE_MS, timeZone));
  }
  return result;
}

/** The first occurrence strictly after `after`. */
export function nextOccurrence(timing: Timing, timeZone: string, after: Date, minIntervalMinutes = 1): Date | undefined {
  const today = localDay(after.getTime(), timeZone);
  const found = occurrences(timing, timeZone, today - 1, today + SEARCH_DAYS, minIntervalMinutes).find(
    (instant) => instant > after.getTime(),
  );
  return found === undefined ? undefined : new Date(found);
}

/** The last occurrence at or before `at`. */
export function previousOccurrence(
  timing: Timing,
  timeZone: string,
  at: Date,
  minIntervalMinutes = 1,
): Date | undefined {
  const today = localDay(at.getTime(), timeZone);
  const found = occurrences(timing, timeZone, today - SEARCH_DAYS, today + 1, minIntervalMinutes)
    .filter((instant) => instant <= at.getTime())
    .at(-1);
  return found === undefined ? undefined : new Date(found);
}

/** Whether `timeZone` is a zone this machine's ICU knows. */
export function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
