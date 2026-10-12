/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { generateKeyPairSync, createHash, randomUUID, sign, createPrivateKey } from "node:crypto";
import {
  LumiAccountError,
  LumiDeviceHostTransport,
  type LumiAccountHostTransport,
  type LumiRuntimeCapabilityReport,
} from "@zcode/services/node";
import {
  keepLeasesFresh,
  needsProactiveRefresh,
  persistDeviceRefusal,
  reconcile,
} from "./lumiDeviceExpiry.js";
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
  /** Main-owned runtime snapshot provider; never supplied by renderer commands. */
  readRuntimeCapabilities?: () => Promise<LumiRuntimeCapabilityReport>;
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
  /** Persist what a server refusal of the held credential proves (see `persistDeviceRefusal`). */
  async function observeRefusal(error: unknown) {
    const held = record?.credential;
    if (!held) return;
    try {
      await withVaultLock(lockIdentity, async () => {
        const next = await persistDeviceRefusal(options.vault, error, held);
        if (next !== undefined) record = next;
      });
      await device.restore();
    } catch {
      // Best effort: failing to persist must not hide the refusal itself.
    }
  }
  /** Rotate a still-valid token that is about to expire, by proof of possession (P03-CG). */
  async function ensureFresh() {
    if (record?.revokedAt || !needsProactiveRefresh(record?.credential)) return;
    try {
      const privateKey = createPrivateKey(record!.privateKeyPem);
      await device.refresh(options.appVersion, async (nonce) =>
        sign(null, Buffer.from(nonce), privateKey).toString("hex"),
      );
    } catch (error) {
      // Best effort: a refused rotation (e.g. below the minimum version) is recorded, and the
      // still-valid token keeps serving this operation until it expires.
      await observeRefusal(error);
    }
  }
  /** A token-using operation: loaded, not revoked, enrolled, and rotated if about to expire. */
  function withToken<T>(work: () => Promise<T>, guard?: LumiSessionGuard): Promise<T> {
    return serialized(async () => {
      await load();
      if (refuseRevoked() || !record?.credential) throw new Error("lumi_device_missing");
      await ensureFresh();
      return work();
    }, guard);
  }
  /** A revoked device sends nothing with its token and offers no recovery. */
  function refuseRevoked(): false {
    if (record?.revokedAt) throw new LumiAccountError("lumi_device_revoked");
    return false;
  }
  function serialized<T>(work: () => Promise<T>, guard?: LumiSessionGuard): Promise<T> {
    const next = queue.then(async () => {
      activeGuard = guard;
      try {
        check();
        return await work();
      } catch (error) {
        await observeRefusal(error);
        throw error;
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
      status: record.revokedAt
        ? ("revoked" as const)
        : Date.parse(record.credential.tokenExpiresAt) > Date.now()
          ? ("active" as const)
          : ("reauth_required" as const),
      orgId: options.orgId,
      device: device.projection(),
    };
  }
  // Canonical form of the last report the control plane accepted for the held credential.
  let lastReported: string | null = null;
  async function reportRuntime(onlyIfChanged = false) {
    // No provider means availability is unknown, never optimistically true.
    const report = (await options.readRuntimeCapabilities?.()) ?? {};
    const canonical = JSON.stringify(
      Object.entries(report).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    if (onlyIfChanged && canonical === lastReported) return;
    lastReported = null;
    await device.heartbeat(options.appVersion, report);
    lastReported = canonical;
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
        await reportRuntime();
        check();
        const policy = await device.policy();
        check();
        await device.acknowledge(policy.policy_version as number);
        check();
        return projection();
      }, guard),

    /**
     * Main-only P06 lease transport. The object holds no token: it reads the held credential on
     * every request, and its results never reach the renderer, the scheduler process or Host.
     */
    automationLeases: () =>
      withToken(async () => {
        return keepLeasesFresh(device.automationLeases(), () =>
          serialized(async () => {
            await load();
            if (!refuseRevoked()) await ensureFresh();
          }),
        );
      }),

    listWorkspaceBindings: () =>
      withToken(async () => {
        return device.listWorkspaceBindings();
      }),

    createManagedSession: (input: {
      projectId: string;
      agentDefinitionId: string;
      workspaceBindingId: string;
      title?: string;
    }) =>
      withToken(async () => {
        return device.createManagedSession(input);
      }),

    createManagedRun: (agentSessionId: string, modelAlias: string) =>
      withToken(async () => {
        return device.createManagedRun(agentSessionId, modelAlias);
      }),

    getManagedRun: (runId: string) =>
      withToken(async () => {
        return device.getManagedRun(runId);
      }),

    requestManagedToolDecision: (
      input: import("@zcode/shared").ZCodeManagedToolDecisionRequestParams,
    ) =>
      withToken(async () => {
        return device.requestManagedToolDecision(input);
      }),

    reportManagedToolResult: (input: import("@zcode/shared").ZCodeManagedToolResultRequestParams) =>
      withToken(async () => {
        await device.reportManagedToolResult(input, input.status);
      }),
    startManagedRun: (run: Awaited<ReturnType<typeof device.getManagedRun>>) =>
      withToken(async () => {
        return device.startManagedRun(run);
      }),

    completeManagedRun: (run: Awaited<ReturnType<typeof device.getManagedRun>>) =>
      withToken(async () => {
        return device.completeManagedRun(run);
      }),

    failManagedRun: (run: Awaited<ReturnType<typeof device.getManagedRun>>, failureCode: string) =>
      withToken(async () => {
        return device.failManagedRun(run, failureCode);
      }),

    cancelManagedRun: (run: Awaited<ReturnType<typeof device.getManagedRun>>) =>
      withToken(async () => {
        return device.cancelManagedRun(run);
      }),

    createWorkspaceBinding: (input: {
      projectId: string;
      workspaceIdentity: string;
      displayName: string;
      environmentType: "local" | "ssh" | "wsl" | "docker" | "remote";
    }) =>
      withToken(async () => {
        return device.createWorkspaceBinding(input);
      }),

    deleteWorkspaceBinding: (bindingId: string) =>
      withToken(async () => {
        await device.deleteWorkspaceBinding(bindingId);
      }),

    recover: (guard?: LumiSessionGuard) =>
      withToken(async () => {
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
        await reportRuntime();
        check();
        const policy = await device.policy();
        check();
        await device.acknowledge(policy.policy_version as number);
        check();
        return projection();
      }, guard),
    syncPolicy: (guard?: LumiSessionGuard) =>
      withToken(async () => {
        check();
        await reportRuntime();
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
      withToken(async () => {
        const policy = await device.policy();
        return {
          id: policy.id as string,
          version: policy.policy_version as number,
          expiresAt: policy.expires_at as string,
        };
      }),
    /** Publish the Main-validated runtime snapshot; heartbeat only, never policy ACK. */
    refreshRuntimeCapabilities: () =>
      withToken(async () => {
        await reportRuntime(true);
      }),
    /** Main paths outside this queue (the automation poll) report a refusal of the held token. */
    observeServerRefusal: (error: unknown) => serialized(() => observeRefusal(error)),
    refresh: (guard?: LumiSessionGuard) =>
      serialized(async () => {
        await load();
        if (refuseRevoked() || !record?.credential) throw new Error("lumi_device_missing");
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
