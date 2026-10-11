import { until } from "../harness.mjs";
import {
  PROJECTS,
  boundWorkspace,
  fail,
  ok,
  unboundWorkspace,
  withAccount,
  withSignIn,
} from "./data.mjs";
import { PROVIDERS } from "./startupBehaviors.mjs";
import { alertText, button, field, see, seeText } from "./ui.mjs";

const NO_ACCOUNT = { restore: ok() };
const LOADED = (workspace, projects = PROJECTS) => ({
  "list-projects": ok({ projects }),
  "read-workspace": ok({ workspace }),
});

/** Cross the 5 s "slow" notice and the 35 s renderer give-up bound on the faked page clock. */
export async function reachRestoreTimeout(fx) {
  await fx.advance(5000);
  await fx.advance(30_001);
}

/**
 * Visual states, each reached by driving the real component from a fresh page. The same table feeds
 * the screenshot matrix, so every screenshot is of a state the driver actually produced.
 */
export const STATES = [
  {
    id: "entry-restoring",
    surface: "entry",
    auto: { restore: "hold" },
    drive: (fx) => seeText(fx, "lumiEntry.restoring"),
  },
  {
    id: "entry-restoring-slow",
    surface: "entry",
    auto: { restore: "hold" },
    drive: async (fx) => {
      await fx.advance(5000);
      await seeText(fx, "lumiEntry.restoringSlow");
    },
  },
  {
    id: "entry-restore-timed-out",
    surface: "entry",
    auto: { restore: "hold" },
    drive: async (fx) => {
      await reachRestoreTimeout(fx);
      await see(await button(fx, "lumiEntry.checkAgain"), "check saved session again");
    },
  },
  {
    id: "entry-signed-in",
    surface: "entry",
    auto: { restore: withAccount() },
    drive: async (fx) => see(await button(fx, "lumiEntry.continue"), "Continue"),
  },
  {
    id: "entry-sign-in-begin",
    surface: "entry",
    auto: NO_ACCOUNT,
    drive: async (fx) => see(await button(fx, "lumiAccount.begin"), "begin"),
  },
  {
    id: "entry-sign-in-code",
    surface: "entry",
    auto: { ...NO_ACCOUNT, begin: withSignIn() },
    drive: async (fx) => {
      await (await button(fx, "lumiAccount.begin")).click();
      await see(await button(fx, "lumiAccount.complete"), "complete");
    },
  },
  {
    id: "entry-begin-error",
    surface: "entry",
    auto: { ...NO_ACCOUNT, begin: fail("lumi_request_timeout") },
    drive: async (fx) => {
      await (await button(fx, "lumiAccount.begin")).click();
      await see(alertText(fx), "begin error alert");
    },
  },
  {
    id: "workspace-loading",
    surface: "workspace",
    auto: { "list-projects": "hold" },
    drive: (fx) => seeText(fx, "lumiWorkspace.busy"),
  },
  {
    id: "workspace-no-projects",
    surface: "workspace",
    auto: LOADED(unboundWorkspace(), []),
    drive: (fx) => seeText(fx, "lumiWorkspace.noProjectsHint"),
  },
  {
    id: "workspace-page-incomplete",
    surface: "workspace",
    auto: { "list-projects": fail("lumi_page_incomplete") },
    drive: (fx) => seeText(fx, "lumiError.pageIncomplete"),
  },
  {
    id: "workspace-retryable-error",
    surface: "workspace",
    auto: { "list-projects": fail("lumi_request_timeout") },
    drive: async (fx) => see(await button(fx, "lumiWorkspace.reload"), "reload"),
  },
  {
    id: "workspace-device-required",
    surface: "workspace",
    auto: LOADED(unboundWorkspace({ deviceUsable: false })),
    drive: (fx) => seeText(fx, "lumiWorkspace.deviceRequired"),
  },
  {
    id: "workspace-unbound-ready",
    surface: "workspace",
    auto: LOADED(unboundWorkspace()),
    drive: async (fx) => {
      await until(
        async () => (await field.project(fx).locator("option").count()) > 1,
        "project options",
      );
      await field.project(fx).selectOption("prj_1");
      await see(await button(fx, "lumiWorkspace.bind"), "bind");
    },
  },
  {
    id: "workspace-bound-credential",
    surface: "workspace",
    auto: LOADED(boundWorkspace()),
    drive: async (fx) => see(field.radio(fx, "local_credential"), "credential radios"),
  },
  {
    id: "workspace-credential-pending-own-key",
    surface: "workspace",
    auto: LOADED(boundWorkspace()),
    drive: async (fx) => {
      await field.radio(fx, "metadata_only").check();
      await see(await button(fx, "lumiWorkspace.credential.confirm"), "record this choice");
    },
  },
  {
    id: "workspace-credential-pending-org",
    surface: "workspace",
    auto: LOADED(boundWorkspace()),
    drive: async (fx) => {
      await field.radio(fx, "org_managed_credential").check();
      await see(await button(fx, "lumiWorkspace.credential.console"), "console button");
    },
  },
  {
    id: "workspace-credential-org-unavailable",
    surface: "workspace",
    auto: LOADED(boundWorkspace({ ownership: "local_unmanaged", stage: "account_optional" })),
    drive: (fx) => seeText(fx, "lumiWorkspace.credential.orgUnavailable"),
  },
  {
    id: "workspace-credential-stale-reread",
    surface: "workspace",
    auto: {
      ...LOADED(boundWorkspace()),
      "set-workspace-credential-mode": fail("lumi_workspace_stale"),
    },
    drive: async (fx) => {
      await field.radio(fx, "metadata_only").check();
      // Queue the re-read the UI issues after the refusal: the server moved to version 4.
      await fx.setAuto({
        "read-workspace": ok({
          workspace: boundWorkspace({ adoptionVersion: 4, credentialMode: "metadata_only" }),
        }),
      });
      await (await button(fx, "lumiWorkspace.credential.confirm")).click();
      await seeText(fx, "lumiError.changed");
      await see(field.radio(fx, "metadata_only"), "reloaded radios");
    },
  },
  {
    id: "workspace-reread-failed",
    surface: "workspace",
    auto: {
      ...LOADED(boundWorkspace()),
      "set-workspace-credential-mode": fail("lumi_workspace_stale"),
    },
    drive: async (fx) => {
      await field.radio(fx, "metadata_only").check();
      await fx.setAuto({ "read-workspace": fail("lumi_request_timeout") });
      await (await button(fx, "lumiWorkspace.credential.confirm")).click();
      await see(await button(fx, "lumiWorkspace.reload"), "reload after failed re-read");
    },
  },
  {
    id: "startup-root-entry",
    surface: "root",
    startup: { lumiBridge: true, providers: PROVIDERS },
    auto: NO_ACCOUNT,
    drive: async (fx) => see(await button(fx, "lumiEntry.local"), "Continue locally"),
  },
  {
    id: "startup-root-restore-hung",
    surface: "root",
    startup: { lumiBridge: true, providers: PROVIDERS },
    auto: { restore: "hold" },
    drive: async (fx) => {
      await fx.advance(5500);
      await see(await button(fx, "lumiEntry.local"), "Continue locally");
    },
  },
  {
    id: "startup-welcome-no-bridge",
    surface: "welcome",
    startup: { lumiBridge: false, providers: PROVIDERS },
    auto: {},
    drive: async (fx) => see(await button(fx, "lumiEntry.local"), "Continue locally"),
  },
];
