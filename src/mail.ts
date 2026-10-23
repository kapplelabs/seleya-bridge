/**
 * Mail Assistant: one Claude run that reads the user's recent Gmail (only that connector's read-only
 * tools) and triages it as structured output: threads that need a reply (with a drafted answer), mail
 * the user is waiting on, meeting invites, and bundles of FYI, notifications and marketing. Seleya shows
 * it in the Mail Assistant workspace; it can't send, label or archive anything, so the user sends the
 * drafts from Gmail.
 *
 * A report run (report.ts): same agent run events and privacy rules as the Daily Briefing. On top of
 * them, security, payment, HR, health and legal mail is skipped entirely, and no email address, phone
 * number or link leaves the run.
 */
import { z } from "zod";

import { PRIVACY_RULES } from "./claude.ts";
import type { BridgeConfig } from "./config.ts";
import { onlyConnectors, type ConnectorSet } from "./connectors.ts";
import { readSummary, runReport } from "./report.ts";
import type { Run } from "./runs.ts";

const AGENT_ID = "mail";
const CONNECTOR_ID = "gmail";
const MAX_TURNS = 40;
/** A page of threads with their messages runs long; a result over Claude Code's default limit would be lost. */
const MAX_TOOL_OUTPUT_TOKENS = 60_000;
/** How far back Seleya may ask Claude to read the inbox. */
export const MIN_DAYS = 1;
export const MAX_DAYS = 7;
export const DEFAULT_DAYS = 2;
/** Sent mail older than this isn't "awaiting a reply" any more, it's forgotten. */
const AWAITING_DAYS = 14;

/** Gmail thread ids are hex; anything else isn't one and isn't turned into a link. */
const GMAIL_THREAD_ID = /^[0-9a-f]{8,24}$/i;

// ---------------------------------------------------------------- what Claude returns

const person = z.string().describe("Display name only, e.g. 'John Carter'. Never an email address");

const threadId = z
  .string()
  .describe("The Gmail thread id the connector returned (hex, e.g. '18c2f0a9d3b4e5f6'); empty if unknown");

const flag = z.object({
  kind: z
    .enum(["question", "deadline", "vip", "external", "overdue"])
    .describe(
      "question: asks the user something. deadline: states a due date. vip: from a manager, lead or customer. external: from outside the user's company. overdue: a stated deadline has passed",
    ),
  label: z.string().describe("Chip text, 1–3 words, e.g. 'Asked you a question', 'Before 2 PM', 'Deadline Fri'"),
});

const mailOutput = z.object({
  checked: z.number().int().min(0).describe("How many inbox threads you looked at"),
  digest: z
    .string()
    .describe("2–3 sentences on what arrived: who needs the user and for what, what can wait. Empty if nothing arrived"),
  respond: z
    .array(
      z.object({
        threadId,
        from: person,
        org: z.string().describe("The sender's company when it isn't the user's, e.g. 'Acme'; empty otherwise"),
        subject: z.string(),
        summary: z.string().describe("What the sender needs from the user, paraphrased, at most 140 characters"),
        flags: z.array(flag).max(3),
        receivedAt: z.string().describe("Local time if today ('9:42 AM'), else weekday ('Tue')"),
        unread: z.boolean(),
        messages: z
          .array(
            z.object({
              from: person,
              sentAt: z.string().describe("e.g. 'Today, 9:42 AM', 'Yesterday, 4:10 PM', 'Mon, 11:05 AM'"),
              text: z
                .string()
                .describe(
                  "The message as written, without signature, disclaimers or quoted earlier messages; at most 700 characters",
                ),
            }),
          )
          .min(1)
          .max(3)
          .describe("The thread's last messages, oldest first; the last one is what the draft answers"),
        draft: z
          .object({
            body: z
              .string()
              .describe("The reply in the user's voice: greeting, answer, sign-off with the user's first name. At most 1200 characters"),
            confidence: z.enum(["high", "medium", "low"]),
            confidenceNote: z
              .string()
              .describe("Why, one short phrase, e.g. 'Answers both questions', 'Needs a number only you know'"),
            checks: z
              .array(z.string())
              .max(3)
              .describe("Commitments the draft makes for the user (a meeting, a price, a deadline), one sentence each, e.g. 'Check: this agrees to a call on Thu at 10 AM'"),
          })
          .nullable()
          .describe("null when you can't answer without information you don't have"),
      }),
    )
    .max(10)
    .describe("Threads where the user owes a reply, most urgent first"),
  awaiting: z
    .array(
      z.object({
        threadId,
        to: person,
        subject: z.string(),
        sentAt: z.string().describe("When the user sent it, e.g. 'Mon, 4:10 PM'"),
        waitingDays: z.number().int().min(0),
        summary: z.string().describe("What the user asked for, one line"),
        nudgeDraft: z.string().describe("A short, friendly follow-up in the user's voice, at most 600 characters"),
      }),
    )
    .max(8)
    .describe(`Mail the user sent in the last ${AWAITING_DAYS} days that asked for something and got no reply`),
  invites: z
    .array(
      z.object({
        threadId,
        title: z.string(),
        organizer: person,
        when: z.string().describe("e.g. 'Thu, Oct 29 · 10:00–10:30 AM'"),
        location: z.string().describe("Room name, 'Video call', or empty. Never a link, dial-in or street address"),
        attendees: z.number().int().min(0),
        recommendation: z.enum(["accept", "decline"]),
        reason: z.string().describe("Why, one sentence"),
        acceptDraft: z.string().describe("A one or two sentence reply accepting"),
        declineDraft: z.string().describe("A one or two sentence reply declining politely"),
      }),
    )
    .max(6)
    .describe("Meeting invitations still waiting for the user's answer"),
  bundles: z
    .array(
      z.object({
        category: z
          .enum(["fyi", "notifications", "marketing"])
          .describe("fyi: updates from people that need no reply. notifications: automated mail from tools (GitHub, Jira, calendar). marketing: newsletters and promotions"),
        title: z.string().describe("The sender or tool, e.g. 'GitHub', 'Jira', 'Newsletters'"),
        summary: z.string().describe("What the bundle is about, one sentence"),
        count: z.number().int().min(1).describe("Threads in this bundle"),
        items: z
          .array(
            z.object({
              from: person,
              subject: z.string(),
              snippet: z.string().describe("Paraphrased, at most 120 characters"),
              receivedAt: z.string(),
            }),
          )
          .min(1)
          .max(3)
          .describe("The latest few"),
      }),
    )
    .max(9),
});

type MailOutput = z.infer<typeof mailOutput>;

// ---------------------------------------------------------------- what Seleya gets

type WithId<T> = T & { id: string };
type WithLink<T> = Omit<T, "threadId"> & { gmailThreadId?: string };

/** Seleya's `BridgeMailTriage` (src/types/bridge/bridge.ts). */
export interface MailTriage {
  /** ISO time it was read. */
  createdAt: string;
  /** How many days back the inbox was read. */
  days: number;
  checked: number;
  digest: string;
  respond: WithId<WithLink<MailOutput["respond"][number]>>[];
  awaiting: WithId<WithLink<MailOutput["awaiting"][number]>>[];
  invites: WithId<WithLink<MailOutput["invites"][number]>>[];
  bundles: WithId<MailOutput["bundles"][number]>[];
  sources: { id: string; name: string }[];
  redactions: number;
}

/** Ids for Seleya, and the Gmail thread id only when it looks like one (it becomes a link). */
function withIds<T extends { threadId: string }>(items: T[], prefix: string): WithId<WithLink<T>>[] {
  return items.map(({ threadId: gmailThreadId, ...item }, index) => ({
    ...item,
    id: `${prefix}${index + 1}`,
    gmailThreadId: GMAIL_THREAD_ID.test(gmailThreadId) ? gmailThreadId : undefined,
  }));
}

// ---------------------------------------------------------------- prompt

/** True when Gmail can be read. */
export const canReadMail = (connectors: ConnectorSet) =>
  connectors.connectors.some((item) => item.id === CONNECTOR_ID && item.state === "connected");

function mailPrompt(days: number): string {
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
  return [
    `Triage the user's Gmail inbox. It is ${now} (${timeZone}).`,
    "",
    "Read, with Gmail's own search:",
    `- Inbox threads from the last ${days} ${days === 1 ? "day" : "days"} (\`in:inbox newer_than:${days}d\`), a page of up to 50. Open a thread only when its snippet isn't enough to sort it or to draft a reply.`,
    `- Mail the user sent in the last ${AWAITING_DAYS} days (\`in:sent newer_than:${AWAITING_DAYS}d\`) that asked someone for something and has no reply yet: that is awaiting.`,
    "",
    "Sort every inbox thread into exactly one place:",
    "- respond: a person wrote to the user and expects an answer. Draft the reply in the user's voice (match how they write in the thread), answer what you can from the thread, and never promise anything the thread doesn't support; list each commitment the draft makes in checks. If you can't answer without information you don't have, set draft to null.",
    "- invites: meeting invitations the user hasn't answered.",
    "- bundles: everything else, grouped by sender or tool (fyi, notifications, marketing). Never list newsletters or notifications one by one outside a bundle.",
    "Never invent threads, people, times or numbers. An empty list means there was nothing of that kind.",
    "",
    "Privacy, strictly:",
    `- ${PRIVACY_RULES}`,
    "- Skip entirely (don't list, bundle, count or describe) mail about passwords, sign-in or verification codes, security alerts, bank or payment details, invoices with account numbers, salaries, health, HR or legal matters.",
    "- Name people by display name only. Quote message text only in messages, and only after removing signatures, phone numbers, addresses and links.",
    "- Locations are a room name or 'Video call', never a link, dial-in or street address.",
    "",
    "You can only read Gmail: you can't send, draft in Gmail, label or archive. Return the triage as the structured output.",
  ].join("\n");
}

// ---------------------------------------------------------------- run

/** Triages the inbox to the end; every outcome, including a crash or cancel, ends the run's stream. */
export function runMailTriage(
  run: Run,
  config: BridgeConfig,
  version: string,
  connectors: ConnectorSet,
  days: number,
): Promise<void> {
  const gmail = onlyConnectors(connectors, [CONNECTOR_ID]);
  return runReport(run, config, version, gmail, {
    agentId: AGENT_ID,
    title: `Triaging the last ${days === 1 ? "day" : `${days} days`} of Gmail`,
    planningLabel: "Planning how to read Gmail",
    reasoningLabel: "Sorting out what needs you",
    writingLabel: "Drafting replies",
    prompt: mailPrompt(days),
    systemPrompt: `You are Seleya's Mail Assistant, running in Claude Code on the user's own computer. You can only read Gmail. ${PRIVACY_RULES}`,
    maxTurns: MAX_TURNS,
    maxToolOutputTokens: MAX_TOOL_OUTPUT_TOKENS,
    output: mailOutput,
    resultKey: "triage",
    invalidCode: "invalid_triage",
    invalidMessage: "Claude's triage didn't come back in the expected shape. Try again.",
    noResultMessage: "Claude ended without reading Gmail.",
    finish: (output, sources, redactions) => {
      const triage: MailTriage = {
        createdAt: new Date().toISOString(),
        days,
        checked: output.checked,
        digest: output.digest,
        respond: withIds(output.respond, "r"),
        awaiting: withIds(output.awaiting, "a"),
        invites: withIds(output.invites, "i"),
        bundles: output.bundles.map((bundle, index) => ({ ...bundle, id: `b${index + 1}` })),
        sources,
        redactions,
      };
      const drafts = triage.respond.filter((thread) => thread.draft !== null).length;
      return {
        result: triage,
        summary: `${triage.respond.length} need you · ${drafts} ${drafts === 1 ? "draft" : "drafts"} · ${readSummary(sources.length, redactions)}`,
      };
    },
  });
}
