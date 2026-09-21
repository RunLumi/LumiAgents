# Validation report: Lumi Agents rebrand

Date: 2026-09-21
Baseline commit: `872ad960de7ec172591f7e1952f7849229f94521` (`feat: open source`)
Upstream: `https://github.com/zai-org/ZCode`, `upstream/main` = same commit.

## Environment (actual, not assumed)

| Tool    | Required (`mise.toml`) | Used                             | Note                                                                                                                                            |
| ------- | ---------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Node    | 24.14.0                | v26.3.0                          | `mise` is **not installed** on this machine; the available Node satisfied the workspace install. This is a deviation from the pinned toolchain. |
| pnpm    | 10.33.2                | 10.33.2                          | match                                                                                                                                           |
| install | —                      | `pnpm install --frozen-lockfile` | succeeded in ~1m34s (some tarball retries)                                                                                                      |

## Commands run and real results

| Command                                                          | Result                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/check-workspace-freshness.mjs`                     | **PASS** — `main` in sync with `origin/main`, ahead 0 / behind 0                                                                                                                        |
| `node scripts/check-lumi-branding-drift.mjs` (`pnpm lumi:drift`) | **PASS** — 8 integration points verified                                                                                                                                                |
| `pnpm architecture:check -- --changed`                           | **PASS** — `architecture: OK`, violations 0, baseline 0, new 0                                                                                                                          |
| `pnpm typecheck`                                                 | **PASS** (exit 0)                                                                                                                                                                       |
| `pnpm lint`                                                      | **PASS** — 70 warnings, **0 errors**. The warnings are pre-existing (e.g. unused `desktopElectronVersion`, unused params in `WorkspaceSidebarFooter`) and are not in the changed hunks. |
| `pnpm fmt:check`                                                 | **FAIL — only `DESIGN.md`** (see below). All files added/changed by this work are formatted.                                                                                            |
| `node --import tsx --test packages/ui/test/lumiBranding.test.ts` | **PASS** — 5/5 tests                                                                                                                                                                    |

### `fmt:check` explanation

`oxfmt --check` reports a single file: `DESIGN.md`. That file already had
uncommitted local changes before this task and the goal requires preserving them,
so it was deliberately **not** reformatted. Every file authored or edited for this
change passes formatting.

## Upstream integration rehearsal

Ran per `UPSTREAM-SYNC.md` in an isolated worktree
(`git worktree add .lumi-upstream-sync -b chore/lumi-upstream-rehearsal origin/main`):

```
git merge --no-commit --no-ff upstream/main
→ Already up to date.
git status --porcelain
→ (empty)
```

- **No conflicts**, because `upstream/main` is currently **identical** to the fork
  baseline. There is no newer upstream revision to integrate.
- Worktree and temporary branch were removed; the shared checkout was not touched.

**Limitation:** this validates the runbook as a _process_, not against real
upstream changes. No measured conflict set exists yet. Re-run step 1 of the runbook
once upstream advances.

## Not executed (environment- or scope-limited)

1. **Packaged display name / bundle identity on real platforms.** Verifying
   `Lumi Agents` / `app.lumi.agents` inside a signed `.app`, `.dmg`, `.exe`, or
   Linux package requires a full desktop build plus platform runners. Not run
   here. Source-level identity is verified by the drift check and
   `desktop-product-identity.mjs`.
2. **Desktop and web before/after screenshots at small-laptop and narrow
   viewports.** Running the desktop app needs runtime assets + an Electron host,
   and the web app needs the dev servers. Not captured in this environment.
   Token values are verified statically (drift check asserts
   `#F4F0E8` / `#FFFFFF` / `#006093` / `#102A43`).
3. **Focused E2E coverage for the affected interactions.** The repository has no
   wired test runner in this checkout (no `test` script; the 4 existing
   `node:test` files do not resolve `@/` aliases under a naive `tsx` invocation).
   A self-contained unit test was added and executed instead.
4. **Signing, notarization, update feed, OAuth callback re-registration.** These
   are external release configuration for `app.lumi.agents` and were intentionally
   not changed. No service was redirected.
5. **Brand artwork and Geist fonts.** Upstream logo assets and platform icons are
   still in place; the folded-L asset set was not authored. Geist / Geist Mono are
   not bundled, so hosts without them fall back to Noto/system fonts.

## Distinction of verification levels

- **Source checks (run):** drift, architecture, typecheck, lint, unit test, formatting.
- **Local build/runtime:** not run.
- **Packaged / platform / signing:** not run; external configuration required.
