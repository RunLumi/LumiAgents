import {
  zcodeProtocolMethods,
  zcodeProviderRegisterManagedAliasResultSchema,
} from "@zcode/shared";
import type { ZCodeProtocolClient } from "#src/zcode-agent/zcodeProtocolClient.js";

export const MANAGED_RUNTIME_UNSUPPORTED_CODE = "lumi_managed_runtime_unsupported";
export const MANAGED_ALIAS_REFUSED_CODE = "lumi_managed_alias_refused";
const METHOD_NOT_FOUND = -32601;

/**
 * Register an already-Host-approved alias in the SAME running Agent process before
 * any session/create|resume selects it. Resolves only after the child's formal
 * Registry published the model. Method-not-found proves an old runtime; every other
 * failure is a refusal. Neither falls back to another alias, a restart or config.
 */
export async function registerManagedAliasOnClient(
  client: Pick<ZCodeProtocolClient, "request">,
  modelAlias: string,
): Promise<void> {
  try {
    const result = await client.request(
      zcodeProtocolMethods.providerRegisterManagedAlias,
      { modelAlias },
      zcodeProviderRegisterManagedAliasResultSchema,
    );
    if (result.modelAlias !== modelAlias) throw new Error(MANAGED_ALIAS_REFUSED_CODE);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === METHOD_NOT_FOUND
    ) {
      throw new Error(MANAGED_RUNTIME_UNSUPPORTED_CODE, { cause: error });
    }
    throw new Error(MANAGED_ALIAS_REFUSED_CODE, { cause: error });
  }
}
