/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { randomUUID } from "node:crypto";
import type { LumiManagedRunProjection, LumiManagedSessionProjection } from "@zcode/shared";
import { LumiAccountError } from "./errors.js";
import type { LumiDeviceCredential } from "./deviceTransport.js";

type ManagedRunRequest = (
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
) => Promise<Record<string, unknown> | undefined>;

/** P05 session/run lifecycle over the private DeviceToken transport. */
export class LumiManagedRunHostTransport {
  readonly #request: ManagedRunRequest;
  readonly #credential: () => LumiDeviceCredential | undefined;

  constructor(request: ManagedRunRequest, credential: () => LumiDeviceCredential | undefined) {
    this.#request = request;
    this.#credential = credential;
  }

  #session(value: Record<string, unknown>): LumiManagedSessionProjection {
    const credential = this.#credential();
    if (
      typeof value.agent_session_id !== "string" ||
      !/^rse_[0-9a-f]{32}$/.test(value.agent_session_id) ||
      value.org_id !== credential?.orgId ||
      typeof value.project_id !== "string" ||
      !/^prj_[0-9a-f]{32}$/.test(value.project_id) ||
      value.device_id !== credential?.id ||
      !(
        value.workspace_binding_id === null ||
        (typeof value.workspace_binding_id === "string" &&
          /^wsb_[0-9a-f]{32}$/.test(value.workspace_binding_id))
      ) ||
      typeof value.agent_definition_id !== "string" ||
      !/^agd_[0-9a-f]{32}$/.test(value.agent_definition_id) ||
      !Number.isSafeInteger(value.agent_definition_version) ||
      !["active", "closed", "archived"].includes(String(value.lifecycle)) ||
      !Number.isSafeInteger(value.version) ||
      !(
        value.external_id === null ||
        (typeof value.external_id === "string" && value.external_id.length <= 256)
      ) ||
      !(value.title === null || (typeof value.title === "string" && value.title.length <= 200))
    )
      throw new LumiAccountError("lumi_device_response_invalid");
    return {
      agentSessionId: value.agent_session_id,
      orgId: value.org_id as string,
      projectId: value.project_id,
      deviceId: credential!.id,
      workspaceBindingId: value.workspace_binding_id as string | null,
      agentDefinitionId: value.agent_definition_id,
      agentDefinitionVersion: value.agent_definition_version as number,
      externalId: value.external_id as string | null,
      title: value.title as string | null,
      lifecycle: value.lifecycle as LumiManagedSessionProjection["lifecycle"],
      version: value.version as number,
    };
  }

  #run(value: Record<string, unknown>): LumiManagedRunProjection {
    const credential = this.#credential();
    if (typeof value.run_id !== "string" && typeof value.id !== "string")
      throw new LumiAccountError("lumi_device_response_invalid");
    const runId = (value.run_id ?? value.id) as string;
    if (
      !/^run_[0-9a-f]{32}$/.test(runId) ||
      value.org_id !== credential?.orgId ||
      typeof value.project_id !== "string" ||
      !/^prj_[0-9a-f]{32}$/.test(value.project_id) ||
      typeof value.agent_session_id !== "string" ||
      !/^rse_[0-9a-f]{32}$/.test(value.agent_session_id) ||
      value.device_id !== credential?.id ||
      typeof value.agent_definition_id !== "string" ||
      !/^agd_[0-9a-f]{32}$/.test(value.agent_definition_id) ||
      !Number.isSafeInteger(value.agent_definition_version) ||
      typeof value.workspace_binding_id !== "string" ||
      !/^wsb_[0-9a-f]{32}$/.test(value.workspace_binding_id) ||
      typeof value.model_alias !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value.model_alias) ||
      !Number.isSafeInteger(value.version) ||
      typeof value.state !== "string" ||
      (value.policy_snapshot_id !== null && typeof value.policy_snapshot_id !== "string") ||
      (value.policy_version !== null && !Number.isSafeInteger(value.policy_version)) ||
      (value.request_id !== null &&
        (typeof value.request_id !== "string" || !/^req_[0-9a-f]{32}$/.test(value.request_id)))
    )
      throw new LumiAccountError("lumi_device_response_invalid");
    return {
      runId,
      orgId: value.org_id as string,
      projectId: value.project_id,
      agentSessionId: value.agent_session_id,
      deviceId: credential!.id,
      agentDefinitionId: value.agent_definition_id,
      agentDefinitionVersion: value.agent_definition_version as number,
      workspaceBindingId: value.workspace_binding_id,
      modelAlias: value.model_alias,
      policySnapshotId: value.policy_snapshot_id as string | null,
      policyVersion: value.policy_version as number | null,
      state: value.state,
      version: value.version as number,
      requestId: value.request_id as string | null,
    };
  }

  async createSession(
    input: {
      projectId: string;
      agentDefinitionId: string;
      workspaceBindingId: string;
      title?: string;
    },
    idempotencyKey = randomUUID(),
  ): Promise<LumiManagedSessionProjection> {
    if (
      !this.#credential() ||
      !/^prj_[0-9a-f]{32}$/.test(input.projectId) ||
      !/^agd_[0-9a-f]{32}$/.test(input.agentDefinitionId) ||
      !/^wsb_[0-9a-f]{32}$/.test(input.workspaceBindingId) ||
      (input.title !== undefined && (!input.title.trim() || input.title.length > 200)) ||
      !idempotencyKey ||
      idempotencyKey.length > 128
    )
      throw new LumiAccountError("lumi_managed_session_invalid");
    const row = await this.#request(
      "/api/v1/devices/sessions",
      "POST",
      {
        project_id: input.projectId,
        agent_definition_id: input.agentDefinitionId,
        workspace_binding_id: input.workspaceBindingId,
        external_id: `lumi-desktop-${randomUUID()}`,
        ...(input.title ? { title: input.title.trim() } : {}),
      },
      { "Idempotency-Key": idempotencyKey },
    );
    if (!row) throw new LumiAccountError("lumi_device_response_invalid");
    return this.#session(row);
  }

  async createRun(agentSessionId: string, modelAlias: string, idempotencyKey = randomUUID()) {
    if (
      !/^rse_[0-9a-f]{32}$/.test(agentSessionId) ||
      !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(modelAlias) ||
      !idempotencyKey ||
      idempotencyKey.length > 128
    )
      throw new LumiAccountError("lumi_managed_run_invalid");
    const row = await this.#request(
      `/api/v1/devices/sessions/${agentSessionId}/runs`,
      "POST",
      { model_alias: modelAlias, execution_mode: "managed" },
      { "Idempotency-Key": idempotencyKey },
    );
    if (!row) throw new LumiAccountError("lumi_device_response_invalid");
    return this.#run(row);
  }

  async getRun(runId: string) {
    if (!/^run_[0-9a-f]{32}$/.test(runId)) throw new LumiAccountError("lumi_managed_run_invalid");
    const row = await this.#request(`/api/v1/devices/runs/${runId}`, "GET");
    if (!row) throw new LumiAccountError("lumi_device_response_invalid");
    return this.#run(row);
  }

  startRun(run: LumiManagedRunProjection, key = randomUUID()) {
    return this.#transition(run, "start", { version: run.version }, key);
  }
  completeRun(run: LumiManagedRunProjection, key = randomUUID()) {
    return this.#transition(run, "complete", { version: run.version }, key);
  }
  failRun(run: LumiManagedRunProjection, failureCode: string, key = randomUUID()) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(failureCode))
      throw new LumiAccountError("lumi_managed_run_invalid");
    return this.#transition(run, "fail", { version: run.version, failure_code: failureCode }, key);
  }
  cancelRun(run: LumiManagedRunProjection, key = randomUUID()) {
    return this.#transition(run, "cancel", { version: run.version }, key);
  }

  async #transition(
    run: LumiManagedRunProjection,
    action: "start" | "complete" | "fail" | "cancel",
    body: Record<string, unknown>,
    idempotencyKey: string,
  ) {
    const credential = this.#credential();
    if (
      !credential ||
      run.orgId !== credential.orgId ||
      run.deviceId !== credential.id ||
      !/^run_[0-9a-f]{32}$/.test(run.runId) ||
      !idempotencyKey ||
      idempotencyKey.length > 128
    )
      throw new LumiAccountError("lumi_managed_run_invalid");
    const row = await this.#request(`/api/v1/devices/runs/${run.runId}/${action}`, "POST", body, {
      "Idempotency-Key": idempotencyKey,
    });
    if (!row) throw new LumiAccountError("lumi_device_response_invalid");
    return this.#run(row);
  }
}
