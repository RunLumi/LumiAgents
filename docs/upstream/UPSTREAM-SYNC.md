# Upstream sync runbook: pulling ZCode into Lumi Agents

Goal: absorb upstream [zai-org/ZCode](https://github.com/zai-org/ZCode) changes
while preserving Lumi branding, identity, and the light-only theme, using a small
number of reviewable commits — never bulk formatting, file moves, or blanket merge
strategies.

## 0. Invariants

- `origin` stays `RunLumi/LumiAgents`; `upstream` is `https://github.com/zai-org/ZCode`.
- Internal identifiers are **not** rebranded: `@zcode/*`, source paths, `zcode`
  CLI, `ZCODE_*` env vars, `zcode://` scheme, protocol fields, persistence schemas.
- Branding lives in a few files only. See [FORK-DIFFERENCES.md](./FORK-DIFFERENCES.md).
- Never re-add a dark theme or `prefers-color-scheme` branch to Lumi surfaces.

## 1. Fetch and choose a release

```bash
git fetch upstream --tags --prune
git log --oneline -1 upstream/main
git tag --sort=-creatordate | head            # pick a release tag if available
```

Record the chosen revision (tag or SHA) in the PR description.

## 2. Integrate on an isolated branch

Do the work out of the shared checkout so other agents/users are not disturbed:

```bash
git worktree add ../lumi-upstream-sync -b chore/upstream-sync-<ref> origin/main
cd ../lumi-upstream-sync
git merge --no-commit --no-ff upstream/main   # reviewable, no auto-commit
# or, for a tag:  git merge --no-commit --no-ff <tag>
```

Prefer `git merge` over `git rebase` for syncing so upstream history stays intact.

## 3. Conflict review

Conflicts should cluster in the integration points listed in
`FORK-DIFFERENCES.md`. For each conflict:

1. Keep the upstream implementation.
2. Re-apply only the Lumi line(s) — branding, identity value, theme class.
3. If upstream changed the shape of an integration point (e.g. renamed
   `resolveTheme`), update the Lumi seam rather than reverting upstream.

Do **not** resolve by taking “ours” or “theirs” wholesale for the theme or i18n
files.

## 4. Validation

From the repo root:

```bash
node scripts/check-workspace-freshness.mjs
node scripts/check-lumi-branding-drift.mjs      # fails visibly on branding/theme drift
pnpm install                                     # pinned by mise.toml (node 24.14.0, pnpm 10.33.2)
pnpm architecture:check -- --changed
pnpm typecheck
pnpm lint
pnpm fmt:check
```

Then re-verify the surfaces the theme touches (light-only, no dark flash):

- Desktop startup shell, About window, force-update prompt, CUA permission panel.
- Web startup shell and share landing page.
- Code preview, diff, and terminal readability at a small-laptop width and a
  narrow/mobile width.
- Saving `zcode-theme=dark` in `localStorage` and reloading still renders light.

Record actual results — do not report a passing check that was not run.

## 5. Rollback

If integration is not clean:

```bash
git merge --abort           # before committing
git reset --hard origin/main  # only on the isolated branch
git worktree remove ../lumi-upstream-sync
```

Because the sync happens on its own branch/worktree, rollback never touches the
shared checkout or `origin`.

## 6. Land

Land the sync as a small set of commits — typically one “merge upstream `<ref>`”
plus at most one “re-apply Lumi branding/theme” commit. Update the baseline row in
`FORK-DIFFERENCES.md` to the new upstream SHA.

## Known limitation

At the time of writing, upstream `main` equals the fork baseline
(`872ad960de7ec172591f7e1952f7849229f94521`), so **no newer upstream revision
exists**. This runbook is therefore validated as a process, not against real
upstream changes: there are no measured conflicts to report yet. Re-run step 1
once upstream advances.
