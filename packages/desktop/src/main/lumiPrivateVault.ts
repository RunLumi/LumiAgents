/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";
export interface LumiVaultEncryption {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
/** Main-private adapter, never a renderer credential service. */
export function createLumiPrivateVault<T>(options: {
  directory: string;
  identity: string;
  namespace: "session" | "device";
  encryption: LumiVaultEncryption;
  platform?: NodeJS.Platform;
  validate(value: unknown): T;
}) {
  const file = join(
    options.directory,
    `lumi-${options.namespace}-${createHash("sha256").update(options.identity).digest("hex")}.json`,
  );
  function available() {
    const backend =
      (options.platform ?? process.platform) === "linux"
        ? options.encryption.getSelectedStorageBackend()
        : undefined;
    if (
      !options.encryption.isEncryptionAvailable() ||
      backend === "basic_text" ||
      backend === "unknown"
    )
      throw new Error("lumi_secure_storage_unavailable");
  }
  return {
    async load(): Promise<T | null> {
      available();
      let raw: string;
      try {
        raw = await readFile(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw new Error("lumi_vault_read_failed");
      }
      try {
        const envelope = JSON.parse(raw) as Record<string, unknown>;
        if (
          Object.keys(envelope).sort().join(",") !== "ciphertext,version" ||
          envelope.version !== 1 ||
          typeof envelope.ciphertext !== "string" ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertext)
        )
          throw new Error();
        return options.validate(
          JSON.parse(options.encryption.decryptString(Buffer.from(envelope.ciphertext, "base64"))),
        );
      } catch {
        throw new Error("lumi_vault_corrupt");
      }
    },
    async save(record: T): Promise<void> {
      available();
      const row = options.validate(record),
        ciphertext = options.encryption.encryptString(JSON.stringify(row)).toString("base64");
      await withFileLock(file, () =>
        atomicWritePrivateTextFile(file, JSON.stringify({ version: 1, ciphertext }) + "\n"),
      );
    },
    async clear(): Promise<void> {
      await withFileLock(file, async () => {
        try {
          await unlink(file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            throw new Error("lumi_vault_clear_failed");
        }
      });
    },
  };
}
