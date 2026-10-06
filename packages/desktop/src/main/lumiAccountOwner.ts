import { createLumiDeviceOwner } from "./lumiDeviceOwner.js";
import { createLumiDeviceVault } from "./lumiDeviceVault.js";
/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { app, safeStorage } from "electron";
import { ZCODE_VERSION } from "@zcode/shared";
import { join } from "node:path";
import { LumiAccountHostTransport } from "@zcode/services/node";
import { createLumiSessionVault } from "./lumiSessionVault.js";

/** Main-only assembly, created after app.ready; never expose transport/vault getters. */
export function createLumiAccountOwner(origin: string) {
  if (!app.isReady()) throw new Error("lumi_main_not_ready");
  const vault = createLumiSessionVault({
    directory: join(app.getPath("userData"), "lumi-account"),
    origin,
    encryption: safeStorage,
  });
  const transport = new LumiAccountHostTransport(origin, fetch, vault);
  const devices = new Map<string, ReturnType<typeof createLumiDeviceOwner>>();
  const deviceFor = async (orgId: string) => {
    if (!/^org_[0-9a-f]{32}$/.test(orgId)) throw new Error("lumi_org_invalid");
    const account = await transport.readAccount();
    const userId = account.user.id;
    const identity = `${orgId}:${userId}`;
    let owner = devices.get(identity);
    if (!owner) {
      owner = createLumiDeviceOwner({
        origin,
        orgId,
        userId,
        account: transport,
        appVersion: ZCODE_VERSION || app.getVersion(),
        vault: createLumiDeviceVault({
          directory: join(app.getPath("userData"), "lumi-account"),
          origin,
          orgId,
          userId,
          encryption: safeStorage,
        }),
      });
      devices.set(identity, owner);
    }
    return owner;
  };
  return {
    restoreSession: () => transport.restoreSession(),
    beginSignIn: (deviceName: string) => transport.beginSignIn(deviceName),
    completeSignIn: () => transport.completeSignIn(),
    cancelSignIn: () => transport.cancelSignIn(),
    readAccount: () => transport.readAccount(),
    signOut: () => {
      devices.clear();
      return transport.signOut();
    },
    enrollDevice: async (orgId: string) => (await deviceFor(orgId)).enroll(),
    readDevice: async (orgId: string) => (await deviceFor(orgId)).read(),
    syncDevicePolicy: async (orgId: string) => (await deviceFor(orgId)).syncPolicy(),
    refreshDevice: async (orgId: string) => (await deviceFor(orgId)).refresh(),
  };
}
