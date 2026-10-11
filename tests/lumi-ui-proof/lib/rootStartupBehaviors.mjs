import { fail, ok, withAccount, withSignIn } from "./data.mjs";
import { until } from "../harness.mjs";
import { expect, expectEqual } from "./report.mjs";
import { button, see } from "./ui.mjs";
import {
  ENSURE,
  KEY,
  PERSISTED,
  SIGNED_OUT,
  ZCODE_USER,
  entryTitle,
  expectEntryWithoutWorkspaceCreation,
  expectNoForbiddenHostCalls,
  expectOnlyRestoreOnBridge,
  expectOnlyWrites,
  expectProvidersHiddenButListed,
  init,
  names,
  noEntry,
  persistedPathCalls,
  seeActions,
  seeEntry,
  untilTicking,
} from "./startupHelpers.mjs";

/**
 * Root and WelcomeScreen startup claims. `surface` "root" mounts the real Root (real
 * useLumiStartupGate, welcome-reason state, startup fallback) and "welcome" mounts the real
 * WelcomeScreen; both over the recording host fixture in src/hostFixture.ts.
 */
export const ROOT_STARTUP_BEHAVIORS = [
  {
    id: "startup.root-neither",
    claim:
      "Root with no Lumi session and no ZCode session opens the real Lumi-first entry (Sign in / Use API key / Continue locally); z.ai and BigModel are listed by the host but never rendered; startup only restores and changes no credential, provider, setting or login state",
    surface: "root",
    startup: init(),
    auto: SIGNED_OUT,
    run: async (fx) => {
      await seeEntry(fx);
      await seeActions(fx);
      await expectProvidersHiddenButListed(fx);
      await expectOnlyRestoreOnBridge(fx);
      await expectNoForbiddenHostCalls(fx, "neither");
    },
  },
  {
    id: "startup.root-no-workspace-before-entry",
    claim:
      "Root creates no default conversation workspace while the Lumi entry decision is pending or the entry is open; the startup fallback only runs after an explicit choice",
    surface: "root",
    startup: init(),
    auto: SIGNED_OUT,
    run: expectEntryWithoutWorkspaceCreation,
  },
  {
    id: "startup.root-zcode-only",
    claim:
      "A cached ZCode session alone does not skip the Lumi-first entry when the Lumi bridge exists; ZCode credentials are not touched",
    surface: "root",
    startup: init({ zcodeUser: ZCODE_USER }),
    auto: SIGNED_OUT,
    run: async (fx) => {
      await seeEntry(fx);
      await seeActions(fx);
      await until(
        async () => names(await fx.hostCalls()).includes("oauthService.restoreCachedSessionState"),
        "ZCode cached session was read (positive control)",
      );
      expectEqual(await fx.startupCompleted(), [], "entry completions");
      await expectNoForbiddenHostCalls(fx, "zcode-only");
      await expectOnlyRestoreOnBridge(fx);
    },
  },
  {
    id: "startup.root-lumi-only",
    claim:
      "A restored Lumi session skips the entry: no Welcome screen, one restore, no begin/complete, no credential/provider/setting change",
    surface: "root",
    startup: init(),
    auto: { restore: withAccount() },
    run: async (fx) => {
      await until(
        async () => names(await fx.hostCalls()).includes(ENSURE),
        "startup proceeded past the entry gate",
      );
      // Positive control: the real workspace shell mounted and queried its task list.
      await untilTicking(
        fx,
        async () => names(await fx.hostCalls()).includes("windowControllerService.listTaskList"),
        "workspace shell queried the task list",
      );
      await noEntry(fx);
      await expectOnlyRestoreOnBridge(fx);
      await expectNoForbiddenHostCalls(fx, "lumi-only");
    },
  },
  {
    id: "startup.root-both",
    claim:
      "With both a restored Lumi session and a cached ZCode session the entry is skipped and neither session's state is written",
    surface: "root",
    startup: init({ zcodeUser: ZCODE_USER }),
    auto: { restore: withAccount() },
    run: async (fx) => {
      await until(
        async () => names(await fx.hostCalls()).includes(ENSURE),
        "startup proceeded past the entry gate",
      );
      await noEntry(fx);
      await expectOnlyRestoreOnBridge(fx);
      await expectNoForbiddenHostCalls(fx, "both");
    },
  },
  {
    id: "startup.root-hung-and-late",
    claim:
      "A restore that never answers holds the startup screen only 5 s, then opens the entry with local/BYOK usable; a late restore answer does not close the entry, start a workspace or write anything until the user presses Continue",
    surface: "root",
    startup: init(),
    auto: { restore: "hold" },
    run: async (fx) => {
      await noEntry(fx);
      await fx.advance(4000);
      await noEntry(fx);
      await fx.advance(1500);
      await seeEntry(fx);
      await see(await button(fx, "lumiEntry.local"), "Continue locally while restore hangs");
      await see(await button(fx, "login.useApiKey"), "Use API key while restore hangs");
      // Late answer from the host: the entry offers Continue but does not act by itself.
      await fx.settle(0, withAccount());
      await see(await button(fx, "lumiEntry.continue"), "Continue after late restore");
      await fx.advance(2000);
      await seeEntry(fx);
      const ensured = (await fx.hostCalls()).filter((c) => `${c.target}.${c.method}` === ENSURE);
      expectEqual(ensured.length, 0, "workspace creation before Continue");
      expectEqual(await fx.startupCompleted(), [], "completions before Continue");
      await expectNoForbiddenHostCalls(fx, "late answer");
      await (await button(fx, "lumiEntry.continue")).click();
      // The close path awaits host reads under a faked page clock: tick it while waiting.
      const title = await entryTitle(fx);
      await until(async () => {
        await fx.advance(250);
        return (await fx.page.getByRole("heading", { level: 1, name: title }).count()) === 0;
      }, "entry closed after Continue");
    },
  },
  {
    id: "startup.root-restore-failure",
    claim:
      "A failed restore opens the entry (never a blank or blocked app) with Sign in, Use API key and Continue locally available, and starts no sign-in",
    surface: "root",
    startup: init(),
    auto: { restore: fail("lumi_request_timeout") },
    run: async (fx) => {
      await seeEntry(fx);
      await seeActions(fx).catch(async () => {
        // A failed restore may instead offer a retry; local and BYOK must still be reachable.
        await see(await button(fx, "login.useApiKey"), "Use API key");
        await see(await button(fx, "lumiEntry.local"), "Continue locally");
      });
      await expectOnlyRestoreOnBridge(fx);
      await expectNoForbiddenHostCalls(fx, "restore failure");
    },
  },
  {
    id: "startup.root-cancel",
    claim:
      "From the entry, an explicit Sign in issues exactly one begin; Cancel issues one cancel and returns to Sign in with local/BYOK intact, and nothing completes, enrolls, adopts or writes",
    surface: "root",
    startup: init(),
    auto: { restore: ok(), begin: withSignIn(), cancel: ok() },
    run: async (fx) => {
      await seeEntry(fx);
      await (await button(fx, "lumiAccount.begin")).click();
      await see(await button(fx, "lumiAccount.cancel"), "Cancel");
      await (await button(fx, "lumiAccount.cancel")).click();
      await seeActions(fx);
      const keys = (await fx.calls()).map((call) => call.key);
      expectEqual(keys.filter((k) => k === "begin").length, 1, "begin calls");
      expectEqual(keys.filter((k) => k === "cancel").length, 1, "cancel calls");
      expect(
        keys.every((k) => k === "restore" || k === "begin" || k === "cancel"),
        `bridge saw ${JSON.stringify(keys)}`,
      );
      await expectNoForbiddenHostCalls(fx, "cancel");
      await expectEntryWithoutWorkspaceCreation(fx);
    },
  },
  {
    id: "startup.root-continue-locally",
    claim:
      "Continue locally closes the entry and only then lets the startup fallback create the default workspace; Lumi sees only restore, no setting records the choice, and the next launch shows the entry again",
    surface: "root",
    startup: init(),
    auto: SIGNED_OUT,
    run: async (fx) => {
      await seeEntry(fx);
      const before = (await fx.hostCalls()).length;
      await (await button(fx, "lumiEntry.local")).click();
      await noEntry(fx);
      await until(
        async () =>
          (await fx.hostCalls()).slice(before).some((c) => `${c.target}.${c.method}` === ENSURE),
        "default workspace created after the explicit choice",
      );
      await expectOnlyRestoreOnBridge(fx);
      await expectNoForbiddenHostCalls(fx, "continue locally");
      // Per launch, not persisted: a fresh renderer with the same host state shows the entry again.
      fx.allowNavigation();
      await fx.page.reload();
      await seeEntry(fx);
    },
  },
  {
    id: "startup.root-byok",
    claim:
      "Use API key opens the existing BYOK form and Cancel returns to the entry; browsing it writes no credential, provider or Lumi state",
    surface: "root",
    startup: init(),
    auto: SIGNED_OUT,
    run: async (fx) => {
      await seeEntry(fx);
      await (await button(fx, "login.useApiKey")).click();
      await see(fx.page.getByTestId("login-api-key-input"), "API key input");
      await expectNoForbiddenHostCalls(fx, "byok form open");
      await fx.page.getByTestId("login-api-key-cancel-button").click();
      await seeActions(fx);
      await expectOnlyRestoreOnBridge(fx);
      await expectNoForbiddenHostCalls(fx, "byok cancel");
    },
  },
  {
    id: "startup.root-restore-session-gated",
    claim:
      "With restoreSession on and a persisted workspace session, the real Root makes no workspace-scoped host call and writes nothing before the entry decision; after Continue locally the persisted workspace is actually opened (positive control). In-renderer tab state is not observable here: Root renders only the entry, so removing the restore gate is equivalent at this boundary",
    surface: "root",
    startup: init({ persistedWorkspace: PERSISTED }),
    auto: SIGNED_OUT,
    run: async (fx) => {
      await seeEntry(fx);
      for (let tick = 0; tick < 6; tick += 1) await fx.advance(500);
      expectEqual(
        persistedPathCalls(await fx.hostCalls()).length,
        0,
        "workspace calls before entry",
      );
      await expectNoForbiddenHostCalls(fx, "restore gated");
      await (await button(fx, "lumiEntry.local")).click();
      await untilTicking(
        fx,
        async () => persistedPathCalls(await fx.hostCalls()).length > 0,
        "persisted workspace restored after the explicit choice",
      );
      await expectOnlyRestoreOnBridge(fx);
    },
  },
  {
    id: "startup.root-restore-session-lumi-only",
    claim:
      "With restoreSession on, a restored Lumi session skips the entry and the persisted workspace is restored; nothing is written",
    surface: "root",
    startup: init({ persistedWorkspace: PERSISTED }),
    auto: { restore: withAccount() },
    run: async (fx) => {
      await untilTicking(
        fx,
        async () => persistedPathCalls(await fx.hostCalls()).length > 0,
        "persisted workspace restored",
      );
      await noEntry(fx);
      await expectOnlyRestoreOnBridge(fx);
      await expectNoForbiddenHostCalls(fx, "restore lumi-only");
    },
  },
  {
    id: "startup.root-sign-in-completion",
    claim:
      "Signing in through the real entry: nothing opens the browser until the explicit action, 'complete' is written once however often it is pressed, the entry then closes and only then does the startup fallback create the default workspace; no enrollment, adoption, credential or provider write happens",
    surface: "root",
    startup: init(),
    auto: { restore: ok(), begin: withSignIn(), complete: withAccount() },
    run: async (fx) => {
      await seeEntry(fx);
      await (await button(fx, "lumiAccount.begin")).click();
      await see(await button(fx, "lumiAccount.complete"), "I approved");
      expectEqual(await fx.hostOpens(), [], "browser opened without the explicit action");
      await fx.advance(1000);
      expectEqual(
        (await fx.hostCalls()).filter((c) => `${c.target}.${c.method}` === ENSURE).length,
        0,
        "workspace creation before the explicit completion",
      );
      const done = await button(fx, "lumiAccount.complete");
      await done.dblclick();
      await untilTicking(
        fx,
        async () => (await fx.callsOf("complete")).length > 0,
        "complete written",
      );
      await untilTicking(
        fx,
        async () =>
          (await fx.page.getByRole("heading", { level: 1, name: await entryTitle(fx) }).count()) ===
          0,
        "entry closed after sign-in",
      );
      const keys = (await fx.calls()).map((c) => c.key).filter((k) => k !== "restore");
      expectEqual(keys, ["begin", "complete"], "bridge writes");
      const ensured = (await fx.hostCalls()).filter((c) => `${c.target}.${c.method}` === ENSURE);
      expect(ensured.length > 0, "startup fallback ran after the explicit completion");
      await expectNoForbiddenHostCalls(fx, "sign-in completion");
    },
  },
  {
    id: "startup.root-byok-save",
    claim:
      "Saving a BYOK key through the real entry calls the existing provider owner once with that key and writes nothing to Lumi; the key appears in no other host call or bridge command, nothing is written before the explicit save, and the entry then closes",
    surface: "root",
    startup: init(),
    auto: SIGNED_OUT,
    run: async (fx) => {
      await seeEntry(fx);
      await (await button(fx, "login.useApiKey")).click();
      await see(fx.page.getByTestId("login-api-key-input"), "API key input");
      await fx.page.getByTestId("login-api-key-input").fill(KEY);
      await expectOnlyWrites(fx, {}, "typing a key");
      await fx.page.getByTestId("login-api-key-continue-button").click();
      await untilTicking(
        fx,
        async () =>
          (await fx.hostCalls()).some(
            (c) => `${c.target}.${c.method}` === "providerSettingsService.createPersonalProvider",
          ),
        "provider created by the existing owner",
      );
      await untilTicking(
        fx,
        async () =>
          (await fx.page.getByRole("heading", { level: 1, name: await entryTitle(fx) }).count()) ===
          0,
        "entry closed after save",
      );
      const calls = await fx.hostCalls();
      const created = calls.filter((c) => c.method === "createPersonalProvider");
      expectEqual(created.length, 1, "createPersonalProvider calls");
      expectEqual(created[0].args[0].templateId, "zai-api", "template");
      expectEqual(created[0].args[0].initialConfig.access.apiKey, KEY, "saved key");
      const leaks = calls.filter(
        (c) => c.method !== "createPersonalProvider" && JSON.stringify(c.args).includes(KEY),
      );
      expectEqual(
        leaks.map((c) => `${c.target}.${c.method}`),
        [],
        "key seen by other host calls",
      );
      expect(!JSON.stringify(await fx.calls()).includes(KEY), "the key reached the Lumi bridge");
      await expectOnlyRestoreOnBridge(fx);
      await expectOnlyWrites(
        fx,
        { "providerSettingsService.createPersonalProvider": 1 },
        "byok save",
      );
    },
  },
];
