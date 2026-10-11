import { until } from "../harness.mjs";
import { CONSOLE_URL, boundWorkspace, fail, ok } from "./data.mjs";
import { expect, expectEqual } from "./report.mjs";
import { alertText, button, field, gone, see, seeText } from "./ui.mjs";
import {
  SET_MODE_KEYS,
  count,
  hasButton,
  isDisabled,
  loaded,
  writeCount,
} from "./workspaceHelpers.mjs";

/** Credential-choice claims (label-only choice, fences, refusal handling). */
export const CREDENTIAL_BEHAVIORS = [
  {
    id: "workspace.credential-choice-labels",
    claim:
      "Credential choice marks the server mode, keeps picks local until confirmed, discards on cancel, and offers the console only for the org label",
    auto: loaded(boundWorkspace()),
    run: async (fx) => {
      await see(field.radio(fx, "local_credential"), "radios");
      expect(await field.radio(fx, "local_credential").isChecked(), "server mode checked");
      expect(
        !(await hasButton(fx, "lumiWorkspace.credential.confirm")),
        "no confirm before a change",
      );
      await field.radio(fx, "metadata_only").check();
      await see(await button(fx, "lumiWorkspace.credential.confirm"), "confirm");
      expect(
        !(await hasButton(fx, "lumiWorkspace.credential.console")),
        "no console for own-key label",
      );
      await (await button(fx, "lumiWorkspace.credential.cancel")).click();
      await gone(
        fx.page.getByRole("button", {
          name: await fx.t("lumiWorkspace.credential.confirm"),
          exact: true,
        }),
        "confirm",
      );
      expect(
        await field.radio(fx, "local_credential").isChecked(),
        "cancel restores the server mode",
      );
      await field.radio(fx, "org_managed_credential").check();
      const consoleButton = await button(fx, "lumiWorkspace.credential.console");
      await see(consoleButton, "console");
      await consoleButton.click();
      expectEqual(await fx.opens(), [CONSOLE_URL], "console opens via platform.openExternal only");
      expectEqual(await writeCount(fx), 0, "no write before Record this choice");
    },
  },
  {
    id: "workspace.credential-org-label-refused-unmanaged",
    claim: "On a not-yet-managed row the org credential radio is disabled with its explanation",
    auto: loaded(boundWorkspace({ ownership: "local_unmanaged", stage: "account_optional" })),
    run: async (fx) => {
      await seeText(fx, "lumiWorkspace.credential.orgUnavailable");
      expect(await field.radio(fx, "org_managed_credential").isDisabled(), "org radio disabled");
      expect(!(await field.radio(fx, "metadata_only").isDisabled()), "own-key radio enabled");
    },
  },
  {
    id: "workspace.credential-confirm-once-with-fences",
    claim:
      "Record this choice writes once with exactly the typed fence fields and no secret-bearing field; success moves '(current)' only from the server row",
    auto: { ...loaded(boundWorkspace()), "set-workspace-credential-mode": "hold" },
    run: async (fx) => {
      await field.radio(fx, "org_managed_credential").check();
      await (await button(fx, "lumiWorkspace.credential.confirm")).dblclick();
      const [call] = await fx.waitCall("set-workspace-credential-mode");
      await fx.advance(500);
      expectEqual(await count(fx, "set-workspace-credential-mode"), 1, "write count");
      expectEqual(Object.keys(call.command).sort(), SET_MODE_KEYS, "command keys");
      expectEqual(
        {
          stage: call.command.expectedStage,
          version: call.command.expectedVersion,
          mode: call.command.credentialMode,
          confirm: call.command.confirm,
        },
        { stage: "workspace_bound", version: 3, mode: "org_managed_credential", confirm: true },
        "fences",
      );
      expect(
        (await fx.page.locator("fieldset[disabled]").count()) === 1,
        "credential fieldset disabled while in flight",
      );
      await fx.settle(
        call.n,
        ok({
          workspace: boundWorkspace({
            adoptionVersion: 4,
            credentialMode: "org_managed_credential",
          }),
        }),
      );
      // The pick is already checked locally, so wait on the server-only marker, not the radio state.
      const marker = await fx.t("lumiWorkspace.credential.current");
      const orgLabel = fx.page.locator("label[for='lumi-credential-org_managed_credential']");
      await until(
        async () => (await orgLabel.innerText()).includes(marker),
        "(current) marker on the org label",
      );
      expect(
        !(await hasButton(fx, "lumiWorkspace.credential.confirm")),
        "confirm cleared after remount",
      );
      expect(
        await field.radio(fx, "org_managed_credential").isChecked(),
        "org radio checked from server row",
      );
      expectEqual(await count(fx, "set-workspace-credential-mode"), 1, "write count after success");
    },
  },
  {
    id: "workspace.credential-refusal-rereads-and-discards-pick",
    claim:
      "A refused choice shows 'changed' copy and code, re-reads once, and the remounted choice drops the unconfirmed pick",
    auto: {
      ...loaded(boundWorkspace()),
      "set-workspace-credential-mode": fail("lumi_workspace_stale"),
    },
    run: async (fx) => {
      await field.radio(fx, "org_managed_credential").check();
      const readsBefore = await count(fx, "read-workspace");
      await fx.setAuto({ "read-workspace": "hold" });
      await (await button(fx, "lumiWorkspace.credential.confirm")).click();
      await seeText(fx, "lumiError.changed");
      expect((await alertText(fx).innerText()).includes("lumi_workspace_stale"), "code shown");
      await until(
        async () => (await count(fx, "read-workspace")) === readsBefore + 1,
        "one re-read",
      );
      const [reread] = (await fx.callsOf("read-workspace")).slice(-1);
      await fx.settle(
        reread.n,
        ok({ workspace: boundWorkspace({ adoptionVersion: 4, credentialMode: "metadata_only" }) }),
      );
      await until(
        async () => await field.radio(fx, "metadata_only").isChecked(),
        "server's new mode checked",
      );
      expect(!(await hasButton(fx, "lumiWorkspace.credential.confirm")), "pick discarded");
      expectEqual(await count(fx, "set-workspace-credential-mode"), 1, "no automatic second write");
    },
  },
  {
    id: "workspace.credential-refusal-reread-fails-clears-choice",
    claim:
      "If the re-read after a refused choice fails, the choice UI and every write control are withdrawn until an explicit reload",
    auto: {
      ...loaded(boundWorkspace()),
      "set-workspace-credential-mode": fail("lumi_workspace_stale"),
    },
    run: async (fx) => {
      await field.radio(fx, "metadata_only").check();
      await fx.setAuto({ "read-workspace": fail("lumi_request_timeout") });
      await (await button(fx, "lumiWorkspace.credential.confirm")).click();
      await see(await button(fx, "lumiWorkspace.reload"), "reload");
      await gone(fx.page.locator("#lumi-credential-metadata_only"), "credential radios");
      expect(await isDisabled(fx, "lumiWorkspace.bind"), "bind disabled with unproven state");
      expectEqual(await writeCount(fx), 1, "only the original write; nothing retried");
      await fx.setAuto({ ...loaded(boundWorkspace({ adoptionVersion: 5 })) });
      await (await button(fx, "lumiWorkspace.reload")).click();
      await see(field.radio(fx, "local_credential"), "radios after explicit reload");
    },
  },
];
