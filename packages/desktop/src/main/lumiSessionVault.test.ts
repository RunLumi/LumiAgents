import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLumiSessionVault } from "./lumiSessionVault.js";

// Deterministic cipher for boundary testing only; OS keychain is a separate runtime proof.
const encryption = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "gnome_libsecret",
  encryptString: (s: string) => Buffer.from(Buffer.from(s).map((b) => b ^ 42)),
  decryptString: (b: Buffer) =>
    Buffer.from(b)
      .map((x) => x ^ 42)
      .toString(),
};
test("origin-isolated encrypted restart restore and narrow clear", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lumi-vault-"));
  try {
    const options = { directory, origin: "https://lumi.example", encryption };
    const vault = createLumiSessionVault(options);
    const row = {
      version: 1 as const,
      origin: options.origin,
      session: "a".repeat(64),
      csrf: "b".repeat(64),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    assert.equal(await vault.load(), null);
    await vault.save(row);
    const file = join(directory, (await readdir(directory)).find((x) => x.endsWith(".json"))!);
    assert.equal((await readFile(file, "utf8")).includes(row.session), false);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await createLumiSessionVault(options).load(), row);
    assert.equal(
      await createLumiSessionVault({ ...options, origin: "https://staging.example" }).load(),
      null,
    );
    await writeFile(join(directory, "provider-credentials.json"), "untouched");
    await vault.clear();
    assert.equal(await vault.load(), null);
    assert.equal(await readFile(join(directory, "provider-credentials.json"), "utf8"), "untouched");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("refuses Linux plaintext fallback and unavailable encryption", async () => {
  for (const provider of [
    { ...encryption, getSelectedStorageBackend: () => "basic_text" },
    { ...encryption, isEncryptionAvailable: () => false },
  ]) {
    const vault = createLumiSessionVault({
      directory: "/unused",
      origin: "https://lumi.example",
      encryption: provider,
      platform: "linux",
    });
    await assert.rejects(vault.load(), /lumi_secure_storage_unavailable/);
  }
});

test("corrupt vault is refused and original bytes survive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lumi-vault-corrupt-"));
  try {
    const vault = createLumiSessionVault({ directory, origin: "https://lumi.example", encryption });
    await vault.save({
      version: 1,
      origin: "https://lumi.example",
      session: "a".repeat(64),
      csrf: "b".repeat(64),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const file = join(directory, (await readdir(directory)).find((x) => x.endsWith(".json"))!);
    await writeFile(file, "broken-record");
    await assert.rejects(vault.load(), /lumi_vault_corrupt/);
    assert.equal(await readFile(file, "utf8"), "broken-record");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
