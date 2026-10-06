/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { atomicWritePrivateTextFile, withFileLock } from "@zcode/shared/node";

export interface LumiSessionRecord {
  version: 1;
  origin: string;
  session: string;
  csrf: string;
  expiresAt: string;
}
interface Encryption {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

/** Only main receives this vault. Never expose it through renderer credential RPC. */
export function createLumiSessionVault(options: {
  directory: string;
  origin: string;
  encryption: Encryption;
  platform?: NodeJS.Platform;
}) {
  const origin = new URL(options.origin).origin;
  const file = join(
    options.directory,
    `lumi-session-${createHash("sha256").update(origin).digest("hex")}.json`,
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
    ) {
      throw new Error("lumi_secure_storage_unavailable");
    }
  }
  function validate(value: unknown): LumiSessionRecord {
    if (!value || typeof value !== "object") throw new Error("lumi_session_invalid");
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).sort().join(",") !== "csrf,expiresAt,origin,session,version" ||
      row.version !== 1 ||
      row.origin !== origin ||
      typeof row.session !== "string" ||
      !/^[0-9a-f]{64}$/.test(row.session) ||
      typeof row.csrf !== "string" ||
      !/^[0-9a-f]{64}$/.test(row.csrf) ||
      typeof row.expiresAt !== "string" ||
      !Number.isFinite(Date.parse(row.expiresAt))
    )
      throw new Error("lumi_session_invalid");
    return value as LumiSessionRecord;
  }
  return {
    async load(): Promise<LumiSessionRecord | null> {
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
        const row = validate(
          JSON.parse(options.encryption.decryptString(Buffer.from(envelope.ciphertext, "base64"))),
        );
        return Date.parse(row.expiresAt) > Date.now() ? row : null;
      } catch {
        throw new Error("lumi_vault_corrupt");
      }
    },
    async save(record: LumiSessionRecord): Promise<void> {
      available();
      const row = validate(record);
      const ciphertext = options.encryption.encryptString(JSON.stringify(row)).toString("base64");
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
