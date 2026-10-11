import {
  LUMI_MANAGED_PROVIDER_ID,
  normalizeLumiModelAlias,
  type LumiManagedProviderConfigSource,
} from "@zcode/provider";

export interface ManagedAliasRegistration {
  readonly modelAlias: string;
  readonly status: "registered" | "unchanged";
}

export interface ManagedAliasRegistrarDeps {
  /** 进程唯一的内存 source；无受信 origin 时为 undefined（fail closed）。 */
  readonly getSource: () =>
    | Pick<LumiManagedProviderConfigSource, "getAliases" | "ensureAlias">
    | undefined;
  readonly registry: {
    refresh(reason: string): Promise<unknown>;
    getModel(providerId: string, modelId: string): unknown;
  };
}

/**
 * 把显式选择的 managed 别名登记进本进程唯一的内存 source，并刷新正式 Registry。
 * 不写磁盘、不接受 origin/凭据；发布后必须在 Registry 中找到该模型，否则拒绝
 * （例如 Built-in 未就绪时 refresh 会保留旧快照而不报错）。登记不授予任何后端权限。
 */
export function createManagedAliasRegistrar(deps: ManagedAliasRegistrarDeps) {
  return async function registerManagedAlias(input: string): Promise<ManagedAliasRegistration> {
    const source = deps.getSource();
    if (!source) throw new Error("lumi_managed_origin_unconfigured");
    const modelAlias = normalizeLumiModelAlias(input);
    const known = source.getAliases().includes(modelAlias);
    await source.ensureAlias(modelAlias);
    // 已登记也重刷：Source 去重不证明上次 refresh 成功。
    await deps.registry.refresh("lumi-managed-alias");
    if (!deps.registry.getModel(LUMI_MANAGED_PROVIDER_ID, modelAlias)) {
      throw new Error("lumi_managed_model_unavailable");
    }
    return { modelAlias, status: known ? "unchanged" : "registered" };
  };
}
