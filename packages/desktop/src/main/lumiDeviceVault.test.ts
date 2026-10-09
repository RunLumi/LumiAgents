import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLumiDeviceVault, type LumiDeviceRecord } from "./lumiDeviceVault.js";
const encryption = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "gnome_libsecret",
  encryptString: (s: string) => Buffer.from(Buffer.from(s).map((b) => b ^ 42)),
  decryptString: (b: Buffer) =>
    Buffer.from(b)
      .map((x) => x ^ 42)
      .toString(),
};
test("pending Ed25519 identity restores only for its origin/org, no plaintext", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lumi-device-vault-"));
  try {
    const orgId = `org_${"a".repeat(32)}`,
      origin = "https://lumi.example",
      userId = `usr_${"c".repeat(32)}`,
      { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const record: LumiDeviceRecord = {
      version: 1,
      origin,
      orgId,
      userId,
      orgSlug: "lumi-org",
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      fingerprint: createHash("sha256")
        .update(publicKey.export({ type: "spki", format: "der" }))
        .digest("hex"),
      enrollmentId: null,
      approvalKey: "test-key",
      credential: null,
    };
    const vault = createLumiDeviceVault({ directory, origin, orgId, userId, encryption });
    await vault.save(record);
    assert.deepEqual(
      await createLumiDeviceVault({ directory, origin, orgId, userId, encryption }).load(),
      record,
    );
    const file = (await readdir(directory)).find((n) => n.endsWith(".json"))!;
    assert.equal((await readFile(join(directory, file), "utf8")).includes("PRIVATE KEY"), false);
    assert.equal(
      await createLumiDeviceVault({
        directory,
        origin,
        orgId: `org_${"b".repeat(32)}`,
        userId,
        encryption,
      }).load(),
      null,
    );
    await assert.rejects(
      vault.save({ ...record, fingerprint: "b".repeat(64) }),
      /lumi_device_invalid/,
    );
    assert.deepEqual(await vault.load(), record);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
