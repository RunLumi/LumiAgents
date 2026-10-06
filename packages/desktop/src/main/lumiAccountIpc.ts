/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { LUMI_ACCOUNT_CHANNEL } from "@zcode/shared";
import { createLumiAccountOwner } from "./lumiAccountOwner.js";
import { dispatchLumiAccountCommand } from "./lumiAccountCommands.js";

export function registerLumiAccountIpc(options: {
  origin: string;
  isTrusted(event: IpcMainInvokeEvent): boolean;
}) {
  // Optional managed login cannot break local/provider startup if custody or
  // operator configuration is unavailable. Initialize only on an allowed action.
  let owner: ReturnType<typeof createLumiAccountOwner> | undefined;
  ipcMain.handle(LUMI_ACCOUNT_CHANNEL, (event, command: unknown) =>
    dispatchLumiAccountCommand({
      trusted: options.isTrusted(event),
      command,
      getOwner: () => (owner ??= createLumiAccountOwner(options.origin)),
      openExternal: (url) => shell.openExternal(url),
    }),
  );
}
