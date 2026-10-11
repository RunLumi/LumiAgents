import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLumiWorkspaceVault, type LumiWorkspaceVaultRecord } from "./lumiWorkspaceVault.js";

const encryption = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "gnome_libsecret",
  encryptString: (value: string) => Buffer.from(Buffer.from(value).map((byte) => byte ^ 42)),
  decryptString: (value: Buffer) =>
    Buffer.from(value)
      .map((byte) => byte ^ 42)
      .toString(),
};

test("workspace identity stays in an encrypted origin/user-owned mapping", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lumi-workspace-vault-"));
  try {
    const origin = "https://lumi.example";
    const userId = `usr_${"a".repeat(32)}`;
    const orgId = `org_${"d".repeat(32)}`;
    const vault = createLumiWorkspaceVault({ directory, origin, orgId, userId, encryption });
    const empty = await vault.createEmpty();
    const mapping = {
      workspaceIdentity: "/Users/private/Customer Project",
      workspaceKey: "b".repeat(64),
      adoptionStateId: null,
      deviceBindingId: null,
      projectId: null,
      displayName: null,
      environmentType: null,
    } as const;
    const record: LumiWorkspaceVaultRecord = { ...empty, mappings: [mapping] };
    await vault.save(record);
    assert.deepEqual(await vault.load(), record);
    const file = (await readdir(directory)).find((name) => name.endsWith(".json"))!;
    const ciphertext = await readFile(join(directory, file), "utf8");
    assert.equal(ciphertext.includes(mapping.workspaceIdentity), false);
    assert.equal(ciphertext.includes(mapping.workspaceKey), false);
    assert.equal(
      await createLumiWorkspaceVault({
        directory,
        origin: "https://other.example",
        orgId,
        userId,
        encryption,
      }).load(),
      null,
    );
    assert.equal(
      await createLumiWorkspaceVault({
        directory,
        origin,
        orgId,
        userId: `usr_${"c".repeat(32)}`,
        encryption,
      }).load(),
      null,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
