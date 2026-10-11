# Lumi UI proof — PR handoff (2026-10-09/10)

Goal status: **full desktop/backend E2E remains INCOMPLETE.** This handoff covers the client UI proof:
entry panel, workspace settings, and (new, phase 02 gap closure) the **real `Root` startup wiring and
real `WelcomeScreen` composition** over a recording host fixture. No commit, push, index change,
build, Electron launch or deploy was made; the checkout is dirty and every report pins the exact bytes.

## Phase 02 gap closure — Lumi-first startup (current evidence)

**Spec first.** `docs/specs/lumi-agents/04-control-plane-account.md`: startup creates nothing before the entry
decision (no default-workspace fallback / tab restore while the gate is pending, or decided but not yet opened).

**Demonstrated defect and minimal product fix (`packages/ui/src/Root.tsx`).** The startup gate decided in one
commit and Root opened the entry from an effect in the next. In that gap Root's fallback called
`fileService.ensureConversationWorkspace()` **before the user could choose** (host-call heading at call time `""`).
Fix: a `lumiEntryOpened` flag keeps startup blocked until the entry has actually opened and stays set afterwards.
Failing evidence preserved: `evidence/2026-10-09T17-19-39-969Z-2a49525`, `…17-20-37-930Z-2a49525`.
Reverting the fix is mutant `startup-workspace-race-reintroduced` (DETECTED).

**Mount boundary.** The real `Root` (real startup gate, entry state, startup fallback, `WelcomeScreen`,
`LumiEntryPanel`, `StoreProvider`, OAuth hook, and — after Continue — the real workspace shell) runs in Chrome over
`src/hostFixture.ts`, a recording stand-in for the service accessor and platform. Every member the real code touches
is logged with the first `<h1>` at call time; unmodelled members resolve `undefined`; subscriptions return a disposer.
A separate `welcome` surface mounts `WelcomeScreen` alone so the ZCode-user store can be driven. `restoreSession` is
`true` whenever a persisted workspace session is supplied. The faked page clock is **paused** for startup claims, so
only explicit `advance` moves time (a running fake clock still tracks real time and crossed the 5 s gate timer on a
slow first load — an observed flake, now removed).

**Shell-error tolerance is now zero.** The earlier `SHELL_NOT_MODELED` regex list (module-prefix matches that dropped
messages without a count) is **deleted**. The host stub contract was fixed instead (`windowControllerService.listTaskList`,
`settingsSyncService.getFirstRunPromptState`, `subagentsService.list`, `zcodeTaskService.list*`,
`platform.getUpdateState`, `systemService.info`, `providerSettingsService.createPersonalProvider` and a BYOK template).
Every console error and page error is a verdict, in the shell too. Mutant `shell-same-prefix-error` injects a fault with
the same module prefix as the old tolerated messages (`[useGlobalTaskList]`, a different message) and the claim FAILs.

**Claims (18 startup + 3 startup matrix states):**

| Claim                                          | Proves                                                                                                                                                                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startup.root-neither`                         | no Lumi/ZCode session → entry with Sign in / Use API key / Continue locally; z.ai/BigModel listed by host (positive control) but not rendered; bridge only `restore`; no credential/provider/setting/login host write                         |
| `startup.root-no-workspace-before-entry`       | no default workspace created while the entry is pending/open                                                                                                                                                                                  |
| `startup.root-zcode-only`                      | cached ZCode session (read, positive control) does not skip the entry; nothing completes                                                                                                                                                      |
| `startup.root-lumi-only` / `startup.root-both` | restored Lumi session skips the entry; startup proceeds; only `restore`; no writes; positive control that the real shell mounted and queried its task list                                                                                    |
| `startup.root-hung-and-late`                   | hung restore: no entry at 4 s, entry at 5 s with local/BYOK usable; a late answer offers Continue but does not close the entry, create a workspace, complete or write until pressed                                                           |
| `startup.root-restore-failure`                 | failed restore still opens a usable entry; no sign-in                                                                                                                                                                                         |
| `startup.root-cancel`                          | explicit Sign in → one `begin`; Cancel → one `cancel`, back to Sign in; nothing completes/enrolls/adopts                                                                                                                                      |
| `startup.root-continue-locally`                | closes entry, _then_ the fallback runs; Lumi sees only `restore`; no setting records the choice; reload shows the entry again                                                                                                                 |
| `startup.root-byok`                            | Use API key opens the existing form, Cancel returns; no writes while browsing                                                                                                                                                                 |
| `startup.root-restore-session-gated`           | `restoreSession:true` + persisted workspace: no workspace-scoped host call and no write before the choice; after Continue locally the persisted workspace **is** opened (positive control)                                                    |
| `startup.root-restore-session-lumi-only`       | `restoreSession:true`, restored Lumi session: entry skipped, persisted workspace opened, no writes                                                                                                                                            |
| `startup.root-sign-in-completion`              | no browser open until the explicit action; `complete` written once on double-click; entry closes; workspace fallback runs only after the completion; bridge writes exactly `begin`,`complete`; no enroll/adopt/credential/provider write      |
| `startup.root-byok-save`                       | typing writes nothing; Save calls the existing provider owner exactly once with that key and template; **the only write-named host call in the whole run is that one**; the key appears in no other host call or bridge command; entry closes |
| `startup.welcome-*` (4)                        | ZCode user completes as `oauth` only without a bridge (positive control); with a bridge it never completes and Continue locally yields only `skip`; no bridge → no Lumi action/call; explicit provider-connect still starts OAuth for `zai`   |

**Accounts matrix covered at Root:** neither, ZCode-only, Lumi-only, both (with and without `restoreSession`), plus hung,
late, failed, cancelled and completed sign-in.

**Mutants (18, all DETECTED).** Earlier 9 (`timeout-supersede`, `stale-load-guard`, `stale-write-guard`,
`reread-keeps-projection`, `credential-choice-no-remount`, `page-incomplete-retryable`, `restore-failure-begins-sign-in`,
`bind-no-confirm-flag`, `forced-colors-outline-none`) + startup 7 (`welcome-bridge-zcode-bypass`, `welcome-providers-listed`,
`welcome-local-wrong-reason`, `startup-gate-timeout-removed`, `startup-gate-any-result-signed-in`, `startup-gate-begins-sign-in`,
`startup-workspace-race-reintroduced`) + `shell-same-prefix-error` + `byok-key-leaked-to-settings`.

**Tab-restore guard — UNPROVEN as a mutant (not PASS).** Removing the `canRestoreWorkspaceSession` gate on
`useTabPersistence` produced **no host-observable difference** (run preserved:
`evidence/2026-10-09T22-41-01-765Z-2a49525-mutant-startup-restore-gate-removed`, claim PASS under the fault =
UNDETECTED). While the entry is open Root returns only the entry, so early restore changes in-renderer tab state that
neither the host calls nor the DOM expose. The mutant was removed from the campaign rather than kept as a false
"detected"; `startup.root-restore-session-gated` claims only what is observable (no workspace-scoped host call / write
before the choice, restore after it). The tab-store state itself is unproven.

**Current evidence (Node v24.19.0 bundled, Chrome 154, CDP; machine load average ≈ 8–9 from other workers):**
A single full run no longer finished inside the 10-minute tool limit (29 PASS then SIGALRM; the stray owned Chrome from
that kill was stopped by exact PID and its temp profile removed). The suites therefore ran as **eight subset runs**
(`entry.`, `workspace.`, `startup.`, `motion.`, `keyboard.`, `matrix.entry`, `matrix.workspace`, `matrix.startup`), each
exit 0 with complete cleanup, and `check-evidence.mjs --covers-all` proves the union:
**`COVERAGE COMPLETE: 78 claims PASS across 8 current report(s)`**. Reports (all under `tests/lumi-ui-proof/evidence/`):
`2026-10-10T15-10-10-740Z` entry (13), `…15-10-32-245Z` workspace (15), `…15-11-01-523Z` startup (18), `…15-12-13-776Z`
motion (2), `…15-12-22-740Z` keyboard (8), `…15-13-24-692Z` matrix.entry (7), `…15-14-24-017Z` matrix.workspace (12),
`…15-15-57-598Z` matrix.startup (3). The earlier single-run 74-PASS report (`2026-10-09T17-33-49-142Z`) is retained and
**stale** against current hashes.

- Mutants: `sensitivity-2026-10-10T15-19-25-650Z.json` (4), `…15-22-22-960Z.json` (5), `…15-27-25-294Z.json` (5),
  `…15-31-05-677Z.json` (4) — **18/18 DETECTED**, each child exit 0, complete cleanup (four invocations only to stay inside
  the tool time limit under load).
- `check-evidence.mjs`: CURRENT for the 8 suite reports and all 18 mutant reports (26/26; product + verifier hashes match disk).
- `regressions.test.mjs` 13/13 (adds: subset-run coverage gaps are never inferred; claim ids unique).
- `tsc -b packages/ui`, `tsc -p tests/lumi-ui-proof`, `oxfmt --check`, `architecture:check --changed`, `lumi:notice`,
  `lumi:drift` clean. `oxlint`: proof files 0 warnings/0 errors; `Root.tsx` 0 errors and 4 pre-existing unused-import
  warnings (`lazy`, `Suspense`, `WorkspaceTabState`, `useGlobalTaskList`) this change does not touch. No proof file
  exceeds 400 lines and no lint rule was disabled (the over-long file was split into `startupHelpers`,
  `rootStartupBehaviors`, `startupBehaviors`).

**Main process — not claimed.** Independent baseline comparison
(`test-results/phase02-main-typecheck-{baseline,supervisor}.log`, `…-category-comparison.json`,
`…-comparison.json`): candidate `packages/desktop` typecheck has **90** errors vs clean baseline **92** with the same
installed dependency view; no candidate-only (file, TS-code) category (baseline-only: `lumiAccountCommands.test.ts`
TS2740 ×2). At message level 8 unique lines differ across 5 files (`browserGuestManager.ts`, `desktopCronScheduler.ts`,
`desktopRemoteSessions.ts`, `index.ts`, `taskRealtimeBus.ts`) — re-worded variants of errors already present in the
baseline, not new categories. **Main does not compile cleanly in either tree; this is not a Main PASS.** Not re-run here.

**What this still does NOT prove (exact gaps — not claimed):**

- **Native credentials and Electron.** Preload/IPC, Main owner/lease, keychain/private vault, window-scoped host,
  `isDesktop` startup chrome and native theme sync. Root ran as a web host with the synthetic bridge. Native credential
  handling remains separately unproven.
- **Real host services.** The service accessor is a recording stub with empty-but-valid views. "No credential/provider
  write" means no call to a write-named method on the stub (classifier unit-tested), not an inspection of a real
  `SettingService`/credential store. The BYOK save proves the call goes to the existing provider owner once with the typed
  key; it does not prove what the real owner persists.
- **Tab-store state before the entry** (see UNPROVEN above), and the workspace shell beyond mount: the shell mounts with
  empty task lists and no model/provider, and its behaviour is not asserted beyond "queried the task list, no errors".
- Sign-in completion proves the renderer path; real device-code approval, organization state, enrollment and workspace
  adoption from Root are not exercised.
- Timers use a faked page clock; no real-time startup latency. Chrome only (no Firefox/WebKit/Windows HC/screen readers).
- Observation: the entry restores twice sequentially (gate, then panel) when the gate settles before the panel mounts;
  the spec only forbids _concurrent_ restores, so this is noted, not changed.

---

# Earlier UI-proof handoff (kept; counts below are superseded by the section above)

## PR description

**What changed (product)**

- `packages/ui/src/styles.css` — removed the global `outline:none !important` / `box-shadow:none
!important` (including inside `forced-colors: active`). Keyboard focus now shows
  `outline: 2px solid var(--color-brand)`; under forced colors, `2px solid Highlight`.
  `--color-lumi-blue` is not defined in any stylesheet (an undefined `var()` voids the whole
  `outline` shorthand), `--color-brand` is.
- `packages/ui/src/settings/LumiWorkspaceCredentialChoice.tsx` — fieldset `min-w-0` and a wrapping
  console button, fixing 320 px overflow.
- `DESIGN.md` §16.5 — token and forced-colors rule aligned with the stylesheet; warns against
  reintroducing global focus suppression.

**What changed (verifier, `tests/lumi-ui-proof/`)**

- Candidate-only patch mode removed; the proof runs against real source. Product files **and every
  verifier file** are SHA-256 pinned in each report (`meta.source.files` / `meta.source.harness`);
  `check-evidence.mjs` compares them with disk and exits 1 on any drift.
- New claim `keyboard.forced-colors-focus`: real Chromium forced-colors emulation
  (`forcedColors: active` context; positive control that `matchMedia('(forced-colors: active)')`
  is true on every stop), Tab walks over the restore-failed entry panel, unbound workspace and bound
  credential group, requiring a real **outline** (box-shadow is discarded in that mode).
- Ninth mutant `forced-colors-outline-none` reinstates the original defect for forced colors only.
- Chrome is an owned child over CDP with file-backed stdio and a verified PID exit. Root cause of the
  earlier `browser.close` timeout: Chrome's GoogleUpdater/crashpad helpers inherit Playwright's piped
  stderr, so `close()` waited ~10 s on them (DEBUG=pw:browser trace). Cleanup stages are bounded and
  written to `cleanup.json`.
- Fail-closed exits: unknown `--only`/`--mutate` → 2 (no browser launched); non-Node-24 → 2;
  harness crash → 1; incomplete cleanup → 3; zero claims executed → 4.
- `sensitivity.mjs` accepts a mutant only if the child exit is 0 with no signal/timeout, the report
  matches the mutation, every expected-red claim is FAIL and cleanup is complete (8-minute child bound).
- `regressions.test.mjs` (8 tests): false-green shapes above plus stale-hash detection.

## Exact claims and evidence (Node v24.19.0, bundled runtime; Chrome 154, headless, CDP)

| Claim                                                                                                                                                                                              | Evidence                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 57/57 checks PASS on real source (entry, workspace, credential, keyboard, forced-colors, reduced motion, EN+ZH × 320/768/1440 matrix), exit 0, cleanup complete                                    | `tests/lumi-ui-proof/evidence/2026-10-09T17-04-47-582Z-2a49525/`                  |
| 9/9 mutants DETECTED, each child exit 0, expected-red checks FAIL, cleanup complete                                                                                                                | `evidence/sensitivity-2026-10-09T17-11-25-988Z.json` + nine `…-mutant-*` run dirs |
| Every one of those 10 reports matches current product and verifier hashes                                                                                                                          | `check-evidence.mjs` → CURRENT ×10, exit 0                                        |
| 8/8 regression tests                                                                                                                                                                               | `node --test tests/lumi-ui-proof/regressions.test.mjs`                            |
| `oxlint`, `oxfmt --check` (proof files, `styles.css`, credential component), `tsc -b packages/ui`, `tsc -p tests/lumi-ui-proof`, `architecture:check --changed`, `lumi:notice`, `lumi:drift` clean | run on this candidate                                                             |

Screens (all under `evidence/2026-10-09T17-04-47-582Z-2a49525/screens/`):
`workspace-credential-pending-org__en-US__320.png` (previously overflowed),
`keyboard.workspace-bound-credential__en-US__768.png`,
`keyboard.forced-colors-focus__keyboard.entry-restore-failed.png`,
`keyboard.forced-colors-focus__keyboard.workspace-unbound.png`,
`keyboard.forced-colors-focus__keyboard.workspace-bound-credential.png`, plus the full matrix.

## Original failures (preserved)

`evidence/2026-10-09T12-14-13-500Z-2a49525/report.json`: 50 PASS / 6 FAIL — five keyboard focus
checks and `matrix.workspace-credential-pending-org`. Hung/`cleanup.json complete:false` mutant runs
from 12-26 and 12-33/12-34 are retained, as are the verifier-feedback reproducers. These older reports
are intentionally **stale** against current hashes; only the 10 reports above are current.

## DESIGN.md formatter result (baseline vs new, reported separately)

`oxfmt --check` fails on `DESIGN.md`. Using the repo `.oxfmtrc.json` on copies in `/tmp`:

- Baseline (committed `HEAD:DESIGN.md`): fails, 1228 changed diff lines.
- Candidate (current file): fails, 1228 changed diff lines — identical; none touch the §16.5 lines
  added here. The failure is **pre-existing** (e.g. `*` vs `-` bullets) and was deliberately not
  reformatted to avoid a drive-by diff. `DESIGN.md` is therefore not formatter-clean either before or after.

## Coverage review: entry / account matrix

Covered (fixture mounts exactly `LumiEntryPanel` and `LumiWorkspaceSection` with a synthetic
`lumiAccount` bridge): restore once / 4 s / 6 s / 31 s / never-answers (35 s timeout), late answers
dropped, explicit "check again", begin/complete idempotence, cancel superseding in-flight complete,
all workspace load/bind/credential states, keyboard order and focus, reduced motion, forced colors.

**Not covered — missing proof, not claimed:**

- (Closed by the phase 02 section above: `Root` startup gate and `WelcomeScreen` composition are now mounted and proven
  at the stated boundary; its remaining gaps are listed there.)
- Settings account/device sections (`LumiAccountSection`, `LumiDeviceSection`, `SettingsPage`).
- Real Electron, preload/IPC, Main owner/lease fences, keychain/private vault, device enrollment,
  host/adoption/device transports, any backend or control-plane behaviour, native window chrome.
- Firefox/WebKit; real Windows High Contrast (only Chromium forced-colors emulation was run);
  screen readers; touch.
- Elapsed times use a faked page clock, so real-time timer behaviour is unproven.
  A follow-up needs a Root/Welcome fixture or a native/Electron E2E before the entry matrix can be
  called complete.

## Reproduce

```
N=/Users/james/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
$N tests/lumi-ui-proof/run.mjs
$N tests/lumi-ui-proof/sensitivity.mjs
$N --test tests/lumi-ui-proof/regressions.test.mjs
$N tests/lumi-ui-proof/check-evidence.mjs <run-dir> evidence/sensitivity-<stamp>.json
```

(The nvm path labelled v24.20.0 actually ran v22.14.0 on this machine; the runner refuses non-24.)
