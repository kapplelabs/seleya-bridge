import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { HttpError } from "../http.ts";
import { RunRegistry } from "../runs.ts";
import { LinkClient, serverFor } from "./client.ts";
import { Scheduler } from "./scheduler.ts";
import { LinkStore, type Report } from "./store.ts";

const ORIGIN = "https://seleya.example.com";
const SERVER = "https://seleya.example.com/api";

interface Call {
  url: string;
  authorization: string | undefined;
  body: any;
}

/** A Seleya server that answers from a queue of handlers per path; an unhandled poll hangs until aborted. */
class FakeServer {
  calls: Call[] = [];
  handlers = new Map<string, ((call: Call) => { status: number; body: unknown })[]>();

  on(pathname: string, handler: (call: Call) => { status: number; body: unknown }): void {
    this.handlers.set(pathname, [...(this.handlers.get(pathname) ?? []), handler]);
  }

  fetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const call = { url, authorization: headers.get("authorization") ?? undefined, body: JSON.parse(String(init?.body)) };
    this.calls.push(call);
    const pathname = url.slice(SERVER.length);
    const handler = this.handlers.get(pathname)?.shift();
    if (!handler) {
      if (pathname === "/bridge/v1/reports") return Response.json({ accepted: call.body.reports.length });
      // Like a long poll with nothing new: wait until the client gives up.
      await new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    }
    const { status, body } = handler!(call);
    return Response.json(body, { status });
  };

  callsTo(pathname: string): Call[] {
    return this.calls.filter((call) => call.url === `${SERVER}${pathname}`);
  }
}

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(condition(), "condition never became true");
};

const report = (id: string): Report => ({
  report_id: id,
  schedule_id: "sch_1",
  command_id: null,
  trigger: "schedule",
  scheduled_for: "2026-10-24T08:00:00.000Z",
  status: "completed",
  code: null,
  retryable: null,
  task_version: 1,
  started_at: null,
  finished_at: null,
  duration_ms: null,
  connectors_read: [],
  connector_errors: [],
  redactions: null,
});

let home: string;
let store: LinkStore;
let server: FakeServer;
let scheduler: Scheduler;
let client: LinkClient;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "seleya-bridge-client-"));
  store = new LinkStore(home);
  server = new FakeServer();
  scheduler = new Scheduler({
    store,
    link: () => ({ enabled: true, connectors: "all", maxRunsPerDay: 24, minIntervalMinutes: 30 }),
    runs: new RunRegistry(),
    start: () => {
      throw new Error("not in this test");
    },
    provider: () => ({ ready: true, discovering: false, connected: [] }),
    origin: () => store.link()?.origin,
    report: (item) => client.report(item),
  });
  client = new LinkClient({
    store,
    scheduler,
    enabled: () => true,
    fetch: server.fetch,
    status: () => ({
      bridgeVersion: "9.9.9",
      platform: "darwin-arm64",
      timeZone: "Asia/Ho_Chi_Minh",
      busy: false,
      paused: false,
      providers: [{ id: "claude", state: "ready" }],
      connectors: [{ id: "gmail", state: "connected" }],
    }),
  });
});

afterEach(() => {
  client.stop();
  scheduler.stop();
  rmSync(home, { recursive: true, force: true });
});

const enrolled = (userId = "u_1") => () => ({
  status: 200,
  body: { device_id: "dev_1", device_token: "secret-device-token", user_id: userId },
});

describe("link client", () => {
  test("the server is the Seleya origin plus a path, https only", () => {
    assert.equal(serverFor(ORIGIN, "/api"), SERVER);
    assert.equal(serverFor("http://localhost:3000", "/api/"), "http://localhost:3000/api");
    assert.throws(() => serverFor("http://seleya.example.com", "/api"), HttpError);
    assert.throws(() => serverFor(ORIGIN, "//evil.example.com"), HttpError);
  });

  test("links, polls with the device token, applies schedules and acks commands", async () => {
    server.on("/bridge/v1/enroll", enrolled());
    server.on("/bridge/v1/poll", () => ({
      status: 200,
      body: {
        config_revision: 4,
        config: {
          schedules: [
            {
              id: "sch_1",
              name: "Daily Briefing",
              task_id: "briefing",
              task_version: 1,
              enabled: true,
              timing: { kind: "weekly", days: ["Mon"], time: "08:00" },
              time_zone: "UTC",
              created_at: "2026-10-01T00:00:00Z",
              template: { request: { prompt: "Hi" }, expires_after_minutes: 60 },
            },
            { id: "broken" },
          ],
        },
        commands: [{ id: "cmd_1", kind: "cancel", schedule_id: "sch_1", expires_at: "2099-01-01T00:00:00Z" }],
      },
    }));
    server.on("/bridge/v1/poll", () => ({ status: 200, body: { config_revision: 4, commands: [] } }));

    const link = await client.link(ORIGIN, "/api", "enroll-me");
    assert.equal(link.server, SERVER);
    assert.equal(link.userId, "u_1");
    const [enroll] = server.callsTo("/bridge/v1/enroll");
    assert.equal(enroll!.authorization, undefined);
    assert.deepEqual(enroll!.body, {
      enrollment_token: "enroll-me",
      name: link.deviceName,
      platform: "darwin-arm64",
      bridge_version: "9.9.9",
      time_zone: "Asia/Ho_Chi_Minh",
    });

    await until(() => server.callsTo("/bridge/v1/poll").length >= 3);
    const polls = server.callsTo("/bridge/v1/poll");
    assert.equal(polls[0]!.authorization, "Device secret-device-token");
    assert.equal(polls[0]!.body.config_revision, 0);
    assert.equal(polls[0]!.body.status.connectors[0].id, "gmail");
    assert.deepEqual(polls[1]!.body.acks, ["cmd_1"]);
    assert.equal(polls[1]!.body.config_revision, 4);
    assert.deepEqual(polls[2]!.body.acks, []);
    assert.deepEqual(
      store.config()!.schedules.map((item) => item.id),
      ["sch_1"],
    );
    assert.equal(client.current().state, "online");
  });

  test("reports wait in the outbox until the server accepts them", async () => {
    server.on("/bridge/v1/enroll", enrolled());
    await client.link(ORIGIN, "/api", "enroll-me");
    client.stop();
    server.on("/bridge/v1/reports", () => ({ status: 503, body: { error: { code: "unavailable" } } }));
    client.report(report("r1"));
    await until(() => server.callsTo("/bridge/v1/reports").length === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(store.pendingReports().length, 1);
    client.report(report("r2"));
    await until(() => store.pendingReports().length === 0);
    assert.deepEqual(
      server.callsTo("/bridge/v1/reports").at(-1)!.body.reports.map((item: Report) => item.report_id),
      ["r1", "r2"],
    );
  });

  test("a revoked device forgets the link", async () => {
    server.on("/bridge/v1/enroll", enrolled());
    server.on("/bridge/v1/poll", () => ({ status: 401, body: { error: { code: "device_revoked" } } }));
    await client.link(ORIGIN, "/api", "enroll-me");
    await until(() => client.current().state === "revoked");
    assert.equal(store.link(), undefined);
  });

  test("a wrong code is enrollment_invalid; another account needs an unlink first", async () => {
    server.on("/bridge/v1/enroll", () => ({ status: 401, body: { error: { code: "enrollment_invalid" } } }));
    await assert.rejects(client.link(ORIGIN, "/api", "nope"), { code: "enrollment_invalid" });

    server.on("/bridge/v1/enroll", enrolled("u_1"));
    await client.link(ORIGIN, "/api", "one");
    server.on("/bridge/v1/enroll", enrolled("u_2"));
    server.on("/bridge/v1/unlink", () => ({ status: 204, body: {} }));
    await assert.rejects(client.link(ORIGIN, "/api", "two"), { code: "already_linked" });
    assert.equal(store.link()?.userId, "u_1");
  });
});
