/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
// 本地任务 → P06 托管任务的纯映射（spec: docs/specs/lumi-agents/07-automation-adoption-scheduling.md）。
// 只产出元数据：永远不读取、不序列化 prompt、工具参数、路径或历史。
// 不能忠实表达的形态一律判为不可接管，原任务继续由本地调度，不做近似转换。
import { buildAutomationAdoptionCorrelation } from "../session/automationManagedAdoption.js";

/** 判定所需的本地任务字段；刻意不含 prompt，调用方想传也传不进来。 */
export interface AdoptableLocalAutomation {
  readonly automationId: string;
  readonly title: string;
  readonly cronExpr: string;
  readonly recurring: boolean;
  readonly maxRuns?: number;
  readonly endAt?: number;
  readonly scheduleRule?: unknown;
  readonly targetTaskId?: string;
  readonly botDeliveryTarget?: unknown;
  readonly locationKind: "local" | "remote";
  readonly nextRunAt?: number;
  readonly enabled: boolean;
  readonly lifecycleStatus: string;
}

export type AutomationAdoptionUnsupportedReason =
  | "unsupported_schedule_rule"
  | "unsupported_schedule_expression"
  | "unsupported_bounded_runs"
  | "unsupported_session_binding"
  | "unsupported_external_delivery"
  | "unsupported_remote_workspace"
  | "unsupported_not_active"
  | "unsupported_one_time_elapsed";

export type AutomationAdoptionClassification =
  | { readonly adoptable: true; readonly scheduleKind: "cron" | "one_time" }
  | { readonly adoptable: false; readonly reason: AutomationAdoptionUnsupportedReason };

const CRON_FIELD_COUNT = 5;

export function classifyLocalAutomation(
  automation: AdoptableLocalAutomation,
  now: number,
): AutomationAdoptionClassification {
  const refuse = (reason: AutomationAdoptionUnsupportedReason) =>
    ({ adoptable: false, reason }) as const;
  if (automation.locationKind === "remote") return refuse("unsupported_remote_workspace");
  if (automation.targetTaskId) return refuse("unsupported_session_binding");
  if (automation.botDeliveryTarget) return refuse("unsupported_external_delivery");
  if (!automation.enabled || automation.lifecycleStatus !== "active")
    return refuse("unsupported_not_active");
  if (automation.scheduleRule) return refuse("unsupported_schedule_rule");
  if (automation.endAt !== undefined) return refuse("unsupported_bounded_runs");
  if (automation.recurring) {
    if (automation.maxRuns !== undefined) return refuse("unsupported_bounded_runs");
    if (automation.cronExpr.trim().split(/\s+/).length !== CRON_FIELD_COUNT)
      return refuse("unsupported_schedule_expression");
    return { adoptable: true, scheduleKind: "cron" };
  }
  if ((automation.maxRuns ?? 1) > 1) return refuse("unsupported_bounded_runs");
  if (automation.nextRunAt === undefined || automation.nextRunAt <= now)
    return refuse("unsupported_one_time_elapsed");
  return { adoptable: true, scheduleKind: "one_time" };
}

/** 服务端 preview 的候选描述：key + 形态 + 能力，没有 prompt/命令/路径。 */
export interface AutomationImportCandidate {
  local_key: string;
  schedule_kind: "cron" | "one_time";
  required_tools: string[];
  required_model_capabilities: string[];
  uses_off_peak: boolean;
  credential_mode: "local_credential" | "metadata_only" | "org_managed_credential";
}

export function buildImportCandidate(
  automation: Pick<AdoptableLocalAutomation, "automationId">,
  scheduleKind: "cron" | "one_time",
): AutomationImportCandidate {
  return {
    local_key: automation.automationId,
    schedule_kind: scheduleKind,
    // 客户端不替服务端断言能力：未知即空，服务端声明 model_capability_check 推迟到派发。
    required_tools: [],
    required_model_capabilities: [],
    uses_off_peak: false,
    credential_mode: "local_credential",
  };
}

export interface ZoneOffsetTransition {
  at_utc: number;
  offset_seconds: number;
}

export interface ZoneOffsetTable {
  utc_offset_seconds: number;
  utc_offset_transitions: ZoneOffsetTransition[];
}

const SECONDS_PER_DAY = 86_400;
const ZONE_HORIZON_DAYS = 366;
const MAX_ZONE_TRANSITIONS = 8;

function offsetSecondsAt(formatter: Intl.DateTimeFormat, epochSeconds: number): number {
  const part = formatter
    .formatToParts(new Date(epochSeconds * 1000))
    .find((item) => item.type === "timeZoneName")?.value;
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(part ?? "");
  if (!match) throw new Error("automation_timezone_unsupported");
  if (!match[1]) return 0;
  const magnitude = Number(match[2]) * 3600 + Number(match[3]) * 60;
  return match[1] === "-" ? -magnitude : magnitude;
}

/**
 * Worker 不带 tz 数据库，名称之外必须由适配器提供当前偏移及有界切换点。
 * 这里用系统 Intl 在一年内逐日扫描并二分定位，超出上限直接拒绝而不是截断。
 */
export function resolveZoneOffsetTable(timezone: string, nowMs: number): ZoneOffsetTable {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  });
  const start = Math.floor(nowMs / 1000);
  const current = offsetSecondsAt(formatter, start);
  const transitions: ZoneOffsetTransition[] = [];
  let previous = current;
  for (let day = 1; day <= ZONE_HORIZON_DAYS; day++) {
    const at = start + day * SECONDS_PER_DAY;
    const offset = offsetSecondsAt(formatter, at);
    if (offset === previous) continue;
    let low = at - SECONDS_PER_DAY;
    let high = at;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (offsetSecondsAt(formatter, middle) === previous) low = middle;
      else high = middle;
    }
    transitions.push({ at_utc: high, offset_seconds: offset });
    if (transitions.length > MAX_ZONE_TRANSITIONS)
      throw new Error("automation_timezone_unsupported");
    previous = offset;
  }
  return { utc_offset_seconds: current, utc_offset_transitions: transitions };
}

export interface ManagedAutomationCreateInput {
  readonly automation: AdoptableLocalAutomation;
  readonly scheduleKind: "cron" | "one_time";
  readonly projectId: string;
  readonly agentDefinitionId: string;
  readonly workspaceBindingId: string;
  readonly modelAlias: string;
  readonly principalUserId: string;
  readonly timezone: string;
  readonly nowMs: number;
}

const MAX_NAME_LENGTH = 120;

/** `POST /orgs/{org}/automations` 的请求体（deny_unknown_fields，字段全部有界元数据）。 */
export function buildManagedAutomationCreateBody(input: ManagedAutomationCreateInput) {
  const { automation } = input;
  const schedule =
    input.scheduleKind === "cron"
      ? {
          kind: "cron" as const,
          expression: automation.cronExpr.trim(),
          timezone: input.timezone,
          // 本地 cron 语义：跳过缺失本地时刻，不为错过的窗口补跑（与本地 5 分钟 misfire 一致的保守选择）。
          dst_policy: "skip_duplicate" as const,
          overlap_policy: "skip" as const,
          missed_policy: "skip" as const,
          ...resolveZoneOffsetTable(input.timezone, input.nowMs),
        }
      : {
          kind: "one_time" as const,
          scheduled_at: new Date(automation.nextRunAt as number).toISOString(),
          overlap_policy: "skip" as const,
          missed_policy: "skip" as const,
        };
  return {
    name: (automation.title.trim() || "Local automation").slice(0, MAX_NAME_LENGTH),
    description: buildAutomationAdoptionCorrelation(automation.automationId),
    project_id: input.projectId,
    agent_definition_id: input.agentDefinitionId,
    execution_principal: { kind: "user" as const, id: input.principalUserId },
    target: {
      kind: "eligible_device" as const,
      workspace_binding_id: input.workspaceBindingId,
      required_capabilities: [] as string[],
    },
    schedule,
    execution_policy: { model_alias: input.modelAlias, tool_policy_scope: "project" as const },
  };
}
