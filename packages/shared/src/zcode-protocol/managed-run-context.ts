/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import { z } from "zod";

export const zcodeManagedOpaqueIdSchema = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[0-9a-f]{32}$`));

export const zcodeManagedExternalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[\x21-\x7e]+$/);

/** Non-secret server-issued context carried only by one managed input/runtime scope. */
export const zcodeManagedRunContextSchema = z
  .object({
    organizationId: zcodeManagedOpaqueIdSchema("org"),
    projectId: zcodeManagedOpaqueIdSchema("prj"),
    deviceId: zcodeManagedOpaqueIdSchema("dvc"),
    agentSessionId: zcodeManagedOpaqueIdSchema("rse"),
    runId: zcodeManagedOpaqueIdSchema("run"),
    agentDefinitionId: zcodeManagedOpaqueIdSchema("agd"),
    agentDefinitionVersion: z.number().int().positive(),
    requestId: zcodeManagedOpaqueIdSchema("req"),
    externalId: zcodeManagedExternalIdSchema.optional(),
    executionMode: z.enum(["managed", "local_only"]),
    policySnapshotId: zcodeManagedOpaqueIdSchema("pol").optional(),
    policyVersion: z.number().int().nonnegative().optional(),
  })
  .strict();

export type ZCodeManagedRunContext = z.infer<typeof zcodeManagedRunContextSchema>;
