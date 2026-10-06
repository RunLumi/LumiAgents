/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type { LumiAccountProjection, LumiAccountResult, LumiSignInProjection } from "@zcode/shared";
interface AccountOwner {
  beginSignIn(name: string): Promise<LumiSignInProjection>;
  completeSignIn(): Promise<void>;
  cancelSignIn(): void;
  readAccount(): Promise<LumiAccountProjection>;
  restoreSession(): Promise<boolean>;
  signOut(): Promise<void>;
}
export async function dispatchLumiAccountCommand(options: {
  trusted: boolean;
  command: unknown;
  getOwner(): AccountOwner;
}): Promise<LumiAccountResult> {
  if (!options.trusted) return { ok: false, code: "lumi_sender_denied" };
  if (
    !["begin", "complete", "cancel", "read", "restore", "logout"].includes(
      String(options.command),
    ) ||
    typeof options.command !== "string"
  ) {
    return { ok: false, code: "lumi_command_invalid" };
  }
  try {
    const owner = options.getOwner();
    switch (options.command) {
      case "begin": {
        const signIn = await owner.beginSignIn("Lumi Agents Desktop");
        return { ok: true, signIn };
      }
      case "complete":
        await owner.completeSignIn();
        return { ok: true, account: await owner.readAccount() };
      case "cancel":
        owner.cancelSignIn();
        return { ok: true };
      case "read":
        return { ok: true, account: await owner.readAccount() };
      case "restore": {
        const restored = await owner.restoreSession();
        return restored
          ? { ok: true, restored, account: await owner.readAccount() }
          : { ok: true, restored };
      }
      case "logout":
        await owner.signOut();
        return { ok: true };
      default:
        return { ok: false, code: "lumi_command_invalid" };
    }
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "lumi_account_failed";
    return { ok: false, code: /^lumi_[a-z_]{1,80}$/.test(code) ? code : "lumi_account_failed" };
  }
}
