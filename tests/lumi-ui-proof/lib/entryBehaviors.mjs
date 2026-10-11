import { until } from "../harness.mjs";
import { SIGN_IN_URL, ok, fail, withAccount, withSignIn } from "./data.mjs";
import { expect, expectEqual } from "./report.mjs";
import { reachRestoreTimeout } from "./states.mjs";
import { alertText, button, gone, see, seeText, textAbsent } from "./ui.mjs";

const HOLD = { restore: "hold" };
const SIGNED_OUT = { restore: ok() };

const count = async (fx, key) => (await fx.callsOf(key)).length;
const noAlert = (fx) => gone(alertText(fx), "alert");

/**
 * Entry-panel behavior claims. Each runs on a fresh page with a faked clock and a held or scripted
 * synthetic bridge, so late, dropped and duplicated replies are produced on purpose.
 */
export const ENTRY_BEHAVIORS = [
  {
    id: "entry.restore-called-once",
    claim: "Mounting the panel issues exactly one restore, and never begin/complete on its own",
    auto: HOLD,
    run: async (fx) => {
      await fx.waitCall("restore");
      await fx.advance(20_000);
      expectEqual(await count(fx, "restore"), 1, "restore calls");
      expectEqual(await count(fx, "begin"), 0, "begin calls");
      expectEqual(await count(fx, "complete"), 0, "complete calls");
      return "1 restore after 20 s of faked time";
    },
  },
  {
    id: "entry.restore-at-4s",
    claim: "A restore answered at 4 s never shows the slow notice and leaves the sign-in button",
    auto: HOLD,
    run: async (fx) => {
      await fx.advance(4000);
      await textAbsent(fx, "lumiEntry.restoringSlow");
      await fx.settle(0, ok());
      await see(await button(fx, "lumiAccount.begin"), "begin after restore");
      await textAbsent(fx, "lumiEntry.restoringSlow");
      await noAlert(fx);
    },
  },
  {
    id: "entry.restore-at-6s",
    claim: "A restore answered at 6 s shows the slow notice at 5 s, then clears it and the status",
    auto: HOLD,
    run: async (fx) => {
      await fx.advance(5000);
      await seeText(fx, "lumiEntry.restoringSlow");
      await fx.advance(1000);
      await fx.settle(0, withAccount());
      await see(await button(fx, "lumiEntry.continue"), "Continue");
      await textAbsent(fx, "lumiEntry.restoringSlow");
      expectEqual(await fx.signedIn(), 0, "onSignedIn before Continue");
    },
  },
  {
    id: "entry.restore-at-31s",
    claim: "A restore answered at 31 s (inside the 35 s bound) succeeds with no timeout alert",
    auto: HOLD,
    run: async (fx) => {
      await fx.advance(5000);
      await seeText(fx, "lumiEntry.restoringSlow");
      await fx.advance(26_000);
      await noAlert(fx);
      await fx.settle(0, withAccount());
      await see(await button(fx, "lumiEntry.continue"), "Continue");
      await noAlert(fx);
      expectEqual(await count(fx, "restore"), 1, "restore calls");
    },
  },
  {
    id: "entry.restore-never-answers",
    claim:
      "A restore that never answers ends in lumi_request_timeout at 35 s with focus on 'check again', and never retries by itself",
    auto: HOLD,
    run: async (fx) => {
      await fx.advance(34_000);
      await noAlert(fx);
      await fx.advance(1500);
      await see(alertText(fx), "timeout alert");
      const text = await alertText(fx).innerText();
      expect(text.includes("lumi_request_timeout"), `alert shows the stable code, got: ${text}`);
      expect(text.includes(await fx.t("lumiEntry.restoreFailed")), "alert uses restoreFailed copy");
      const checkAgain = await button(fx, "lumiEntry.checkAgain");
      await see(checkAgain, "check again");
      expect(
        await checkAgain.evaluate((el) => el === document.activeElement),
        "check-again button holds focus",
      );
      await fx.advance(120_000);
      expectEqual(await count(fx, "restore"), 1, "restore calls after 2 more minutes");
      expectEqual(await count(fx, "begin"), 0, "failed restore must not start a sign-in");
    },
  },
  {
    id: "entry.late-restore-after-timeout-ignored",
    claim:
      "A host restore answer arriving after the timeout is dropped: no account, no Continue, no callback",
    auto: HOLD,
    run: async (fx) => {
      await reachRestoreTimeout(fx);
      await see(alertText(fx), "timeout alert");
      await fx.settle(0, withAccount());
      await fx.advance(1000);
      await see(alertText(fx), "alert still shown");
      await gone(
        fx.page.getByRole("button", { name: await fx.t("lumiEntry.continue"), exact: true }),
        "Continue",
      );
      expectEqual(await fx.signedIn(), 0, "onSignedIn");
    },
  },
  {
    id: "entry.check-again-is-explicit-restore",
    claim:
      "'Check saved session again' issues one direct restore (not glued to the hung one); success needs an explicit Continue; a second failure never starts sign-in",
    auto: HOLD,
    run: async (fx) => {
      await reachRestoreTimeout(fx);
      const checkAgain = await button(fx, "lumiEntry.checkAgain");
      await see(checkAgain, "check again");
      await checkAgain.dblclick();
      const restores = await fx.waitCall("restore", 2);
      expectEqual(restores.length, 2, "restore calls after double-click on check again");
      await fx.settle(1, withAccount());
      await see(await button(fx, "lumiEntry.continue"), "Continue");
      expectEqual(await fx.signedIn(), 0, "restored session must not auto-complete");
      await (await button(fx, "lumiEntry.continue")).click();
      expectEqual(await fx.signedIn(), 1, "onSignedIn after explicit Continue");
      expectEqual(await count(fx, "begin"), 0, "begin calls");
    },
  },
  {
    id: "entry.check-again-failure-no-sign-in",
    claim: "A failed re-check shows the error again and still never begins a sign-in",
    auto: HOLD,
    run: async (fx) => {
      await reachRestoreTimeout(fx);
      await (await button(fx, "lumiEntry.checkAgain")).click();
      await fx.waitCall("restore", 2);
      await fx.settle(1, fail("lumi_sender_denied"));
      await see(alertText(fx), "alert");
      expect((await alertText(fx).innerText()).includes("lumi_sender_denied"), "code shown");
      expectEqual(await count(fx, "begin"), 0, "begin calls");
    },
  },
  {
    id: "entry.begin-not-duplicated",
    claim: "Double-clicking Sign in writes begin once",
    auto: { ...SIGNED_OUT, begin: "hold" },
    run: async (fx) => {
      const begin = await button(fx, "lumiAccount.begin");
      await see(begin, "begin");
      await begin.dblclick();
      await fx.waitCall("begin");
      await fx.advance(500);
      expectEqual(await count(fx, "begin"), 1, "begin calls");
    },
  },
  {
    id: "entry.begin-error-retry",
    claim: "A begin error shows copy plus code and a 'Try again' that issues one new begin",
    auto: { ...SIGNED_OUT, begin: fail("lumi_request_timeout") },
    run: async (fx) => {
      await (await button(fx, "lumiAccount.begin")).click();
      await see(alertText(fx), "alert");
      expect((await alertText(fx).innerText()).includes("lumi_request_timeout"), "code shown");
      await fx.setAuto({ begin: withSignIn() });
      await (await button(fx, "lumiEntry.retry")).click();
      await fx.waitCall("begin", 2);
      expectEqual(await count(fx, "begin"), 2, "begin calls");
      await see(await button(fx, "lumiAccount.complete"), "sign-in code step");
    },
  },
  {
    id: "entry.sign-in-complete-once",
    claim:
      "Open-browser only calls platform.openExternal; double-clicking 'I approved' writes complete once; onSignedIn fires once",
    auto: { ...SIGNED_OUT, begin: withSignIn(), complete: "hold" },
    run: async (fx) => {
      await (await button(fx, "lumiAccount.begin")).click();
      await see(await button(fx, "lumiAccount.complete"), "complete");
      await (await button(fx, "lumiAccount.openBrowser")).click();
      expectEqual(await fx.opens(), [SIGN_IN_URL], "openExternal calls");
      expectEqual(await count(fx, "complete"), 0, "open browser must not complete");
      await (await button(fx, "lumiAccount.complete")).dblclick();
      await fx.waitCall("complete");
      await fx.advance(500);
      expectEqual(await count(fx, "complete"), 1, "complete calls");
      expectEqual(await fx.signedIn(), 0, "onSignedIn before host answers");
      await fx.settle((await fx.callsOf("complete"))[0].n, withAccount());
      await until(async () => (await fx.signedIn()) === 1, "onSignedIn once");
      await fx.advance(500);
      expectEqual(await fx.signedIn(), 1, "onSignedIn count");
    },
  },
  {
    id: "entry.late-complete-after-timeout-ignored",
    claim:
      "A complete answer arriving after the 35 s bound is dropped (no callback); a retry then succeeds exactly once",
    auto: { ...SIGNED_OUT, begin: withSignIn(), complete: "hold" },
    run: async (fx) => {
      await (await button(fx, "lumiAccount.begin")).click();
      await (await button(fx, "lumiAccount.complete")).click();
      const [first] = await fx.waitCall("complete");
      await fx.advance(35_001);
      await see(alertText(fx), "timeout alert");
      await fx.settle(first.n, withAccount());
      await fx.advance(500);
      expectEqual(await fx.signedIn(), 0, "late complete must not call onSignedIn");
      await (await button(fx, "lumiAccount.complete")).click();
      const [, second] = await fx.waitCall("complete", 2);
      await fx.settle(second.n, withAccount());
      await until(async () => (await fx.signedIn()) === 1, "onSignedIn after retry");
      await fx.advance(500);
      expectEqual(await fx.signedIn(), 1, "onSignedIn count");
    },
  },
  {
    id: "entry.cancel-supersedes-inflight-complete",
    claim:
      "Cancel during an in-flight complete returns to Sign in, and the superseded complete answer cannot sign the user in",
    auto: { ...SIGNED_OUT, begin: withSignIn(), complete: "hold", cancel: ok() },
    run: async (fx) => {
      await (await button(fx, "lumiAccount.begin")).click();
      await (await button(fx, "lumiAccount.complete")).click();
      const [pending] = await fx.waitCall("complete");
      await (await button(fx, "lumiAccount.cancel")).click();
      await fx.waitCall("cancel");
      await see(await button(fx, "lumiAccount.begin"), "back to begin");
      await fx.settle(pending.n, withAccount());
      await fx.advance(500);
      expectEqual(await fx.signedIn(), 0, "onSignedIn after superseded complete");
      await gone(
        fx.page.getByRole("button", { name: await fx.t("lumiEntry.continue"), exact: true }),
        "Continue",
      );
    },
  },
];
