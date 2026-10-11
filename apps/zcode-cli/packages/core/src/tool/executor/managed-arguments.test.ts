/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createManagedArgumentsSummary } from "./managed-tool-identity.js";

test("managed summary does not export paths, commands, arbitrary names or strings", () => {
  const summary = createManagedArgumentsSummary({
    path: "/Users/fixture/private-folder/private-file.txt",
    command: "echo PRIVATE_SENTINEL",
    content: "PRIVATE_BODY_SENTINEL",
    privateFieldNameSentinel: "PRIVATE_VALUE_SENTINEL",
    nested: { url: "https://user:password@example.test/private?q=secret" },
  });
  for (const value of [
    "/Users/fixture",
    "PRIVATE_",
    "privateFieldNameSentinel",
    "example.test",
    "password",
  ])
    assert.equal(summary.includes(value), false, value);
  assert.match(summary, /(?:^|;)input_digest=[0-9a-f]{64}(?:;|$)/);
  assert(summary.length <= 512 && /^[\x20-\x7e]+$/.test(summary));
});

test("summary binds nested input, long tails, arrays and fields beyond a display bound", () => {
  const variants = [
    [{ nested: { path: "one" } }, { nested: { path: "two" } }],
    [{ content: "a".repeat(1000) + "one" }, { content: "a".repeat(1000) + "two" }],
    [{ values: [1, 2] }, { values: [2, 1] }],
    [
      Object.fromEntries(Array.from({ length: 40 }, (_, i) => ["f" + i, i])),
      Object.fromEntries(Array.from({ length: 40 }, (_, i) => ["f" + i, i === 39 ? 99 : i])),
    ],
    [{ operation: "unknown-one" }, { operation: "unknown-two" }],
    [{ value: null }, {}],
  ];
  for (const [left, right] of variants)
    assert.notEqual(createManagedArgumentsSummary(left), createManagedArgumentsSummary(right));
  assert.equal(
    createManagedArgumentsSummary({ b: 2, a: 1 }),
    createManagedArgumentsSummary({ a: 1, b: 2 }),
  );
  const expected = createHash("sha256").update('{"a":[1,2,3],"b":{"x":true}}').digest("hex");
  assert.match(
    createManagedArgumentsSummary({ b: { x: true }, a: [1, 2, 3] }),
    new RegExp(`input_digest=${expected}`),
  );
});

test("only closed action vocabulary is displayable and summary stays server-canonical", () => {
  const summary = createManagedArgumentsSummary({
    operation: "write",
    action: "delete",
    path: "hidden",
  });
  assert.match(summary, /action=delete/);
  assert.match(summary, /operation=write/);
  const parts = summary.split(";");
  assert.deepEqual(parts, [...parts].sort());
  assert.equal(new Set(parts.map((part) => part.split("=")[0])).size, parts.length);
});

test("non-JSON, cyclic, excessive-depth and oversized input fails closed", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  let deep: unknown = null;
  for (let i = 0; i < 70; i++) deep = { nested: deep };
  for (const value of [
    undefined,
    NaN,
    Infinity,
    1n,
    new Date(),
    { value: undefined },
    { value: () => {} },
    cycle,
    deep,
    { content: "x".repeat(262145) },
  ])
    assert.throws(() => createManagedArgumentsSummary(value), /managed_arguments_invalid/);
});

test("hashing does not invoke input getters and rejects non-JSON array/object shapes", () => {
  let getterCalls = 0;
  const getter = Object.defineProperty({}, "operation", {
    enumerable: true,
    get() {
      getterCalls++;
      return "write";
    },
  });
  const hidden = Object.defineProperty({}, "hidden", { enumerable: false, value: "private" });
  class CustomArray extends Array<number> {}
  for (const value of [
    getter,
    hidden,
    Array(3),
    { [Symbol("hidden")]: "private" },
    new CustomArray(1, 2),
  ])
    assert.throws(() => createManagedArgumentsSummary(value), /managed_arguments_invalid/);
  assert.equal(getterCalls, 0);
});
