/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { createLumiPrivateVault, type LumiVaultEncryption } from "./lumiPrivateVault.js";
export interface LumiSessionRecord {
  version: 1;
  origin: string;
  session: string;
  csrf: string;
  expiresAt: string;
}
export function createLumiSessionVault(options: {
  directory: string;
  origin: string;
  encryption: LumiVaultEncryption;
  platform?: NodeJS.Platform;
}) {
  const origin = new URL(options.origin).origin;
  function validate(value: unknown): LumiSessionRecord {
    if (!value || typeof value !== "object") throw new Error("lumi_session_invalid");
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).sort().join(",") !== "csrf,expiresAt,origin,session,version" ||
      row.version !== 1 ||
      row.origin !== origin ||
      typeof row.session !== "string" ||
      !/^[0-9a-f]{64}$/.test(row.session) ||
      typeof row.csrf !== "string" ||
      !/^[0-9a-f]{64}$/.test(row.csrf) ||
      typeof row.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(row.expiresAt))
    )
      throw new Error("lumi_session_invalid");
    return value as LumiSessionRecord;
  }
  const vault = createLumiPrivateVault<LumiSessionRecord>({
    ...options,
    identity: origin,
    namespace: "session",
    validate,
  });
  return {
    ...vault,
    async load() {
      const row = await vault.load();
      return row && Date.parse(row.expiresAt) > Date.now() ? row : null;
    },
  };
}
