import assert from "node:assert/strict";
import { test } from "node:test";

import { estimate } from "../../src/generation/runs/estimate.ts";

const min = 60_000;

test("at the start the estimate is the usual range; with no history it is the typical one", () => {
  assert.deepEqual(
    estimate({
      history: [],
      typicalMs: [3 * min, 5 * min],
      elapsedMs: 0,
      doneSteps: 0,
      plannedSteps: 5,
    }),
    { basis: "typical", remainingMs: [3 * min, 5 * min] },
  );
  const fromHistory = estimate({
    history: [4 * min, 5 * min, 6 * min, 7 * min],
    typicalMs: [1 * min, 2 * min],
    elapsedMs: 0,
    doneSteps: 0,
    plannedSteps: 5,
  });
  assert.equal(fromHistory.basis, "history");
  assert.deepEqual(fromHistory.remainingMs, [5 * min, 7 * min]);
});

test("each finished step moves the estimate toward the run's own pace", () => {
  const usual = { history: [], typicalMs: [3 * min, 5 * min] as [number, number], plannedSteps: 4 };
  // Running slow: 2 of 4 steps took 4 min, so the pace says 8 min in total.
  const half = estimate({ ...usual, elapsedMs: 4 * min, doneSteps: 2 });
  assert.ok(
    half.remainingMs[0] > 0.5 * min,
    "not 'almost done' just because the typical time passed",
  );
  const later = estimate({ ...usual, elapsedMs: 6 * min, doneSteps: 3 });
  assert.ok(later.remainingMs[1] < half.remainingMs[1], "the range shrinks as steps finish");
  assert.ok(later.remainingMs[0] >= 15_000, "a run with a step left never reads as zero");
});

test("a run far past its usual time with steps left still shows time left per step", () => {
  const late = estimate({
    history: [],
    typicalMs: [1 * min, 2 * min],
    elapsedMs: 10 * min,
    doneSteps: 1,
    plannedSteps: 3,
  });
  assert.ok(late.remainingMs[0] >= 2 * 15_000, `got ${late.remainingMs}`);
  assert.ok(late.remainingMs[1] >= late.remainingMs[0]);
});

test("when every step is done the estimate is zero", () => {
  assert.deepEqual(
    estimate({
      history: [],
      typicalMs: [1 * min, 2 * min],
      elapsedMs: 3 * min,
      doneSteps: 4,
      plannedSteps: 4,
    }).remainingMs,
    [0, 0],
  );
});
