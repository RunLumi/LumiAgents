/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { writeFile } from "node:fs/promises";
import {
  createToolExecutor,
  createToolRegistry,
  PermissionService,
  createLumiManagedToolDecisionPortAdapter,
} from "@zcode/core";
import type { ManagedRunContext, ManagedToolIdentity } from "@zcode/contracts";
import {
  zcodeProtocolMethods,
  type ZCodeManagedToolDecisionRequestParams,
  type ZCodeManagedToolDecisionResult,
  type ZCodeManagedToolIdentityRequest,
  type ZCodeManagedToolIdentityResolution,
  type ZCodeManagedToolResultRequestParams,
} from "@zcode/shared";
import { createManagedToolDecisionPort } from "../src/zcode-protocol/managed-tool-decision.js";

/** Supporting Core/bootstrap/device/Worker proof with a reviewed fixture handler.
 * No model, Electron IPC or Main assembly is simulated as production evidence.
 */
export function createManagedResultFixture(input: {
  context: ManagedRunContext;
  tool: ManagedToolIdentity;
  toolCallId: string;
  file: string;
  handlerTimeoutMs?: number;
  resolve(params: ZCodeManagedToolIdentityRequest): Promise<ZCodeManagedToolIdentityResolution>;
  decide(params: ZCodeManagedToolDecisionRequestParams): Promise<ZCodeManagedToolDecisionResult>;
  report(params: ZCodeManagedToolResultRequestParams): Promise<void>;
}) {
  let effects = 0,
    reports = 0;
  const port = createManagedToolDecisionPort({
    requestClient: async (method, params, schema) => {
      if (method === zcodeProtocolMethods.interactionResolveManagedToolIdentity)
        return schema.parse(await input.resolve(params as ZCodeManagedToolIdentityRequest));
      if (method === zcodeProtocolMethods.interactionRequestManagedToolDecision)
        return schema.parse(await input.decide(params as ZCodeManagedToolDecisionRequestParams));
      if (method === zcodeProtocolMethods.interactionReportManagedToolResult) {
        const report = params as ZCodeManagedToolResultRequestParams;
        reports++;
        await input.report(report);
        return schema.parse({
          recorded: true,
          runId: report.context.runId,
          toolCallId: report.toolCallId,
          status: report.status,
        });
      }
      throw new Error("unexpected reverse method");
    },
  });
  const registry = createToolRegistry();
  registry.register({
    capability: "Controlled external side effect fixture",
    inputSchema: {
      type: "object",
      properties: { operation: { type: "string" } },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      additionalProperties: false,
    },
    metadata: {
      name: input.tool.name,
      readOnly: false,
      concurrentSafe: false,
      sideEffectScope: "system",
      riskLevel: "high",
      needsApproval: true,
    },
    managedIdentity: { ...input.tool, toolId: `tool_${"0".repeat(32)}`, catalogued: false },
    permission: {
      permission: "execute",
      reason: "Reviewed fixture",
      riskLevel: "high",
      sideEffectScope: "system",
      needsApproval: true,
      patternSources: ["toolName"],
      denyPriority: "beforeAsk",
    },
    resultBudget: {
      maxInlineBytes: 16384,
      maxModelBytes: 16384,
      strategy: "truncate",
      preview: { direction: "head" },
    },
    timeout: {
      kind: "timed",
      defaultMs: input.handlerTimeoutMs ?? 30_000,
      allowCallOverride: false,
    },
    cancellation: { supported: true, cleanup: "bestEffort", userVisibleMessage: "cancelled" },
    trace: {
      required: true,
      propagateToAdapters: true,
      recordInput: "summary",
      recordOutput: "summary",
    },
    handler: async () => {
      effects++;
      await writeFile(input.file, "automatic-core-effect");
      return { ok: true };
    },
  });
  const executor = createToolExecutor({
    registry,
    permissionService: new PermissionService({
      allowedTools: new Set([input.tool.name]),
      disallowedTools: new Set(),
      autoApproveHighRisk: true,
      allowMediumRiskInAutoMode: true,
    }),
    permissionBroker: { requestPermission: async () => ({ decision: "deny" }) },
    emitEvent: async () => {},
    sessionId: "local-core-result-fixture" as never,
    getMode: () => "build",
    getWorkingDirectory: () => ".",
    getWorkspaceRoot: () => ".",
    managedDecisionAdapter: {
      ...createLumiManagedToolDecisionPortAdapter(port),
      requireResultReporting: true,
      isManaged: () => false,
    },
  });
  return {
    execute: () =>
      executor.execute(
        { id: input.toolCallId, name: input.tool.name, input: { operation: "write" } },
        { managedContext: input.context },
      ),
    counts: () => ({ effects, reports }),
  };
}
