import assert from "node:assert/strict";
import test from "node:test";
import { parseManagedProviderAliases } from "../src/app/process-provider-registry-runtime.js";

test("managed provider bootstrap accepts only a bounded JSON string list", () => {
  assert.deepEqual(parseManagedProviderAliases(undefined), []);
  assert.deepEqual(parseManagedProviderAliases("[]"), []);
  assert.deepEqual(parseManagedProviderAliases(' ["coding-default","coding-default"] '), [
    "coding-default",
  ]);
  assert.throws(() => parseManagedProviderAliases("not-json"), /invalid JSON/);
  assert.throws(() => parseManagedProviderAliases("{}"), /invalid shape/);
  assert.throws(() => parseManagedProviderAliases("[1]"), /must be strings/);
});
