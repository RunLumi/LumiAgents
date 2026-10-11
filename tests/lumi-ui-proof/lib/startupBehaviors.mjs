import { until } from "../harness.mjs";
import { expectEqual } from "./report.mjs";
import { button, see, textAbsent } from "./ui.mjs";
import { SIGNED_OUT, ZCODE_USER, init, names, seeActions } from "./startupHelpers.mjs";
import { ROOT_STARTUP_BEHAVIORS } from "./rootStartupBehaviors.mjs";

export { PROVIDERS, forbiddenHostCalls } from "./startupHelpers.mjs";

/** Root claims (real Root) followed by the WelcomeScreen-only claims. */
const WELCOME_STARTUP_BEHAVIORS = [
  {
    id: "startup.welcome-zcode-user-needs-explicit-choice",
    claim:
      "In the real WelcomeScreen a ZCode user never auto-completes the entry when the Lumi bridge exists, but still does when it does not (positive control: the user store write works)",
    surface: "welcome",
    startup: init({ lumiBridge: false }),
    auto: SIGNED_OUT,
    run: async (fx) => {
      await fx.setZcodeUser(ZCODE_USER);
      await until(
        async () => (await fx.startupCompleted()).includes("oauth"),
        "no-bridge host completes from an existing ZCode user",
      );
    },
  },
  {
    id: "startup.welcome-bridge-ignores-zcode-user",
    claim:
      "With the Lumi bridge present, setting a ZCode user does not complete or close the entry; only an explicit Continue locally completes it, as 'skip'",
    surface: "welcome",
    startup: init(),
    auto: SIGNED_OUT,
    run: async (fx) => {
      await seeActions(fx);
      await fx.setZcodeUser(ZCODE_USER);
      await fx.advance(2000);
      await seeActions(fx);
      expectEqual(await fx.startupCompleted(), [], "completions after ZCode user appeared");
      await (await button(fx, "lumiEntry.local")).click();
      expectEqual(await fx.startupCompleted(), ["skip"], "completions after Continue locally");
      expectEqual(
        (await fx.calls()).map((c) => c.key),
        ["restore"],
        "bridge calls",
      );
    },
  },
  {
    id: "startup.welcome-no-bridge",
    claim:
      "Without a Lumi bridge (web/test host) the entry offers API key and Continue locally and no Lumi sign-in, and no Lumi request exists to be made",
    surface: "welcome",
    startup: init({ lumiBridge: false }),
    auto: {},
    run: async (fx) => {
      await see(await button(fx, "login.useApiKey"), "Use API key");
      await see(await button(fx, "lumiEntry.local"), "Continue locally");
      await textAbsent(fx, "lumiAccount.begin", "Lumi sign-in action");
      expectEqual((await fx.calls()).length, 0, "bridge calls");
    },
  },
  {
    id: "startup.welcome-explicit-provider-connect",
    claim:
      "Hiding the OAuth buttons does not remove the owner: an explicit provider-connect request still starts OAuth for that provider (positive control for 'hidden, not removed')",
    surface: "welcome",
    startup: init(),
    auto: SIGNED_OUT,
    run: async (fx) => {
      await seeActions(fx);
      await fx.requestLogin("zai");
      await until(
        async () => names(await fx.hostCalls()).includes("oauthService.startOAuthWithPolling"),
        "explicit request started OAuth",
      );
      const started = (await fx.hostCalls()).filter((c) => c.method === "startOAuthWithPolling");
      expectEqual(
        started.map((c) => c.args[0]),
        ["zai"],
        "provider started",
      );
      expectEqual(
        (await fx.calls()).map((c) => c.key),
        ["restore"],
        "bridge calls",
      );
    },
  },
];

/** Root claims (real Root) followed by the WelcomeScreen-only claims. */
export const STARTUP_BEHAVIORS = [...ROOT_STARTUP_BEHAVIORS, ...WELCOME_STARTUP_BEHAVIORS];
