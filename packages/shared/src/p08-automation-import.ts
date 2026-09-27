/**
 * P08 automation import preview (`p08-cg-v1`, automation import section).
 *
 * The preview is pure and has **no mutating counterpart anywhere in P08**. That
 * absence is the enforcement mechanism for FR-F26-004's "existing local
 * automations remain local until imported": there is no code path in the control
 * plane that can touch a local automation, so the client keeps its own copy until
 * it chooses to create a managed one through P06's ordinary automation route.
 *
 * A candidate is a *description*, not a body. It carries a key, a schedule kind,
 * the tools and model capabilities the automation needs, and the credential mode
 * it would run under. There is deliberately no `prompt`, `command`, `path`, or
 * `body` field, so the client cannot describe a local automation's contents even
 * by accident — the type has nowhere to put them.
 *
 * The client-side contribution here is deliberately small. The server judges
 * conflicts; what the client must guarantee is (a) it builds candidates with no
 * content, (b) it shows every conflict before anything is created, and (c) it
 * creates nothing itself.
 */

import { z } from "zod";

import { p08ReasonCodeSchema, type P08CredentialMode } from "./p08-migration-adoption.js";

const MAX_CANDIDATES = 200;
const MAX_CANDIDATE_KEY_LENGTH = 128;
const MAX_MODEL_CAPABILITIES = 32;
const MAX_TOOL_CAPABILITIES = 64;
const MAX_TOOL_CAPABILITY_LENGTH = 64;
const MAX_MODEL_CAPABILITY_LENGTH = 64;

/** Candidate keys are stable local aliases, never paths. */
const CANDIDATE_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const CAPABILITY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;

/**
 * Schedule kinds. `off_peak` is a provider-ticket execution class with no clock
 * schedule (P06-CR-001), so it is a distinct kind rather than a cron-shaped
 * flag; a candidate may not claim a schedule it does not have.
 */
export const P08_IMPORT_SCHEDULE_KINDS = ["interval", "cron", "off_peak"] as const;

export type P08ImportScheduleKind = (typeof P08_IMPORT_SCHEDULE_KINDS)[number];

/**
 * Conflict codes frozen by `p08-cg-v1`.
 *
 * `model_capability_unavailable` is in the vocabulary, but the capability check
 * is deferred to dispatch and the preview discloses
 * `model_capability_check: "deferred_to_dispatch"`. P04 owns the route catalog;
 * a capability set assembled in P08 would be a second source of truth and would
 * drift, so the preview never emits this code from the client.
 */
export const P08_IMPORT_CONFLICT_CODES = [
  "automation_not_available",
  "automation_limit_reached",
  "tool_not_permitted",
  "model_capability_unavailable",
  "off_peak_not_entitled",
  "workspace_unbound",
  "local_credential_not_permitted",
] as const;

export type P08ImportConflictCode = (typeof P08_IMPORT_CONFLICT_CODES)[number];

/**
 * One described-but-not-copied local automation.
 *
 * Every field is either a key the client already uses locally, a capability it
 * needs, or a mode it would run under. `.strict()` is load-bearing: an unknown
 * key is a decode failure rather than a silently retained field, so a future
 * attempt to attach `prompt` fails loudly here instead of quietly uploading.
 */
export const p08AutomationImportCandidateSchema = z
  .object({
    candidate_key: z
      .string()
      .min(1)
      .max(MAX_CANDIDATE_KEY_LENGTH)
      .regex(CANDIDATE_KEY_PATTERN, "expected a stable local candidate key"),
    schedule_kind: z.enum(P08_IMPORT_SCHEDULE_KINDS),
    required_tool_capabilities: z
      .array(z.string().max(MAX_TOOL_CAPABILITY_LENGTH).regex(CAPABILITY_PATTERN))
      .max(MAX_TOOL_CAPABILITIES),
    required_model_capabilities: z
      .array(z.string().max(MAX_MODEL_CAPABILITY_LENGTH).regex(CAPABILITY_PATTERN))
      .max(MAX_MODEL_CAPABILITIES),
    credential_mode: z.enum(["local_credential", "metadata_only", "org_managed_credential"]),
  })
  .strict();

export type P08AutomationImportCandidate = z.infer<typeof p08AutomationImportCandidateSchema>;

/** Field names a candidate must never carry. Pinned by a test. */
export const P08_FORBIDDEN_CANDIDATE_FIELDS = Object.freeze([
  "prompt",
  "body",
  "command",
  "instructions",
  "path",
  "directory",
  "file",
  "files",
  "content",
  "message",
  "messages",
  "session",
  "transcript",
] as const);

export const p08AutomationImportConflictSchema = z
  .object({
    candidate_key: z.string().min(1).max(MAX_CANDIDATE_KEY_LENGTH).regex(CANDIDATE_KEY_PATTERN),
    code: z.enum(P08_IMPORT_CONFLICT_CODES),
    reason_code: p08ReasonCodeSchema,
  })
  .strict();

export type P08AutomationImportConflict = z.infer<typeof p08AutomationImportConflictSchema>;

/**
 * Always this value. The preview is an upper bound on what will run, never a
 * promise, because a project may narrow the tool set further at dispatch.
 */
export const P08_IMPORT_MODEL_CAPABILITY_CHECK = "deferred_to_dispatch" as const;

export const p08AutomationImportPreviewSchema = z
  .object({
    model_capability_check: z.literal(P08_IMPORT_MODEL_CAPABILITY_CHECK),
    importable: z
      .array(
        z
          .object({
            candidate_key: z
              .string()
              .min(1)
              .max(MAX_CANDIDATE_KEY_LENGTH)
              .regex(CANDIDATE_KEY_PATTERN),
            /** The P06 route this will be created through. Not a P08 route. */
            create_via: z.literal("p06_automations"),
          })
          .strict(),
      )
      .max(MAX_CANDIDATES),
    blocked: z.array(p08AutomationImportConflictSchema).max(MAX_CANDIDATES),
    active_automation_limit: z.number().int().nonnegative(),
  })
  .strict();

export type P08AutomationImportPreview = z.infer<typeof p08AutomationImportPreviewSchema>;

export const P08_IMPORT_MAX_CANDIDATES = MAX_CANDIDATES;

export type P08ImportBuildResult =
  | { readonly ok: true; readonly candidates: readonly P08AutomationImportCandidate[] }
  | {
      readonly ok: false;
      readonly code: "automation_import_too_large" | "candidate_field_forbidden";
    };

/**
 * Build the candidate list the client will send for preview.
 *
 * This function creates nothing and sends nothing; it only turns locally
 * described automations into the preview request body. It is the last place a
 * content field could enter, so it re-checks each candidate's own keys against
 * `P08_FORBIDDEN_CANDIDATE_FIELDS` before handing it on. The zod schema would
 * already reject an unknown key, but a candidate assembled by a future caller
 * through a cast would not have been parsed, and the point of this seam is that
 * the content field is refused structurally.
 */
export function buildP08ImportCandidates(
  described: readonly Readonly<Record<string, unknown>>[],
): P08ImportBuildResult {
  if (described.length > MAX_CANDIDATES) {
    return { ok: false, code: "automation_import_too_large" };
  }
  const candidates: P08AutomationImportCandidate[] = [];
  for (const entry of described) {
    for (const field of P08_FORBIDDEN_CANDIDATE_FIELDS) {
      if (Object.hasOwn(entry, field)) {
        return { ok: false, code: "candidate_field_forbidden" };
      }
    }
    const parsed = p08AutomationImportCandidateSchema.safeParse(entry);
    if (!parsed.success) {
      return { ok: false, code: "candidate_field_forbidden" };
    }
    candidates.push(Object.freeze(parsed.data));
  }
  return { ok: true, candidates: Object.freeze(candidates) };
}

/**
 * A candidate is blocked when it carries ANY conflict. Never partially imported:
 * a batch where one candidate is blocked does not import the rest either, because
 * a user who was told three of five would work has no way to know which three
 * until after the fact.
 *
 * The active-automation limit is counted DOWN by the server, so the candidate
 * that would cross it is blocked rather than the batch being silently trimmed.
 * No candidate is ever dropped, and an existing managed automation is never
 * evicted to make room. This client-side function is what the UI uses to decide
 * whether to offer the confirm affordance at all: zero blocked candidates.
 */
export function p08ImportPreviewIsActionable(preview: P08AutomationImportPreview): boolean {
  return preview.blocked.length === 0 && preview.importable.length > 0;
}

/**
 * Group a preview by candidate key, preserving the server's order. Used to render
 * the conflict list next to the candidate it belongs to.
 */
export function indexP08ImportConflicts(
  preview: P08AutomationImportPreview,
): ReadonlyMap<string, readonly P08AutomationImportConflict[]> {
  const grouped = new Map<string, P08AutomationImportConflict[]>();
  for (const conflict of preview.blocked) {
    const existing = grouped.get(conflict.candidate_key);
    if (existing === undefined) grouped.set(conflict.candidate_key, [conflict]);
    else existing.push(conflict);
  }
  const index = new Map<string, readonly P08AutomationImportConflict[]>();
  for (const [key, value] of grouped) index.set(key, Object.freeze([...value]));
  return index;
}

/**
 * Whether a candidate's credential mode may be imported under the mode the
 * workspace currently holds. A `local_credential` candidate is refused when the
 * org requires managed credentials, which the server reports as
 * `local_credential_not_permitted`; the client surfaces the mismatch before the
 * preview so the user is not asked to confirm something already refused.
 */
export function p08ImportCredentialModeMismatch(
  candidate: P08AutomationImportCandidate,
  workspaceMode: P08CredentialMode,
): boolean {
  if (workspaceMode === "local_credential" && candidate.credential_mode !== "local_credential") {
    return true;
  }
  if (workspaceMode !== "local_credential" && candidate.credential_mode === "local_credential") {
    return true;
  }
  return false;
}
