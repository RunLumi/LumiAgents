import { LumiAccountError, LumiAutomationLeaseError } from "@zcode/services/node";
import type { LumiDeviceRecord } from "./lumiDeviceVault.js";

type DeviceVault = {
  load(): Promise<LumiDeviceRecord | null>;
  save(value: LumiDeviceRecord): Promise<void>;
};

/** The one place a server refusal becomes persisted device state; anything else is ignored. */
export function classifyDeviceRefusal(error: unknown): "expired" | "revoked" | undefined {
  if (error instanceof LumiAccountError) {
    if (error.code === "lumi_device_revoked") return "revoked";
    if (error.code === "lumi_device_token_expired") return "expired";
  }
  if (error instanceof LumiAutomationLeaseError) {
    if (error.reason === "device_revoked") return "revoked";
    if (error.status === 401 && error.reason === "device_token_expired") return "expired";
  }
  return undefined;
}

/**
 * Persist what a refusal of the held credential proves. Returns the record now on disk, or
 * `undefined` when the error says nothing about the device. The caller holds the vault lock.
 */
export async function persistDeviceRefusal(
  vault: DeviceVault,
  error: unknown,
  held: { id: string; token: string },
): Promise<LumiDeviceRecord | null | undefined> {
  const kind = classifyDeviceRefusal(error);
  if (kind === "revoked") return markDeviceRevoked(vault, held.id);
  if (kind === "expired") return ageRefusedCredential(vault, held.token);
  return undefined;
}

/**
 * The Worker (or the local clock) says the held device token is expired. Age exactly that token
 * in the vault so the projection is `reauth_required` now and after a restart, and recovery is
 * offered. The key pair, enrollment and credential id stay for recovery; a credential another
 * owner rotated meanwhile is left alone. A revoked device never reaches this (`lumi_device_revoked`).
 * The caller holds the vault lock.
 */
export async function ageRefusedCredential(
  vault: DeviceVault,
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

/**
 * The Worker answered `device_revoked` for this device. Record that for exactly the device identity
 * the refused request used (credential id), so the projection is `revoked` now and after a restart
 * and no recovery is offered. Nothing is deleted: the identity is kept so the state stays visible
 * and nothing silently re-enrolls. The caller holds the vault lock.
 */
export async function markDeviceRevoked(
  vault: DeviceVault,
  refusedDeviceId: string,
  now = new Date(),
): Promise<LumiDeviceRecord | null> {
  const latest = await vault.load();
  if (!latest || latest.credential?.id !== refusedDeviceId || latest.revokedAt) return latest;
  const next = { ...latest, revokedAt: now.toISOString() };
  await vault.save(next);
  return next;
}

/**
 * Merge a write onto what is on disk right now, never onto this owner's possibly stale memory.
 * The key pair and enrollment of an existing record are never replaced, and a stale owner can
 * neither regress a newer credential nor erase one it never saw.
 */
export function reconcile(
  latest: LumiDeviceRecord | null,
  next: LumiDeviceRecord,
  credentialIsNew: boolean,
): LumiDeviceRecord {
  if (!latest) return next;
  if (latest.fingerprint !== next.fingerprint || latest.publicKeyPem !== next.publicKeyPem)
    throw new Error("lumi_device_conflict");
  let credential = latest.credential;
  if (next.credential) {
    if (!credential) credential = next.credential;
    else if (credential.id !== next.credential.id) throw new Error("lumi_device_conflict");
    else if (Date.parse(next.credential.tokenExpiresAt) >= Date.parse(credential.tokenExpiresAt))
      credential = next.credential;
    else if (credentialIsNew) throw new Error("lumi_device_conflict");
  }
  return { ...latest, enrollmentId: latest.enrollmentId ?? next.enrollmentId, credential };
}

/**
 * Rotate a still-valid device token this long before it expires (P03-CG: DeviceToken is
 * short-lived, 15 minutes, renewed by proof-of-possession over a server nonce). An already
 * expired token is never rotated here: that needs human-authorized recovery (FR-F19-010).
 */
export const DEVICE_TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

export function needsProactiveRefresh(
  credential: { tokenExpiresAt: string } | null | undefined,
  now = Date.now(),
): boolean {
  if (!credential) return false;
  const remaining = Date.parse(credential.tokenExpiresAt) - now;
  return Number.isFinite(remaining) && remaining > 0 && remaining <= DEVICE_TOKEN_REFRESH_MARGIN_MS;
}

type LeaseMethods = "listDue" | "claim" | "renew" | "start" | "settle" | "release";
type LeaseTransport = Record<LeaseMethods, (...args: never[]) => Promise<unknown>>;

/**
 * The lease port outlives the owner call that produced it (a poll, a long managed run's renewals),
 * so each lease request first lets the owner rotate a token that is about to expire.
 */
export function keepLeasesFresh<T extends LeaseTransport>(
  leases: T,
  ensureFresh: () => Promise<void>,
): Pick<T, LeaseMethods> {
  const wrap =
    <K extends LeaseMethods>(method: K) =>
    async (...args: Parameters<T[K]>) => {
      await ensureFresh();
      return (leases[method] as (...a: Parameters<T[K]>) => ReturnType<T[K]>)(...args);
    };
  return {
    listDue: wrap("listDue"),
    claim: wrap("claim"),
    renew: wrap("renew"),
    start: wrap("start"),
    settle: wrap("settle"),
    release: wrap("release"),
  } as unknown as Pick<T, LeaseMethods>;
}
