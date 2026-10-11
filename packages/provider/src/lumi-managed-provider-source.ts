/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import {
  ApiKeyAccessConfig,
  ModelConfig,
  ModelConfigRules,
  ModelOptionSpecsConfig,
  ProviderApiConfig,
  ProviderConfig,
  createRegistryModelConfig,
  type ProviderSource,
} from "@zcode/provider";
import {
  LUMI_MANAGED_PROVIDER_ID,
  LUMI_MANAGED_PROVIDER_KIND,
  createLumiManagedInferenceBaseUrl,
  normalizeLumiModelAlias,
} from "./lumi-managed-inference.js";
import type { ProviderConfigSnapshot } from "./sources.js";

const MAX_MANAGED_ALIASES = 100;
const MANAGED_API_KEY_MARKER = "lumi-managed-request-auth-required";
export const LUMI_MANAGED_PROVIDER_ALIASES_ENV = "LUMI_MANAGED_PROVIDER_ALIASES";
export const LUMI_MANAGED_PROVIDER_ORIGIN_ENV = "LUMI_MANAGED_PROVIDER_ORIGIN";

/** Host-local, in-memory overlay. It never writes a provider or alias to user config. */
export class LumiManagedProviderConfigSource implements ProviderSource<ProviderConfigSnapshot> {
  readonly #source: ProviderSource<ProviderConfigSnapshot>;
  readonly #baseUrl: string;
  readonly #aliases = new Set<string>();
  readonly #listeners = new Set<(reason: string) => void>();
  #revision = 0;

  constructor(source: ProviderSource<ProviderConfigSnapshot>, controlPlaneOrigin: string) {
    this.#source = source;
    this.#baseUrl = createLumiManagedInferenceBaseUrl(controlPlaneOrigin);
  }

  onDidChange(listener: (reason: string) => void): () => void {
    const disposeSource = this.#source.onDidChange((reason) => listener(`source:${reason}`));
    this.#listeners.add(listener);
    return () => {
      disposeSource();
      this.#listeners.delete(listener);
    };
  }

  /** Runtime startup may accept this explicitly selected hidden model without exposing it in menus. */
  getReadinessSelection():
    | { providerId: typeof LUMI_MANAGED_PROVIDER_ID; modelId: string }
    | undefined {
    const modelId = [...this.#aliases].at(-1);
    return modelId ? { providerId: LUMI_MANAGED_PROVIDER_ID, modelId } : undefined;
  }

  /** Current aliases are safe to pass to a newly spawned local Agent process. */
  getAliases(): readonly string[] {
    return Object.freeze([...this.#aliases].sort());
  }

  async read(): Promise<ProviderConfigSnapshot> {
    const base = await this.#source.read();
    if (base.zcodeBuiltinProviders.has(LUMI_MANAGED_PROVIDER_ID))
      throw new Error("lumi_managed_provider_reserved");
    if (base.personalProviders.has(LUMI_MANAGED_PROVIDER_ID))
      throw new Error("lumi_managed_provider_conflict");
    if (this.#aliases.size === 0) return base;

    const aliases = [...this.#aliases].sort();
    const config = new ProviderConfig({
      group: "standard-personal",
      access: new ApiKeyAccessConfig({ apiKey: MANAGED_API_KEY_MARKER }),
      api: new ProviderApiConfig({
        type:
          LUMI_MANAGED_PROVIDER_KIND === "openai-compatible"
            ? "openai-chat-completions"
            : undefined,
        baseUrl: this.#baseUrl,
      }),
      personalModelIds: aliases,
      visibility: "hidden",
    });
    const modelTemplate = findExecutableModelTemplate(base);
    const personalModels = new ModelConfigRules([
      ...base.personalModels
        .rules()
        .filter((rule) => !("providerId" in rule) || rule.providerId !== LUMI_MANAGED_PROVIDER_ID),
      ...aliases.map((modelId) => ({
        type: "provider-model" as const,
        providerId: LUMI_MANAGED_PROVIDER_ID,
        modelId,
        config: new ModelConfig({
          enabled: true,
          properties: modelTemplate.properties,
          // Lumi's Chat Completions contract accepts max_tokens but has no
          // provider-specific reasoning_effort field. Do not inherit an
          // unrelated provider's request-body mapping.
          optionSpecs: new ModelOptionSpecsConfig({
            reasoningLevel: { values: ["default"], map: "{}" },
            maxOutputTokens: {
              // The first end-to-end path is deliberately bounded to a modest
              // completion size; P04 still enforces the selected route's own cap.
              max: Math.min(modelTemplate.optionSpecs?.maxOutputTokens?.max ?? 4096, 4096),
              map: '{"max_tokens": maxOutputTokens}',
            },
          }),
        }),
      })),
    ]);
    const personalProviders = base.personalProviders.setRule({
      providerId: LUMI_MANAGED_PROVIDER_ID,
      providerName: "Lumi managed",
      enabled: true,
      config,
    });
    const personalProviderOrder = [...(base.personalProviderOrder ?? []), LUMI_MANAGED_PROVIDER_ID];
    return Object.freeze({
      ...base,
      revision: `${base.revision}:lumi-managed:${this.#revision}:${aliases.join(",")}`,
      personalProviders,
      personalModels,
      personalProviderOrder,
    });
  }

  async ensureAlias(input: string): Promise<void> {
    this.registerAlias(input);
  }

  registerAlias(input: string): void {
    const alias = normalizeLumiModelAlias(input);
    if (this.#aliases.has(alias)) return;
    if (this.#aliases.size >= MAX_MANAGED_ALIASES) throw new Error("lumi_managed_alias_limit");
    this.#aliases.add(alias);
    this.#revision++;
    for (const listener of this.#listeners) listener("lumi-managed-alias");
  }
}

function findExecutableModelTemplate(snapshot: ProviderConfigSnapshot) {
  for (const [providerId, provider] of snapshot.zcodeBuiltinProviders.entries()) {
    for (const modelId of provider.builtinModelIds ?? []) {
      const config = snapshot.zcodeBuiltinModelRules.resolve({
        providerId,
        modelId,
        apiType: provider.api?.type,
        baseUrl: provider.api?.baseUrl,
      });
      if (createRegistryModelConfig(config).ok) return config;
    }
  }
  throw new Error("lumi_managed_model_template_unavailable");
}
