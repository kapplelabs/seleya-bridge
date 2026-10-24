import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { nextOccurrence, previousOccurrence, type Timing } from "./timing.ts";

const weekdays: Timing = { kind: "weekly", days: ["Mon", "Tue", "Wed", "Thu", "Fri"], time: "08:00" };
const iso = (date: Date | undefined) => date?.toISOString();

describe("timing", () => {
  test("weekly in the schedule's time zone", () => {
    // Friday 2026-10-23 09:00 in Ho Chi Minh City (UTC+7): next is Monday 08:00 local.
    const at = new Date("2026-10-23T02:00:00Z");
    assert.equal(iso(nextOccurrence(weekdays, "Asia/Ho_Chi_Minh", at)), "2026-10-26T01:00:00.000Z");
    assert.equal(iso(previousOccurrence(weekdays, "Asia/Ho_Chi_Minh", at)), "2026-10-23T01:00:00.000Z");
  });

  test("next is strictly after, previous includes the moment itself", () => {
    const at = new Date("2026-10-23T01:00:00Z");
    assert.equal(iso(previousOccurrence(weekdays, "Asia/Ho_Chi_Minh", at)), "2026-10-23T01:00:00.000Z");
    assert.equal(iso(nextOccurrence(weekdays, "Asia/Ho_Chi_Minh", at)), "2026-10-26T01:00:00.000Z");
  });

  test("interval between from and to, with the minimum interval", () => {
    const timing: Timing = { kind: "interval", days: ["Sat"], from: "08:00", to: "11:00", every_minutes: 90 };
    const at = new Date("2026-10-24T08:30:00Z");
    assert.equal(iso(nextOccurrence(timing, "UTC", at)), "2026-10-24T09:30:00.000Z");
    // The last slot may fall on `to` itself.
    assert.equal(iso(nextOccurrence(timing, "UTC", new Date("2026-10-24T09:30:00Z"))), "2026-10-24T11:00:00.000Z");
    assert.equal(iso(nextOccurrence(timing, "UTC", new Date("2026-10-24T11:00:00Z"))), "2026-10-31T08:00:00.000Z");
    // Every 15 minutes asked, 60 allowed.
    const fast: Timing = { ...timing, every_minutes: 15 };
    assert.equal(iso(nextOccurrence(fast, "UTC", at, 60)), "2026-10-24T09:00:00.000Z");
  });

  test("a time that happens twice fires the first time", () => {
    // Europe/Berlin: 2026-10-25 03:00 CEST becomes 02:00 CET, so 02:30 happens twice.
    const timing: Timing = { kind: "weekly", days: ["Sun"], time: "02:30" };
    const next = nextOccurrence(timing, "Europe/Berlin", new Date("2026-10-24T12:00:00Z"));
    assert.equal(iso(next), "2026-10-25T00:30:00.000Z");
  });

  test("a time that doesn't exist moves forward by the jump", () => {
    // Europe/Berlin: 2027-03-28 02:00 CET jumps to 03:00 CEST; 02:30 becomes 03:30 CEST.
    const timing: Timing = { kind: "weekly", days: ["Sun"], time: "02:30" };
    const next = nextOccurrence(timing, "Europe/Berlin", new Date("2027-03-27T12:00:00Z"));
    assert.equal(iso(next), "2027-03-28T01:30:00.000Z");
  });
});
