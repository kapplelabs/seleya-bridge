/**
 * Daily Briefing: one Claude run that reads today's calendar, mail, chat and code review through the
 * connectors and returns the briefing as structured output (a JSON schema, validated here).
 *
 * It streams Seleya's agent run events (`seleya.run.*`, `seleya.thought.*`, `seleya.trace.step`; the
 * contract in seleya's src/types/agent/runStream.ts) so the Briefing page shows the agent working, and
 * keeps the briefing on the run for GET /v1/runs/:id/result. The prompt is the bridge's own: the web only
 * asks for a briefing, it can't change what Claude is told to read.
 *
 * Privacy: connector results are redacted before Claude reads them (claude.ts), the prompt tells Claude
 * to leave personal and secret data out, and the briefing is redacted once more before it is kept.
 */
import { z } from "zod";

import { PRIVACY_RULES } from "./claude.ts";
import type { BridgeConfig } from "./config.ts";
import type { ConnectorSet } from "./connectors.ts";
import { readSummary, runReport } from "./report.ts";
import type { Run } from "./runs.ts";

const AGENT_ID = "daily-briefing";
const TITLE = "Creating today's briefing";
const MAX_TURNS = 40;

const TONES = ["violet", "cyan", "amber", "rose", "emerald", "sky"] as const;

// ---------------------------------------------------------------- what Claude returns

const action = z
  .object({
    label: z.string().describe("Button label, 1–3 words, e.g. 'Draft reply', 'Summarize thread', 'Review PR'"),
    prompt: z.string().describe("The follow-up to ask Seleya's assistant, one sentence, no personal data"),
  })
  .describe("A follow-up the user can start in one click");

const briefingOutput = z.object({
  headline: z.string().describe("One sentence on what defines the day"),
  summary: z.string().describe("2–3 sentences: the meetings, replies and blockers that matter most"),
  overview: z
    .array(z.object({ label: z.string(), value: z.string(), hint: z.string() }))
    .max(4)
    .describe("Exactly four stats when possible: Meetings, Need replies, Jira to focus on, Focus time"),
  calendar: z
    .array(
      z.object({
        title: z.string(),
        start: z.string().describe("Local start time, e.g. '9:30 AM'"),
        end: z.string().describe("Local end time, e.g. '10:15 AM'"),
        duration: z.string().describe("e.g. '45m', '1h 30m'"),
        attendees: z.number().int().min(0),
        location: z.string().describe("Room name, or 'Video call'. Never a link"),
        isNext: z.boolean().describe("True only for the next event that hasn't started yet"),
        prepReady: z.boolean().describe("True when there is material worth preparing from"),
      }),
    )
    .max(12),
  emails: z
    .array(
      z.object({
        from: z.string().describe("Sender's display name only, e.g. 'Maya Lin (Finance)'"),
        subject: z.string(),
        snippet: z.string().describe("What they need from the user, paraphrased, at most 140 characters"),
        priority: z.enum(["high", "normal", "low"]),
        due: z.string().optional().describe("When a reply is due, if stated, e.g. 'Before 3 PM', 'Friday'"),
        action,
      }),
    )
    .max(6),
  tasks: z
    .array(
      z.object({
        title: z.string(),
        due: z.string().describe("'Today', 'Yesterday' when overdue, or a weekday"),
        source: z.string().describe("Where it comes from, e.g. 'GitHub', 'Gmail'"),
      }),
    )
    .max(8)
    .describe("To-dos from mail, chat and code review. Jira issues go in workItems, not here"),
  workItems: z
    .array(
      z.object({
        key: z.string().describe("Issue key, e.g. 'PLAT-431'"),
        title: z.string().describe("The issue summary"),
        stage: z
          .enum(["focus", "todo", "ship"])
          .describe(
            "focus: in progress, blocked, overdue or highest priority; todo: assigned and not started, due soon or in the current sprint; ship: work done and waiting to be reviewed, released or deployed",
          ),
        status: z.string().describe("Jira status as shown, e.g. 'In Progress', 'Ready for Release'"),
        priority: z.enum(["highest", "high", "medium", "low", "lowest"]),
        type: z.string().describe("Issue type, e.g. 'Bug', 'Story', 'Task'"),
        due: z.string().optional().describe("'Today', 'Overdue', a weekday or a date, when it has a due date"),
        reason: z.string().describe("Why it needs the user now, one short sentence, e.g. 'Blocks the webhook release'"),
        url: z.string().optional().describe("The issue's browse link, https://<site>.atlassian.net/browse/<KEY>"),
        action,
      }),
    )
    .max(12)
    .describe("Jira issues assigned to the user that aren't done, sorted by urgency within each stage"),
  messages: z
    .array(
      z.object({
        channel: z.string().describe("'#channel' or 'DM'"),
        author: z.string().describe("Display name only"),
        text: z.string().describe("Paraphrased, at most 160 characters"),
        replies: z.number().int().min(0),
        action,
      }),
    )
    .max(5),
  pullRequests: z
    .array(
      z.object({
        number: z.number().int().min(0),
        title: z.string(),
        repo: z.string().describe("owner/name"),
        state: z.enum(["review-requested", "changes-requested", "approved", "ci-failed"]),
        action,
      }),
    )
    .max(6),
  attention: z
    .array(z.object({ text: z.string().describe("One sentence"), action }))
    .max(3)
    .describe("The three things that need the user first, across every source"),
  suggestions: z
    .array(z.object({ title: z.string(), body: z.string().describe("One or two sentences"), action }))
    .max(3)
    .describe("Ways to protect focus time, batch replies or unblock others"),
});

type BriefingOutput = z.infer<typeof briefingOutput>;

// ---------------------------------------------------------------- what Seleya gets

/** Seleya's `Briefing` (src/types/briefing/briefing.ts), plus where it came from. */
export interface Briefing {
  date: string;
  generatedAt: string;
  /** ISO time it was made, so Seleya can tell today's briefing from an older one. */
  createdAt: string;
  headline: string;
  summary: string;
  overview: BriefingOutput["overview"];
  calendar: (BriefingOutput["calendar"][number] & { id: string; tone: (typeof TONES)[number] })[];
  emails: (BriefingOutput["emails"][number] & { id: string })[];
  tasks: (BriefingOutput["tasks"][number] & { id: string; done: boolean })[];
  workItems: (BriefingOutput["workItems"][number] & { id: string })[];
  messages: (BriefingOutput["messages"][number] & { id: string })[];
  pullRequests: (BriefingOutput["pullRequests"][number] & { id: string })[];
  attention: (BriefingOutput["attention"][number] & { id: string })[];
  suggestions: (BriefingOutput["suggestions"][number] & { id: string })[];
  /** Connectors that were read without an error. */
  sources: { id: string; name: string }[];
  /** How many personal or secret values were removed on the way. */
  redactions: number;
}

function isJiraLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".atlassian.net") && url.pathname.startsWith("/browse/");
  } catch {
    return false;
  }
}

const withIds = <T extends object>(items: T[], prefix: string) =>
  items.map((item, index) => ({ ...item, id: `${prefix}${index + 1}` }));

function toBriefing(
  output: BriefingOutput,
  createdAt: Date,
  sources: Briefing["sources"],
  redactions: number,
): Briefing {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    date: createdAt.toLocaleDateString("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }),
    generatedAt: createdAt.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" }),
    createdAt: createdAt.toISOString(),
    headline: output.headline,
    summary: output.summary,
    overview: output.overview,
    calendar: withIds(output.calendar, "c").map((event, index) => ({
      ...event,
      tone: TONES[index % TONES.length] ?? "violet",
    })),
    emails: withIds(output.emails, "e"),
    tasks: withIds(output.tasks, "t").map((task) => ({ ...task, done: false })),
    workItems: withIds(output.workItems, "w").map(({ url, ...item }) => ({
      ...item,
      // Only a Jira Cloud issue link is kept: anything else isn't one, and isn't shown as one.
      url: url && isJiraLink(url) ? url : undefined,
    })),
    messages: withIds(output.messages, "m"),
    pullRequests: withIds(output.pullRequests, "pr"),
    attention: withIds(output.attention, "a"),
    suggestions: withIds(output.suggestions, "s"),
    sources,
    redactions,
  };
}

// ---------------------------------------------------------------- prompt

function briefingPrompt(connectors: ConnectorSet): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date().toLocaleString("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const usable = connectors.connectors.filter((item) => item.state === "connected").map((item) => item.name);
  return [
    `Create the user's Daily Briefing. It is ${now} (${timeZone}). You can read: ${usable.join(", ")}.`,
    "",
    "Read only what the briefing needs, with the connectors you have:",
    "- Calendar: today's events, with local start/end times, attendee count and room (or 'Video call').",
    "- Mail: threads from the last 24 hours that need the user: direct asks, replies owed, deadlines. Skip newsletters, notifications and receipts.",
    "- Chat (Slack, Teams): mentions and direct messages from the last 24 hours, with reply counts.",
    "- Code (GitHub, GitLab): pull requests waiting for the user's review, and the user's own open ones with failing CI or requested changes.",
    "- Jira (the Atlassian connector): first getAccessibleAtlassianResources for the cloud id, then searchJiraIssuesUsingJql with `assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, duedate ASC` (a page of up to 30). Sort each issue into a stage: focus (in progress, blocked, overdue or highest priority), todo (not started, due soon or in the current sprint), ship (done in development and waiting for review, QA, release or deployment). Put them in workItems with the issue's browse link, never in tasks.",
    "- Other issue trackers (Linear): items assigned to the user that are due today or overdue, as tasks.",
    "A section whose source you can't read stays empty. Never invent items, people or numbers.",
    "",
    "Privacy, strictly:",
    `- ${PRIVACY_RULES}`,
    "- Leave out anything about passwords, sign-in codes, security alerts, bank or payment details, salaries, health, HR or legal matters: don't list or describe them.",
    "- Name people by display name only. Paraphrase; never quote a message word for word.",
    "",
    "Each action's prompt is a follow-up for Seleya's assistant (e.g. 'Draft a reply to Maya with the Q4 estimate'). It can only read, so phrase actions as drafts, summaries or reviews.",
    "Write in clear, concise English. Return the briefing as the structured output.",
  ].join("\n");
}

// ---------------------------------------------------------------- run

/** True when at least one connector can be read; a briefing without any has nothing to say. */
export const canBrief = (connectors: ConnectorSet) => connectors.connectors.some((item) => item.state === "connected");

/** Runs the briefing to the end; every outcome, including a crash or cancel, ends the run's stream. */
export function runBriefing(run: Run, config: BridgeConfig, version: string, connectors: ConnectorSet): Promise<void> {
  const names = connectors.connectors.filter((item) => item.state === "connected").map((item) => item.name);
  return runReport(run, config, version, connectors, {
    agentId: AGENT_ID,
    title: TITLE,
    planningLabel: `Planning what to read from ${names.join(", ")}`,
    reasoningLabel: "Deciding what matters today",
    writingLabel: "Writing your briefing",
    prompt: briefingPrompt(connectors),
    systemPrompt: `You are Seleya's Daily Briefing agent, running in Claude Code on the user's own computer. ${PRIVACY_RULES}`,
    maxTurns: MAX_TURNS,
    output: briefingOutput,
    resultKey: "briefing",
    invalidCode: "invalid_briefing",
    invalidMessage: "Claude's briefing didn't come back in the expected shape. Try again.",
    noResultMessage: "Claude ended without a briefing.",
    finish: (output, sources, redactions) => {
      const briefing = toBriefing(output, new Date(), sources, redactions);
      return { result: briefing, summary: readSummary(sources.length, redactions) };
    },
  });
}
