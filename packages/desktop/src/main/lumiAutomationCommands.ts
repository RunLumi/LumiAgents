/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// 渲染进程 → Main 的自动化接管命令：严格白名单校验，只返回投影（无 prompt/令牌/租约）。
// 编排顺序在 services 的 createAutomationAdoptionOwner；这里只做输入边界与错误码归一。
import type {
  LumiAccountResult,
  LumiAutomationAdoptionProjection,
  LumiAutomationAttachPreviewProjection,
  LumiAutomationPreviewProjection,
} from "@zcode/shared";

export interface AutomationCommandOwner {
  previewAutomationAdoption?(input: {
    orgId: string;
    localAutomationIds: string[];
  }): Promise<LumiAutomationPreviewProjection>;
  adoptAutomation?(input: {
    orgId: string;
    localAutomationId: string;
    agentDefinitionId: string;
    modelAlias: string;
    expectedRevision: number;
  }): Promise<LumiAutomationAdoptionProjection>;
  previewAutomationAttach?(input: {
    orgId: string;
    localAutomationId: string;
  }): Promise<LumiAutomationAttachPreviewProjection>;
  attachAutomation?(input: {
    orgId: string;
    localAutomationId: string;
    managedAutomationId: string;
    expectedRevision: number;
    expectedVersion: number;
    /** Already validated as `true` at the command boundary; forwarded so the owner enforces it too. */
    acknowledgeLocalInstructions: true;
  }): Promise<LumiAutomationAdoptionProjection>;
  releaseAutomation?(input: { orgId: string; localAutomationId: string }): Promise<void>;
  readAutomationAdoptions?(orgId: string): Promise<LumiAutomationAdoptionProjection[]>;
}

const ORG = /^org_[0-9a-f]{32}$/;
const AGENT = /^agd_[0-9a-f]{32}$/;
const MANAGED_AUTOMATION = /^aut_[0-9a-f]{32}$/;
const MODEL_ALIAS = /^[a-z0-9][a-z0-9._-]{0,127}$/;
/** 本地任务 ID（`automation-<uuid>`）：有界、无路径与控制字符，才允许进入编排。 */
const LOCAL_AUTOMATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_PREVIEW_IDS = 20;
const FALLBACK = "lumi_automation_action_failed";
const STABLE_CODE = /^(?:lumi|automation)_[a-z_]{1,80}$/;

const ACTIONS = [
  "preview-automation-adoption",
  "adopt-automation",
  "preview-automation-attach",
  "attach-automation",
  "release-automation",
  "read-automation-adoptions",
] as const;

function onlyKeys(command: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(command).every((key) => allowed.includes(key));
}

function stableCode(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : error instanceof Error
        ? error.message
        : FALLBACK;
  return STABLE_CODE.test(code) ? code : FALLBACK;
}

/** 非自动化命令返回 undefined，调用方继续原有分发。 */
export async function dispatchLumiAutomationCommand(
  command: Record<string, unknown>,
  owner: () => AutomationCommandOwner,
): Promise<LumiAccountResult | undefined> {
  if (!(ACTIONS as readonly string[]).includes(String(command.action))) return undefined;
  const invalid: LumiAccountResult = { ok: false, code: "lumi_command_invalid" };
  const unsupported: LumiAccountResult = { ok: false, code: "lumi_command_unsupported" };
  if (typeof command.orgId !== "string" || !ORG.test(command.orgId)) return invalid;
  const orgId = command.orgId;
  try {
    switch (command.action) {
      case "preview-automation-adoption": {
        const ids = command.localAutomationIds;
        if (
          !onlyKeys(command, ["action", "orgId", "localAutomationIds"]) ||
          !Array.isArray(ids) ||
          ids.length === 0 ||
          ids.length > MAX_PREVIEW_IDS ||
          new Set(ids).size !== ids.length ||
          ids.some((id) => typeof id !== "string" || !LOCAL_AUTOMATION_ID.test(id))
        )
          return invalid;
        const handler = owner().previewAutomationAdoption;
        if (!handler) return unsupported;
        return {
          ok: true,
          automationPreview: await handler({ orgId, localAutomationIds: ids as string[] }),
        };
      }
      case "adopt-automation": {
        if (
          command.confirm !== true ||
          !onlyKeys(command, [
            "action",
            "orgId",
            "localAutomationId",
            "agentDefinitionId",
            "modelAlias",
            "expectedRevision",
            "confirm",
          ]) ||
          !Number.isSafeInteger(command.expectedRevision) ||
          (command.expectedRevision as number) < 0 ||
          typeof command.localAutomationId !== "string" ||
          !LOCAL_AUTOMATION_ID.test(command.localAutomationId) ||
          typeof command.agentDefinitionId !== "string" ||
          !AGENT.test(command.agentDefinitionId) ||
          typeof command.modelAlias !== "string" ||
          !MODEL_ALIAS.test(command.modelAlias)
        )
          return invalid;
        const handler = owner().adoptAutomation;
        if (!handler) return unsupported;
        return {
          ok: true,
          automationAdoption: await handler({
            orgId,
            localAutomationId: command.localAutomationId,
            agentDefinitionId: command.agentDefinitionId,
            modelAlias: command.modelAlias,
            expectedRevision: command.expectedRevision as number,
          }),
        };
      }
      case "preview-automation-attach": {
        if (
          !onlyKeys(command, ["action", "orgId", "localAutomationId"]) ||
          typeof command.localAutomationId !== "string" ||
          !LOCAL_AUTOMATION_ID.test(command.localAutomationId)
        )
          return invalid;
        const handler = owner().previewAutomationAttach;
        if (!handler) return unsupported;
        return {
          ok: true,
          automationAttachPreview: await handler({
            orgId,
            localAutomationId: command.localAutomationId,
          }),
        };
      }
      case "attach-automation": {
        if (
          command.confirm !== true ||
          command.acknowledgeLocalInstructions !== true ||
          !onlyKeys(command, [
            "action",
            "orgId",
            "localAutomationId",
            "managedAutomationId",
            "expectedRevision",
            "expectedVersion",
            "confirm",
            "acknowledgeLocalInstructions",
          ]) ||
          !Number.isSafeInteger(command.expectedRevision) ||
          (command.expectedRevision as number) < 0 ||
          !Number.isSafeInteger(command.expectedVersion) ||
          (command.expectedVersion as number) < 1 ||
          typeof command.localAutomationId !== "string" ||
          !LOCAL_AUTOMATION_ID.test(command.localAutomationId) ||
          typeof command.managedAutomationId !== "string" ||
          !MANAGED_AUTOMATION.test(command.managedAutomationId)
        )
          return invalid;
        const handler = owner().attachAutomation;
        if (!handler) return unsupported;
        return {
          ok: true,
          automationAdoption: await handler({
            orgId,
            localAutomationId: command.localAutomationId,
            managedAutomationId: command.managedAutomationId,
            expectedRevision: command.expectedRevision as number,
            expectedVersion: command.expectedVersion as number,
            acknowledgeLocalInstructions: true,
          }),
        };
      }
      case "release-automation": {
        if (
          command.confirm !== true ||
          !onlyKeys(command, ["action", "orgId", "localAutomationId", "confirm"]) ||
          typeof command.localAutomationId !== "string" ||
          !LOCAL_AUTOMATION_ID.test(command.localAutomationId)
        )
          return invalid;
        const handler = owner().releaseAutomation;
        if (!handler) return unsupported;
        await handler({ orgId, localAutomationId: command.localAutomationId });
        return { ok: true };
      }
      default: {
        if (!onlyKeys(command, ["action", "orgId"])) return invalid;
        const handler = owner().readAutomationAdoptions;
        if (!handler) return unsupported;
        return { ok: true, automationAdoptions: await handler(orgId) };
      }
    }
  } catch (error) {
    return { ok: false, code: stableCode(error) };
  }
}
