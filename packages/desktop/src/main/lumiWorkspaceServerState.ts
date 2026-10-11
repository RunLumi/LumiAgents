/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
import type { LumiAccountHostTransport } from "@zcode/services/node";
import type { WorkspaceServerState } from "./lumiWorkspaceCredentialMode.js";
import type { DeviceOwner } from "./lumiWorkspaceOwnerTypes.js";

/**
 * The one fresh read of the server-owned device binding + adoption row for a workspace key, with
 * the cross-checks every command relies on. It writes nothing; the server stays the authority.
 */
export async function readWorkspaceServerState(
  deps: {
    device: DeviceOwner;
    account: LumiAccountHostTransport;
    orgId: string;
    installationId: string;
  },
  workspaceKey: string,
  allowMissingBinding = false,
): Promise<WorkspaceServerState> {
  const device = await deps.device.read();
  const bindings = device.status === "active" ? await deps.device.listWorkspaceBindings() : [];
  const matchingBindings = bindings.filter((item) => item.workspaceIdentity === workspaceKey);
  if (matchingBindings.length > 1) throw new Error("lumi_workspace_conflict");
  const deviceBinding = matchingBindings[0] ?? null;
  const adoptionRows = await deps.account.listAdoptionRecords(deps.orgId);
  const matchingAdoptions = adoptionRows.filter(
    (item) =>
      item.orgId === deps.orgId &&
      item.installationId === deps.installationId &&
      item.workspaceKey === workspaceKey,
  );
  if (matchingAdoptions.length > 1) throw new Error("lumi_workspace_conflict");
  const adoption = matchingAdoptions[0] ?? null;
  const localUnbound =
    adoption?.stage === "local_unmanaged" &&
    adoption.ownership === "local_unmanaged" &&
    adoption.projectId === null &&
    adoption.deviceId === null;
  if (
    adoption &&
    ((adoption.deviceId && adoption.deviceId !== device.device?.id) ||
      (deviceBinding &&
        !localUnbound &&
        (deviceBinding.projectId !== adoption.projectId ||
          deviceBinding.deviceId !== adoption.deviceId)))
  )
    throw new Error("lumi_workspace_mismatch");
  if (adoption?.ownership === "org_managed" && !deviceBinding && !allowMissingBinding)
    throw new Error("lumi_workspace_binding_missing");
  return { device, deviceBinding, adoption };
}
