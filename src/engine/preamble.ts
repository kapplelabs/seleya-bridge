/**
 * The start of every run's system prompt (docs/gateway.md §8.1). It belongs to the bridge, not to the
 * feature asking: the request's own system_prompt only comes after it, so a web page can add instructions
 * but can't drop the read-only and privacy rules. It's a safety net, not a guarantee: redact.ts removes
 * what slips through.
 */

/** Told to every run that reads connectors; redact.ts removes what slips through. */
export const PRIVACY_RULES =
  "Never repeat email addresses, phone numbers, street addresses, passwords, keys, tokens, sign-in codes, card, bank or ID numbers, or links that grant access. Values shown as [email], [phone], [secret], [card], [id], [ip] or [link] were removed on purpose: don't try to recover them.";

/**
 * Where the model runs, today's date (it needs it to ask a calendar for "today") and what its connectors
 * may do. Only the date, not the time: the preamble starts the system prompt, and a value that changes
 * every minute would keep the provider from caching anything after it.
 */
export function preamble(connectorNames: string[], now: Date = new Date()): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = now.toLocaleDateString("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return [
    "You are running on the user's own computer, reached through a local gateway.",
    `Today is ${today}; the user's time zone is ${timeZone}.`,
    connectorNames.length > 0
      ? `You can read the user's ${connectorNames.join(", ")} through connectors. They are read-only: you can search and read, but you can't send, create, change or delete anything. If asked to, say so. ${PRIVACY_RULES}`
      : "No connectors are available.",
  ].join("\n");
}
