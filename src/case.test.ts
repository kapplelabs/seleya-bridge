import assert from "node:assert/strict";
import { test } from "node:test";

import { keysToSnakeCase, verbatim } from "./case.ts";

test("keys become snake_case, verbatim data keeps its keys", () => {
  const body = { runId: "r1", output: verbatim({ dueDate: "Fri", items: [{ threadId: "a" }] }) };
  assert.equal(
    JSON.stringify(keysToSnakeCase(body)),
    JSON.stringify({ run_id: "r1", output: { dueDate: "Fri", items: [{ threadId: "a" }] } }),
  );
});

test("undefined fields are dropped", () => {
  assert.deepEqual(keysToSnakeCase({ aB: undefined, cD: 1 }), { c_d: 1 });
});
