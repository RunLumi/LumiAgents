/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { LUMI_ACCOUNT_CHANNEL } from "@zcode/shared";
import { createLumiAccountOwner, type LumiAccountOwnerOptions } from "./lumiAccountOwner.js";
import { dispatchLumiAccountCommand } from "./lumiAccountCommands.js";

export function registerLumiAccountIpc(options: {
  origin: string;
  isTrusted(event: IpcMainInvokeEvent): boolean;
  /** Main→Host managed automation channel; scheduler polling is inert without it. */
  automationHost?: LumiAccountOwnerOptions["automationHost"];
  log?: LumiAccountOwnerOptions["log"];
}) {
  // Optional managed login cannot break local/provider startup if custody or
  // operator configuration is unavailable. Initialize only on an allowed action.
  let owner: ReturnType<typeof createLumiAccountOwner> | undefined;
  const ownerOptions = {
    ...(options.automationHost ? { automationHost: options.automationHost } : {}),
    ...(options.log ? { log: options.log } : {}),
  };
  ipcMain.handle(LUMI_ACCOUNT_CHANNEL, (event, command: unknown) =>
    dispatchLumiAccountCommand({
      trusted: options.isTrusted(event),
      command,
      getOwner: () => (owner ??= createLumiAccountOwner(options.origin, ownerOptions)),
    }),
  );
  return {
    /**
     * The scheduler process only asks; the credential-holding owner does the due/claim/start pass.
     * Only reached when a local marker says managed work exists, so a local-only profile never
     * initializes account custody because of the scheduler.
     */
    pollManagedAutomations: () =>
      (owner ??= createLumiAccountOwner(options.origin, ownerOptions)).pollManagedAutomations(),
    resolveManagedToolIdentity: (input: {
      workspaceIdentity: string;
      params: import("@zcode/shared").ZCodeManagedToolIdentityRequest;
    }) => (owner ??= createLumiAccountOwner(options.origin)).resolveManagedToolIdentity(input),
    reportRuntimeCapabilities: (input: {
      workspaceIdentity: string;
      params: import("@zcode/shared").ZCodeManagedRuntimeCapabilitiesRequest;
    }) => (owner ??= createLumiAccountOwner(options.origin)).reportRuntimeCapabilities(input),
    reportManagedToolResult: (input: {
      workspaceIdentity: string;
      params: import("@zcode/shared").ZCodeManagedToolResultRequestParams;
    }) => (owner ??= createLumiAccountOwner(options.origin)).reportManagedToolResult(input),
    resolveManagedRequestAuth: (request: {
      sessionId: string;
      workspaceIdentity: string;
      providerId: string;
      modelId: string;
      managedContext: import("@zcode/shared").ZCodeManagedRunContext;
    }) => (owner ??= createLumiAccountOwner(options.origin)).resolveManagedRequestAuth(request),
    settleManagedRun: (input: { runId: string; outcome: "succeeded" | "failed" | "stopped" }) =>
      (owner ??= createLumiAccountOwner(options.origin)).settleManagedRun(
        input.runId,
        input.outcome === "succeeded" ? "complete" : input.outcome === "failed" ? "fail" : "cancel",
      ),
    requestManagedToolDecision: (input: {
      workspaceIdentity: string;
      params: import("@zcode/shared").ZCodeManagedToolDecisionRequestParams;
    }) => (owner ??= createLumiAccountOwner(options.origin)).requestManagedToolDecision(input),
  };
}
