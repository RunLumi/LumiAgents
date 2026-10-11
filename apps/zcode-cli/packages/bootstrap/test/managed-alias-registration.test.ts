import assert from "node:assert/strict";
import test from "node:test";
import { createManagedAliasRegistrar } from "../src/app/managed-alias-registrar.js";
import { registerManagedProviderAlias } from "../src/zcode-protocol/managed-provider-alias.js";
import type { ZCodeProtocolAgentServerContext } from "../src/zcode-protocol/server-types.js";

/** Fake of the single in-memory source + formal Registry; records ordering and publishes on refresh. */
function createFixture(options: { publishOnRefresh?: boolean; startAliases?: string[] } = {}) {
  const aliases = new Set(options.startAliases ?? []);
  const published = new Set(aliases);
  const events: string[] = [];
  const source = {
    getAliases: () => [...aliases].sort(),
    async ensureAlias(alias: string) {
      events.push(`ensure:${alias}`);
      aliases.add(alias);
    },
  };
  const registry = {
    async refresh(reason: string) {
      events.push(`refresh:${reason}`);
      if (options.publishOnRefresh !== false) for (const alias of aliases) published.add(alias);
    },
    getModel: (providerId: string, modelId: string) =>
      providerId === "lumi-managed" && published.has(modelId) ? { modelId } : undefined,
  };
  return { source, registry, events, aliases };
}

test("second alias registers into the same running process after the first", async () => {
  const fixture = createFixture({ startAliases: ["coding-default"] });
  const register = createManagedAliasRegistrar({
    getSource: () => fixture.source,
    registry: fixture.registry,
  });

  const result = await register("coding-tools");

  assert.deepEqual(result, { modelAlias: "coding-tools", status: "registered" });
  assert.deepEqual(fixture.source.getAliases(), ["coding-default", "coding-tools"]);
  // 登记先于刷新、刷新先于成功回执：session/create 只能在回执之后选择它。
  assert.deepEqual(fixture.events, ["ensure:coding-tools", "refresh:lumi-managed-alias"]);
});

test("a process started with zero aliases but a trusted origin accepts the first alias", async () => {
  const fixture = createFixture();
  const register = createManagedAliasRegistrar({
    getSource: () => fixture.source,
    registry: fixture.registry,
  });

  assert.deepEqual(await register("coding-default"), {
    modelAlias: "coding-default",
    status: "registered",
  });
});

test("repeating an alias is unchanged but still refreshes the Registry", async () => {
  const fixture = createFixture({ startAliases: ["coding-default"] });
  const register = createManagedAliasRegistrar({
    getSource: () => fixture.source,
    registry: fixture.registry,
  });

  assert.equal((await register("coding-default")).status, "unchanged");
  assert.deepEqual(fixture.events, ["ensure:coding-default", "refresh:lumi-managed-alias"]);
});

test("missing trusted origin/source fails closed before any refresh", async () => {
  const fixture = createFixture();
  const register = createManagedAliasRegistrar({
    getSource: () => undefined,
    registry: fixture.registry,
  });

  await assert.rejects(register("coding-default"), /lumi_managed_origin_unconfigured/);
  assert.deepEqual(fixture.events, []);
});

test("invalid aliases are refused without touching the source", async () => {
  const fixture = createFixture();
  const register = createManagedAliasRegistrar({
    getSource: () => fixture.source,
    registry: fixture.registry,
  });

  for (const alias of ["", "Upper", "../x", "lumi-managed/coding-tools", "a b", "a".repeat(129)]) {
    await assert.rejects(register(alias), /alias is invalid/, alias);
  }
  assert.deepEqual(fixture.events, []);
  assert.deepEqual(fixture.source.getAliases(), []);
});

test("a refresh that publishes no model is a refusal, not success", async () => {
  const fixture = createFixture({ publishOnRefresh: false });
  const register = createManagedAliasRegistrar({
    getSource: () => fixture.source,
    registry: fixture.registry,
  });

  await assert.rejects(register("coding-tools"), /lumi_managed_model_unavailable/);
});

function contextWith(
  register: ZCodeProtocolAgentServerContext["deps"]["registerManagedProviderAlias"],
  warnings: unknown[] = [],
): ZCodeProtocolAgentServerContext {
  return {
    deps: { registerManagedProviderAlias: register },
    logger: { warn: (...args: unknown[]) => warnings.push(args) },
  } as unknown as ZCodeProtocolAgentServerContext;
}

test("protocol handler accepts exactly {modelAlias} and rejects extra fields", async () => {
  const seen: string[] = [];
  const context = contextWith(async (alias) => {
    seen.push(alias);
    return { modelAlias: alias, status: "registered" };
  });

  assert.deepEqual(await registerManagedProviderAlias(context, { modelAlias: "coding-tools" }), {
    modelAlias: "coding-tools",
    status: "registered",
  });
  for (const params of [
    { modelAlias: "coding-tools", origin: "https://evil.example" },
    { modelAlias: "coding-tools", apiKey: "secret" },
    { modelAlias: "coding-tools", headers: {} },
    { modelAlias: "Bad Alias" },
    {},
    null,
  ]) {
    await assert.rejects(registerManagedProviderAlias(context, params), { code: -32602 });
  }
  assert.deepEqual(seen, ["coding-tools"]);
});

test("protocol handler without a registrar is unconfigured and leaks no detail on refusal", async () => {
  await assert.rejects(
    registerManagedProviderAlias(contextWith(undefined), { modelAlias: "coding-tools" }),
    { code: -32018, message: "lumi_managed_provider_unconfigured" },
  );

  const warnings: unknown[] = [];
  const refusing = contextWith(async () => {
    throw new Error("https://internal.example/secret-detail");
  }, warnings);
  await assert.rejects(registerManagedProviderAlias(refusing, { modelAlias: "coding-tools" }), {
    code: -32031,
    message: "lumi_managed_alias_refused",
  });
  assert.equal(warnings.length, 1);
  assert.equal(JSON.stringify(warnings).includes("internal.example"), false);
  assert.equal(JSON.stringify(warnings).includes("secret-detail"), false);
  assert.equal(JSON.stringify(warnings).includes("lumi_managed_alias_refused"), true);
});
