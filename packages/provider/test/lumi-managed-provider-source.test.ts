import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelConfig,
  ModelConfigRules,
  ModelInputFormatConfig,
  ModelOptionSpecsConfig,
  ModelOutputFormatConfig,
  ModelPropertiesConfig,
  ProviderApiConfig,
  ProviderConfig,
  ProviderConfigMap,
} from "../src/config/index.js";
import { LumiManagedProviderConfigSource } from "../src/lumi-managed-provider-source.js";
import type { ProviderConfigSnapshot, ProviderSource } from "../src/sources.js";

function baseSnapshot(): ProviderConfigSnapshot {
  const providerId = "fixture-provider";
  const modelId = "fixture-model";
  const modelConfig = new ModelConfig({
    enabled: true,
    properties: new ModelPropertiesConfig({
      requiresMfjsToolSchema: false,
      contextWindow: 32_000,
      inputFormat: new ModelInputFormatConfig({
        supportsText: true,
        supportsImage: false,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: false,
      }),
      outputFormat: new ModelOutputFormatConfig({ supportsText: true }),
      supportsToolCall: true,
      supportsJsonSchemaOutput: false,
      supportsNativeWebSearch: false,
      supportsMidConversationSystem: true,
    }),
    optionSpecs: new ModelOptionSpecsConfig({
      reasoningLevel: { values: ["low"], map: '{"reasoning_effort": reasoningLevel}' },
      maxOutputTokens: { max: 4096, map: '{"max_tokens": maxOutputTokens}' },
    }),
  });
  return {
    revision: "fixture-revision",
    zcodeBuiltinRevision: "builtin-revision",
    personalRevision: "personal-revision",
    zcodeBuiltinProviders: new ProviderConfigMap([
      [
        providerId,
        new ProviderConfig({
          group: "standard-personal",
          api: new ProviderApiConfig({
            type: "openai-chat-completions",
            baseUrl: "https://fixture.example/v1",
          }),
          builtinModelIds: [modelId],
          visibility: "visible",
        }),
      ],
    ]),
    zcodeBuiltinProviderTemplates: new Map() as never,
    personalProviders: ProviderConfigMap.empty(),
    zcodeBuiltinModelRules: new ModelConfigRules([
      { type: "provider-model", providerId, modelId, config: modelConfig },
    ]),
    personalModels: ModelConfigRules.empty(),
    personalProviderOrder: [],
  } as ProviderConfigSnapshot;
}

test("a second alias joins the same in-memory source, republishes, and writes nothing", async () => {
  const base = baseSnapshot();
  const baseListeners = new Set<(reason: string) => void>();
  let baseReads = 0;
  const source: ProviderSource<ProviderConfigSnapshot> = {
    async read() {
      baseReads++;
      return base;
    },
    onDidChange(listener) {
      baseListeners.add(listener);
      return () => baseListeners.delete(listener);
    },
  };
  // Zero aliases + trusted origin: projection is the untouched base.
  const managed = new LumiManagedProviderConfigSource(source, "https://control.example");
  const reasons: string[] = [];
  managed.onDidChange((reason) => reasons.push(reason));
  assert.equal(await managed.read(), base);

  await managed.ensureAlias("coding-default");
  const first = await managed.read();
  await managed.ensureAlias("coding-tools");
  const second = await managed.read();

  assert.deepEqual(second.personalProviders.get("lumi-managed")?.personalModelIds, [
    "coding-default",
    "coding-tools",
  ]);
  assert.notEqual(first.revision, second.revision);
  assert.deepEqual(reasons, ["lumi-managed-alias", "lumi-managed-alias"]);
  // Repeating is idempotent: no new revision or notification.
  await managed.ensureAlias("coding-tools");
  assert.equal((await managed.read()).revision, second.revision);
  assert.equal(reasons.length, 2);
  // Nothing leaked into the underlying (disk-backed) source or provider order.
  assert.equal((await source.read()).personalProviders.get("lumi-managed"), undefined);
  assert.deepEqual(managed.getAliases(), ["coding-default", "coding-tools"]);
  assert.ok(baseReads > 0);
  await assert.rejects(managed.ensureAlias("lumi-managed/coding-tools"), /alias is invalid/);
  assert.deepEqual(managed.getAliases(), ["coding-default", "coding-tools"]);
});

test("managed aliases live only in the Host memory provider projection", async () => {
  const base = baseSnapshot();
  const listeners = new Set<(reason: string) => void>();
  const source: ProviderSource<ProviderConfigSnapshot> = {
    async read() {
      return base;
    },
    onDidChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const managed = new LumiManagedProviderConfigSource(source, "https://control.example");
  const changeReasons: string[] = [];
  managed.onDidChange((reason) => changeReasons.push(reason));

  assert.equal((await managed.read()).personalProviders.get("lumi-managed"), undefined);
  assert.equal(managed.getReadinessSelection(), undefined);
  await managed.ensureAlias("coding-default");
  const projected = await managed.read();
  const provider = projected.personalProviders.get("lumi-managed");
  assert.ok(provider);
  assert.equal(provider.visibility, "hidden");
  assert.equal(provider.api?.baseUrl, "https://control.example/api/v1/inference");
  assert.deepEqual(provider.personalModelIds, ["coding-default"]);
  const managedModel = projected.personalModels.resolve({
    providerId: "lumi-managed",
    modelId: "coding-default",
    apiType: provider.api?.type,
    baseUrl: provider.api?.baseUrl,
  });
  assert.deepEqual(managedModel.optionSpecs.reasoningLevel.values, ["default"]);
  assert.equal(managedModel.optionSpecs.reasoningLevel.map, "{}");
  assert.equal(managedModel.optionSpecs.maxOutputTokens.map, '{"max_tokens": maxOutputTokens}');
  assert.equal(managedModel.optionSpecs.maxOutputTokens.max, 4096);
  assert.deepEqual(managed.getReadinessSelection(), {
    providerId: "lumi-managed",
    modelId: "coding-default",
  });
  assert.equal(changeReasons.includes("lumi-managed-alias"), true);
  assert.equal((await source.read()).personalProviders.get("lumi-managed"), undefined);
  assert.equal(JSON.stringify(projected).includes("runtime-session-token"), false);
});
