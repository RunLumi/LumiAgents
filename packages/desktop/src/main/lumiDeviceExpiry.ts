import type { LumiDeviceRecord } from "./lumiDeviceVault.js";

/**
 * The Worker (or the local clock) says the held device token is expired. Age exactly that token
 * in the vault so the projection is `reauth_required` now and after a restart, and recovery is
 * offered. The key pair, enrollment and credential id stay for recovery; a credential another
 * owner rotated meanwhile is left alone. A revoked device never reaches this (`lumi_device_revoked`).
 * The caller holds the vault lock.
 */
export async function ageRefusedCredential(
  vault: {
    load(): Promise<LumiDeviceRecord | null>;
    save(value: LumiDeviceRecord): Promise<void>;
  },
  refusedToken: string,
  now = new Date(),
): Promise<LumiDeviceRecord | null> {
  const latest = await vault.load();
  const held = latest?.credential;
  if (!latest || !held || held.token !== refusedToken) return latest;
  if (Date.parse(held.tokenExpiresAt) <= now.getTime()) return latest;
  const next = { ...latest, credential: { ...held, tokenExpiresAt: now.toISOString() } };
  await vault.save(next);
  return next;
}
