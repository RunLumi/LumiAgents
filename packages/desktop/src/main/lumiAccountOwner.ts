/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { app, safeStorage } from "electron";
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
  return {
    restoreSession: () => transport.restoreSession(),
    beginSignIn: (deviceName: string) => transport.beginSignIn(deviceName),
    completeSignIn: () => transport.completeSignIn(),
    cancelSignIn: () => transport.cancelSignIn(),
    readAccount: () => transport.readAccount(),
    signOut: () => transport.signOut(),
  };
}
