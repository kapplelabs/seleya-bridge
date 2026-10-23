# seleya-bridge

A small local server that lets Seleya web — including the deployed site — send requests to Claude Code on
your own machine. The browser can't start `claude` itself, so the bridge does it: it listens on
`127.0.0.1`, runs each prompt through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), and
streams the answer back as the same `seleya.*` SSE events ms-agent-gateway emits, so Seleya's chat
stream reads it unchanged.

```
Seleya (browser) ──HTTPS page, fetch/EventSource──▶ seleya-bridge (127.0.0.1:47821) ──▶ Claude Code
```

## Run it

Requires Node 22.18+ and Claude Code signed in on this machine (`claude`, then `/login`), or
`ANTHROPIC_API_KEY` set in the bridge's environment.

```bash
pnpm install
pnpm dev                       # node --watch src/index.ts
pnpm build && pnpm start       # compiled, from dist/
```

Run it from a normal terminal, not from inside a Claude Code session (Claude Code refuses to start
nested sessions).

Commands:

```bash
seleya-bridge [start] [--port <n>] [--allow-origin <origin>]...
seleya-bridge revoke     # forget every paired browser
seleya-bridge config     # print the config file path
```

## Configuration

`~/.config/seleya-bridge/config.json` (or `$SELEYA_BRIDGE_HOME/config.json`), written with defaults on
first run:

| Key | Default | |
|---|---|---|
| `port` | `47821` | Fixed so Seleya knows where to look |
| `allowedOrigins` | `["http://localhost:3000"]` | Add your deployed Seleya origin, e.g. `https://seleya.example.com` (no trailing slash) |
| `workspace` | `~/seleya-workspace` | Claude's working directory |
| `tools` | `["Read", "Glob", "Grep"]` | Built-in tools Claude may use; others don't exist for it |
| `model` | Claude Code's default | Model override |
| `claudeExecutable` | bundled with the SDK | Path to a `claude` binary, e.g. `~/.local/bin/claude` |
| `connectors` | `{}` | claude.ai connectors Claude may read from: `"auto"` or a map by Seleya connector id (see below) |

`SELEYA_BRIDGE_PORT` / `--port` and `SELEYA_BRIDGE_ALLOWED_ORIGINS` (comma-separated) / `--allow-origin`
override the file for one process.

### Connectors (read-only)

Claude can read from the claude.ai connectors of the account Claude Code is signed in with.

**Every connector you've connected:**

```json
"connectors": "auto"
```

The bridge uses each claude.ai connector that is connected when it starts, so connecting or disconnecting
one in Claude only needs a bridge restart; the file is never rewritten. Known connectors get Seleya's id
(Gmail → `gmail`, Google Calendar → `calendar`, Google Drive → `drive`, Slack → `slack`, Atlassian → `jira`…, so Seleya shows
its name and icon); others get an id from their name (Google Sheets → `google_sheets`). The bridge prints
the connectors it skipped because they aren't connected in this session (`needs-auth`, `failed`).
`claude mcp list` can show a connector as connected that still reports `needs-auth` to the Agent SDK;
reconnecting it on claude.ai fixes that.

**Only some connectors:** list them by Seleya connector id, with the connector's name as `claude mcp list`
shows it, without "claude.ai ":

```json
"connectors": { "calendar": "Google Calendar", "gmail": "Gmail" }
```

Either way, the bridge looks them up once at startup, in a session that loads your user settings but sends
no prompt and has no tools, and prints each one with its read-only tools. Web runs then get exactly those
connectors: tools the connector marks read-only run without asking, and every other tool (send, create,
update, delete…) is removed, so Claude can't call it. A listed connector that isn't connected on claude.ai
is reported as unavailable and left out.

## Daily Briefing

`POST /v1/briefings` runs one Claude turn with the bridge's own prompt (the web can't change it) and only the
connectors' read-only tools — no file tools. Claude reads today's calendar, the last day's mail and chat
mentions, pull requests waiting on the user, and the user's open Jira issues (Atlassian connector, JQL
`assignee = currentUser() AND statusCategory != Done`), sorted into *focus* (in progress, blocked, overdue,
highest priority), *to do* and *ready to ship* (waiting for review, QA, release or deployment). It returns
the briefing as structured output
(a JSON schema, validated with zod). The stream carries Seleya's agent run events instead of chat events:

| Event | When |
|---|---|
| `seleya.run.started` / `seleya.run.phase` | First, then whenever the kind of work changes (`processing`, `thinking`, `reasoning`, `tool`, `writing`) |
| `seleya.thought.started` / `.delta` / `.completed` | Each thinking or text block, sent whole once it ends (so it is redacted as a whole) |
| `seleya.trace.step` | Connector calls (`active` → `done` / `failed`) |
| `seleya.run.completed` | With a summary such as "Read 4 sources · removed 12 private details"; the briefing is then at `GET /v1/runs/:id/result` |
| `seleya.error` | `stopped`, `no_result`, `invalid_briefing`, `claude_auth_required`, `connector_failed` (every connector call failed, e.g. a connector authorized without read permission), … |
| `stream.done` | Always last |

The briefing is kept with the run (10 minutes); Seleya stores the latest one in the browser.

## Calendar Assistant

`POST /v1/calendar/weeks` with `{ "week_start": "YYYY-MM-DD" }` (a Monday, from 4 weeks back to 8 ahead) runs
one Claude turn that reads that Monday–Friday from Google Calendar and returns its events as structured
output: title, local date and times, all-day, guest count, whether the user organizes it, kind (meeting,
focus, personal, out-of-office), the user's reply and a room or "Video call". Declined and cancelled
events are left out, and so are descriptions, attendee names and links.

It's a report run like the Daily Briefing (same events, same redaction), with two differences: Claude only
gets the Google Calendar connector (`calendar`) and its read-only tools, and the result is
`GET /v1/runs/:id/result` → `{ week }`. It answers `409 no_calendar` when Google Calendar isn't connected.
Seleya works out the week's stats, conflicts, free time and focus suggestions from the events; it can't
change the calendar, so the user makes changes in Google Calendar.

## Mail Assistant

`POST /v1/mail/triage` with `{ "days": 2 }` (1–7, default 2) runs one Claude turn that reads that many days
of the Gmail inbox, plus the last 14 days of sent mail, and returns a triage as structured output:

- `respond`: threads where someone expects an answer, with why they were flagged, the last messages
  (without signatures or quoted history) and a reply drafted in the user's voice, its confidence and the
  commitments it makes (`checks`); `draft` is `null` when Claude can't answer from the thread.
- `awaiting`: sent mail that asked for something and got no reply, with a drafted follow-up.
- `invites`: meeting invitations still waiting for an answer, with a suggested answer and both drafts.
- `bundles`: everything else grouped by sender or tool (`fyi`, `notifications`, `marketing`).

Same events and redaction as the other report runs, with only the Gmail connector (`gmail`) and its
read-only tools: nothing is sent, drafted in Gmail, labelled or archived. Security, sign-in, payment,
salary, health, HR and legal mail is skipped entirely, people are named by display name only, and a Gmail
thread id is kept only when it looks like one (Seleya links to the thread with it). The result is
`GET /v1/runs/:id/result` → `{ triage }`; `409 no_gmail` when Gmail isn't connected.

## Personal and secret data

Connector content is redacted before anything else sees it (`src/redact.ts`):

- **Before Claude reads it.** A `PostToolUse` hook rewrites every connector result (chat and briefing runs):
  email addresses, phone numbers, credentials (private keys, JWTs, bearer tokens, API keys of common
  providers, `password:` / `token=` values, sign-in codes), card numbers (Luhn-checked), IBANs, SSNs and
  passport / national-id / account numbers, IP addresses, and links that grant access (meeting joins,
  webhooks, credentials in the URL; sensitive query parameters are dropped from other links) become
  placeholders such as `[email]` or `[secret]`. JSON fields named like credentials are blanked.
- **In what Claude is told.** Runs with connectors are told never to repeat such data; the briefing prompt
  also has Claude skip security alerts, payment, salary, health, HR and legal mail entirely.
- **In what leaves the bridge.** Trace step details (search queries), briefing thoughts and the briefing
  itself are redacted again, and the count of removed values is reported.

People's display names are kept: a briefing needs to say who is waiting on you. The rules are patterns, a
safety net rather than a guarantee.

## Security model

Every page you open can send requests to `127.0.0.1`, and Claude Code can act on this machine, so:

- **Loopback only.** The server binds `127.0.0.1`; requests whose `Host` isn't `127.0.0.1`, `localhost`
  or `[::1]` on the bridge port are refused (DNS rebinding).
- **Origin allowlist.** A browser request from an origin not in `allowedOrigins` gets `403` and no CORS
  headers. POST bodies must be `application/json`, which forces a CORS preflight.
- **Pairing.** Seleya calls `POST /v1/pair/start`; the bridge prints a 6-digit code in its terminal (valid
  2 minutes, 5 tries, single use); the user types it into Seleya, which trades it for a random token.
  Only the token's SHA-256 is stored (`tokens.json`, mode 600), bound to the origin that paired it.
- **Stream tickets.** `EventSource` can't send headers, so the SSE URL carries a ticket bound to one run,
  valid 60 seconds (long enough for the browser's own reconnect).
- **Isolated Claude.** No `~/.claude` settings, hooks, MCP servers or skills are loaded, so your personal
  permission rules never apply to web requests. Only `tools` and the read-only tools of `connectors`
  exist, permission mode is `default`, and any call that would need approval is denied (an approval flow
  comes later). One run at a time.

Browsers: Chrome, Edge and Firefox treat `http://127.0.0.1` as a secure context, so an HTTPS page can call
it. Chrome may ask once for local network access (the bridge answers the
`Access-Control-Request-Private-Network` preflight). Safari may block it as mixed content.

## HTTP API

JSON is snake_case on the wire. Errors are `{ "error": { "code", "message" } }`.

| Method & path | Auth | Body | Response |
|---|---|---|---|
| `GET /v1/health` | optional | | `{ name, version, paired, busy, connectors: [{ id, name, state }] }` (`paired` is whether the sent token is valid) |
| `POST /v1/pair/start` | Origin | | `{ expires_at }`; `429` within 3 s of the last code |
| `POST /v1/pair/confirm` | Origin | `{ code }` | `{ token }`; `401 invalid_code` |
| `DELETE /v1/pair` | Bearer | | `204`, revokes the caller's token |
| `POST /v1/runs` | Bearer | `{ prompt, session_id?, title? }` | `201 { run_id, session_id, assistant_message_id, stream }`; `409 busy` |
| `POST /v1/briefings` | Bearer | | `201 { run_id, stream }`: today's Daily Briefing as an agent run; `409 busy`, `409 no_connectors` |
| `POST /v1/calendar/weeks` | Bearer | `{ week_start }` | `201 { run_id, stream }`: one Mon–Fri week of Google Calendar; `400 invalid_week`, `409 busy`, `409 no_calendar` |
| `POST /v1/mail/triage` | Bearer | `{ days? }` | `201 { run_id, stream }`: the last 1–7 days of Gmail, triaged; `409 busy`, `409 no_gmail` |
| `GET /v1/runs/:id/result` | Bearer | | `{ briefing }`, `{ week }` or `{ triage }` once a report run completed; `409 not_ready`, `404 no_result` |
| `POST /v1/runs/:id/tickets` | Bearer | | `stream` with a fresh ticket |
| `POST /v1/runs/:id/cancel` | Bearer | | `202` |
| `GET /v1/runs/:id/stream?ticket=` | ticket | | `text/event-stream` |

`stream` is Seleya's `ChatStream`: `{ stream_id, ticket, expires_at, url }`. `session_id` is the Claude
Code session, Seleya's conversation id: send it back to continue the conversation; omit it to start a new
one.

### Stream events

Frames look like ms-agent-gateway's: `id: <n>`, `event: <type>`,
`data: {"event_type": <type>, "session_id": <run id>, "data": {…}}`. A reconnect with `Last-Event-ID`
resumes after that event; a new ticket replays the run from the start. Finished runs are kept 10 minutes.

| Event | When |
|---|---|
| `seleya.message.started` | First; `conversation_id` = Claude session id |
| `seleya.block.started` / `seleya.block.delta` | Each text block Claude writes, streamed |
| `seleya.trace.started` / `seleya.trace.step` / `seleya.trace.completed` | Tool calls (`active` → `done` / `failed`) |
| `seleya.message.completed` | Success, with the full message |
| `seleya.error` | `cancelled`, `claude_auth_required`, `claude_api_error`, `claude_error`, `error_max_turns`, … |
| `stream.done` | Always last |
