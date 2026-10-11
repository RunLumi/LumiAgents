import { until } from "../harness.mjs";
import {
  PROJECTS,
  PROJECTS_B,
  WORKSPACE_PATH_A,
  WORKSPACE_PATH_B,
  boundWorkspace,
  fail,
  ok,
  unboundWorkspace,
} from "./data.mjs";
import { expect, expectEqual } from "./report.mjs";
import { alertText, button, field, gone, see, seeText } from "./ui.mjs";
import {
  count,
  hasButton,
  isDisabled,
  loaded,
  optionCount,
  ready,
  writeCount,
} from "./workspaceHelpers.mjs";

/** Workspace-section load, bind and stale-answer claims. */
export const WORKSPACE_BEHAVIORS = [
  {
    id: "workspace.loading-sequence",
    claim:
      "Loading shows a status with inputs disabled; list-projects precedes read-workspace and both carry org/path/environment from props",
    auto: { "list-projects": "hold" },
    run: async (fx) => {
      await seeText(fx, "lumiWorkspace.busy");
      expect(await field.org(fx).isDisabled(), "org select disabled while loading");
      expect(await field.project(fx).isDisabled(), "project select disabled while loading");
      expect(await field.name(fx).isDisabled(), "name input disabled while loading");
      expectEqual(await count(fx, "read-workspace"), 0, "read-workspace before projects settle");
      await fx.settle(0, ok({ projects: PROJECTS }));
      const [read] = await fx.waitCall("read-workspace");
      expectEqual(
        read.command,
        {
          action: "read-workspace",
          orgId: "org_a",
          workspacePath: WORKSPACE_PATH_A,
          environmentType: "local",
        },
        "read-workspace command",
      );
      await fx.settle(read.n, ok({ workspace: unboundWorkspace() }));
      await gone(
        fx.page.getByRole("status").filter({ hasText: await fx.t("lumiWorkspace.busy") }),
        "busy status",
      );
      expectEqual(await writeCount(fx), 0, "writes while merely loading");
    },
  },
  {
    id: "workspace.page-incomplete-fails-closed",
    claim:
      "lumi_page_incomplete shows dedicated copy plus code, no reload button, nothing selectable and no write possible",
    auto: { "list-projects": fail("lumi_page_incomplete") },
    run: async (fx) => {
      await seeText(fx, "lumiError.pageIncomplete");
      expect(
        (await alertText(fx).innerText()).includes("lumi_page_incomplete"),
        "stable code shown",
      );
      expect(!(await hasButton(fx, "lumiWorkspace.reload")), "no plain Reload offered");
      expect(await field.project(fx).isDisabled(), "project select disabled (no partial list)");
      expectEqual(await optionCount(fx), 1, "only the placeholder option exists");
      expect(await isDisabled(fx, "lumiWorkspace.bind"), "bind disabled");
      expectEqual(await count(fx, "read-workspace"), 0, "no read after the incomplete page");
      expectEqual(await writeCount(fx), 0, "writes");
    },
  },
  {
    id: "workspace.retryable-error-reload-once",
    claim:
      "A retryable load failure offers Reload; one click issues one new list-projects and clears the alert on success",
    auto: { "list-projects": fail("lumi_request_timeout") },
    run: async (fx) => {
      const reload = await button(fx, "lumiWorkspace.reload");
      await see(reload, "reload");
      await fx.setAuto({ ...loaded(unboundWorkspace()) });
      await reload.click();
      await fx.waitCall("list-projects", 2);
      await ready(fx);
      await gone(alertText(fx), "alert after successful reload");
      expectEqual(await count(fx, "list-projects"), 2, "list-projects calls");
    },
  },
  {
    id: "workspace.device-required-blocks-bind",
    claim: "A workspace whose device is unusable shows the device notice and keeps bind disabled",
    auto: loaded(unboundWorkspace({ deviceUsable: false })),
    run: async (fx) => {
      await seeText(fx, "lumiWorkspace.deviceRequired");
      await ready(fx);
      await field.project(fx).selectOption("prj_1");
      expect(await isDisabled(fx, "lumiWorkspace.bind"), "bind disabled without a usable device");
      expectEqual(await writeCount(fx), 0, "writes");
    },
  },
  {
    id: "workspace.empty-projects",
    claim: "No open projects shows its own placeholder and hint, and bind stays disabled",
    auto: loaded(unboundWorkspace(), [PROJECTS[2]]),
    run: async (fx) => {
      await seeText(fx, "lumiWorkspace.noProjectsHint");
      expectEqual(
        await field.project(fx).locator("option").first().innerText(),
        await fx.t("lumiWorkspace.noProjects"),
        "placeholder copy",
      );
      expect(await isDisabled(fx, "lumiWorkspace.bind"), "bind disabled");
    },
  },
  {
    id: "workspace.bind-not-duplicated",
    claim:
      "Double-clicking bind writes bind-workspace once, with confirm:true, the chosen project and the approved display name only",
    auto: { ...loaded(unboundWorkspace()), "bind-workspace": "hold" },
    run: async (fx) => {
      await ready(fx);
      await field.project(fx).selectOption("prj_1");
      const bind = await button(fx, "lumiWorkspace.bind");
      await until(async () => bind.isEnabled(), "bind enabled");
      await bind.dblclick();
      const [call] = await fx.waitCall("bind-workspace");
      await fx.advance(500);
      expectEqual(await count(fx, "bind-workspace"), 1, "bind calls");
      expectEqual(
        Object.keys(call.command).sort(),
        [
          "action",
          "confirm",
          "displayName",
          "environmentType",
          "orgId",
          "projectId",
          "workspacePath",
        ],
        "bind command keys",
      );
      expectEqual(call.command.confirm, true, "confirm flag");
      expectEqual(call.command.projectId, "prj_1", "projectId");
    },
  },
  {
    id: "workspace.dropped-bind-reread-ok",
    claim:
      "A dropped bind reply triggers a read-only re-read, shows the failure, and never re-issues the bind by itself",
    auto: { ...loaded(unboundWorkspace()), "bind-workspace": "hold" },
    run: async (fx) => {
      await ready(fx);
      await field.project(fx).selectOption("prj_1");
      await (await button(fx, "lumiWorkspace.bind")).click();
      const [bind] = await fx.waitCall("bind-workspace");
      const readsBefore = await count(fx, "read-workspace");
      await fx.rejectCall(bind.n);
      await until(
        async () => (await count(fx, "read-workspace")) === readsBefore + 1,
        "re-read after drop",
      );
      await fx.advance(2000);
      expectEqual(await count(fx, "bind-workspace"), 1, "bind calls (no auto retry)");
      expect(
        (await alertText(fx).innerText()).includes("lumi_workspace_action_failed"),
        "failure code shown",
      );
    },
  },
  {
    id: "workspace.dropped-bind-reread-fails-disables-bind",
    claim:
      "If the re-read after a dropped bind also fails, the projection is cleared: bind stays disabled until an explicit reload proves state",
    auto: { ...loaded(unboundWorkspace()), "bind-workspace": "hold" },
    run: async (fx) => {
      await ready(fx);
      await field.project(fx).selectOption("prj_1");
      await (await button(fx, "lumiWorkspace.bind")).click();
      const [bind] = await fx.waitCall("bind-workspace");
      await fx.setAuto({ "read-workspace": fail("lumi_request_timeout") });
      await fx.rejectCall(bind.n);
      await see(await button(fx, "lumiWorkspace.reload"), "reload");
      await until(
        async () => await (await button(fx, "lumiWorkspace.bind")).isDisabled(),
        "bind disabled",
      );
      expect((await field.project(fx).isDisabled()) === false, "project select usable again");
      expectEqual(await count(fx, "bind-workspace"), 1, "bind calls");
      await fx.setAuto({ ...loaded(unboundWorkspace()) });
      await (await button(fx, "lumiWorkspace.reload")).click();
      await until(async () => (await count(fx, "list-projects")) === 2, "reload re-lists");
      await ready(fx);
      await field.project(fx).selectOption("prj_1");
      await until(
        async () => await (await button(fx, "lumiWorkspace.bind")).isEnabled(),
        "bind enabled after proven reload",
      );
      expectEqual(await count(fx, "bind-workspace"), 1, "bind calls after reload (still one)");
    },
  },
  {
    id: "workspace.stale-load-result-dropped",
    claim:
      "A load answer for a workspace the user already left cannot overwrite the newer workspace's projects or name",
    auto: { "list-projects": "hold" },
    run: async (fx) => {
      await fx.waitCall("list-projects");
      await fx.setAuto({
        "list-projects": ok({ projects: PROJECTS_B }),
        "read-workspace": ok({
          workspace: boundWorkspace({
            displayName: "Beta service",
            workspaceKey: "wk_b",
            adoptionStateId: "ads_b",
            projectId: "prj_b",
          }),
        }),
      });
      await fx.page.evaluate((path) => window.__proof.setWorkspacePath(path), WORKSPACE_PATH_B);
      await until(
        async () => (await field.name(fx).inputValue()) === "Beta service",
        "workspace B loaded",
      );
      // Late answer for workspace A, then its follow-up read (the section still issues it).
      await fx.setAuto({ "read-workspace": "hold" });
      await fx.settle(0, ok({ projects: PROJECTS }));
      const reads = await fx.waitCall("read-workspace", 2);
      await fx.settle(
        reads.at(-1).n,
        ok({ workspace: boundWorkspace({ displayName: "STALE Alpha", adoptionVersion: 99 }) }),
      );
      await fx.advance(500);
      expectEqual(await field.name(fx).inputValue(), "Beta service", "name after stale A answer");
      const options = await field.project(fx).locator("option").allInnerTexts();
      expect(
        !options.some((o) => o.startsWith("Platform")),
        `stale project list leaked: ${options.join(" / ")}`,
      );
      expectEqual(await writeCount(fx), 0, "writes");
      return `stale A read-workspace was still issued (read-only, ${reads.length} reads); its result was ignored`;
    },
  },
  {
    id: "workspace.stale-write-result-dropped",
    claim:
      "A write answer for a workspace the user already left cannot replace the newer workspace's projection",
    auto: { ...loaded(boundWorkspace()), "set-workspace-credential-mode": "hold" },
    run: async (fx) => {
      await field.radio(fx, "metadata_only").check();
      await (await button(fx, "lumiWorkspace.credential.confirm")).click();
      const [write] = await fx.waitCall("set-workspace-credential-mode");
      await fx.setAuto({
        ...loaded(
          boundWorkspace({
            displayName: "Beta service",
            workspaceKey: "wk_b",
            adoptionStateId: "ads_b",
            adoptionVersion: 9,
          }),
        ),
      });
      await fx.page.evaluate((path) => window.__proof.setWorkspacePath(path), WORKSPACE_PATH_B);
      await until(
        async () => (await field.name(fx).inputValue()) === "Beta service",
        "workspace B loaded",
      );
      await fx.settle(
        write.n,
        ok({
          workspace: boundWorkspace({
            displayName: "STALE Alpha",
            credentialMode: "metadata_only",
            adoptionVersion: 4,
          }),
        }),
      );
      await fx.advance(500);
      expectEqual(
        await field.name(fx).inputValue(),
        "Beta service",
        "name after stale write answer",
      );
      expect(await field.radio(fx, "local_credential").isChecked(), "B's server mode still shown");
      expectEqual(await count(fx, "set-workspace-credential-mode"), 1, "write count");
    },
  },
];
