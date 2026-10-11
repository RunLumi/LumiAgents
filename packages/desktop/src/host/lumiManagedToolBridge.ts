/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { randomUUID } from "node:crypto";
import {
  HostResponseTypes,
  hostLumiManagedToolDecisionResultSchema,
  hostLumiManagedToolReportResultSchema,
  hostLumiManagedToolIdentityResultSchema,
  hostLumiRuntimeCapabilitiesResultSchema,
  type ZCodeManagedRuntimeCapabilitiesAck,
  type ZCodeManagedRuntimeCapabilitiesRequest,
  type ZCodeManagedToolIdentityRequest,
  type ZCodeManagedToolIdentityResolution,
  type ZCodeManagedToolResultRequestParams,
  type ZCodeManagedToolResultAck,
  type ZCodeManagedToolDecisionRequestParams,
  type ZCodeManagedToolDecisionResult,
} from "@zcode/shared";

type BridgeKind = "decision" | "report" | "identity" | "capabilities";

const REQUEST_TYPES = {
  decision: HostResponseTypes.LumiManagedToolDecisionRequest,
  report: HostResponseTypes.LumiManagedToolReportRequest,
  identity: HostResponseTypes.LumiManagedToolIdentityRequest,
  capabilities: HostResponseTypes.LumiRuntimeCapabilitiesRequest,
} as const;

const RESULT_KINDS: Readonly<Record<string, BridgeKind>> = {
  "lumi-managed-tool-decision-result": "decision",
  "lumi-managed-tool-report-result": "report",
  "lumi-managed-tool-identity-result": "identity",
  "lumi-runtime-capabilities-result": "capabilities",
};

/** Window Host's private Main bridge. No renderer event or credential material. */
export function createLumiManagedToolBridge(post: (message: unknown) => void, timeoutMs?: number) {
  const pending = new Map<
    string,
    {
      kind: BridgeKind;
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  function send<T>(
    kind: BridgeKind,
    params:
      | ZCodeManagedToolDecisionRequestParams
      | ZCodeManagedToolResultRequestParams
      | ZCodeManagedToolIdentityRequest
      | ZCodeManagedRuntimeCapabilitiesRequest,
    workspaceIdentity: string,
  ) {
    const requestId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          pending.delete(requestId);
          reject(new Error("lumi_managed_tool_timeout"));
        },
        timeoutMs ?? (kind === "decision" ? 930_000 : 40_000),
      );
      timer.unref();
      pending.set(requestId, { kind, resolve: (value) => resolve(value as T), reject, timer });
      try {
        post({ type: REQUEST_TYPES[kind], requestId, workspaceIdentity, params });
      } catch {
        clearTimeout(timer);
        pending.delete(requestId);
        reject(new Error("lumi_managed_tool_unavailable"));
      }
    });
  }
  return {
    resolve(params: ZCodeManagedToolIdentityRequest, workspaceIdentity: string) {
      return send<ZCodeManagedToolIdentityResolution>("identity", params, workspaceIdentity);
    },
    request(params: ZCodeManagedToolDecisionRequestParams, workspaceIdentity: string) {
      return send<ZCodeManagedToolDecisionResult>("decision", params, workspaceIdentity);
    },
    report(params: ZCodeManagedToolResultRequestParams, workspaceIdentity: string) {
      return send<ZCodeManagedToolResultAck>("report", params, workspaceIdentity);
    },
    reportCapabilities(params: ZCodeManagedRuntimeCapabilitiesRequest, workspaceIdentity: string) {
      return send<ZCodeManagedRuntimeCapabilitiesAck>("capabilities", params, workspaceIdentity);
    },
    accept(raw: unknown) {
      const parsed = [
        hostLumiManagedToolIdentityResultSchema,
        hostLumiManagedToolReportResultSchema,
        hostLumiRuntimeCapabilitiesResultSchema,
        hostLumiManagedToolDecisionResultSchema,
      ]
        .map((schema) => schema.safeParse(raw))
        .find((attempt) => attempt.success);
      if (!parsed?.success) return false;
      const reply = parsed.data;
      const entry = pending.get(reply.requestId);
      if (!entry) return false;
      if (RESULT_KINDS[reply.type] !== entry.kind) return false;
      pending.delete(reply.requestId);
      clearTimeout(entry.timer);
      const value =
        "resolution" in reply
          ? reply.resolution
          : "ack" in reply
            ? reply.ack
            : "result" in reply
              ? reply.result
              : undefined;
      if (reply.ok && value) entry.resolve(value);
      else entry.reject(new Error(reply.errorCode ?? "lumi_managed_tool_refused"));
      return true;
    },
    dispose() {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("lumi_managed_tool_unavailable"));
      }
      pending.clear();
    },
  };
}
