/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// Main 侧的自动化接管装配：把 services 的纯编排接到真实端口（人类会话传输、已授权工作区、AutomationRepo）。
// 顺序与不变量在 createAutomationAdoptionOwner（spec 07）；这里不复制顺序，只提供端口。
// 渲染进程拿到的只有投影：不含 prompt、令牌、租约。
import {
  AutomationRepo,
  createAutomationAdoptionOwner,
  type AdoptionLocalPort,
  type AdoptionServerPort,
  type LocalAutomationMetadata,
  type LumiAccountHostTransport,
} from "@zcode/services/node";
import type { LumiAutomationAdoptionProjection } from "@zcode/shared";
import type { AutomationCommandOwner } from "./lumiAutomationCommands.js";

interface AuthorizedWorkspace {
  projectId: string;
  workspaceBindingId: string;
  adoptionStateId: string;
}

export interface LumiAutomationAssemblyDeps {
  transport: LumiAccountHostTransport;
  /** 已授权托管工作区（managed_policy + 设备有效 + 策略未过期）；未满足即抛出稳定 lumi_* 错误。 */
  authorizeWorkspace(orgId: string, workspaceIdentity: string): Promise<AuthorizedWorkspace>;
  /** 默认惰性创建；测试注入临时库。仅在用户发起自动化命令时才打开 tasks-index。 */
  repo?: () => AutomationRepo;
  now?: () => number;
  /**
   * 账号代数：登出与登录完成各自递增。命令开始时记录，每次服务端调用/本地写入前复核；
   * 同一用户重新登录也是另一代，不能把旧代已开始的确认继续做完。
   */
  generation?: () => number;
}

function projection(
  marker: {
    localAutomationId: string;
    state: "suppressed" | "managed" | "releasing";
    origin: "created" | "attached";
    managedAutomationId: string | null;
  },
  ambiguousOccurrences = 0,
): LumiAutomationAdoptionProjection {
  return {
    localAutomationId: marker.localAutomationId,
    state: marker.state,
    origin: marker.origin,
    managedAutomationId: marker.managedAutomationId,
    ...(ambiguousOccurrences > 0 ? { ambiguousOccurrences } : {}),
  };
}

export function createLumiAutomationAssembly(
  deps: LumiAutomationAssemblyDeps,
): AutomationCommandOwner {
  let sharedRepo: AutomationRepo | undefined;
  const repo = () => deps.repo?.() ?? (sharedRepo ??= new AutomationRepo());
  const generation = deps.generation ?? (() => 0);

  /** 会话/代数新鲜度围栏：fresh() 在每个会产生副作用的步骤之前调用。 */
  async function authorized<T>(
    orgId: string,
    operation: (fresh: () => void) => Promise<T>,
  ): Promise<T> {
    const read = async () => {
      const account = await deps.transport.readAccount();
      if (
        !account.organizations.some(
          (org) => org.id === orgId && org.state === "active" && org.status === "active",
        )
      )
        throw new Error("lumi_org_unavailable");
      return account.user.id;
    };
    const startedGeneration = generation();
    const fresh = () => {
      if (generation() !== startedGeneration) throw new Error("lumi_account_changed");
    };
    const userId = await read();
    fresh();
    const result = await operation(fresh);
    fresh();
    if ((await read()) !== userId) throw new Error("lumi_account_changed");
    fresh();
    return result;
  }

  const localPort = (fresh: () => void): AdoptionLocalPort => ({
    async readMetadata(id): Promise<LocalAutomationMetadata | null> {
      const row = await repo().get(id);
      if (!row) return null;
      // 类型上不携带 prompt：元数据是显式挑选的字段，而不是展开整行再删除。
      return {
        automationId: row.automationId,
        title: row.title,
        cronExpr: row.cronExpr,
        recurring: row.recurring,
        ...(row.maxRuns === undefined ? {} : { maxRuns: row.maxRuns }),
        ...(row.endAt === undefined ? {} : { endAt: row.endAt }),
        ...(row.scheduleRule === undefined ? {} : { scheduleRule: row.scheduleRule }),
        ...(row.targetTaskId === undefined ? {} : { targetTaskId: row.targetTaskId }),
        ...((await repo().hasBotDeliveryTargetRaw(id)) ? { botDeliveryTarget: true } : {}),
        locationKind: row.locationKind,
        ...(row.nextRunAt === undefined ? {} : { nextRunAt: row.nextRunAt }),
        enabled: row.enabled,
        lifecycleStatus: row.lifecycleStatus,
        workspacePath: row.workspacePath,
        ...(row.workspaceIdentity ? { workspaceIdentity: row.workspaceIdentity } : {}),
        revision: row.updatedAt,
      };
    },
    getMarker: (id) => repo().getManagedAdoption(id),
    getMarkerByManagedId: (orgId, managedId) => repo().getManagedAdoptionByManagedId(orgId, managedId),
    beginAttach(input) {
      fresh();
      return repo().beginManagedAttach(input);
    },
    beginAdoption(input) {
      fresh();
      return repo().beginManagedAdoption(input);
    },
    recordCreated(input) {
      fresh();
      return repo().recordManagedAutomationCreated(input);
    },
    beginRelease(id) {
      fresh();
      return repo().beginManagedRelease(id);
    },
    completeRelease(id) {
      fresh();
      return repo().completeManagedRelease(id);
    },
  });

  /** 每次服务端调用之前复核；调用返回之后的复核由下一步的 fresh() 与 authorized() 收口。 */
  const serverPort = (fresh: () => void): AdoptionServerPort => {
    const server = deps.transport.automations();
    return {
      previewImport: (...args) => (fresh(), server.previewImport(...args)),
      createManaged: (...args) => (fresh(), server.createManaged(...args)),
      findManagedByCorrelation: (...args) => (fresh(), server.findManagedByCorrelation(...args)),
      getManaged: (...args) => (fresh(), server.getManaged(...args)),
      listManagedForProject: (...args) => (fresh(), server.listManagedForProject(...args)),
      pauseManaged: (...args) => (fresh(), server.pauseManaged(...args)),
      deleteManaged: (...args) => (fresh(), server.deleteManaged(...args)),
    };
  };

  const ownerFor = (orgId: string, fresh: () => void) =>
    createAutomationAdoptionOwner({
      local: localPort(fresh),
      server: serverPort(fresh),
      context: {
        userId: async () => (await deps.transport.readAccount()).user.id,
        resolveWorkspace: (workspaceIdentity) => deps.authorizeWorkspace(orgId, workspaceIdentity),
        timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
        now: deps.now ?? Date.now,
      },
    });

  return {
    previewAutomationAdoption: (input) =>
      authorized(input.orgId, async (fresh) => {
        const result = await ownerFor(input.orgId, fresh).preview(input);
        return {
          ...result,
          rows: result.rows.map((row) =>
            row.adoptable ? { ...row, revision: row.revision ?? 0 } : row,
          ),
        };
      }),
    async adoptAutomation(input) {
      const result = await authorized(input.orgId, (fresh) =>
        ownerFor(input.orgId, fresh).adopt({ ...input, confirm: true }),
      );
      return {
        localAutomationId: input.localAutomationId,
        state: "managed",
        origin: "created",
        managedAutomationId: result.managedAutomationId,
      };
    },
    previewAutomationAttach: (input) =>
      authorized(input.orgId, async (fresh) => {
        const result = await ownerFor(input.orgId, fresh).previewAttach(input);
        return result.adoptable ? { ...result, revision: result.revision ?? 0 } : result;
      }),
    async attachAutomation(input) {
      const result = await authorized(input.orgId, (fresh) =>
        ownerFor(input.orgId, fresh).attach({ ...input, confirm: true }),
      );
      return {
        localAutomationId: input.localAutomationId,
        state: "managed",
        origin: "attached",
        managedAutomationId: result.managedAutomationId,
      };
    },
    async releaseAutomation(input) {
      await authorized(input.orgId, (fresh) => ownerFor(input.orgId, fresh).release(input));
    },
    async readAutomationAdoptions(orgId) {
      return authorized(orgId, async () => {
        const [markers, ambiguous] = await Promise.all([
          repo().listManagedAdoptions({ orgId }),
          repo().listManagedOccurrences({ orgId, state: "ambiguous" }),
        ]);
        const counts = new Map<string, number>();
        for (const row of ambiguous)
          counts.set(row.localAutomationId, (counts.get(row.localAutomationId) ?? 0) + 1);
        return markers.map((marker) => projection(marker, counts.get(marker.localAutomationId)));
      });
    },
  };
}
