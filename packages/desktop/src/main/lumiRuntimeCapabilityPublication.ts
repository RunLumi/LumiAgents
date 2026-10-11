import type { ZCodeManagedRuntimeCapabilities } from "@zcode/shared";

/** Mutable state remains on the Main-owned lease, never in a second store. */
export interface LumiRuntimeCapabilityLease {
  runtimeCapabilities?: ZCodeManagedRuntimeCapabilities;
  runtimeCapabilityQueue?: Promise<void>;
}

/**
 * Union of live leases for one device owner; no live runtime means nothing is available.
 * Returns `{}` (an empty report) rather than assumed support when no lease reported.
 */
export function mergeLiveRuntimeCapabilities(
  leases: Iterable<LumiRuntimeCapabilityLease & { deviceOwner: unknown }>,
  owner: unknown,
): ZCodeManagedRuntimeCapabilities | Record<string, never> {
  const merged: ZCodeManagedRuntimeCapabilities = {
    filesystem_write: false,
    process_execution: false,
    network_access: false,
    mcp_execution: false,
    browser_use: false,
    computer_use: false,
  };
  let live = false;
  for (const lease of leases) {
    if (lease.deviceOwner !== owner || !lease.runtimeCapabilities) continue;
    live = true;
    for (const key of Object.keys(merged) as (keyof typeof merged)[])
      merged[key] = merged[key] || lease.runtimeCapabilities[key];
  }
  return live ? merged : {};
}

export function publishLumiRuntimeCapabilities(
  lease: LumiRuntimeCapabilityLease,
  capabilities: ZCodeManagedRuntimeCapabilities,
  ports: { isCurrent(): boolean; authorize(): Promise<void>; publish(): Promise<void> },
): Promise<void> {
  const snapshot = { ...capabilities };
  const assertCurrent = () => {
    if (!ports.isCurrent()) throw new Error("lumi_runtime_capabilities_refused");
  };
  const next = (lease.runtimeCapabilityQueue ?? Promise.resolve()).then(async () => {
    assertCurrent();
    await ports.authorize();
    assertCurrent();
    const previous = lease.runtimeCapabilities;
    lease.runtimeCapabilities = snapshot;
    try {
      await ports.publish();
      assertCurrent();
    } catch (error) {
      if (ports.isCurrent()) lease.runtimeCapabilities = previous;
      throw error;
    }
  });
  lease.runtimeCapabilityQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}
