import type {
  LumiDeviceStateProjection,
  LumiWorkspaceStage,
  P08CredentialMode,
} from "@zcode/shared";
import type { LumiAdoptionRecord, LumiWorkspaceBinding } from "@zcode/services/node";
import {
  isCredentialModeLabel,
  isCredentialModePermitted,
  isLumiResourceId,
} from "./lumiWorkspaceValidation.js";

export interface WorkspaceServerState {
  device: LumiDeviceStateProjection;
  deviceBinding: LumiWorkspaceBinding | null;
  adoption: LumiAdoptionRecord | null;
}

export interface CredentialModeChange {
  projectId: string;
  credentialMode: P08CredentialMode;
  expectedStage: Exclude<LumiWorkspaceStage, "history_sync">;
  expectedVersion: number;
}

/**
 * Label-only change. Nothing is provisioned, uploaded or bound: the server row stays the
 * authority, every refusal below happens before a request, and success is the re-read row.
 */
export async function changeWorkspaceCredentialMode(args: {
  input: CredentialModeChange;
  readState(): Promise<WorkspaceServerState>;
  send(adoption: LumiAdoptionRecord, mode: P08CredentialMode): Promise<unknown>;
  /**
   * Rejects when the signed-in account/org this operation started under is gone (sign-out,
   * replaced session, membership removed). Called after every await boundary: a PATCH already
   * sent is never undone or retried, but its completion is refused for a stale owner.
   */
  assertCurrent(): Promise<void>;
}): Promise<WorkspaceServerState> {
  const { input } = args;
  if (
    !isLumiResourceId(input.projectId, "prj") ||
    !isCredentialModeLabel(input.credentialMode) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  )
    throw new Error("lumi_workspace_invalid");
  await args.assertCurrent();
  const server = await args.readState();
  const adoption = server.adoption;
  if (
    !adoption ||
    !server.deviceBinding ||
    adoption.projectId !== input.projectId ||
    server.deviceBinding.projectId !== input.projectId
  )
    throw new Error("lumi_workspace_binding_missing");
  // 第 5 阶段不可构造：即使服务端行已是该阶段也不发任何请求。
  if (adoption.stage === "history_sync") throw new Error("lumi_workspace_stage_invalid");
  // 栅栏：用户看到的行与此刻服务端不一致（含晚到的账号/组织投影）则什么都不发。
  if (adoption.stage !== input.expectedStage || adoption.version !== input.expectedVersion)
    throw new Error("lumi_workspace_stale");
  if (!isCredentialModePermitted(input.credentialMode, adoption.ownership))
    throw new Error("lumi_workspace_credential_mode_invalid");
  if (adoption.credentialMode === input.credentialMode) {
    await args.assertCurrent();
    return server;
  }
  // 栅栏：上面的 readState 跨越了若干 await，账号/组织可能已变；发出 PATCH 前必须再确认。
  await args.assertCurrent();
  await args.send(adoption, input.credentialMode);
  await args.assertCurrent();
  // PATCH 之后服务端可能已提交旧作用域的写入：不撤销、不重试，只拒绝过期的 UI 完成。
  // 响应不是证据：服务端可能返回 200 却没有落库，必须以重新读取的行为准。
  const confirmed = await args.readState();
  await args.assertCurrent();
  if (
    confirmed.adoption?.adoptionStateId !== adoption.adoptionStateId ||
    confirmed.adoption.credentialMode !== input.credentialMode
  )
    throw new Error("lumi_workspace_credential_not_persisted");
  return confirmed;
}
