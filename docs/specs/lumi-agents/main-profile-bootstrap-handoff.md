> Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.

# Main profile bootstrap isolation — handoff

Lane: child Main application-state-root / bootstrap / settings readers. Source-only; no Electron launch, no build.

## Defect (supervisor repro, synthetic fixtures only)

`test-results/main-profile-bootstrap-reproducer.json` (original checkout): with fake OS `HOME` holding a
`setting.json` with `dataBaseDir=<synthetic-other-root>` and explicit `ZCODE_DATA_BASE_DIR=<owned-profile>`,
early Main bootstrap read the fake OS-home settings and `setDataBaseDir()` replaced the owned root.
Same shape in three more readers.

Root cause: each reader resolved `setting.json` independently from `os.homedir()` / `HOME`:

| Reader | Before |
| --- | --- |
| `desktopDataBaseDirBootstrap` (early) | `homedir()` + unconditional `setDataBaseDir` |
| `desktopChromiumHardwareAccelerationBootstrap` (early) | `homedir()` |
| `index.ts` `settingsFile` (startup workspace) and `whenReady` bootstrap | `homedir()`; unconditional `setDataBaseDir` |
| `SettingService` | `ZCODE_DESKTOP_HOME_DIR > HOME > USERPROFILE` (differed from the readers above) |

## Fix (one boundary: `packages/services/src/paths.ts`)

- `getBootstrapHomeDir(env)`: `ZCODE_DATA_BASE_DIR` > `ZCODE_DESKTOP_HOME_DIR` > `HOME` > `USERPROFILE` > `homedir()`.
  With no explicit root this equals the previous installed behaviour.
- `getBootstrapSettingsFile(env)`: `<bootstrapHome>/.zcode/v2/setting.json`. Used by early data-dir bootstrap,
  hardware-acceleration bootstrap, `index.ts` startup settings, and `SettingService`.
- `applyConfiguredDataBaseDir(dir, env)`: explicit `ZCODE_DATA_BASE_DIR` wins; settings value ignored (returns false).
  Used by early bootstrap and the `whenReady` bootstrap.
- Same home resolver for the audited Main readers of user-scope state: MCP user directory
  (`mcpUserDirectory/index.ts`) and log export CLI / computer-use run dirs (`exportLogs.ts`). An explicit-root
  profile no longer reads OS-home `.zcode/mcp.json`, `.agents/mcp.json` or `.zcode/cli` logs.

Not changed (by design): Main's own `HOME`, native keychain / OS credential access, any plaintext fallback, any
authorization or test-only relaxation. Normal installed behaviour (no `ZCODE_DATA_BASE_DIR`) is unchanged except
that Main readers now also honour `ZCODE_DESKTOP_HOME_DIR`, matching `SettingService`.

## Evidence (head: working tree, uncommitted)

Test: `packages/desktop/src/main/desktopBootstrapStateRoot.test.ts` — `node --import tsx --test` → 6 pass / 0 fail.
Controls:
- positive: no explicit root → OS-home `dataBaseDir` and hardware-acceleration setting still applied.
- negative: explicit root + fake OS-home `dataBaseDir` → root unchanged, returns null; hardware setting read from owned root.
- sensitivity: removing the explicit-root guard in `applyConfiguredDataBaseDir` fails test 3 (explicit root with a
  `dataBaseDir` inside its own settings); restored afterwards. Test 2 passes under that mutation because root
  resolution alone already stops the OS-home read (two independent defences).

`pnpm exec oxlint` on touched files: 0 warnings/errors. `pnpm typecheck`: no errors in touched files; remaining
errors are in other lanes' automation files (`automationAdoptionOwner.test.ts`, `automationOccurrenceDriver.test.ts`,
`LumiAutomationAttachDialog.tsx`) and were not touched.

Source hashes (sha256, first 16 hex):

```
b111cc031b7a32e4 packages/services/src/paths.ts
1ba7c61abc21532e packages/services/src/node.ts
99e5b307b566df7a packages/services/src/setting/settingService.ts
ef9712536ef429fb packages/desktop/src/main/desktopDataBaseDirBootstrap.ts
b746cca27983e23e packages/desktop/src/main/desktopChromiumHardwareAccelerationBootstrap.ts
3ea69fbaef42908e packages/desktop/src/main/mcpUserDirectory/index.ts
e8f8de2832281e44 packages/desktop/src/main/exportLogs.ts
593b6a5436d65d99 packages/desktop/src/main/index.ts   (shared WIP file; only my 4 hunks are in scope)
509f3780729f215f packages/desktop/src/main/desktopBootstrapStateRoot.test.ts
```

## Remaining actual Electron proof (UNPROVEN)

- Launch real Main with fake OS `HOME` + explicit `ZCODE_DATA_BASE_DIR`: logger, crashDumps, `SettingService`,
  startup workspace and Host env (`ZCODE_DATA_BASE_DIR` passthrough) all land under the owned root; nothing created
  under fake OS home `.zcode`.
- Keychain/credential path still uses native Main `HOME` (not exercised here).
- `desktopRuntimeEnv.ts` `ZCODE_HOME` fallback (`join(homedir(), ".zcode")`, unsigned-helper dev path only) and
  `services/src/node.ts` line ~1868 `ZCODE_HOME` default were audited, not changed: dev-only / outside this packet.
- `copyDataDirectory` still excludes `setting.json`; with an explicit root, `updateDataBaseDir` would write into the
  owned settings but the override is ignored — acceptable, but unverified at runtime.
- CLI/CUA writers: confirm the CLI actually writes logs under `<root>/.zcode/cli` for an explicit root; if it writes
  elsewhere, `exportLogs` reads an empty dir (safe, not a leak).
