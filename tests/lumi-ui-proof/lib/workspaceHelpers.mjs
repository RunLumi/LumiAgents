import { until } from "../harness.mjs";
import { PROJECTS, ok } from "./data.mjs";
import { button, field } from "./ui.mjs";

export const loaded = (workspace, projects = PROJECTS) => ({
  "list-projects": ok({ projects }),
  "read-workspace": ok({ workspace }),
});
export const count = async (fx, key) => (await fx.callsOf(key)).length;
export const WRITES = [
  "bind-workspace",
  "advance-workspace",
  "rollback-workspace",
  "set-workspace-credential-mode",
];
export const writeCount = async (fx) =>
  (await fx.calls()).filter((c) => WRITES.includes(c.key)).length;
export const hasButton = async (fx, id) =>
  (await fx.page.getByRole("button", { name: await fx.t(id), exact: true }).count()) > 0;
export const isDisabled = async (fx, id) => (await button(fx, id)).isDisabled();
export const optionCount = (fx) => field.project(fx).locator("option").count();
export const ready = (fx) => until(async () => (await optionCount(fx)) > 1, "projects loaded");

export const SET_MODE_KEYS = [
  "action",
  "confirm",
  "credentialMode",
  "environmentType",
  "expectedStage",
  "expectedVersion",
  "orgId",
  "projectId",
  "workspacePath",
];
