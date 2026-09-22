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
pnpm install                                     # pinned by mise.toml (node 24.14.0, pnpm 10.33.2)

# 品牌 / 主题 / 归属 / 分发安全 + Apache-2.0 §4(b) 修改声明（失败即显式退出非 0）
pnpm lumi:drift
# 同步后确认「改了上游文件但没登记声明」的漏网（需本地 upstream 远端）
node scripts/check-lumi-branding-drift.mjs --against-upstream

# 第三方声明：上游动了依赖就重新生成，再校验标识与新鲜度
node scripts/licenses.mjs notices
node scripts/licenses.mjs check
# 发布前必须过严格门禁（当前上游遗留 19 项缺口，见 docs/licensing/COMPLIANCE.md §9）
node scripts/licenses.mjs check --strict

pnpm architecture:check -- --changed
pnpm typecheck
pnpm lint
pnpm fmt:check

# 合规与分发默认值的负向测试（含首个漂移检查负向用例）
node --import tsx --test packages/ui/test/lumiCompliance.test.ts packages/ui/test/lumiBranding.test.ts
```

合并冲突后的额外步骤：

1. 对每个冲突文件重新应用 Lumi 行，然后补齐 §4(b) 声明：
   `node scripts/lumi-modified-files.mjs apply`。
2. 上游新增/改名的文件如果也被 Lumi 修改，必须同时加进
   `scripts/lumi-modified-files.mjs` 的 `MODIFIED_FILES` 或 `NOTICE_EXCEPTIONS`；
   `--against-upstream` 会指出漏登记项。
3. 上游如果动了品牌/主题集成点（改函数名、改 token），更新 `scripts/lumi-drift-rules.mjs`
   而不是放宽断言。

**硬性约束**：不要把自动更新或遥测默认值改回上游值；Lumi 没有对应的后端。

**DCO 与上游同步**：上游导入基线本身不要求 Lumi DCO；另外，
`docs/licensing/dco-legacy-exceptions.json` 精确冻结了 DCO 门禁启用前已合入 main 的
历史 unsigned fork 提交。这些 exact-SHA 例外不是 DCO 认证或版权转让，cutoff 不得后移。
任何新的同步/冲突解决/cherry-pick 提交都由实际提交作者本人 `-s` 签名。

若 post-cutoff unsigned commit 已误合入 main，**不得**把它追加到 legacy exceptions，也不为
历史提交伪造 trailer；只允许原作者在后续 signed non-merge commit 中加入
`DCO-Attests: <exact-40-char-sha>`。Checker 会验证 same-author、target ancestry、target
确实 unsigned，以及 attesting commit 自身的真实 `Signed-off-by`。

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
`FORK-DIFFERENCES.md` **and** the provenance table in `docs/licensing/COMPLIANCE.md`
to the new upstream SHA.

## Known limitation

At the time of writing, upstream `main` equals the fork baseline
(`872ad960de7ec172591f7e1952f7849229f94521`), so **no newer upstream revision
exists**. This runbook is therefore validated as a process, not against real
upstream changes: there are no measured conflicts to report yet. Re-run step 1
once upstream advances.
