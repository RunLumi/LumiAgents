# Credential choice: integration verification handoff

Status: candidate, not yet verified for this cut. Every result below was
recorded in the originating work lane and has not been re-run against this
source cut; treat counts and "clean" statements as history, not current proof.

Scope: child-side P08 credential **label** choice (spec 05, "Credential choice"). Labels are not
routing; underlying secrets stay local; nothing here enrolls, adopts, binds or uploads.
Written 2026-10-09. An earlier handoff could not be located, so nothing below is inherited from
it; every claim cites a check run in the originating lane.

## Defects found and fixed

| #   | Defect                                                                                                                                                                                                                                                         | Fix                                                                                                                                | Proof                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | `LumiAccountHostTransport` (the real facade the owner calls) had no `changeAdoptionCredentialMode`; owner tests used an `as never` fake, so production would have thrown "not a function" on every choice. Found by the source-mapped `tsc --noEmit` (TS2339). | Added the delegate in `hostTransport.ts` (the `max-lines` disable first used for this was later removed; see the third follow-up). | `hostTransport.test.ts` facade-surface test; typecheck clean. |
| 2   | Transport accepted a replayed full row for a different `adoption_state_id`/`org_id`.                                                                                                                                                                           | `changeAdoptionCredentialMode` rejects with `lumi_response_invalid` unless the row is the requested one.                           | `adoptionTransport.test.ts`                                   |
| 3   | Row parser accepted `version < 1` and `org_managed_credential` on a `local_unmanaged` row (violates server `credential_mode_requires_managed`).                                                                                                                | `adoptionRecord` rejects both with `lumi_response_invalid`.                                                                        | `adoptionTransport.test.ts`                                   |
| 4   | UI `submit` read `command.action` on a union that includes bare strings (TS2339).                                                                                                                                                                              | Narrowed with `typeof command === "object"`.                                                                                       | UI typecheck clean.                                           |

## Added regression proof (owner level, real owner + fake transport)

Org no longer active fences before any request; foreign org / foreign project send nothing; server
binding moved to another project refuses (`lumi_workspace_mismatch`); two choices on the same
version cannot both write (second is `lumi_workspace_stale`, one PATCH); re-read returning a
different record is `lumi_workspace_credential_not_persisted`; request bodies carry no path,
workspace key or secret-shaped field and the projection carries no path.

## Review conclusions (no unsupported PASS)

- Consent: bridge requires `confirm === true`, strict key allow-list (no secret field can ride),
  `history_sync` and unknown labels refused at the bridge and again in main.
- State owner: server row only; renderer holds an unconfirmed selection and remounts on
  `adoptionStateId:version:mode`.
- Fences: account user/org checked at the start of each operation; stage/version compared to a fresh
  server read; success requires re-read confirmation.
- **Account fence gap: fixed (2026-10-09 follow-up).** Previously not re-run after the PATCH.
  Now `assertCurrent` (fresh account read: same user, org still active; plus the account owner's
  existing `accountGeneration`) runs: at operation start, after the pre-read awaits and immediately
  before the PATCH, after the PATCH before the confirming GET, and after the confirming GET before
  the projection is returned. The generation is captured synchronously at call time, before the
  serialization queue, so a queued choice is fenced too. It reuses `accountGeneration` (bumped on
  sign-out and every sign-in completion) through an optional `generation` port on
  `createLumiWorkspaceOwner`; no parallel store. Refusals are `lumi_account_changed` /
  `lumi_workspace_org_unavailable`. A PATCH already sent is never undone or retried: the server may
  have committed the old-scope write, and only the stale UI completion is refused (the renderer's
  existing error path re-reads the row through the current owner).
- Projection intentionally carries the opaque random `workspaceKey` (pre-existing contract); it is
  not path-derived.

## Safe commands used in the originating lane (read-only / no build outputs)

```text
node --import tsx --test \
  packages/desktop/src/main/lumiWorkspaceCredentialMode.test.ts \
  packages/desktop/src/main/lumiAccountCredentialCommand.test.ts \
  packages/desktop/src/main/lumiAccountCommands.test.ts \
  packages/desktop/src/main/lumiWorkspaceOwner.test.ts \
  packages/services/src/lumi-account/adoptionTransport.test.ts \
  packages/services/src/lumi-account/hostTransport.test.ts \
  packages/ui/test/lumiAccountFlow.test.ts
```

Originating-lane result: 50 tests, 50 pass, 0 fail. `oxlint` and `oxfmt --check` on the six edited
files: clean. Not re-run for this cut.

Type proof without `tsc -b`: `pnpm exec tsc -p <tmp config>` where the tmp config (kept outside the
repo) extends the package config with `composite:false, noEmit:true, references:[]`. Plain
`tsc -p packages/ui --noEmit` is **misleading**: project references redirect `@zcode/shared` to
stale built declarations and report phantom errors (`credentialMode`, `adoptionVersion` missing).
Source-mapped result in the originating lane: UI project 0 errors; desktop main + `lumi-account`
services: 0 errors in any file touched by this feature (the tmp desktop config reported 90
unrelated errors in other files, not owned here).

## Account-fence proof (follow-up), `lumiWorkspaceCredentialMode.test.ts`

Same command as above then ran 60 tests, 60 pass. New cases, each with a hook that changes state
inside the named await: account switch / membership removal / session replaced during the pre-PATCH
read (0 PATCH sent); account switch, membership removal and ABA (user away and back plus generation
bump) during the PATCH (exactly 1 PATCH, no retry, no confirming read, row stays committed);
account switch and session replaced during the confirming read (refused though the row persisted);
a choice queued behind a slower one refused by the call-time generation; unchanged account still
completes.

Disposable mutations run on the live files and reverted (grep confirmed no markers remain):
removing the post-PATCH fence fails the 3 in-flight-PATCH tests; removing the pre-PATCH fence fails
the 3 pre-PATCH tests; capturing the generation inside the queue instead of at call time fails the
queued-call test. The post-confirm fence is covered by the confirming-read tests.

The two limits first written here were replaced by evidence (next section): the
"per-org owner identity stops an old owner" assumption was **wrong** for a user in both orgs, and
the fake-counter-only proof was superseded.

## Org switch, ABA and login admission (second follow-up)

Trace of the real path. An org switch is renderer-only state (`setOrgId` in
`LumiWorkspaceSection`); there is no account command for it and main kept no selected org. The only
main-visible signal is the `read-workspace` the renderer issues for the newly selected org, and
`workspaceFor(orgId)` picks a per-`orgId:userId` owner, so an old-org owner kept running. For a user
who is a member of both orgs, the membership read still passed for the old org and the old owner
could finish the PATCH and return its projection. Also, `workspaceFor()` awaits (account read,
device owner) **before** the workspace owner's call-time capture, so a switch during those awaits
was invisible, and login transitions only bumped after `completeSignIn` resolved.

Fix, one owner and no second session store: new Electron-free `lumiSessionFence.ts` holds the
existing session generation plus a per-workspace selected-org epoch. Production
`lumiAccountOwner.ts` is now a composition of its exported functions:

- `admitWorkspaceRead`: `read-workspace` selects the org synchronously before any await; an actual
  change (including A→B→A) bumps the epoch, a same-org re-read does not.
- `admitCredentialChoice`: refuses a no-longer-selected org (`lumi_workspace_org_changed`) before
  `workspaceFor` is even called, and captures the epoch **before the first await**, handing it to
  `createLumiWorkspaceOwner().setCredentialMode(command, admitted)`; the owner's `epoch` port is the
  same fence. Every fence point from the previous section now compares `{session, org}`.
- `fencedLoginTransitions`: bumps at `beginSignIn`, at the **start** of `completeSignIn`, and again
  when it settles. `fencedSignOut`: bump, teardown, transport sign-out, bump again (also on failure).
  `restoreSession` still does not bump. A bump also clears recorded selections.
- A PATCH already sent is never undone or retried and provider credentials are never touched;
  only the stale completion is refused.

Tests (`lumiWorkspaceCredentialMode.test.ts`, 36 tests, 36 pass in the originating lane; production
fence functions plus the real workspace owner, fake transport only for HTTP): org switch during the
PATCH refused while the old org membership still passes (1 PATCH, row committed, no confirming
read); A→B→A during the PATCH; switch while `workspaceFor()` is resolving (0 PATCH); late command
for a deselected org refused before `workspaceFor` runs; same-org re-read mid-PATCH does not
invalidate; a login whose `completeSignIn` is still pending already invalidates an in-flight choice;
`beginSignIn` invalidates; login clears the selection; sign-out fences at both ends even if the
transport fails. Mutations on the live fence, reverted (no markers remain): dropping the
admission-time bump in `completeSignIn` fails the pending-login test; capturing the epoch after
`workspaceFor` fails the `workspaceFor` test; a non-incrementing selection epoch fails the 3
org-switch tests.

(The gaps first listed here for bind/advance/rollback are closed by the next section; the remaining
ones are restated there.)

## Fence extended to read / bind / advance / rollback (third follow-up)

Same owner and epoch, no new store. `createLumiWorkspaceOwner` now routes every command through one
`fenced(input, admitted, work)` wrapper (the credential choice's inline fence code was folded into
it): the epoch is captured synchronously, the caller's admission epoch wins, and `assertCurrent`
(epoch + live `/api/v1/me` membership, then epoch again) runs at these points.

| Command           | `assertCurrent` before                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| read              | start; mapping save; projection return                                                         |
| bind              | start; `createWorkspaceBinding`; `createAdoptionRecord`; mapping save; policy sync; projection |
| advance           | start; policy sync (stages that need it); adoption PATCH; mapping save; projection             |
| rollback          | start; `deleteWorkspaceBinding`; `rollbackAdoptionRecord`; mapping save; projection            |
| credential choice | unchanged from the earlier follow-up                                                           |

Admission (`lumiSessionFence.ts`): `admitWorkspaceRead` selects the org then captures the epoch;
`admitWorkspaceMutation(fence, "bind" | "advance" | "rollback" | "setCredentialMode", …)` refuses a
deselected org (`lumi_workspace_org_changed`) before `workspaceFor`, captures the epoch before the
first await and hands it to the owner. `lumiAccountOwner.ts` calls these for all five commands. Scope
is the command's own org + workspace key, so other workspaces never interfere.

Semantics: a server write that already committed is never undone or retried (no hidden rollback);
the stale command only has its later writes, mapping save, projection and authority refused. The
local mapping is a derived cache of the server row: it is not saved by a stale completion and a fresh
`read` in the current scope re-derives it (asserted). Initial `mapping()` creation (an opaque random
key in the per-org/user vault) still happens right after the first fence and is not rolled back.
Cost: each `assertCurrent` is one live `/api/v1/me` call; bind makes about six.

Tests: `lumiWorkspaceMutationFence.test.ts` (13 tests in the originating lane, stateful fake server
keyed per workspace, user is a member of BOTH orgs so membership always passes, commands driven
through the production admission functions): bind refused after binding-create (no adoption write,
binding kept) and after adoption-create (no mapping save, no policy sync, mapping re-derived by the
next read); A→B→A mid-bind; advance with a login begun mid-PATCH (one committed write, no retry,
mapping unsaved) and a switch before the policy sync (no writes); rollback stale after
binding-delete (no adoption rollback, delete not undone, mapping untouched) and after
adoption-rollback; read stale before the mapping save and across ABA; membership removed between
server write and mapping save; deselected org refused before the owner is reached (0 reads, 0
writes); two workspaces on one owner where W1 is switched mid-bind and W2 completes with its mapping
saved. Mutations on the live files, reverted (no markers): dropping the pre-`createAdoptionRecord`
fence fails 2 tests; dropping the bind pre-save fence fails 3; dropping the
pre-`rollbackAdoptionRecord` fence fails 1; dropping `assertOrgSelected` at admission fails 2 here
plus the earlier credential admission test.

Lint exceptions: the two `max-lines` disables added to `lumiAccountOwner.ts` and `hostTransport.ts`
were removed, not kept. Instead, small existing-logic extractions with unchanged behaviour: the
server-state read → `lumiWorkspaceServerState.ts` (type `WorkspaceServerState` already existed);
the four adoption delegates in `hostTransport.ts` use a one-line `AdoptionInput` alias. No other
exception was added or touched.

Verification limits, stated plainly:

- `createLumiAccountOwner` is still not constructed in any test (imports `electron`; reaching a real
  PATCH needs an enrolled device). Its workspace and sign-in lines are thin calls into the tested
  functions; that composition is covered by type-check and review only. **No Electron PASS is claimed.**
- Selection means "last org the renderer read for that workspace". A renderer that does not re-read on
  switch would not advance it. `LumiWorkspaceSection` re-reads and its stale-submit path returns
  before issuing its own re-read; that UI behaviour is not asserted by a test here.
- `listProjects` and the device commands are not given this epoch (outside the scope of existing
  workspace mutating commands).
- The fake server is in-memory; ordering of a real D1/Worker commit versus the client fence is
  unproven. The server may have committed a stale-scope write; that is intentionally surfaced as a
  refusal, and reconciliation relies on the next read.
- Typecheck is the source-mapped `/tmp` method (0 errors in the touched files; the same 90 unrelated
  errors elsewhere); `tsc -b`, the full `pnpm lint`, the architecture check and `pnpm test` were not
  run in the originating lane.

## Client states follow-up (2026-10-09, UI lane)

Scope: renderer only (`LumiWorkspaceSection`, `LumiEntryPanel`, startup gate/flow, locales); spec 05
"Client states". No Main, services, provider-credential or vault file touched.

| Change                                                                                                                                                                    | Files                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Stable codes map to user copy (EN/ZH); `lumi_page_incomplete` has dedicated, non-retryable copy that does not claim 100+ support; code still shown                        | `lumi/lumiErrorCopy.ts`, locales                                                                                    |
| Gate and panel share one launch `restore`; panel adds slow notice (5 s), 35 s bound, seq-superseding timeout, explicit "Check saved session again" (restore, not sign-in) | `lumi/lumiRestore.ts`, `lumiAccountFlow.ts`, `useLumiAccountFlow.ts`, `useLumiStartupGate.ts`, `LumiEntryPanel.tsx` |
| Any failed/interrupted workspace command re-reads the row; failed re-read clears the projection so bind/advance stay disabled until explicit reload (no second binding)   | `LumiWorkspaceSection.tsx`                                                                                          |
| Loaded vs empty project state, reload button, wrapping buttons for 320 px, spinners honor reduced motion                                                                  | `LumiWorkspaceSection.tsx`, `LumiEntryPanel.tsx`                                                                    |

Proof run: `node --import tsx --test packages/ui/test/lumiAccountFlow.test.ts packages/ui/test/lumiEntryStates.test.ts`
(21 tests). Covers the reducer (slow/timeout fencing, late completion dropped, errorCommand), the
shared-restore helper (join, no cache after settle, share window, per-bridge), error-copy mapping, and
EN/ZH key parity. Not run in this lane (command execution needed approval that was not available):
`oxlint`, `oxfmt --check`, source-mapped typecheck, `pnpm typecheck`, architecture check.

Visual gate matrix (prepared, **not executed**; run only after the coordinator opens a native/host
window, with a test-owned host fixture that scripts `platform.lumiAccount` replies). No
`docs/screens/` reference covers these controls; `lumi_account.webp` was opened for density/hierarchy
only. Widths 320, 768, 1440; each once with `prefers-reduced-motion: reduce`.

| Surface           | States to capture                                                                                                                                                  | Keyboard / focus checks                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry panel       | restoring; restoring + slow notice; restore failed (`lumi_request_timeout`); signed-in Continue; sign-in code; begin error                                         | Tab order panel → API key → Continue locally; visible focus ring on every button; "Check saved session again" gets focus on failure; Local/BYOK reachable while restoring |
| Workspace section | loading; no projects; `lumi_page_incomplete` (no reload button); retryable error + reload; device required; bound + credential choice                              | selects and radios reachable; reload button focus; no horizontal overflow at 320; long ZH/EN labels wrap                                                                  |
| Fixture cases     | restore answers at 4 s, 6 s, 31 s, never; restore ok after timeout (must be ignored); bind reply dropped then re-read ok / re-read fails (bind must stay disabled) | —                                                                                                                                                                         |

Limits: the hook and components still have no React render harness, so the timers in
`useLumiAccountFlow` and the section's re-read-after-failure path are covered by reducer/helper tests
and review only. The 35 s bound is renderer-side; it does not cancel the host request.

## Remaining obligations (UNPROVEN)

- No rendered UI proof: no browser/Electron run, no screenshots at desktop and narrow widths, no
  keyboard/focus walk, no loading/error/stale async-state capture. (`docs/screens/` has no reference
  for this control; compare against `DESIGN.md` and the existing workspace section.)
- No component-level test of `LumiWorkspaceCredentialChoice` (radio disabled state for the org label,
  cancel, remount on server change, console button). The suite has no React render harness.
- No real Worker/D1 proof that a mode-only PATCH persists (depends on control-plane P08-CR-003);
  only the faked-server readback path is proven. Idempotent-replay behavior against the real server
  is unproven.
- Full `pnpm typecheck` (`tsc -b`), `pnpm lint`, architecture check and `pnpm test` have not been run
  for this cut; the coordinator owns them.
- ZH/EN key parity for `lumiWorkspace.credential.*` was checked by listing keys (identical sets);
  copy quality and layout overflow are not reviewed visually.
