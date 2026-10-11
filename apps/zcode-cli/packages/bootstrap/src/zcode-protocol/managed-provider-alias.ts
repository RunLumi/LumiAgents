import {
  zcodeProviderRegisterManagedAliasParamsSchema,
  type ZCodeProviderRegisterManagedAliasResult,
} from "@zcode/shared";
import {
  parseParams,
  ProtocolRequestError,
  type ZCodeProtocolAgentServerContext,
} from "./server-types.js";

/** 私有协议：Host 用它把显式选择的别名登记进同一个运行中的进程；不携带任何凭据或配置。 */
const MANAGED_ALIAS_UNAVAILABLE_CODE = -32018;
const MANAGED_ALIAS_REFUSED_CODE = -32031;

export async function registerManagedProviderAlias(
  context: ZCodeProtocolAgentServerContext,
  params: unknown,
): Promise<ZCodeProviderRegisterManagedAliasResult> {
  const { modelAlias } = parseParams(zcodeProviderRegisterManagedAliasParamsSchema, params);
  const register = context.deps.registerManagedProviderAlias;
  if (!register) {
    throw new ProtocolRequestError(
      MANAGED_ALIAS_UNAVAILABLE_CODE,
      "lumi_managed_provider_unconfigured",
    );
  }
  try {
    return await register(modelAlias);
  } catch {
    // Registry/source failures may contain private config; log closed codes only.
    context.logger?.warn("Lumi managed alias registration refused", {
      event: "zcode_protocol.managed_alias.refused",
      reason: "lumi_managed_alias_refused",
    });
    throw new ProtocolRequestError(MANAGED_ALIAS_REFUSED_CODE, "lumi_managed_alias_refused");
  }
}
