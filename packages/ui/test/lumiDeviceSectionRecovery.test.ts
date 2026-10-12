// @vitest-environment jsdom

/**
 * DE2E-CLI-03: when a device action is refused because the Worker expired the token, Main persists
 * `reauth_required`; the device section must pick that up and offer recovery. A revoked device stays
 * `active` in the projection and must not be offered recovery.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TID_LUMI_DEVICE_RECOVER,
  TID_LUMI_DEVICE_REVOKED,
  type LumiDeviceStateProjection,
} from "@zcode/shared";

const orgId = `org_${"a".repeat(32)}`;
const device = (status: LumiDeviceStateProjection["status"]): LumiDeviceStateProjection => ({
  status,
  orgId,
  device: {
    id: `dvc_${"c".repeat(32)}`,
    orgId,
    tokenExpiresAt: "2026-10-12T00:00:00.000Z",
    policyVersion: 2,
  },
});

const bridge = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/hooks/usePlatform.js", () => ({ usePlatform: () => ({ lumiAccount: bridge }) }));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));

async function renderSection() {
  const { LumiDeviceSection } = await import("@/settings/LumiDeviceSection.js");
  render(
    createElement(LumiDeviceSection, {
      account: {
        organizations: [
          { id: orgId, slug: "acme", displayName: "Acme", status: "active", state: "active" },
        ],
      } as never,
    }),
  );
  await waitFor(() => expect(screen.getByText("lumiDevice.sync")).toBeTruthy());
}

describe("Lumi device section after a refused action", () => {
  afterEach(() => {
    cleanup();
    bridge.request.mockReset();
  });

  it("a Worker-expired token switches to the recovery action", async () => {
    const reads = [device("active"), device("reauth_required")];
    bridge.request.mockImplementation(async (command: { action: string }) =>
      command.action === "read-device"
        ? { ok: true, device: reads.shift() }
        : { ok: false, code: "lumi_device_action_failed" },
    );
    await renderSection();
    expect(screen.queryByTestId(TID_LUMI_DEVICE_RECOVER)).toBeNull();

    await act(async () => fireEvent.click(screen.getByText("lumiDevice.sync")));

    await waitFor(() => expect(screen.getByTestId(TID_LUMI_DEVICE_RECOVER)).toBeTruthy());
    expect(screen.queryByTestId(TID_LUMI_DEVICE_REVOKED)).toBeNull();
    expect(screen.getByText("lumiDevice.expired")).toBeTruthy();
  });

  it("a refused recovery that reveals revocation shows the revoked message and no recovery", async () => {
    const reads = [device("reauth_required"), device("revoked")];
    bridge.request.mockImplementation(async (command: { action: string }) =>
      command.action === "read-device"
        ? { ok: true, device: reads.shift() }
        : { ok: false, code: "lumi_device_action_failed" },
    );
    await renderSection();
    await act(async () => fireEvent.click(screen.getByTestId(TID_LUMI_DEVICE_RECOVER)));

    await waitFor(() => expect(screen.getByTestId(TID_LUMI_DEVICE_REVOKED)).toBeTruthy());
    expect(screen.getByText("lumiDevice.revoked")).toBeTruthy();
    expect(screen.queryByTestId(TID_LUMI_DEVICE_RECOVER)).toBeNull();
    expect(screen.queryByText("lumiDevice.enroll")).toBeNull();
    expect((screen.getByText("lumiDevice.sync") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("lumiDevice.refresh") as HTMLButtonElement).disabled).toBe(true);
    expect(bridge.request.mock.calls.map(([command]) => command.action)).toEqual([
      "read-device",
      "recover-device",
      "read-device",
    ]);
  });

  it("after a restart a revoked device still shows no recovery", async () => {
    bridge.request.mockResolvedValue({ ok: true, device: device("revoked") });
    await renderSection();
    expect(screen.getByTestId(TID_LUMI_DEVICE_REVOKED)).toBeTruthy();
    expect(screen.queryByTestId(TID_LUMI_DEVICE_RECOVER)).toBeNull();
  });
});
