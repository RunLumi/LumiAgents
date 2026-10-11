import {
  ProviderRegistryService,
  MutableAccountProviderConfigSource,
  createFailClosedAccountProviderConfigSnapshot,
  type AccountProviderConfigSnapshot,
  type ProviderConfigSnapshot,
  type ProviderSource,
} from "@zcode/provider";
import {
  NodeProviderConfigRuntime,
  type NodeProviderConfigRuntimeOptions,
} from "./provider-config-runtime.js";

export interface NodeProviderRegistryRuntimeOptions extends NodeProviderConfigRuntimeOptions {
  readonly accountSource?: ProviderSource<AccountProviderConfigSnapshot>;
  readonly registryConfigSourceFactory?: (
    configSource: NodeProviderConfigRuntime["configService"],
  ) => ProviderSource<ProviderConfigSnapshot>;
  readonly createAccountSource?: (
    configSource: ProviderSource<ProviderConfigSnapshot>,
  ) => ProviderSource<AccountProviderConfigSnapshot>;
}

/** 一个 Node.js 进程内共享的 Config + Registry 生命周期。 */
export class NodeProviderRegistryRuntime {
  readonly configService: NodeProviderConfigRuntime["configService"];
  readonly registryService: ProviderRegistryService;
  readonly #configRuntime: NodeProviderConfigRuntime;
  readonly #registryConfigSource: ProviderSource<ProviderConfigSnapshot>;
  readonly #accountSource: ProviderSource<AccountProviderConfigSnapshot>;
  #disposed = false;

  constructor(options: NodeProviderRegistryRuntimeOptions) {
    this.#configRuntime = new NodeProviderConfigRuntime(options);
    this.configService = this.#configRuntime.configService;
    this.#registryConfigSource =
      options.registryConfigSourceFactory?.(this.configService) ?? this.configService;
    this.#accountSource =
      options.createAccountSource?.(this.#registryConfigSource) ??
      options.accountSource ??
      new MutableAccountProviderConfigSource();
    this.registryService = new ProviderRegistryService({
      configSource: this.#registryConfigSource,
      accountSource: this.#accountSource,
    });
  }

  async start(): Promise<void> {
    this.#assertNotDisposed();
    await this.#configRuntime.start();
    if (this.#accountSource instanceof MutableAccountProviderConfigSource) {
      const account = await this.#accountSource.read();
      if (account.basedOnZCodeBuiltinRevision === "uninitialized") {
        this.#accountSource.replace(
          createFailClosedAccountProviderConfigSnapshot(await this.#registryConfigSource.read()),
          "initial-fail-closed",
        );
      }
    }
    return this.registryService.start();
  }

  get personalRepository(): NodeProviderConfigRuntime["personalRepository"] {
    return this.#configRuntime.personalRepository;
  }

  onDidCheckZCodeBuiltin(listener: () => Promise<void>): () => void {
    return this.#configRuntime.onDidCheckZCodeBuiltin(listener);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.registryService.dispose();
    this.#configRuntime.dispose();
  }

  #assertNotDisposed(): void {
    if (this.#disposed) throw new Error("NodeProviderRegistryRuntime 已 dispose");
  }
}

export function createNodeProviderRegistryRuntime(
  options: NodeProviderRegistryRuntimeOptions,
): NodeProviderRegistryRuntime {
  return new NodeProviderRegistryRuntime(options);
}
