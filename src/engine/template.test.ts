import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { HttpError } from "../http.ts";
import { fillTemplate, templateValues } from "./template.ts";

const values = (iso: string, timeZone: string, weekOffset = 0, connectorNames: string[] = []) =>
  templateValues({ now: new Date(iso), timeZone, weekOffset, connectorNames });

function templateError(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, "invalid_template");
    return error;
  }
  assert.fail("expected invalid_template");
}

describe("template", () => {
  test("values follow the time zone, not UTC", () => {
    // 2026-10-24 23:30 UTC is already Sunday morning in Ho Chi Minh City.
    const { vars } = values("2026-10-24T23:30:00Z", "Asia/Ho_Chi_Minh", 0, ["Gmail", "Google Calendar"]);
    assert.equal(vars.now, "2026-10-25T06:30:00+07:00");
    assert.equal(vars.today, "2026-10-25");
    assert.equal(vars.time_zone, "Asia/Ho_Chi_Minh");
    // Sunday belongs to the week that started on Monday the 19th.
    assert.equal(vars.week_start, "2026-10-19");
    assert.equal(vars.connectors, "Gmail, Google Calendar");
    assert.match(vars.now_text, /^Sunday, October 25, 2026 at 6:30\sAM$/);
  });

  test("UTC and negative offsets", () => {
    assert.equal(values("2026-10-24T08:05:00Z", "UTC").vars.now, "2026-10-24T08:05:00+00:00");
    assert.equal(values("2026-10-24T08:05:00Z", "America/New_York").vars.now, "2026-10-24T04:05:00-04:00");
  });

  test("week offsets and day offsets", () => {
    const filled = fillTemplate(
      "{{week_start}} {{week_start:+4}} {{today:-1}} {{ today:+31 }}",
      values("2026-10-21T12:00:00Z", "UTC", 1),
    );
    assert.equal(filled, "2026-10-26 2026-10-30 2026-10-20 2026-11-21");
  });

  test("day offsets cross a DST change by calendar days", () => {
    // Europe/Berlin leaves summer time on 2026-10-25.
    const filled = fillTemplate("{{today:+1}} {{today:+2}}", values("2026-10-24T10:00:00Z", "Europe/Berlin"));
    assert.equal(filled, "2026-10-25 2026-10-26");
  });

  test("no connectors reads as none", () => {
    assert.equal(fillTemplate("{{connectors}}", values("2026-10-24T08:00:00Z", "UTC")), "none");
  });

  test("unknown variables, offsets on non-dates, large offsets and stray braces are refused", () => {
    const at = values("2026-10-24T08:00:00Z", "UTC");
    assert.deepEqual(templateError(() => fillTemplate("{{email}}", at)).details, { variable: "email" });
    templateError(() => fillTemplate("{{time_zone:+1}}", at));
    templateError(() => fillTemplate("{{today:+32}}", at));
    templateError(() => fillTemplate("{{ }}", at));
    templateError(() => fillTemplate("open {{today", at));
  });

  test("text without variables, and JSON that ends in }}, stays as it is", () => {
    const at = values("2026-10-24T08:00:00Z", "UTC");
    assert.equal(fillTemplate('Answer as {"a":{"b":1}}', at), 'Answer as {"a":{"b":1}}');
  });
});
