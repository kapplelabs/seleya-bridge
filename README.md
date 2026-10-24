# seleya-bridge

A small local gateway that lets Seleya web — including the deployed site — run AI agents on your own
machine. The browser can't start `claude` itself, so the bridge does it: it listens on `127.0.0.1`, runs
each request through a provider (Claude Code, via the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk)),
and streams provider-neutral SSE events back.

The bridge holds no product logic: prompts, output schemas and what Seleya does with the result live in
Seleya. The bridge keeps what must be enforced on this machine: pairing, isolation, read-only connectors,
redaction, limits and one run at a time. The design is in [docs/gateway.md](docs/gateway.md).

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

## Seleya Bridge app (macOS)

For people who don't use a terminal, `app/` is a menu-bar app that runs the same bridge:

- **Install**: open `Seleya Bridge-<version>-arm64.dmg` and drag the app to Applications. It ships its own
  `claude` binary; the user only needs to be signed in to Claude Code once (`claude`, then `/login`), as
  for the CLI.
- **Use**: the bridge starts with the app. A menu-bar glyph shows its state (faded: off, dot: Claude is
  answering or a pairing code is waiting); its menu starts and stops it, opens Seleya's AI providers page (*Open Seleya Provider*, where the
  browser is paired and the connection set up) and turns on
  *Start at Login*. The control panel shows the status, the pairing code (also sent as a notification, and
  the panel floats over the browser until the code is used), paired browsers, connectors and a log.
  *Settings* edits `allowedOrigins`, `workspace`, `tools`, `connectors` and `model` in the same
  `config.json` and restarts the bridge.
- **From Seleya**: the app registers `seleya-bridge://`. When the bridge is offline, Seleya's *Open Seleya
  Bridge* button opens `seleya-bridge://open`, which launches or shows the app (launching it starts the
  bridge). Any website can open such a link, so it never changes settings, pairs a browser or starts a
  bridge you stopped. Set `BRIDGE_DOWNLOAD_URL` in Seleya's `.env` to show a
  download link too.

The app and the CLI share `config.json`, `tokens.json` and the port, so run one at a time: the app says so
when the port is taken.

```bash
cd app
pnpm install
pnpm dev        # panel from Vite with hot reload; restart after changing src/main or the bridge
pnpm dist       # release/Seleya Bridge-<version>-<arch>.dmg for this Mac's architecture
```

`pnpm install` in the repo root comes first: the app bundles `../src`, zod and the Agent SDK from there.
`pnpm dist` builds an unsigned app; for other Macs, sign and notarize it (`CSC_LINK`, `APPLE_ID`, … for
electron-builder), or Gatekeeper refuses to open it. The panel's design follows
`seleya/design-system/seleya/pages/bridge-launcher.md`.

## Configuration

`~/.config/seleya-bridge/config.json` (or `$SELEYA_BRIDGE_HOME/config.json`), written with defaults on
first run:

| Key | Default | |
|---|---|---|
| `port` | `47821` | Fixed so Seleya knows where to look |
| `allowedOrigins` | `[]` | Your deployed Seleya origin, e.g. `https://seleya.example.com` (no trailing slash). `https` only, except `http://localhost:<port>` for a local Seleya: add that only while developing, since every page served on that port is trusted too |
| `workspace` | `~/seleya-workspace` | Claude's working directory |
| `tools` | `["Read", "Glob", "Grep"]` | Built-in tools Claude may use; others don't exist for it |
| `model` | Claude Code's default | Model override |
| `models` | `[]` | Other Claude models a request may ask for |
| `defaultProvider` | `"claude"` | Provider of a run whose request names none |
| `limits` | `{ "maxTurns": 60, "maxToolOutputTokens": 100000 }` | Ceilings on what one run may ask for |
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

## Runs

Every request is a run: `POST /v1/runs` with the prompt, an optional system prompt (added after the
bridge's own preamble: date, time zone, the run's connectors and privacy rules), the connectors and
workspace tools it may use (only within `connectors` and `tools`), an optional JSON Schema for a
structured answer, and limits (clamped to `limits`). Chat, the Daily Briefing, the Calendar and Mail
assistants are all runs whose prompts and schemas Seleya sends; adding or changing one needs no new
bridge.

A run keeps no transcript unless `session.persist` is set. A persisted conversation gets a session id
from the bridge, which only the browser that started it can continue (`session.resume_id`).

## Personal and secret data

Connector content is redacted before anything else sees it (`src/redact.ts`):

- **Before Claude reads it.** A `PostToolUse` hook rewrites every connector result:
  email addresses, phone numbers, credentials (private keys, JWTs, bearer tokens, API keys of common
  providers, `password:` / `token=` values, sign-in codes), card numbers (Luhn-checked), IBANs, SSNs and
  passport / national-id / account numbers, IP addresses, and links that grant access (meeting joins,
  webhooks, credentials in the URL; sensitive query parameters are dropped from other links) become
  placeholders such as `[email]` or `[secret]`. JSON fields named like credentials are blanked.
- **In what Claude is told.** Runs with connectors are told never to repeat such data.
- **In what leaves the bridge.** Answer text (streamed a line at a time, so no value is split between two
  events), thinking, tool inputs and errors, and the structured output (keys and values) are redacted
  again, and the count of removed values is reported.

People's display names are kept: a briefing needs to say who is waiting on you. The rules are patterns, a
safety net rather than a guarantee.

## Security model

Every page you open can send requests to `127.0.0.1`, and Claude Code can act on this machine, so:

- **Loopback only.** The server binds `127.0.0.1`; requests whose `Host` isn't `127.0.0.1`, `localhost`
  or `[::1]` on the bridge port are refused (DNS rebinding).
- **Origin allowlist.** A browser request from an origin not in `allowedOrigins` gets `403` and no CORS
  headers. POST bodies must be `application/json`, which forces a CORS preflight.
- **Pairing.** Seleya calls `POST /v1/pair/start`; the bridge shows a 6-digit code in its terminal, or in
  the app and a notification (valid 2 minutes, 5 tries, single use); the user types it into Seleya, which
  trades it for a random token. After 10 wrong codes within an hour, whatever the code or origin, pairing
  pauses for an hour (`429 pairing_locked`) or until the bridge restarts.
- **Tokens.** Only the token's SHA-256 is stored (`tokens.json`, mode 600), bound to the origin that
  paired it: a request without that `Origin` header isn't authorized. A token unused for 30 days stops
  working.
- **Ownership.** A run, its stream tickets and its result belong to the paired browser that started it;
  others get `404`. Session ids are always the bridge's, and a conversation can only be continued by the
  browser that started it, with the same provider (`sessions.json`), never a Claude Code session started
  some other way.
- **Stream tickets.** `EventSource` can't send headers, so the SSE URL carries a ticket bound to one run,
  valid 60 seconds and 5 connections (enough for the browser's own reconnects).
- **Isolated Claude.** No `~/.claude` settings, hooks, MCP servers or skills are loaded, so your personal
  permission rules never apply to web requests. Only the workspace tools and connectors a run asks for,
  within `tools` and `connectors`, exist (connectors read-only), permission mode is `default`, and any call
  that would need approval is denied (an approval flow comes later). One run at a time.

Browsers: Chrome, Edge and Firefox treat `http://127.0.0.1` as a secure context, so an HTTPS page can call
it. Chrome may ask once for local network access (the bridge answers the
`Access-Control-Request-Private-Network` preflight). Safari may block it as mixed content.

## HTTP API

JSON is snake_case on the wire. Errors are `{ "error": { "code", "message", "details"? } }`; `message` is
for debugging, Seleya shows its own words for each `code`.

| Method & path | Auth | Body | Response |
|---|---|---|---|
| `GET /v1/health` | optional | | `{ name, version, paired, busy }` (`paired` is whether the sent token is valid for the sending origin) |
| `POST /v1/pair/start` | Origin | | `{ expires_at }`; `429 too_many_requests` within 3 s of the last code, `429 pairing_locked` after too many wrong codes |
| `POST /v1/pair/confirm` | Origin | `{ code }` | `{ token }`; `401 invalid_code` |
| `DELETE /v1/pair` | Bearer | | `204`, revokes the caller's token |
| `GET /v1/capabilities` | Bearer | | `{ bridge_version, time_zone, default_provider, providers: [{ id, state, models, features, connectors_state, connectors }], limits }` |
| `POST /v1/runs` | Bearer | see below | `201 { run_id, session_id, provider, stream }` |
| `GET /v1/runs/:id` | Bearer | | `{ run_id, session_id, provider, status, output, text, sources, connector_errors, redactions, error }` |
| `POST /v1/runs/:id/tickets` | Bearer | | `stream` with a fresh ticket |
| `POST /v1/runs/:id/cancel` | Bearer | | `202` |
| `GET /v1/runs/:id/stream?ticket=` | ticket | | `text/event-stream` |

`POST /v1/runs` body:

```jsonc
{
  "provider": "claude",                 // optional, default defaultProvider
  "model": null,                        // optional, one of capabilities' models
  "prompt": "…",
  "system_prompt": "…",                 // optional, after the bridge's preamble
  "session": { "persist": true, "resume_id": "…", "title": "…" },   // optional; no transcript without persist
  "connectors": ["calendar"],           // or "all"; default none
  "workspace_tools": ["read_file"],     // or "all"; default none
  "output_schema": { "type": "object" },// optional JSON Schema (draft-7): the answer comes back as `output`
  "limits": { "max_turns": 40, "max_tool_output_tokens": 60000 }
}
```

It answers `400 invalid_request` / `invalid_output_schema`, `404 session_not_found`,
`409 provider_unavailable` / `connectors_discovering` / `busy`, `422 model_not_allowed` /
`connector_unavailable` / `tool_not_allowed`. `stream` is Seleya's `ChatStream`:
`{ stream_id, ticket, expires_at, url }`. `session_id` is `null` for a run that isn't persisted.

### Stream events

Frames look like ms-agent-gateway's: `id: <n>`, `event: <type>`,
`data: {"event_type": <type>, "session_id": <run id>, "data": {…}}`. A reconnect with `Last-Event-ID`
resumes after that event; a new ticket replays the run from the start. Finished runs are kept 10 minutes.

| Event | When |
|---|---|
| `run.started` | First, with the values the run really got (provider, connectors, workspace tools, limits…) |
| `text.started` / `text.delta` / `text.completed` | Each text block, streamed a line at a time, redacted |
| `thinking.started` / `thinking.delta` / `thinking.completed` | Each thinking block, sent whole once it ends, redacted |
| `tool.started` / `tool.completed` | Tool calls: `kind` (`connector`, `workspace`, `other`), `connector`, `name`, redacted `input`; then `ok` and `error` |
| `output.started` | The model started writing the structured answer |
| `run.completed` | `{ text, output?, sources, connector_errors, redactions, usage?, duration_ms }` |
| `run.failed` | `{ code, message, retryable, details? }`: `provider_auth_required`, `provider_usage_limit`, `provider_api_error`, `context_limit`, `max_turns`, `invalid_output`, `no_result`, `cancelled`, `provider_error` |
| `stream.done` | Always last |
