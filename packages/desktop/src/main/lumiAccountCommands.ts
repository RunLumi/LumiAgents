/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type {
  LumiDeviceStateProjection,
  LumiAccountProjection,
  LumiAccountResult,
  LumiSignInProjection,
} from "@zcode/shared";
interface AccountOwner {
  beginSignIn(name: string): Promise<LumiSignInProjection>;
  completeSignIn(): Promise<void>;
  cancelSignIn(): void;
  readAccount(): Promise<LumiAccountProjection>;
  restoreSession(): Promise<boolean>;
  signOut(): Promise<void>;
  enrollDevice?(orgId: string): Promise<LumiDeviceStateProjection>;
  readDevice?(orgId: string): Promise<LumiDeviceStateProjection>;
  syncDevicePolicy?(orgId: string): Promise<unknown>;
  refreshDevice?(orgId: string): Promise<LumiDeviceStateProjection>;
  recoverDevice?(orgId: string): Promise<LumiDeviceStateProjection>;
}
export async function dispatchLumiAccountCommand(options: {
  trusted: boolean;
  command: unknown;
  getOwner(): AccountOwner;
}): Promise<LumiAccountResult> {
  if (!options.trusted) return { ok: false, code: "lumi_sender_denied" };
  if (options.command && typeof options.command === "object") {
    const command = options.command as Record<string, unknown>;
    if (
      typeof command.orgId !== "string" ||
      !/^org_[0-9a-f]{32}$/.test(command.orgId) ||
      Object.keys(command).some((k) => !["action", "orgId", "confirm"].includes(k)) ||
      !["enroll-device", "read-device", "sync-device", "refresh-device", "recover-device"].includes(
        String(command.action),
      ) ||
      (command.action === "enroll-device" && command.confirm !== true)
    )
      return { ok: false, code: "lumi_command_invalid" };
    try {
      const owner = options.getOwner();
      if (command.action === "enroll-device" && owner.enrollDevice)
        return { ok: true, device: await owner.enrollDevice(command.orgId) };
      if (command.action === "read-device" && owner.readDevice)
        return { ok: true, device: await owner.readDevice(command.orgId) };
      if (command.action === "refresh-device" && owner.refreshDevice)
        return { ok: true, device: await owner.refreshDevice(command.orgId) };
      if (command.action === "recover-device" && owner.recoverDevice && command.confirm === true)
        return { ok: true, device: await owner.recoverDevice(command.orgId) };
      if (command.action === "sync-device" && owner.syncDevicePolicy && owner.readDevice) {
        await owner.syncDevicePolicy(command.orgId);
        return { ok: true, device: await owner.readDevice(command.orgId) };
      }
      return { ok: false, code: "lumi_command_unsupported" };
    } catch {
      return { ok: false, code: "lumi_device_action_failed" };
    }
  }
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
