/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { generateKeyPairSync, createHash, randomUUID, sign, createPrivateKey } from "node:crypto";
import { LumiDeviceHostTransport, type LumiAccountHostTransport } from "@zcode/services/node";
import type { LumiDeviceRecord } from "./lumiDeviceVault.js";
import type { LumiSessionGuard } from "./lumiSessionFence.js";
interface Vault {
  load(): Promise<LumiDeviceRecord | null>;
  save(value: LumiDeviceRecord): Promise<void>;
}

/**
 * One write queue per vault identity, shared by every owner instance. Sign-out discards the owner
 * cache, so an operation that outlives it and the owner built after the next sign-in would
 * otherwise read-modify-write the same file concurrently.
 */
const vaultQueues = new Map<string, Promise<unknown>>();
function withVaultLock<T>(identity: string, work: () => Promise<T>): Promise<T> {
  const next = (vaultQueues.get(identity) ?? Promise.resolve()).then(work);
  const tail = next.then(
    () => undefined,
    () => undefined,
  );
  vaultQueues.set(identity, tail);
  void tail.then(() => {
    if (vaultQueues.get(identity) === tail) vaultQueues.delete(identity);
  });
  return next;
}

/**
 * Merge a write onto what is on disk right now, never onto this owner's possibly stale memory.
 * The key pair and enrollment of an existing record are never replaced, and a stale owner can
 * neither regress a newer credential nor erase one it never saw.
 */
function reconcile(
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

/** One serialized main owner per origin/org. No renderer key/token access. */
export function createLumiDeviceOwner(options: {
  origin: string;
  orgId: string;
  userId: string;
  account: LumiAccountHostTransport;
  vault: Vault;
  appVersion: string;
  /** Test seam; production uses the global fetch. */
  fetch?: typeof fetch;
}) {
  let record: LumiDeviceRecord | null = null;
  let loaded = false;
  let queue: Promise<void> = Promise.resolve();
  /** The session guard of the command that currently holds the queue (commands never overlap). */
  let activeGuard: LumiSessionGuard | undefined;
  const lockIdentity = `${new URL(options.origin).origin}|${options.orgId}|${options.userId}`;
  const check = () => activeGuard?.();

  /** Write the record onto the current vault state and adopt the merged result. */
  function commit(next: LumiDeviceRecord, credentialIsNew = false): Promise<LumiDeviceRecord> {
    return withVaultLock(lockIdentity, async () => {
      const merged = reconcile(await options.vault.load(), next, credentialIsNew);
      // Another owner already moved the credential on: this one is stale, so it must neither
      // continue from its own copy nor adopt the other's silently. A fresh command re-reads.
      if (!credentialIsNew && merged.credential?.token !== (next.credential?.token ?? undefined))
        throw new Error("lumi_device_conflict");
      await options.vault.save(merged);
      record = merged;
      return merged;
    });
  }

  const device = new LumiDeviceHostTransport(options.origin, options.fetch ?? fetch, {
    async load() {
      return record?.credential ?? null;
    },
    // A credential the server already issued is persisted even if the session just changed: the
    // vault is this org and user's own, dropping it would orphan an enrolled or rotated device.
    // The command's remaining steps and its projection are still refused by the guard.
    async save(credential) {
      if (!record) throw new Error("lumi_device_missing");
      await commit({ ...record, credential }, true);
    },
  });
  async function load() {
    if (loaded) return;
    record = await options.vault.load();
    await device.restore();
    loaded = true;
  }
  function serialized<T>(work: () => Promise<T>, guard?: LumiSessionGuard): Promise<T> {
    const next = queue.then(async () => {
      activeGuard = guard;
      try {
        check();
        return await work();
      } finally {
        activeGuard = undefined;
      }
    });
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  function projection() {
    if (!record) return { status: "not_enrolled" as const, orgId: options.orgId };
    if (!record.credential)
      return {
        status: "pending" as const,
        orgId: options.orgId,
        enrollmentId: record.enrollmentId,
      };
    return {
      status:
        Date.parse(record.credential.tokenExpiresAt) > Date.now()
          ? ("active" as const)
          : ("reauth_required" as const),
      orgId: options.orgId,
      device: device.projection(),
    };
  }
  return {
    read: (guard?: LumiSessionGuard) =>
      serialized(async () => {
        await load();
        check();
        return projection();
      }, guard),
    enroll: (guard?: LumiSessionGuard) =>
      serialized(async () => {
        await load();
        const account = await options.account.readAccount();
        check();
        if (account.user.id !== options.userId) throw new Error("lumi_account_changed");
        const org = account.organizations.find(
          (o) => o.id === options.orgId && o.status === "active" && o.state === "active",
        );
        if (!org) throw new Error("lumi_org_unavailable");
        if (record?.credential) return projection(); // Never silently re-enroll an expired or existing identity.
        if (!record) {
          const { publicKey, privateKey } = generateKeyPairSync("ed25519");
          const created: LumiDeviceRecord = {
            version: 1,
            origin: new URL(options.origin).origin,
            orgId: options.orgId,
            userId: options.userId,
            orgSlug: org.slug,
            privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
            publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
            fingerprint: createHash("sha256")
              .update(publicKey.export({ type: "spki", format: "der" }))
              .digest("hex"),
            enrollmentId: null,
            approvalKey: randomUUID(),
            credential: null,
          };
          check();
          await commit(created);
        }
        if (!record) throw new Error("lumi_device_missing");
        if (!record.enrollmentId) {
          check();
          const begun = await device.begin({
            org_slug: record.orgSlug,
            public_key: record.publicKeyPem,
            key_fingerprint: record.fingerprint,
            device_name: "Lumi Agents Desktop",
            platform: `${process.platform}-${process.arch}`,
            app_version: options.appVersion,
          });
          check();
          await commit({ ...record, enrollmentId: begun.enrollmentId });
        }
        const current = record;
        const enrollmentId = current?.enrollmentId;
        if (!current || !enrollmentId) throw new Error("lumi_device_missing");
        check();
        await options.account.approveDeviceEnrollment(
          options.orgId,
          enrollmentId,
          current.approvalKey,
        );
        check();
        const challenge = await device.challenge(enrollmentId);
        const signature = sign(
          null,
          Buffer.from(challenge),
          createPrivateKey(current.privateKeyPem),
        ).toString("hex");
        check();
        await device.complete(enrollmentId, signature);
        check();
        const policy = await device.policy();
        check();
        await device.acknowledge(policy.policy_version as number);
        check();
        return projection();
      }, guard),

    listWorkspaceBindings: () =>
      serialized(async () => {
        await load();
        if (!record?.credential) throw new Error("lumi_device_missing");
        return device.listWorkspaceBindings();
      }),

    createWorkspaceBinding: (input: {
      projectId: string;
      workspaceIdentity: string;
      displayName: string;
      environmentType: "local" | "ssh" | "wsl" | "docker" | "remote";
    }) =>
      serialized(async () => {
        await load();
        if (!record?.credential) throw new Error("lumi_device_missing");
        return device.createWorkspaceBinding(input);
      }),

    deleteWorkspaceBinding: (bindingId: string) =>
      serialized(async () => {
        await load();
        if (!record?.credential) throw new Error("lumi_device_missing");
        await device.deleteWorkspaceBinding(bindingId);
      }),

    recover: (guard?: LumiSessionGuard) =>
      serialized(async () => {
        await load();
        if (!record?.credential) throw new Error("lumi_device_missing");
        const { credential, privateKeyPem } = record;
        check();
        const challenge = await options.account.createDeviceRecoveryChallenge(
          options.orgId,
          credential.id,
          randomUUID(),
        );
        const message =
          "lumi-device-token-recovery-v1\n" + credential.id + "\n" + challenge.challenge;
        const signature = sign(
          null,
          Buffer.from(message),
          createPrivateKey(privateKeyPem),
        ).toString("hex");
        // The token is rotated by the server here: refuse before sending once the session is gone.
        check();
        const renewed = await options.account.recoverDeviceToken(options.orgId, credential.id, {
          challenge: challenge.challenge,
          signature,
          appVersion: options.appVersion,
        });
        // Already issued, so it is adopted into the vault (see `save`); only what follows is refused.
        await device.adoptRecoveredToken(renewed);
        check();
        const policy = await device.policy();
        check();
        await device.acknowledge(policy.policy_version as number);
        check();
        return projection();
      }, guard),
    syncPolicy: (guard?: LumiSessionGuard) =>
      serialized(async () => {
        await load();
        if (!record?.credential) throw new Error("lumi_device_missing");
        check();
        const policy = await device.policy();
        check();
        await device.acknowledge(policy.policy_version as number);
        check();
        return {
          device: projection(),
          policy: {
            id: policy.id as string,
            version: policy.policy_version as number,
            expiresAt: policy.expires_at as string,
          },
        };
      }, guard),
    readCurrentPolicy: () =>
      serialized(async () => {
        await load();
        if (!record?.credential) throw new Error("lumi_device_missing");
        const policy = await device.policy();
        return {
          id: policy.id as string,
          version: policy.policy_version as number,
          expiresAt: policy.expires_at as string,
        };
      }),
    refresh: (guard?: LumiSessionGuard) =>
      serialized(async () => {
        await load();
        if (!record?.credential) throw new Error("lumi_device_missing");
        const privateKey = createPrivateKey(record.privateKeyPem);
        check();
        await device.refresh(options.appVersion, async (nonce) =>
          sign(null, Buffer.from(nonce), privateKey).toString("hex"),
        );
        check();
        return projection();
      }, guard),
  };
}
