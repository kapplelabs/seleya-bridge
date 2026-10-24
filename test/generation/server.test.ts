import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createApp, fixedHarness } from "../../src/generation/app.ts";
import { advanceUntil, makeTestApp, raw, session } from "./helpers.ts";

test("US1: answers /me and /local/health without a session, and runs with one", async () => {
  const t = makeTestApp();
  try {
    const port = await t.app.listen(0);
    const me = await raw(port, { path: "/api/me" });
    assert.equal(me.status, 200);
    assert.match(JSON.parse(me.body).id, /^usr_local_/);
    const health = JSON.parse((await raw(port, { path: "/api/local/health" })).body);
    assert.equal(typeof health.machine_id, "string");
    assert.ok(
      !health.skills.some((skill: { name: string }) => skill.name.startsWith("_")),
      "test skills are hidden",
    );
    // Same routes without the /api prefix (what Vite's proxy forwards).
    assert.equal((await raw(port, { path: "/me" })).status, 200);
  } finally {
    await t.cleanup();
  }
});

test("US1: serves the built client, with SPA fallback that hands out the session", async () => {
  const t = makeTestApp();
  const dist = path.join(t.home, "dist");
  mkdirSync(path.join(dist, "assets"), { recursive: true });
  writeFileSync(path.join(dist, "index.html"), "<!doctype html><div id=root></div>");
  writeFileSync(path.join(dist, "assets", "app.js"), "console.log(1)");
  const app = createApp({
    config: { ...t.config, distDir: dist },
    clock: t.clock,
    pickHarness: fixedHarness(t.harness),
  });
  try {
    const port = await app.listen(0);
    const page = await raw(port, { path: "/studio", headers: { "sec-fetch-site": "none" } });
    assert.equal(page.status, 200);
    assert.match(page.body, /id=root/);
    assert.match(String(page.headers["set-cookie"]), /seleya_local=.*HttpOnly; SameSite=Strict/);
    assert.equal((await raw(port, { path: "/assets/app.js" })).body, "console.log(1)");
    const crossSite = await raw(port, {
      path: "/studio",
      headers: { "sec-fetch-site": "cross-site" },
    });
    assert.equal(
      crossSite.headers["set-cookie"],
      undefined,
      "no session for a cross-site navigation",
    );
    assert.equal((await raw(port, { path: "/api/nope" })).status, 404);
  } finally {
    await app.close();
    await t.cleanup();
  }
});

test("US5: refuses other hosts, missing sessions, foreign origins, cross-site sessions and path escapes", async () => {
  const t = makeTestApp();
  try {
    const port = await t.app.listen(0);
    const cookie = await session(port);
    assert.equal(
      (await raw(port, { path: "/api/me", headers: { host: "evil.example:80" } })).status,
      403,
    );
    assert.equal((await raw(port, { path: "/api/runs" })).status, 401);
    assert.equal(
      (await raw(port, { path: "/api/runs", headers: { cookie: "seleya_local=wrong" } })).status,
      401,
    );
    assert.equal((await raw(port, { path: "/api/runs", headers: { cookie } })).status, 200);
    const foreign = await raw(port, {
      method: "POST",
      path: "/api/local/runs",
      headers: { cookie, origin: "https://evil.example" },
      body: { skill: "_scripted", title: "x", request: {} },
    });
    assert.equal(foreign.status, 403);
    const devUi = await raw(port, {
      method: "POST",
      path: "/api/local/runs",
      headers: { cookie, origin: "http://localhost:3000" },
      body: { skill: "_scripted", title: "x", request: {} },
    });
    assert.equal(devUi.status, 202, "the configured dev UI origin is allowed");
    assert.equal(
      (await raw(port, { path: "/api/local/session", headers: { "sec-fetch-site": "cross-site" } }))
        .status,
      403,
    );
    const runId = JSON.parse(devUi.body).run.id;
    const escape = await raw(port, {
      path: `/api/runs/${runId}/files/..%2F..%2Fseleya.db`,
      headers: { cookie },
    });
    assert.equal(escape.status, 404);
  } finally {
    await t.cleanup();
  }
});

test("US2/US3: the stream replays history, resumes after Last-Event-ID, and ends with stream.done", async () => {
  const t = makeTestApp();
  try {
    const port = await t.app.listen(0);
    const cookie = await session(port);
    const created = await raw(port, {
      method: "POST",
      path: "/api/local/runs",
      headers: { cookie },
      body: { skill: "_scripted", title: "S", request: {} },
    });
    assert.equal(created.status, 202);
    const { run, stream } = JSON.parse(created.body);
    assert.equal(stream.url, `/api/runs/${run.id}/stream`);
    await advanceUntil(t.clock, () => t.app.manager.get(run.id).localStatus === "completed");

    const full = await raw(port, { path: stream.url, headers: { cookie } });
    const ids = [...full.body.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    assert.ok(ids.length > 10);
    assert.deepEqual(
      ids,
      [...ids].sort((a, b) => a - b),
      "in order",
    );
    assert.equal(new Set(ids).size, ids.length, "no duplicates");
    assert.match(full.body, /event: stream\.done\n/);

    const resumed = await raw(port, {
      path: stream.url,
      headers: { cookie, "last-event-id": String(ids[4]) },
    });
    const resumedIds = [...resumed.body.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    assert.deepEqual(resumedIds, ids.slice(5));

    const file = await raw(port, {
      path: `/api/runs/${run.id}/files/out/result.txt`,
      headers: { cookie },
    });
    assert.equal(file.body, "result");
    const list = JSON.parse((await raw(port, { path: "/api/runs", headers: { cookie } })).body);
    assert.equal(list.items[0].id, run.id);
    assert.equal(list.items[0].status, "completed");
  } finally {
    await t.cleanup();
  }
});
