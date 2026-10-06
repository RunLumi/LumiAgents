/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { generateKeyPairSync, createHash, randomUUID, sign, createPrivateKey } from "node:crypto";
import { LumiDeviceHostTransport, type LumiAccountHostTransport } from "@zcode/services/node";
import type { LumiDeviceRecord } from "./lumiDeviceVault.js";
interface Vault {
  load(): Promise<LumiDeviceRecord | null>;
  save(value: LumiDeviceRecord): Promise<void>;
}
/** One serialized main owner per origin/org. No renderer key/token access. */
export function createLumiDeviceOwner(options: {
  origin: string;
  orgId: string;
  userId: string;
  account: LumiAccountHostTransport;
  vault: Vault;
  appVersion: string;
}) {
  let record: LumiDeviceRecord | null = null;
  let loaded = false;
  let queue: Promise<void> = Promise.resolve();
  const device = new LumiDeviceHostTransport(options.origin, fetch, {
    async load() {
      return record?.credential ?? null;
    },
    async save(credential) {
      if (!record) throw new Error("lumi_device_missing");
      const next = { ...record, credential };
      await options.vault.save(next);
      record = next;
    },
  });
  async function load() {
    if (loaded) return;
    record = await options.vault.load();
    await device.restore();
    loaded = true;
  }
  function serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work);
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
    read: () =>
      serialized(async () => {
        await load();
        return projection();
      }),
    enroll: () =>
      serialized(async () => {
        await load();
        const account = await options.account.readAccount();
        if (account.user.id !== options.userId) throw new Error("lumi_account_changed");
        const org = account.organizations.find(
          (o) => o.id === options.orgId && o.status === "active" && o.state === "active",
        );
        if (!org) throw new Error("lumi_org_unavailable");
        if (record?.credential) return projection(); // Never silently re-enroll an expired or existing identity.
        if (!record) {
          const { publicKey, privateKey } = generateKeyPairSync("ed25519");
          record = {
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
          await options.vault.save(record);
        }
        if (!record.enrollmentId) {
          const begun = await device.begin({
            org_slug: record.orgSlug,
            public_key: record.publicKeyPem,
            key_fingerprint: record.fingerprint,
            device_name: "Lumi Agents Desktop",
            platform: `${process.platform}-${process.arch}`,
            app_version: options.appVersion,
          });
          record = { ...record, enrollmentId: begun.enrollmentId };
          await options.vault.save(record);
        }
        const enrollmentId = record.enrollmentId;
        if (!enrollmentId) throw new Error("lumi_device_missing");
        await options.account.approveDeviceEnrollment(
          options.orgId,
          enrollmentId,
          record.approvalKey,
        );
        const challenge = await device.challenge(enrollmentId);
        const signature = sign(
          null,
          Buffer.from(challenge),
          createPrivateKey(record.privateKeyPem),
        ).toString("hex");
        await device.complete(enrollmentId, signature);
        const policy = await device.policy();
        await device.acknowledge(policy.policy_version as number);
        return projection();
      }),
    syncPolicy: () =>
      serialized(async () => {
        await load();
        if (!record?.credential) throw new Error("lumi_device_missing");
        const policy = await device.policy();
        await device.acknowledge(policy.policy_version as number);
        return {
          device: projection(),
          policy: { id: policy.id, version: policy.policy_version, expiresAt: policy.expires_at },
        };
      }),
    refresh: () =>
      serialized(async () => {
        await load();
        if (!record?.credential) throw new Error("lumi_device_missing");
        const privateKey = createPrivateKey(record.privateKeyPem);
        await device.refresh(options.appVersion, async (nonce) =>
          sign(null, Buffer.from(nonce), privateKey).toString("hex"),
        );
        return projection();
      }),
  };
}
