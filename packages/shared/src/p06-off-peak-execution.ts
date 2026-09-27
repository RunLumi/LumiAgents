/**
 * P06 off-peak execution class (`p06-automation-lease-v1`, off-peak section).
 *
 * `P06-CR-001` and the Contract Gate are explicit: off-peak is a provider-ticket
 * execution class with no clock schedule. It is NOT a cron window, NOT a generic
 * interval, and NOT a cron-shaped special case. Two consequences are encoded
 * here rather than left as prose:
 *
 * 1. A provider-ticket RENEWAL must not create a second logical occurrence. The
 *    renewal keeps `occurrence_id`, `automation_id`, `off_peak_mode`, and
 *    `policy_snapshot_id`; only the lease fence/expiry may advance. A renewal
 *    that changes occurrence identity is refused, not merged.
 * 2. The server may NARROW host safety restrictions but never BROADEN them. The
 *    three host tool constraints are composed so that a server response can only
 *    remove capability, and a malformed or unknown-version policy fails closed to
 *    the strictest host baseline.
 *
 * This module reuses the existing ZCode off-peak domain (`off-peak-types.ts`,
 * provider ticket, `queued/running/completed/...`) as the local continuity
 * concept. It does not redefine the local state machine, and it does not treat
 * `OffPeakTaskRepo.recoverInterrupted` (running → queued) as an authority: that
 * transition cannot represent `ambiguous` and would permit double execution.
 */

import { z } from "zod";

import {
  p06AutomationOccurrenceRefSchema,
  type P06AutomationOccurrenceRef,
} from "./p06-automation-lease.js";

/** Wire version of the off-peak policy block. Unknown versions fail closed. */
export const P06_OFF_PEAK_POLICY_SCHEMA_VERSION = 1 as const;

const MAX_ALLOWED_ROUTE_ALIASES = 32;
const MAX_ROUTE_ALIAS_LENGTH = 128;
const STABLE_ALIAS_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/**
 * Host safety restrictions. These are the only three booleans the wire carries;
 * network, browser, and computer decisions stay composed from the P05 tool
 * policy and route configuration instead of being flattened here.
 */
export const p06OffPeakToolConstraintsSchema = z
  .object({
    deny_automation_mutation: z.boolean(),
    deny_recursive_off_peak: z.boolean(),
    allow_background_processes: z.boolean(),
  })
  .strict();

export type P06OffPeakToolConstraints = z.infer<typeof p06OffPeakToolConstraintsSchema>;

export const p06OffPeakPolicySchema = z
  .object({
    schema_version: z.literal(P06_OFF_PEAK_POLICY_SCHEMA_VERSION),
    eligibility_source: z.enum(["provider_ticket", "org_window"]),
    allowed_route_aliases: z
      .array(z.string().max(MAX_ROUTE_ALIAS_LENGTH).regex(STABLE_ALIAS_PATTERN))
      .max(MAX_ALLOWED_ROUTE_ALIASES),
    tool_constraints: p06OffPeakToolConstraintsSchema,
  })
  .strict();

export type P06OffPeakPolicy = z.infer<typeof p06OffPeakPolicySchema>;

/**
 * The strictest host baseline. Used when the server sends no policy, an
 * unreadable policy, or a policy from a future schema version: an off-peak
 * occurrence then gets the narrowest possible capability set instead of the
 * capability set the policy would have granted.
 */
export const P06_OFF_PEAK_FAIL_CLOSED_CONSTRAINTS: P06OffPeakToolConstraints = Object.freeze({
  deny_automation_mutation: true,
  deny_recursive_off_peak: true,
  allow_background_processes: false,
});

/**
 * Compose host restrictions with the server policy so the result can only be
 * narrower. `deny_*` flags are OR-ed (either side can forbid) and
 * `allow_background_processes` is AND-ed (both sides must permit).
 */
export function narrowOffPeakToolConstraints(
  hostBaseline: P06OffPeakToolConstraints,
  serverPolicy: P06OffPeakPolicy | undefined,
): P06OffPeakToolConstraints {
  const server = serverPolicy?.tool_constraints ?? P06_OFF_PEAK_FAIL_CLOSED_CONSTRAINTS;
  return Object.freeze({
    deny_automation_mutation:
      hostBaseline.deny_automation_mutation || server.deny_automation_mutation,
    deny_recursive_off_peak: hostBaseline.deny_recursive_off_peak || server.deny_recursive_off_peak,
    allow_background_processes:
      hostBaseline.allow_background_processes && server.allow_background_processes,
  });
}

export function isOffPeakPolicyUsable(policy: unknown): policy is P06OffPeakPolicy {
  return p06OffPeakPolicySchema.safeParse(policy).success;
}

/** Distinct execution class. `off_peak` is never reported as `scheduled`. */
export type P06AutomationExecutionClass =
  | { readonly kind: "scheduled" }
  | {
      readonly kind: "off_peak";
      readonly policy: P06OffPeakPolicy;
      /** A provider ticket has no clock schedule, so no canonical instant exists. */
      readonly scheduled_by: "provider_ticket" | "org_window";
    };

/**
 * Classify one occurrence. An off-peak occurrence without a usable policy is
 * refused rather than downgraded to `scheduled`: silently running it as a normal
 * scheduled automation would grant exactly the capability the class exists to
 * withhold.
 */
export type P06ExecutionClassResolution =
  | { readonly ok: true; readonly executionClass: P06AutomationExecutionClass }
  | {
      readonly ok: false;
      readonly code: "off_peak_not_allowed" | "execution_principal_unavailable";
    };

export function resolveAutomationExecutionClass(
  occurrence: P06AutomationOccurrenceRef,
  offPeakPolicy: unknown,
  options: { readonly isExecutablePrincipal: (kind: string) => boolean },
): P06ExecutionClassResolution {
  if (!options.isExecutablePrincipal(occurrence.execution_principal.kind)) {
    return { ok: false, code: "execution_principal_unavailable" };
  }
  if (occurrence.off_peak_mode === "normal") {
    return { ok: true, executionClass: { kind: "scheduled" } };
  }
  if (!isOffPeakPolicyUsable(offPeakPolicy)) {
    return { ok: false, code: "off_peak_not_allowed" };
  }
  return {
    ok: true,
    executionClass: {
      kind: "off_peak",
      policy: offPeakPolicy,
      scheduled_by: offPeakPolicy.eligibility_source,
    },
  };
}

/**
 * Tool names an off-peak occurrence must hide.
 *
 * This is the canonical value the three divergent local copies
 * (`packages/services/src/zcode-agent/automationToolPolicy.ts`,
 * `apps/zcode-cli/packages/core/src/runtime/methods/turn-loop-state.ts`, and
 * `apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/commands/prompt-turn.ts`)
 * plus the inline list in `bootstrap/src/zcode-protocol/server-operations.ts`
 * must converge on. Keeping it here means the P06 seam and the local denylists
 * cannot disagree about what an off-peak run may touch.
 */
export const P06_AUTOMATION_RESTRICTED_TOOL_NAMES = Object.freeze([
  // Prevents an unattended run from recursively scheduling more unattended work.
  "OffPeakCreate",
  // Both would start a new agent outside the occurrence's own run attribution.
  "SendMessage",
  "Workflow",
] as const);

export const P06_AUTOMATION_MUTATION_TOOL_NAMES = Object.freeze([
  "CronCreate",
  "CronUpdate",
  "CronDelete",
] as const);

/**
 * Build the occurrence's turn-scoped tool denylist.
 *
 * A scheduled automation run denies automation mutation only; it keeps
 * `OffPeakCreate` available because scheduling idle-time work from a timed
 * automation is an intended product behaviour. An off-peak run denies both
 * families, because the off-peak class additionally forbids recursive
 * derivation and background processes.
 */
export function buildAutomationOccurrenceToolDenylist(
  executionClass: P06AutomationExecutionClass,
  constraints: P06OffPeakToolConstraints,
  additional: readonly string[] = [],
): readonly string[] {
  const denied = new Set<string>(additional);
  for (const name of P06_AUTOMATION_MUTATION_TOOL_NAMES) denied.add(name);
  if (executionClass.kind === "off_peak") {
    for (const name of P06_AUTOMATION_RESTRICTED_TOOL_NAMES) denied.add(name);
  }
  if (constraints.deny_automation_mutation) {
    for (const name of P06_AUTOMATION_MUTATION_TOOL_NAMES) denied.add(name);
  }
  if (constraints.deny_recursive_off_peak) {
    denied.add("OffPeakCreate");
  }
  return Object.freeze([...denied].sort());
}

// ---------------------------------------------------------------------------
// Ticket renewal
// ---------------------------------------------------------------------------

/**
 * A provider-ticket renewal is a lease change on the SAME logical occurrence.
 * Only the lease fence/expiry may advance; occurrence identity, automation
 * identity, off-peak class, and policy snapshot are invariant. A "renewal" that
 * changes any of those is a second occurrence wearing a renewal's name.
 */
export type P06OffPeakTicketRenewalResolution =
  | { readonly ok: true; readonly occurrence: P06AutomationOccurrenceRef }
  | { readonly ok: false; readonly code: "automation_occurrence_mismatch" };

export function acceptOffPeakTicketRenewal(
  previous: P06AutomationOccurrenceRef,
  renewal: unknown,
): P06OffPeakTicketRenewalResolution {
  const parsed = p06AutomationOccurrenceRefSchema.safeParse(renewal);
  if (!parsed.success) return { ok: false, code: "automation_occurrence_mismatch" };
  const next = parsed.data;
  const sameLogicalOccurrence =
    next.occurrence_id === previous.occurrence_id &&
    next.automation_id === previous.automation_id &&
    next.off_peak_mode === previous.off_peak_mode &&
    next.policy_snapshot_id === previous.policy_snapshot_id &&
    next.execution_principal.kind === previous.execution_principal.kind &&
    next.execution_principal.id === previous.execution_principal.id;
  // `attempt` advances only when the server proves no start side effect happened;
  // the client cannot assert that, so a renewal that moves the attempt is
  // treated as a distinct occurrence needing a fresh claim.
  if (!sameLogicalOccurrence || next.attempt !== previous.attempt) {
    return { ok: false, code: "automation_occurrence_mismatch" };
  }
  return { ok: true, occurrence: Object.freeze(next) };
}
