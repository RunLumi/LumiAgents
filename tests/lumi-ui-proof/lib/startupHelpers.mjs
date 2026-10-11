import { until } from "../harness.mjs";
import { ok } from "./data.mjs";
import { expect, expectEqual } from "./report.mjs";
import { button, gone, see } from "./ui.mjs";

/** The host lists both ZCode OAuth providers; the entry must never render them. */
export const PROVIDERS = [
  { id: "zai", displayName: "Z.ai", enabled: true, order: 1 },
  { id: "bigmodel", displayName: "BigModel", enabled: true, order: 2 },
];
export const ZCODE_USER = { id: "zc_1", username: "zcode-user", displayName: "ZCode Proof" };

export const init = (over = {}) => ({ lumiBridge: true, providers: PROVIDERS, ...over });
export const SIGNED_OUT = { restore: ok() };

/**
 * Host calls that would change credentials, provider/model selection, settings or Lumi/ZCode login
 * state. None may occur from startup or from merely browsing the entry; only an explicit user action
 * may cause one, and each behavior below says which.
 */
export const FORBIDDEN_HOST_CALL =
  /^(oauthService\.(startLogin|startOAuth\w*|login|logout|cancel\w*|handleCallback|clear\w*|signOut)|credentialService\.(save|set|delete|clear|remove|store|write)\w*|providerSettingsService\.(create|update|delete|save|set|remove|upsert|reorder|patch)\w*|settingService\.(update|set|reset|save)\w*|modelSelectionService\.(set|select|update|save)\w*)$/;

export const forbiddenHostCalls = (calls) =>
  calls.filter((call) => FORBIDDEN_HOST_CALL.test(`${call.target}.${call.method}`));
export const names = (calls) => calls.map((call) => `${call.target}.${call.method}`);
export const ENSURE = "fileService.ensureConversationWorkspace";

export const PERSISTED = "/synthetic/persisted-workspace";
export const KEY = "sk-proof-synthetic-not-a-real-key";

/** Host calls made for the persisted workspace: proof that a restored workspace was actually opened. */
export const persistedPathCalls = (calls) =>
  calls.filter((call) => JSON.stringify(call.args).includes(PERSISTED));

/** Tick the faked page clock while waiting, so awaited host reads under it can settle. */
export const untilTicking = (fx, read, describe) =>
  until(async () => {
    await fx.advance(250);
    return read();
  }, describe);

/** Writes beyond the explicitly allowed (name -> exact count) ones fail; allowed ones must occur exactly. */
export async function expectOnlyWrites(fx, allowed, where) {
  const calls = forbiddenHostCalls(await fx.hostCalls());
  const seen = {};
  for (const call of calls) {
    const name = `${call.target}.${call.method}`;
    seen[name] = (seen[name] ?? 0) + 1;
  }
  expectEqual(seen, allowed, `${where}: write-named host calls`);
}

export const entryTitle = (fx) => fx.t("login.title");
export const seeEntry = async (fx) =>
  see(fx.page.getByRole("heading", { level: 1, name: await entryTitle(fx) }), "Lumi entry heading");
export const noEntry = async (fx) =>
  gone(
    fx.page.getByRole("heading", { level: 1, name: await entryTitle(fx) }),
    "Lumi entry heading",
  );

/** The three actions the Lumi-first entry offers, by real message ids. */
export async function seeActions(fx) {
  await see(await button(fx, "lumiAccount.begin"), "Sign in to Lumi");
  await see(await button(fx, "login.useApiKey"), "Use API key");
  await see(await button(fx, "lumiEntry.local"), "Continue locally");
}

/** z.ai / BigModel OAuth must not be offered; positive control: the host really listed them. */
export async function expectProvidersHiddenButListed(fx) {
  await until(
    async () => names(await fx.hostCalls()).includes("oauthService.getProviders"),
    "host provider list requested",
  );
  const text = await fx.page.locator("body").innerText();
  for (const provider of PROVIDERS) {
    expect(!text.includes(provider.displayName), `${provider.displayName} is rendered at entry`);
  }
  const oauthButtons = await fx.page.getByRole("button", { name: /z\.ai|bigmodel|zhipu/i }).count();
  expectEqual(oauthButtons, 0, "OAuth provider buttons");
}

export async function expectOnlyRestoreOnBridge(fx) {
  const keys = (await fx.calls()).map((call) => call.key);
  expect(
    keys.length > 0 && keys.every((key) => key === "restore"),
    `bridge saw ${JSON.stringify(keys)}; startup may only restore`,
  );
}

export async function expectNoForbiddenHostCalls(fx, where) {
  const bad = forbiddenHostCalls(await fx.hostCalls());
  expect(bad.length === 0, `${where}: forbidden host calls ${JSON.stringify(names(bad))}`);
}

/** Entry on screen, no workspace creation yet; settled long enough for a racing effect to have fired. */
export async function expectEntryWithoutWorkspaceCreation(fx) {
  await seeEntry(fx);
  await fx.advance(1000);
  const ensured = (await fx.hostCalls()).filter(
    (call) => `${call.target}.${call.method}` === ENSURE,
  );
  expectEqual(
    ensured.map((call) => call.heading),
    [],
    "default workspace created while the entry was open or pending (heading at call time)",
  );
}
