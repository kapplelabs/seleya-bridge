import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Redactor } from "./redact.ts";

describe("Redactor.text", () => {
  test("removes contact details and credentials, counting each", () => {
    const redactor = new Redactor();
    const output = redactor.text("Mail jane.doe@example.com or call +84 912 345 678. password: hunter22");
    assert.equal(output, "Mail [email] or call [phone]. password: [secret]");
    assert.equal(redactor.total, 3);
  });

  test("drops only the sensitive parameters of a link", () => {
    const redactor = new Redactor();
    assert.equal(
      redactor.text("See https://example.com/doc?id=7&token=abcdef123456."),
      "See https://example.com/doc?id=7.",
    );
    assert.equal(redactor.text("Join https://meet.google.com/abc-defg-hij"), "Join [link]");
  });

  test("keeps a display name, drops the address", () => {
    assert.equal(new Redactor().text("From: Jane Doe <jane@example.com>"), "From: Jane Doe");
  });

  test("leaves ordinary text alone", () => {
    const redactor = new Redactor();
    assert.equal(redactor.text("Meeting at 10:30, order 1234."), "Meeting at 10:30, order 1234.");
    assert.equal(redactor.total, 0);
  });
});

describe("Redactor.value", () => {
  test("redacts nested values and blanks credential fields", () => {
    const redactor = new Redactor();
    const output = redactor.value({
      from: "jane@example.com",
      items: [{ note: "card 4111 1111 1111 1111" }],
      access_token: "whatever",
      password: "",
      nextPageToken: "abc",
      count: 3,
    });
    assert.deepEqual(output, {
      from: "[email]",
      items: [{ note: "card [card]" }],
      access_token: "[secret]",
      password: "",
      nextPageToken: "abc",
      count: 3,
    });
    assert.equal(redactor.total, 3);
  });

  test("redacts keys, counting each removed value once", () => {
    const redactor = new Redactor();
    const output = redactor.value({ "jane@example.com": 4, total: 4 });
    assert.deepEqual(output, { "[email]": 4, total: 4 });
    assert.equal(redactor.total, 1);
  });

  test("keeps both values when two keys redact to the same key", () => {
    const redactor = new Redactor();
    const output = redactor.value({
      "a@example.com": 1,
      "b@example.org": 2,
      "[email]": 3,
      nested: { "c@x.io": "d@y.io" },
    });
    assert.deepEqual(output, {
      "[email]": 1,
      "[email] (2)": 2,
      "[email] (3)": 3,
      nested: { "[email]": "[email]" },
    });
    assert.equal(redactor.total, 4);
  });

  test("a credential-named key keeps its name", () => {
    const redactor = new Redactor();
    assert.deepEqual(redactor.value({ SECRET: "x", Token: null }), { SECRET: "[secret]", Token: null });
    assert.equal(redactor.total, 1);
  });

  test("a __proto__ key stays a plain field", () => {
    const output = new Redactor().value(JSON.parse('{"__proto__": {"polluted": "a@b.co"}}')) as object;
    assert.equal(Object.getPrototypeOf(output), Object.prototype);
    assert.deepEqual(Object.getOwnPropertyDescriptor(output, "__proto__")?.value, { polluted: "[email]" });
  });
});
