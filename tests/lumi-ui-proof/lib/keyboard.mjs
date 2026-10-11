import { until } from "../harness.mjs";
import { PROJECTS, boundWorkspace, ok, unboundWorkspace, withSignIn } from "./data.mjs";
import { expect, expectEqual } from "./report.mjs";
import { reachRestoreTimeout } from "./states.mjs";
import {
  button,
  describeActive,
  expectForcedColorsOutline,
  expectVisibleFocus,
  field,
  see,
  seeText,
  sentinel,
  stopLabels,
  tabWalk,
} from "./ui.mjs";

const FORCED_COLORS_ID = "keyboard.forced-colors-focus";

const loaded = (workspace) => ({
  "list-projects": ok({ projects: PROJECTS }),
  "read-workspace": ok({ workspace }),
});

async function expectInitialFocus(fx, id) {
  const label = await fx.t(id);
  // Location only: a script-focused autoFocus control is not :focus-visible until a key is pressed,
  // so the indicator is asserted on Tab stops, not on this first stop.
  await until(
    async () => (await describeActive(fx.page))?.label === label,
    `initial focus on '${label}'`,
  );
}

/** Entry panel walks: where focus starts, Tab order, and a visible indicator on every stop. */
const ENTRY_WALKS = [
  {
    id: "keyboard.entry-restoring-local-reachable",
    claim:
      "While restoring, the panel traps nothing: the first Tab leaves the panel (local/BYOK controls stay reachable)",
    auto: { restore: "hold" },
    run: async (fx) => {
      await seeText(fx, "lumiEntry.restoring");
      const stops = await tabWalk(fx, sentinel, 3);
      expectEqual(stopLabels(stops), ["after-panel sentinel"], "tab stops");
    },
  },
  {
    id: "keyboard.entry-begin",
    claim: "Sign in starts focused and Tab then leaves the panel",
    auto: { restore: ok() },
    run: async (fx) => {
      await see(await button(fx, "lumiAccount.begin"), "begin");
      await expectInitialFocus(fx, "lumiAccount.begin");
      const stops = await tabWalk(fx, sentinel, 4);
      expectEqual(stopLabels(stops), ["after-panel sentinel"], "tab stops");
    },
  },
  {
    id: "keyboard.entry-sign-in-code",
    claim:
      "Sign-in code step: focus starts on Open browser; Tab order is Open browser → I approved → Cancel → leave; every stop shows focus",
    auto: { restore: ok(), begin: withSignIn() },
    run: async (fx) => {
      await (await button(fx, "lumiAccount.begin")).click();
      await see(await button(fx, "lumiAccount.complete"), "complete");
      await expectInitialFocus(fx, "lumiAccount.openBrowser");
      const stops = await tabWalk(fx, sentinel, 6);
      expectEqual(
        stopLabels(stops),
        [
          await fx.t("lumiAccount.complete"),
          await fx.t("lumiAccount.cancel"),
          "after-panel sentinel",
        ],
        "tab stops",
      );
      expectVisibleFocus(stops.slice(0, -1), "sign-in code step");
    },
  },
  {
    id: "keyboard.entry-restore-failed",
    claim:
      "After a failed restore focus lands on 'Check saved session again', then Sign in, then leaves; both show focus",
    auto: { restore: "hold" },
    run: async (fx) => {
      await reachRestoreTimeout(fx);
      await see(await button(fx, "lumiEntry.checkAgain"), "check again");
      await expectInitialFocus(fx, "lumiEntry.checkAgain");
      const stops = await tabWalk(fx, sentinel, 5);
      expectEqual(
        stopLabels(stops),
        [await fx.t("lumiAccount.begin"), "after-panel sentinel"],
        "tab stops",
      );
      expectVisibleFocus(stops.slice(0, -1), "restore failed");
    },
  },
];

const WORKSPACE_WALKS = [
  {
    id: "keyboard.workspace-bound-credential",
    claim:
      "Bound workspace: selects, the credential radio group (arrow keys change the pick), Record/Discard and the rollback button are all keyboard-reachable with visible focus; the keyboard path alone can discard a pick",
    auto: loaded(boundWorkspace()),
    run: async (fx) => {
      await see(field.radio(fx, "local_credential"), "radios");
      const rollback = await fx.t("lumiWorkspace.rollback");
      const first = await tabWalk(fx, (stop) => stop.id === "lumi-credential-local_credential", 6);
      expectEqual(
        first.map((s) => s.id),
        ["lumi-workspace-org", "lumi-workspace-project", "lumi-credential-local_credential"],
        "stops to the radio group",
      );
      await fx.page.keyboard.press("ArrowDown");
      expect(
        await field.radio(fx, "metadata_only").isChecked(),
        "ArrowDown selects the next label",
      );
      const confirm = await fx.t("lumiWorkspace.credential.confirm");
      const discard = await fx.t("lumiWorkspace.credential.cancel");
      const advance = await fx.t("lumiWorkspace.next.managed_policy");
      const rest = await tabWalk(fx, (stop) => stop.label === rollback, 5);
      expectEqual(
        stopLabels(rest),
        [confirm, discard, advance, rollback],
        "stops after the radio group",
      );
      expectVisibleFocus([...first, ...rest], "bound workspace");
      // Focus is on the rollback button; Discard is two stops back (past 'Apply managed policy').
      await fx.page.keyboard.press("Shift+Tab");
      await fx.page.keyboard.press("Shift+Tab");
      expectEqual((await describeActive(fx.page)).label, discard, "Shift+Tab lands on Discard");
      await fx.page.keyboard.press("Enter");
      expect(
        await field.radio(fx, "local_credential").isChecked(),
        "Discard via keyboard restores the server mode",
      );
    },
  },
  {
    id: "keyboard.workspace-unbound",
    claim:
      "Unbound workspace: org, project, name and Bind are reachable in order with visible focus; Bind is only reachable once enabled",
    auto: loaded(unboundWorkspace()),
    run: async (fx) => {
      await until(
        async () => (await field.project(fx).locator("option").count()) > 1,
        "projects loaded",
      );
      await field.project(fx).selectOption("prj_1");
      await until(
        async () => await (await button(fx, "lumiWorkspace.bind")).isEnabled(),
        "bind enabled",
      );
      const bind = await fx.t("lumiWorkspace.bind");
      const stops = await tabWalk(fx, (stop) => stop.label === bind, 6);
      expectEqual(
        stops.map((s) => s.id ?? s.label),
        ["lumi-workspace-org", "lumi-workspace-project", "lumi-workspace-name", bind],
        "tab stops",
      );
      expectVisibleFocus(stops, "unbound workspace");
    },
  },
  {
    id: "keyboard.workspace-reload-after-error",
    claim: "After a retryable failure the Reload button is reachable by Tab and shows focus",
    auto: { "list-projects": { ok: false, code: "lumi_request_timeout" } },
    run: async (fx) => {
      const reload = await fx.t("lumiWorkspace.reload");
      await see(await button(fx, "lumiWorkspace.reload"), "reload");
      const stops = await tabWalk(fx, (stop) => stop.label === reload, 6);
      expect(stops.at(-1).label === reload, "Reload reached");
      expectVisibleFocus(stops, "reload after error");
    },
  },
];

/** Runs every walk across all viewports/locales: reflow must not change reachability or order. */
export async function runKeyboardChecks({ report, withFixture, LOCALES, WIDTHS, wanted }) {
  const walks = [
    ...ENTRY_WALKS.map((w) => ({ ...w, surface: "entry" })),
    ...WORKSPACE_WALKS.map((w) => ({ ...w, surface: "workspace" })),
  ].filter((walk) => wanted(walk.id));
  for (const walk of walks) {
    await report.check(walk.id, walk.claim, async () => {
      for (const locale of LOCALES) {
        for (const width of WIDTHS) {
          const label = `${walk.id}__${locale}__${width}`;
          await withFixture(
            label,
            { surface: walk.surface, locale, width, auto: walk.auto },
            async (fx) => {
              await walk.run(fx);
              await report.screenshot(fx.page, label);
            },
          );
        }
      }
      return `${LOCALES.length * WIDTHS.length} viewport/locale combinations`;
    });
  }
}

export const FORCED_COLORS_CLAIM =
  "Under real forced-colors emulation, keyboard focus on the sign-in and workspace controls still shows an outline (positive control: the mode is active)";

/** Tab stops in forced-colors mode, where box-shadow rings are discarded and only outline survives. */
export async function runForcedColorsCheck({ report, withFixture, wanted }) {
  if (!wanted(FORCED_COLORS_ID)) return;
  await report.check(FORCED_COLORS_ID, FORCED_COLORS_CLAIM, async () => {
    const projectsLoaded = (fx) =>
      until(async () => (await field.project(fx).locator("option").count()) > 1, "projects loaded");
    const cases = [
      {
        stopId: "keyboard.entry-restore-failed",
        surface: "entry",
        auto: { restore: "hold" },
        prepare: async (fx) => {
          await reachRestoreTimeout(fx);
          await see(await button(fx, "lumiEntry.checkAgain"), "check again");
        },
        stopWhen: sentinel,
      },
      {
        stopId: "keyboard.workspace-unbound",
        surface: "workspace",
        auto: loaded(unboundWorkspace()),
        prepare: projectsLoaded,
        stopWhen: (stop) => stop.id === "lumi-workspace-name",
      },
      {
        stopId: "keyboard.workspace-bound-credential",
        surface: "workspace",
        auto: loaded(boundWorkspace()),
        prepare: (fx) => see(field.radio(fx, "local_credential"), "radios"),
        stopWhen: (stop) => stop.id === "lumi-credential-local_credential",
      },
    ];
    for (const item of cases) {
      await withFixture(
        `${FORCED_COLORS_ID}__${item.stopId}`,
        { surface: item.surface, locale: "en-US", width: 768, auto: item.auto, forcedColors: true },
        async (fx) => {
          await item.prepare(fx);
          const stops = (await tabWalk(fx, item.stopWhen, 8)).filter((stop) => !sentinel(stop));
          expectForcedColorsOutline(stops, item.stopId);
          await report.screenshot(fx.page, `${FORCED_COLORS_ID}__${item.stopId}`);
        },
      );
    }
    return `${cases.length} walks, forced-colors active`;
  });
}

/** Ids of every keyboard claim, so the runner can validate a selection before launching a browser. */
export const KEYBOARD_CLAIM_IDS = [...ENTRY_WALKS, ...WORKSPACE_WALKS]
  .map((walk) => walk.id)
  .concat(FORCED_COLORS_ID);
