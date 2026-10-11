import assert from "node:assert/strict";
import test from "node:test";
import {
  MANAGED_ALIAS_REFUSED_CODE,
  MANAGED_RUNTIME_UNSUPPORTED_CODE,
  registerManagedAliasOnClient,
} from "./managedAliasRegistration.js";

function clientReplying(handler: (method: string, params: unknown) => unknown) {
  const calls: Array<{ method: string; params: unknown }> = [];
  return {
    calls,
    client: {
      async request(method: string, params: unknown, schema: { parse(input: unknown): unknown }) {
        calls.push({ method, params });
        return schema.parse(await handler(method, params));
      },
    } as never,
  };
}

test("sends only the alias on the private method and accepts a matching receipt", async () => {
  const { client, calls } = clientReplying((_method, params) => ({
    modelAlias: (params as { modelAlias: string }).modelAlias,
    status: "registered",
  }));

  await registerManagedAliasOnClient(client, "coding-tools");

  assert.deepEqual(calls, [
    { method: "provider/registerManagedAlias", params: { modelAlias: "coding-tools" } },
  ]);
});

test("method-not-found means an old runtime and fails closed", async () => {
  const { client } = clientReplying(() => {
    throw Object.assign(new Error("Method not found"), { code: -32601 });
  });

  await assert.rejects(registerManagedAliasOnClient(client, "coding-tools"), {
    message: MANAGED_RUNTIME_UNSUPPORTED_CODE,
  });
});

test("child refusal, transport error and mismatched receipt are all refusals", async () => {
  const refusing = clientReplying(() => {
    throw Object.assign(new Error("lumi_managed_alias_refused"), { code: -32031 });
  });
  await assert.rejects(registerManagedAliasOnClient(refusing.client, "coding-tools"), {
    message: MANAGED_ALIAS_REFUSED_CODE,
  });

  const mismatch = clientReplying(() => ({ modelAlias: "coding-default", status: "unchanged" }));
  await assert.rejects(registerManagedAliasOnClient(mismatch.client, "coding-tools"), {
    message: MANAGED_ALIAS_REFUSED_CODE,
  });

  const malformed = clientReplying(() => ({ modelAlias: "coding-tools" }));
  await assert.rejects(registerManagedAliasOnClient(malformed.client, "coding-tools"), {
    message: MANAGED_ALIAS_REFUSED_CODE,
  });
});
