# Maintaining Lumi Agents alongside ZCode

This is the canonical integration guide. Read it with the
[fork difference manifest](upstream/FORK-DIFFERENCES.md),
[brand specification](specs/lumi-agents/01-brand-identity-and-theme.md),
[contribution policy](../CONTRIBUTING.md) and
[compliance record](licensing/COMPLIANCE.md).

## Strategy

Review upstream weekly and after relevant releases or security fixes. This is a
recommended cadence, not an installed automation. Keep one active integration PR,
pin an exact upstream commit, and separate integration from installer publication.
Large snapshot commits need a file and dependency review: release notes may omit
important changes. Defer revisions whose migrations, licenses or runtime behavior
cannot yet be verified; record the reason and a condition for revisiting them.

Keep Lumi changes concentrated in product constants, theme tokens, platform
adapters and distribution settings. Record each difference's owner, purpose,
verification and removal condition. If upstream supplies an equivalent fix,
compare behavior and tests before removing the local patch. Contribute general
fixes upstream when authorized. Avoid unrelated refactoring and mass formatting
in sync PRs. Track update age, changed files and recurring conflicts; repeated
conflicts identify integration boundaries worth improving.

## Contracts to preserve

| Area          | Required result                                                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | Lumi Agents name, `app.lumi.agents`, preview identity and packaging metadata from `packages/desktop/scripts/desktop-product-identity.mjs`.                                                               |
| Visuals       | Original `brand/` assets, `LumiBrandMark`, light-only theme and `DESIGN.md` tokens. Generate icons with `pnpm lumi:brand-assets`.                                                                        |
| Display text  | Reuse `productBrand.ts` and `applyLumiBranding`. Audit new hard-coded UI and bot messages that bypass the localization overlay.                                                                          |
| Compatibility | Preserve internal package/protocol/schema contracts during upstream sync. Shared OS registrations, CLI names and writable data paths require a separately specified Lumi isolation migration; see below. |
| Distribution  | Updates and telemetry remain opt-in through Lumi configuration. Keep the app-owned telemetry implementation; do not restore removed `@arms/rum-*` dependencies or upstream update feeds.                 |
| Releases      | Preserve Lumi macOS, MAS and Linux workflows, signing, entitlements and artifact configuration. Check packaged runtime dependencies.                                                                     |
| Attribution   | Preserve LICENSE, inherited notices, Cloudjet stewardship and trademark boundaries. English is `README.md`; Chinese is `README.zh.md`.                                                                   |
| Runtime       | Preserve workspace identity, owner/lease routing, stale-run protection, CommandInbox admission and desktop continuous versus mobile replayable delivery contracts.                                       |
| Provenance    | Preserve modification notices, license evidence, signed Lumi contributions and reviewed upstream import records.                                                                                         |

These contracts define the result. If upstream moves an implementation, adapt the
Lumi integration to the new owner. Copying entire old files can discard upstream
fixes. Read current source and the fork manifest; paths can change.

## 1. Establish a reproducible baseline

```bash
git status --short --branch
git worktree list --porcelain
git remote -v
node scripts/check-workspace-freshness.mjs
git fetch origin --prune
git fetch upstream main
git log -5 --oneline upstream/main
git merge-base origin/main upstream/main
```

Preserve unrelated edits and active merges or rebases. Confirm origin is
RunLumi/LumiAgents and upstream is zai-org/ZCode. Record the starting Lumi SHA.
Set `UPSTREAM_SHA` to a reviewed full SHA, `SYNC_BRANCH` to an unused
`codex/upstream-sync-...` name, and `SYNC_DIR` to a new worktree path.

```bash
git merge-base --is-ancestor "$UPSTREAM_SHA" origin/main
git log --oneline origin/main.."$UPSTREAM_SHA"
git diff --stat origin/main..."$UPSTREAM_SHA"
git diff --name-status origin/main..."$UPSTREAM_SHA"
```

Ancestry exit 0 means the revision is already integrated. Verify the desired
behavior before creating duplicate work. Keep the original fork point and frozen
DCO cutoff distinct from the latest imported release.

## 2. Integrate in isolation

```bash
git worktree add -b "$SYNC_BRANCH" "$SYNC_DIR" origin/main
cd "$SYNC_DIR"
git merge --no-commit --no-ff "$UPSTREAM_SHA"
git status --short
git ls-files -u
git diff --cc
```

Read upstream and Lumi changes since their common ancestor. Before custom code
edits, follow architecture-governance, read target module contexts and update the
relevant spec. Review automatic merges too: new endpoints, defaults, dependencies,
auth flows and migrations can change behavior without a Git conflict.

Resolve conflicts from the ancestor and both versions, preserving upstream
behavior while reapplying the narrow Lumi contract. Avoid blanket ours/theirs,
`-Xours`, global branding substitutions and restoring removed modules. For renames
or modify/delete conflicts, find the current equivalent file and transfer relevant
changes there; update links, notice registrations and tests. Regenerate inventories
and assets from reconciled inputs rather than selecting one side's hashes.

## 3. Reconcile dependencies and provenance

Use versions pinned in the selected revision's `mise.toml`. Begin with a frozen
lockfile install. If dependency edits require regeneration, use pinned pnpm,
review graph changes and repeat the frozen install. Check the OS/CPU/libc matrix.

```bash
pnpm install --frozen-lockfile
node scripts/lumi-modified-files.mjs apply
node scripts/licenses.mjs notices
node scripts/licenses.mjs check --strict
pnpm lumi:notice
pnpm lumi:drift
```

Register newly modified upstream files or documented notice exceptions. Retain
original license evidence and review records. Optional platform packages can be
absent locally; missing mandatory packages and unresolved license material must
still fail. Validate the generated inventory on Linux CI as well as macOS.

The current `--against-upstream` drift option compares with local `upstream/main`.
Use it when that ref equals the selected SHA. Otherwise report the mismatch and
manually audit `git diff "$UPSTREAM_SHA" --name-status` against notice registrations.
Do not relabel refs or claim a moving-ref result validates the pinned revision.

Every new Lumi contribution needs its actual author's DCO sign-off. Current
`scripts/check-dco.mjs` has exact release records in `VERIFIED_UPSTREAM_IMPORTS`;
future unsigned upstream commits are not automatically accepted. Verify source
repository, full SHA, tree, parents, author and license. Any import record or
checker change requires documented provenance review and tests. Never move the
frozen legacy cutoff or fabricate upstream signatures.

Historical unsigned Lumi contributions need the original author's explicit
certification, exact metadata in `docs/licensing/dco-attestations.json`, and a later
same-author signed descendant commit containing `DCO-Attests: <full SHA>`, under
current `CONTRIBUTING.md`. Approval for specific SHAs does not authorize other
attestations. Investigate hook findings; do not disable checks to finish a sync.

## 4. Validate the resolved result

Clear unmerged index entries and review the full diff against the starting Lumi
main, including automatic merges.

```bash
git diff --check
git diff --cached --check
pnpm architecture:check --changed
pnpm typecheck
pnpm lint
pnpm fmt:check
node --import tsx --test packages/ui/test/lumiBranding.test.ts packages/ui/test/lumiCompliance.test.ts packages/ui/test/lumiTelemetryShim.test.ts packages/ui/test/lumiLicensingPolicy.test.ts packages/ui/test/lumiLicenseReview.test.ts
node --test scripts/third-party-npm.test.mjs scripts/lumi-maintainer-credit.test.mjs scripts/lumi-credits-access.test.mjs
```

Verify commands and test paths in the selected revision. Add focused regressions
for custom fixes and update tests alongside approved policy changes. Report
existing failures separately; avoid unrelated formatting. Build affected CLI, Web
and Desktop packages, checking actual packaged dependencies where relevant.

For UI changes, inspect desktop and narrow Web layouts, startup, About/credits
and new screens. Stored `zcode-theme=dark` must still resolve light. Test both
desktop and mobile semantics for stream, queue or reconnect changes. Use isolated
test data and record untested platforms or flows.

After signed commits exist, validate both current DCO scopes:

```bash
node scripts/check-dco.mjs origin/main..HEAD
node scripts/check-dco.mjs 872ad960de7ec172591f7e1952f7849229f94521..HEAD
```

The second models the main-push gate and catches historical failures outside the
PR range. Recheck the workflow if its contract changes.

## 5. Deliver and record evidence

Push a Lumi-owned integration branch. If the original PR comes directly from
upstream main, use a separate integration PR for Lumi conflict resolution. Use a
merge commit to preserve ancestry and sign-offs.

Record exact starting and selected SHAs, source links, behavior changes,
migrations, conflict decisions, preserved invariants, dependency and provenance
decisions, validation results and rollback in the PR.

Refresh origin before merging. Reconcile and validate if main or the PR head
changes. Require successful DCO, licensing-docs, license-gates and other required
checks on the exact head; use an expected-head guard. Read back remote main,
verify selected upstream ancestry and wait for main-push checks. Close superseded
PRs only after accounting for their intended changes.

Update the fork manifest and compliance record with current evidence while
retaining historical facts. Keep the original fork point and DCO cutoff intact.
Installer publication and store submission require separate release validation;
a source merge alone does not establish runtime or production readiness.

## Recovery

Before committing, `git merge --abort` restores the isolated pre-merge state;
preserve any resolution work you need first. After a shared merge, use a reviewed
revert PR accounting for dependent changes and migrations, never reset public
main. Merge reverts affect future merges: record the chosen parent and the plan
for reintroducing the update. Remove only the exact temporary worktree after
reviewing its contents and status.

## Reference integration

The v3.14.3 sync imported `29628c9acdb81b703bbd4080c207a0e7ce5e276e` through
[PR #26](https://github.com/RunLumi/LumiAgents/pull/26), landing as
`ec4f339522a53e65098c580a9016184e74666885` on 2026-09-24. It exposed README renames,
generated inventory conflicts, native package differences between platforms and
existing DCO failures. These are review examples, not permanent exceptions or
proof that a later revision is safe.

## Coexistence: compatibility is not permanent shared identity

The current implementation retains upstream data paths and the `zcode` URL
scheme. This protects earlier installations from an abrupt path change, but does
not establish safe coexistence with a separate ZCode installation. Shared writable
state can mix settings, credentials and sessions; URL registration can route a
callback to the wrong application. A distinct bundle ID alone does not isolate
these resources.

Recommended direction, pending a dedicated implementation and migration spec:

- Give Lumi its own OS data/config/cache roots, credential service names, helper
  identities, locks, IPC endpoints and remote installation roots where shared.
- Use `lumi-agents` for a public CLI and `lumi-agents://` for URL registration.
  Audit OAuth redirect allowlists and provider support before switching callbacks.
- Expose `LUMI_AGENTS_*` configuration where useful, translating to existing
  runtime variables inside Lumi child processes through one adapter.
- Keep private `@zcode/*` workspace imports, wire fields and persistence schema
  names unless a concrete external collision requires changing them. Their
  blanket rename adds upstream merge cost without isolating OS resources.
- Offer an explicit, versioned import from legacy data after both apps are stopped.
  Back up and copy consistently; never move/delete ZCode's data or silently assume
  a shared directory belongs to Lumi. Handle credentials separately and preserve
  rollback. After import, Lumi writes only its own state.
- Test simultaneous launch, independent settings and sessions, callbacks,
  credentials, upgrades, uninstall, preview/dev variants and remote hosts on each
  supported platform. Isolation is complete only when those checks pass.

This is a proposed migration, not permission to rename compatibility identifiers
while resolving an unrelated upstream conflict. Preserve existing users until the
migration has been specified and validated.

Apache-2.0 permits modified distributions subject to its conditions; it does not
require renaming internal identifiers or grant general trademark rights. Preserve
copyright/attribution and modification notices while keeping Lumi's public brand
distinct. See [Apache-2.0 sections 4 and 6](https://www.apache.org/licenses/LICENSE-2.0).
Renaming code does not erase upstream copyright or establish legal clearance.
