/**
 * Calendar Assistant: one Claude run that reads a Monday–Friday week from Google Calendar (only that
 * connector's read-only tools) and returns its events as structured output. Seleya works out the week's
 * stats, conflicts, free time and focus suggestions from them; it can't change the calendar, so the
 * user makes changes in Google Calendar.
 *
 * A report run (report.ts): same agent run events and privacy rules as the Daily Briefing.
 */
import { z } from "zod";

import { PRIVACY_RULES } from "./claude.ts";
import type { BridgeConfig } from "./config.ts";
import { onlyConnectors, type ConnectorSet } from "./connectors.ts";
import { readSummary, runReport } from "./report.ts";
import type { Run } from "./runs.ts";

const AGENT_ID = "calendar";
const CONNECTOR_ID = "calendar";
const MAX_TURNS = 24;
/** A busy day's events can run long; a result over Claude Code's default limit would be lost. */
const MAX_TOOL_OUTPUT_TOKENS = 60_000;
const WEEKDAYS = 5;
/** How far from this week Seleya may ask for, so a run stays one week of real events. */
const MAX_WEEKS_BACK = 4;
const MAX_WEEKS_AHEAD = 8;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------------------------------------------------------------- what Claude returns

const weekOutput = z.object({
  unreadableDays: z
    .array(z.string().regex(DATE))
    .describe("Dates (YYYY-MM-DD) whose events you couldn't read. Empty when every day was read"),
  events: z
    .array(
      z.object({
        title: z.string().describe("The event's title as shown on the calendar"),
        date: z.string().regex(DATE).describe("Local date, YYYY-MM-DD"),
        start: z.string().regex(TIME).describe("Local start time, 24-hour HH:MM; 00:00 for all-day events"),
        end: z.string().regex(TIME).describe("Local end time, 24-hour HH:MM; 23:59 for all-day or past-midnight events"),
        allDay: z.boolean(),
        guests: z.number().int().min(0).describe("People invited besides the user"),
        organizedByYou: z.boolean().describe("True when the user created or organizes the event"),
        kind: z
          .enum(["meeting", "focus", "personal", "out-of-office"])
          .describe(
            "meeting: has other guests. focus: focus time or deep work. out-of-office: OOO or time off. personal: anything else only on the user's calendar",
          ),
        response: z.enum(["accepted", "tentative", "needs-action"]).describe("The user's reply to the invite"),
        location: z.string().describe("Room name, 'Video call', or empty. Never a link or an address"),
      }),
    )
    .max(120),
});

type WeekOutput = z.infer<typeof weekOutput>;

// ---------------------------------------------------------------- what Seleya gets

/** Seleya's `BridgeCalendarWeek` (src/types/bridge/bridge.ts). */
export interface CalendarWeek {
  /** The Monday this week starts on, YYYY-MM-DD. */
  weekStart: string;
  /** The time zone the times are in: this machine's. */
  timeZone: string;
  /** ISO time the week was read. */
  createdAt: string;
  events: (WeekOutput["events"][number] & { id: string })[];
  sources: { id: string; name: string }[];
  redactions: number;
}

// ---------------------------------------------------------------- week

const pad = (value: number) => value.toString().padStart(2, "0");
const isoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Local midnight of this week's Monday. */
function thisMonday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  today.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  return today;
}

/** The Monday `weekStart` names, or why it can't be read. */
export function parseWeekStart(weekStart: string): { monday: Date } | { error: string } {
  if (!DATE.test(weekStart)) return { error: "week_start must be a date, YYYY-MM-DD" };
  const [year, month, day] = weekStart.split("-").map(Number);
  const monday = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  if (isoDate(monday) !== weekStart || monday.getDay() !== 1) return { error: "week_start must be a Monday" };
  const weeks = Math.round((monday.getTime() - thisMonday().getTime()) / (7 * 86_400_000));
  if (weeks < -MAX_WEEKS_BACK || weeks > MAX_WEEKS_AHEAD)
    return { error: `Only weeks from ${MAX_WEEKS_BACK} back to ${MAX_WEEKS_AHEAD} ahead can be read` };
  return { monday };
}

/** "Tuesday, Oct 20" for a YYYY-MM-DD date. */
function dayName(date: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toLocaleDateString("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** True when Google Calendar can be read. */
export const canReadCalendar = (connectors: ConnectorSet) =>
  connectors.connectors.some((item) => item.id === CONNECTOR_ID && item.state === "connected");

function weekPrompt(monday: Date, timeZone: string): string {
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + WEEKDAYS - 1);
  const label = (date: Date) =>
    date.toLocaleDateString("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return [
    `List the user's Google Calendar events from ${label(monday)} through ${label(friday)} (${isoDate(monday)} to ${isoDate(friday)}), in ${timeZone}.`,
    "",
    "- Read the user's primary calendar one day at a time: one call per day, from that day's 00:00 to 24:00, with the calendar's own time range filters. Don't read other weeks.",
    "- If a day's result is too large or can't be opened, read that day again in two halves (00:00–12:00, 12:00–24:00). Never guess.",
    "- Give every time in the user's time zone, 24-hour HH:MM. An event that crosses midnight ends at 23:59 that day.",
    "- Leave out events the user declined, and cancelled events.",
    "- Include all-day events with allDay true.",
    "- Never invent events, guests or times. List every date you still couldn't read in unreadableDays; an empty events list means the days were read and are free.",
    "",
    "Privacy, strictly:",
    `- ${PRIVACY_RULES}`,
    "- Keep titles as they are, but don't add descriptions, notes or attendee names: count guests instead.",
    "- Location is a room name or 'Video call', never a link, dial-in or street address.",
    "",
    "Return the events as the structured output.",
  ].join("\n");
}

/** Reads one week of events to the end; every outcome, including a crash or cancel, ends the run's stream. */
export function runCalendarWeek(
  run: Run,
  config: BridgeConfig,
  version: string,
  connectors: ConnectorSet,
  monday: Date,
): Promise<void> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const calendar = onlyConnectors(connectors, [CONNECTOR_ID]);
  const range = `${monday.toLocaleDateString("en-US", { month: "short", day: "numeric" })} week`;
  return runReport(run, config, version, calendar, {
    agentId: AGENT_ID,
    title: `Reading your calendar for the ${range}`,
    planningLabel: "Planning how to read Google Calendar",
    reasoningLabel: "Sorting out the week",
    writingLabel: "Writing down the week",
    prompt: weekPrompt(monday, timeZone),
    systemPrompt: `You are Seleya's Calendar Assistant, running in Claude Code on the user's own computer. You can only read the calendar. ${PRIVACY_RULES}`,
    maxTurns: MAX_TURNS,
    maxToolOutputTokens: MAX_TOOL_OUTPUT_TOKENS,
    output: weekOutput,
    resultKey: "week",
    invalidCode: "invalid_week",
    invalidMessage: "Claude's calendar didn't come back in the expected shape. Try again.",
    noResultMessage: "Claude ended without reading the calendar.",
    // A week with days missing would look free when it isn't: better no week than a wrong one.
    problem: (output) =>
      output.unreadableDays.length === 0
        ? undefined
        : {
            code: "calendar_incomplete",
            message: `Google Calendar couldn't be read for ${output.unreadableDays
              .map((date) => dayName(date, timeZone))
              .join(", ")}. Try again.`,
          },
    finish: (output, sources, redactions) => {
      const week: CalendarWeek = {
        weekStart: isoDate(monday),
        timeZone,
        createdAt: new Date().toISOString(),
        events: output.events.map((event, index) => ({ ...event, id: `ev${index + 1}` })),
        sources,
        redactions,
      };
      const count = week.events.length;
      return {
        result: week,
        summary: `${count} ${count === 1 ? "event" : "events"} · ${readSummary(sources.length, redactions)}`,
      };
    },
  });
}
