/**
 * Template variables (docs/server-link.md §5.2): a request with `template` gets `{{now}}`, `{{today}}`… filled
 * in when the run starts, on this machine's clock and time zone. A schedule's prompt is written once and
 * runs any day; a run started by hand uses the same prompt, so both read the same.
 *
 * Only dates, times and connector names: nothing here knows what a feature does.
 */
import { HttpError } from "../http.ts";

export const TEMPLATE_VARS = ["now", "now_text", "today", "time_zone", "week_start", "connectors"] as const;
export type TemplateVar = (typeof TEMPLATE_VARS)[number];

/** Variables that are a date and take a day offset: `{{today:+1}}`, `{{week_start:+4}}`. */
const DATE_VARS: ReadonlySet<string> = new Set(["today", "week_start"]);
const MAX_DAY_OFFSET = 31;
export const MIN_WEEK_OFFSET = -4;
export const MAX_WEEK_OFFSET = 8;

/** One `{{…}}`; anything between the braces that isn't a known variable is an error, never left as is. */
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const REFERENCE = /^\s*([a-z_]+)(?::([+-])(\d{1,2}))?\s*$/;

export interface TemplateInput {
  now: Date;
  timeZone: string;
  /** Weeks from this one for `{{week_start}}`. */
  weekOffset: number;
  /** Names of the connectors the run really got. */
  connectorNames: string[];
}

/** The values a run's template got, as run.started and stored results show them. */
export type TemplateVars = Record<TemplateVar, string>;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (value: number) => String(value).padStart(2, "0");

/** A calendar date as days since the epoch, so adding days never meets a time zone. */
const dayNumber = (year: number, month: number, day: number) => Date.UTC(year, month - 1, day) / 86_400_000;

const isoDate = (days: number) => new Date(days * 86_400_000).toISOString().slice(0, 10);

interface LocalTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
  /** "+07:00" */
  offset: string;
}

function localTime(now: Date, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  // "GMT+07:00", or "GMT" for UTC itself.
  const offset = part("timeZoneName").replace("GMT", "") || "+00:00";
  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
    hour: Number(part("hour")),
    minute: Number(part("minute")),
    weekday: WEEKDAYS.indexOf(part("weekday")),
    offset,
  };
}

/** Today and this week's Monday (plus `weekOffset` weeks) as day numbers, for the date variables. */
interface Dates {
  today: number;
  week_start: number;
}

export function templateValues({ now, timeZone, weekOffset, connectorNames }: TemplateInput): {
  vars: TemplateVars;
  dates: Dates;
} {
  const local = localTime(now, timeZone);
  const today = dayNumber(local.year, local.month, local.day);
  // Monday is the first day of the week; Sunday belongs to the week that started six days before.
  const weekStart = today - ((local.weekday + 6) % 7) + 7 * weekOffset;
  const dates = { today, week_start: weekStart };
  const vars: TemplateVars = {
    now: `${isoDate(today)}T${pad(local.hour)}:${pad(local.minute)}:00${local.offset}`,
    now_text: now.toLocaleString("en-US", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
    today: isoDate(today),
    time_zone: timeZone,
    week_start: isoDate(weekStart),
    connectors: connectorNames.length > 0 ? connectorNames.join(", ") : "none",
  };
  return { vars, dates };
}

const invalid = (variable: string, message: string) =>
  new HttpError(400, "invalid_template", message, { variable: variable.trim().slice(0, 100) });

/** Fills every `{{…}}` in `text`; a stray `{{` or an unknown variable is 400 invalid_template. */
export function fillTemplate(text: string, values: { vars: TemplateVars; dates: Dates }): string {
  const filled = text.replace(PLACEHOLDER, (_match, inner: string) => {
    const reference = REFERENCE.exec(inner);
    const name = reference?.[1];
    if (!reference || !name || !(TEMPLATE_VARS as readonly string[]).includes(name))
      throw invalid(inner, `Unknown template variable {{${inner.trim().slice(0, 100)}}}`);
    const [, , sign, digits] = reference;
    if (sign === undefined) return values.vars[name as TemplateVar];
    if (!DATE_VARS.has(name)) throw invalid(inner, `{{${name}}} doesn't take a day offset`);
    const days = Number(digits);
    if (days > MAX_DAY_OFFSET) throw invalid(inner, `A day offset is at most ${MAX_DAY_OFFSET}`);
    return isoDate(values.dates[name as keyof Dates] + (sign === "-" ? -days : days));
  });
  // An opening pair left over can't be a variable: it would reach the model unfilled. A closing pair alone
  // is ordinary text (nested JSON ends with "}}").
  if (filled.includes("{{")) throw invalid("{{", "Unbalanced {{ in the template");
  return filled;
}
