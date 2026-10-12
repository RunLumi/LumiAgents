/**
 * DE2E-CLI-02 — managed MCP / browser / computer-use enforcement through the real Core path.
 *
 * Everything below the Host boundary is the production code: the agent-side reverse port
 * (`createManagedToolDecisionPort`, wired by `createWorkspaceZCodeApp`), the Core adapter and
 * ToolExecutor/call-runner gate, the real ToolRegistry with `registerMcpTools` over the real stdio
 * MCP client (`createMcpAdapter`) talking to a real MCP server process, and the built-in `js`
 * (node_repl + browser use) tool. Only Main is faked: `requestClient` answers the four reverse
 * methods the way Main does (decision/approval/catalog/revocation outcomes).
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserControlPort, McpPort } from "@zcode/contracts";
import {
  createLumiManagedToolDecisionPortAdapter,
  createToolExecutor,
  createToolRegistry,
  PermissionService,
  registerBuiltInTools,
  registerMcpTools,
  summarizeRuntimeCapabilities,
  type ToolRegistry,
} from "@zcode/core";
import { createMcpAdapter } from "@zcode/adapters/mcp";
import { zcodeProtocolMethods } from "@zcode/shared";
import { createManagedToolDecisionPort } from "../src/zcode-protocol/managed-tool-decision.js";

const sessionId = "session_managed_enforcement" as never;
const context = {
  organizationId: `org_${"1".repeat(32)}`,
  projectId: `prj_${"2".repeat(32)}`,
  deviceId: `dvc_${"3".repeat(32)}`,
  agentSessionId: `rse_${"4".repeat(32)}`,
  runId: `run_${"5".repeat(32)}`,
  agentDefinitionId: `agd_${"6".repeat(32)}`,
  agentDefinitionVersion: 1,
  requestId: `req_${"7".repeat(32)}`,
  executionMode: "managed" as const,
};

type Scenario =
  | "allow"
  | "deny"
  | "approval_denied"
  | "approval_wait_expired"
  | "approval_expired_on_allow"
  | "approval_unresolved"
  | "revoked";

const SCENARIOS_THAT_MUST_NOT_RUN: readonly Scenario[] = [
  "deny",
  "approval_denied",
  "approval_wait_expired",
  "approval_expired_on_allow",
  "approval_unresolved",
  "revoked",
];

/** Main, seen from the agent: answers the reverse requests and validates them like Main does. */
function fakeMain(scenario: Scenario) {
  const calls: string[] = [];
  const requestClient = async (
    method: string,
    params: Record<string, unknown> & { tool?: Record<string, unknown> },
    schema: { parse(value: unknown): unknown },
  ) => {
    calls.push(method);
    // Revocation: Main's `authorizeManagedRequest` re-reads the device with its token and fails.
    if (scenario === "revoked") throw new Error("lumi_device_refused");
    const reply = (value: unknown) => schema.parse(value);
    if (method === zcodeProtocolMethods.interactionResolveManagedToolIdentity)
      return reply({ runId: context.runId, identity: { ...params.tool, catalogued: true } });
    if (method === zcodeProtocolMethods.interactionReportRuntimeCapabilities)
      return reply({ runId: context.runId, recorded: true });
    if (method === zcodeProtocolMethods.interactionReportManagedToolResult)
      return reply({
        recorded: true,
        runId: context.runId,
        toolCallId: params.toolCallId,
        status: params.status,
      });
    if (method !== zcodeProtocolMethods.interactionRequestManagedToolDecision)
      throw new Error(`unexpected reverse method ${method}`);
    const tool = params.tool!;
    const bound = {
      runId: context.runId,
      toolCallId: params.toolCallId,
      toolId: tool.toolId,
      toolFingerprint: tool.fingerprint,
      riskClass: tool.riskClass,
      policyVersion: 3,
      policyState: "ok",
      argumentsHash: params.argumentsHash,
    };
    switch (scenario) {
      case "allow":
        return reply({ decision: "allow", ...bound });
      case "deny":
        return reply({ decision: "deny", reasonCode: "tool_denied", ...bound });
      case "approval_denied":
        // Main waited (`waitForLumiManagedApproval`) and the reviewer denied.
        return reply({ decision: "deny", reasonCode: "approval_denied", ...bound });
      case "approval_wait_expired":
        // Main's approval wait throws once the approval or the wait expires.
        throw new Error("lumi_approval_wait_expired");
      case "approval_expired_on_allow":
        return reply({
          decision: "allow",
          approvalId: `apr_${"8".repeat(32)}`,
          approvalMode: "per_use",
          approvalExpiresAt: "2020-01-01T00:00:00.000Z",
          ...bound,
        });
      case "approval_unresolved":
        return reply({
          decision: "require_per_use_approval",
          approvalId: `apr_${"9".repeat(32)}`,
          approvalMode: "per_use",
          approvalExpiresAt: "2999-01-01T00:00:00.000Z",
          ...bound,
        });
    }
  };
  // Exactly how `createWorkspaceZCodeApp` composes the production adapter.
  const adapter = {
    ...createLumiManagedToolDecisionPortAdapter(
      createManagedToolDecisionPort({ requestClient } as never),
    ),
    requireResultReporting: true,
    isManaged: () => false,
  };
  return { adapter, calls };
}

function executorFor(
  registry: ToolRegistry,
  adapter: ReturnType<typeof fakeMain>["adapter"] | undefined,
  extra: { browserControlPort?: BrowserControlPort } = {},
) {
  return createToolExecutor({
    registry,
    permissionService: new PermissionService({
      allowedTools: new Set(registry.list()),
      disallowedTools: new Set(),
      autoApproveHighRisk: true,
      allowMediumRiskInAutoMode: true,
    }),
    permissionBroker: { requestPermission: async () => ({ decision: "deny" as const }) },
    emitEvent: async () => {},
    sessionId,
    getMode: () => "build",
    getWorkingDirectory: () => tmpdir(),
    getWorkspaceRoot: () => tmpdir(),
    ...(adapter ? { managedDecisionAdapter: adapter } : {}),
    ...extra,
  } as never);
}

describe("managed MCP enforcement over a real stdio MCP server", () => {
  let root: string;
  let effectLog: string;
  let mcp: McpPort & { close(): Promise<void> };
  const effects = async () =>
    (await readFile(effectLog, "utf8").catch(() => "")).split("\n").filter(Boolean).length;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "lumi-managed-mcp-"));
    effectLog = join(root, "effects.log");
    const serverPath = join(root, "server.mjs");
    await writeFile(
      serverPath,
      [
        "import { appendFile } from 'node:fs/promises';",
        `import { McpServer } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/server"))};`,
        `import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/server/stdio"))};`,
        "const server = new McpServer({ name: 'lumi-benign-stub', version: '1.0.0' });",
        "server.registerTool('touch', { description: 'append one line', inputSchema: {} }, async () => {",
        "  await appendFile(process.env.EFFECT_LOG, 'touched\\n');",
        "  return { content: [{ type: 'text', text: 'touched' }] };",
        "});",
        "await server.connect(new StdioServerTransport());",
      ].join("\n"),
    );
    mcp = createMcpAdapter() as never;
    await mcp.connectServer("stub", {
      type: "stdio",
      command: process.execPath,
      args: [serverPath],
      env: { EFFECT_LOG: effectLog },
      timeoutMs: 10_000,
    } as never);
  }, 30_000);

  afterAll(async () => {
    await mcp?.close();
    await rm(root, { recursive: true, force: true });
  });

  async function registryWithStub() {
    const registry = createToolRegistry();
    // The same registration Core uses for connected servers (runtime/methods/mcp.ts).
    expect(registerMcpTools(registry, mcp, await mcp.listTools())).toEqual(["mcp__stub__touch"]);
    return registry;
  }

  const call = { id: "call_mcp_touch", name: "mcp__stub__touch", input: {} } as never;

  for (const scenario of SCENARIOS_THAT_MUST_NOT_RUN) {
    it(`${scenario}: the MCP server's handler never runs`, async () => {
      const registry = await registryWithStub();
      const main = fakeMain(scenario);
      const before = await effects();
      const result = await executorFor(registry, main.adapter).execute(call, {
        managedContext: context,
      } as never);
      expect(result.success).toBe(false);
      expect(result.error?.message ?? "").toMatch(/Managed tool decision denied/);
      expect(await effects()).toBe(before);
    });
  }

  it("allow: the benign MCP tool runs exactly once and the result is acknowledged", async () => {
    const registry = await registryWithStub();
    expect(summarizeRuntimeCapabilities(registry)).toMatchObject({
      mcp_execution: true,
      computer_use: false,
    });
    const main = fakeMain("allow");
    const before = await effects();
    const result = await executorFor(registry, main.adapter).execute(call, {
      managedContext: context,
    } as never);
    expect(result.success).toBe(true);
    expect(await effects()).toBe(before + 1);
    expect(main.calls).toEqual([
      zcodeProtocolMethods.interactionReportRuntimeCapabilities,
      zcodeProtocolMethods.interactionResolveManagedToolIdentity,
      zcodeProtocolMethods.interactionRequestManagedToolDecision,
      zcodeProtocolMethods.interactionReportManagedToolResult,
    ]);
  });
});

describe("managed browser use through the built-in node_repl js tool", () => {
  function browserFixture() {
    const executed: string[] = [];
    const port: BrowserControlPort = {
      list: async () => [
        { id: "iab-1", generation: 1, type: "iab", name: "In-app Browser", capabilities: {} },
      ],
      execute: async (input) => {
        executed.push(input.command.method);
        return {
          ok: true,
          tab: { tabId: "tab-1", url: "about:blank", title: "", viewport: { width: 1, height: 1 } },
          elapsedMs: 1,
        } as never;
      },
    };
    const registry = createToolRegistry();
    // The production built-in registration with browser use enabled (official plugin path).
    registerBuiltInTools(registry, {
      includeNodeRepl: true,
      includeBrowserUse: true,
      allowedTools: ["js"],
    });
    return { executed, port, registry };
  }

  const call = (id: string) =>
    ({
      id,
      name: "js",
      input: {
        title: "Open a tab",
        code: "const b = await agent.browsers.getDefault(); await b.tabs.new(); return 'ok';",
      },
    }) as never;

  for (const scenario of SCENARIOS_THAT_MUST_NOT_RUN) {
    it(`${scenario}: no browser command reaches the browser`, async () => {
      const { executed, port, registry } = browserFixture();
      expect(summarizeRuntimeCapabilities(registry).browser_use).toBe(true);
      const main = fakeMain(scenario);
      const result = await executorFor(registry, main.adapter, {
        browserControlPort: port,
      }).execute(call(`call_browser_${scenario}`), { managedContext: context } as never);
      expect(result.success).toBe(false);
      expect(result.error?.message ?? "").toMatch(/Managed tool decision denied/);
      expect(executed).toEqual([]);
    });
  }

  it("allow: the browser command runs once through the real js handler", async () => {
    const { executed, port, registry } = browserFixture();
    const main = fakeMain("allow");
    const result = await executorFor(registry, main.adapter, { browserControlPort: port }).execute(
      call("call_browser_allow"),
      { managedContext: context } as never,
    );
    expect(result.success).toBe(true);
    expect(executed).toEqual(["newTab"]);
    expect(main.calls.at(-1)).toBe(zcodeProtocolMethods.interactionReportManagedToolResult);
  }, 30_000);
});

describe("computer use is NOT_APPLICABLE on this build", () => {
  // The shipped `@zcode/zcode-cua` runtime itself is covered in
  // core/tests/lumi-computer-use-placeholder.test.ts (core owns that dependency).
  it("the managed runtime capability report never claims computer use", () => {
    const registry = createToolRegistry();
    // Every built-in family switched on, including node_repl and browser use.
    registerBuiltInTools(registry, {
      includeAgent: true,
      includeNodeRepl: true,
      includeBrowserUse: true,
      includeSendMessage: true,
    } as never);
    const report = summarizeRuntimeCapabilities(registry);
    expect(report.browser_use).toBe(true);
    expect(report.computer_use).toBe(false);
  });

  it("a computer-class tool absent from the reviewed catalog is refused before its handler", async () => {
    let ran = 0;
    const registry = createToolRegistry();
    registry.register({
      capability: "computer control fixture",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: { type: "object" },
      metadata: {
        name: "ComputerFixture",
        readOnly: false,
        destructive: false,
        concurrentSafe: false,
        riskLevel: "high",
        needsApproval: true,
      },
      permission: {
        permission: "execute",
        reason: "fixture",
        riskLevel: "high",
        sideEffectScope: "system",
        needsApproval: true,
        patternSources: ["toolName"],
        denyPriority: "beforeAsk",
      },
      timeout: { kind: "timed", defaultMs: 1_000, allowCallOverride: false },
      handler: async () => {
        ran++;
        return {};
      },
    } as never);
    expect(summarizeRuntimeCapabilities(registry).computer_use).toBe(true);
    // Main's reviewed catalog has no computer tool for this build: identity resolves to null.
    const main = fakeMain("allow");
    const adapter = {
      ...main.adapter,
      resolveIdentity: async () => undefined,
    };
    const result = await executorFor(registry, adapter).execute(
      { id: "call_computer", name: "ComputerFixture", input: {} } as never,
      { managedContext: context } as never,
    );
    expect(result.success).toBe(false);
    expect(result.error?.message ?? "").toMatch(/tool_not_found/);
    expect(ran).toBe(0);
  });
});
