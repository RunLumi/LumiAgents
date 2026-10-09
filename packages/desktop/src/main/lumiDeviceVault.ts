/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { createPrivateKey, createPublicKey, createHash } from "node:crypto";
import { createLumiPrivateVault, type LumiVaultEncryption } from "./lumiPrivateVault.js";
import type { LumiDeviceCredential } from "@zcode/services/node";
export interface LumiDeviceRecord {
  version: 1;
  origin: string;
  orgId: string;
  userId: string;
  orgSlug: string;
  privateKeyPem: string;
  publicKeyPem: string;
  fingerprint: string;
  enrollmentId: string | null;
  approvalKey: string;
  credential: LumiDeviceCredential | null;
}
export function createLumiDeviceVault(options: {
  directory: string;
  origin: string;
  orgId: string;
  userId: string;
  encryption: LumiVaultEncryption;
  platform?: NodeJS.Platform;
}) {
  const origin = new URL(options.origin).origin;
  if (!/^org_[0-9a-f]{32}$/.test(options.orgId)) throw new Error("lumi_device_invalid");
  function validate(value: unknown): LumiDeviceRecord {
    if (!value || typeof value !== "object") throw new Error("lumi_device_invalid");
    const row = value as LumiDeviceRecord;
    if (
      Object.keys(row).sort().join(",") !==
        "approvalKey,credential,enrollmentId,fingerprint,orgId,orgSlug,origin,privateKeyPem,publicKeyPem,userId,version" ||
      row.version !== 1 ||
      row.origin !== origin ||
      row.orgId !== options.orgId ||
      row.userId !== options.userId ||
      !/^usr_[0-9a-f]{32}$/.test(row.userId) ||
      typeof row.orgSlug !== "string" ||
      !/^[a-z0-9-]{3,63}$/.test(row.orgSlug) ||
      typeof row.privateKeyPem !== "string" ||
      row.privateKeyPem.length > 1024 ||
      typeof row.publicKeyPem !== "string" ||
      row.publicKeyPem.length > 1024 ||
      typeof row.approvalKey !== "string" ||
      row.approvalKey.length > 128
    )
      throw new Error("lumi_device_invalid");
    const key = createPrivateKey(row.privateKeyPem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("lumi_device_invalid");
    const pub = createPublicKey(key);
    if (
      pub.export({ type: "spki", format: "pem" }).toString() !== row.publicKeyPem ||
      createHash("sha256")
        .update(pub.export({ type: "spki", format: "der" }))
        .digest("hex") !== row.fingerprint
    )
      throw new Error("lumi_device_invalid");
    if (row.enrollmentId !== null && !/^enr_[0-9a-f]{32}$/.test(row.enrollmentId))
      throw new Error("lumi_device_invalid");
    if (row.credential) {
      const c = row.credential;
      if (
        c.orgId !== row.orgId ||
        !/^dvc_[0-9a-f]{32}$/.test(c.id) ||
        !Number.isFinite(Date.parse(c.tokenExpiresAt)) ||
        !Number.isSafeInteger(c.policyVersion) ||
        !/^[0-9a-f]{64}$/.test(c.token)
      )
        throw new Error("lumi_device_invalid");
    }
    return row;
  }
  return createLumiPrivateVault<LumiDeviceRecord>({
    ...options,
    identity: `${origin}:${options.orgId}:${options.userId}`,
    namespace: "device",
    validate,
  });
}
