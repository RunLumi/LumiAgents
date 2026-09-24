> Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents) from ZCode (https://github.com/zai-org/ZCode). Apache-2.0 §4(b) modification notice.

# Contributing to Lumi Agents

Thanks for contributing to the Lumi Agents community edition. This fork of
[ZCode](https://github.com/zai-org/ZCode) keeps the public code Apache-2.0; the
licensing and contribution policy is set in
[LICENSING.md](LICENSING.md) and
[ADR 0001](docs/specs/lumi-agents/adr/0001-licensing-and-contribution-model.md).

## The rules in one paragraph

Contributions to first-party public code are made under the **Developer
Certificate of Origin 1.1** (below) plus the **Apache-2.0** license. You sign off
every new commit you submit (`git commit -s`); the applicable copyright owner
retains copyright unless a separate assignment says otherwise, while Lumi and
everyone else receive the Apache grant for the contribution as part of the
distribution.
You do **not** assign copyright and there is no CLA to sign. If you are not the
sole author of your contribution, or your employer may have rights in it, you must
have their authorization before submitting. DCO clauses (a)–(c) cover the
right-to-submit basis; clause (d) separately records the public and persistent
nature of the contribution record.

## Sign-off (DCO) — required for every commit

Every commit in a pull request must carry a `Signed-off-by` line matching the
commit author's verified identity, e.g.:

```
git commit -s -m "Fix terminal resize flicker"
```

The `Signed-off-by` line certifies that you wrote the change or otherwise have the
right to submit it under this repository's license. The DCO is a certification of
**provenance**, not a copyright assignment, not a grant of exclusive rights, and
not proof of any company ownership. Maintainers will not add, edit or "fix"
sign-off lines on a contributor's behalf, and each committer must actually make
the certification themselves.

If your commits fail the DCO check, push corrected commits with proper sign-off
(e.g. `git commit --amend -s` or an interactive rebase adding `-s` to each commit).

### Employer / third-party authorization

If you contribute as part of your job, or your employer's IP policy could claim
your work, get their approval first. DCO clauses (a)–(c) require that you have the
right to submit the contribution under the project's license. Clause (d) separately
records your understanding that the contribution and contribution record are
public and maintained indefinitely. When in doubt, ask your employer before
opening the PR.

### AI-assisted contributions

AI-assisted contributions are welcome, subject to the same DCO certification and
human review:

- A **human** opens the PR, reviews the change, takes responsibility for the
  submission, and holds the submission rights; the sign-off must be made by that
  human (or an authorized committer), never by the tool.
- Do not claim that generated code is guaranteed to be original — certify only
  what the DCO asks (right to submit under the license).
- Follow the tool's license/terms for disclosed restrictions; do not submit output
  you are not licensed to distribute.
- No confidential or customer code/data may be submitted, AI-generated or not.

### Copied material

Copied third-party or existing code requires attribution and evidence of license:
state the origin and license in the PR description, and keep the original license
notice where the code lands. Contributions that cannot demonstrate the right to
submit under Apache-2.0 will be declined.

### Historical exceptions are not retroactive DCOs

The exact pre-enforcement commits listed in
[`docs/licensing/dco-legacy-exceptions.json`](docs/licensing/dco-legacy-exceptions.json)
are grandfathered only so CI can evaluate current history without falsifying old
trailers. Those entries are **not** DCO certifications, copyright assignments, or
proof that Cloudjet owns the work. The exception set is frozen at an immutable
cutoff commit; new commits must carry genuine author sign-off.

### Retrospective attestation for an accidentally merged unsigned commit

Do **not** expand the frozen legacy-exception cutoff and do not rewrite public
`main` history merely to add a trailer. If a post-enforcement commit was already
merged without DCO, the repository accepts a narrowly scoped retrospective
attestation only when all of these are true:

1. `docs/licensing/dco-attestations.json` names the **exact target SHA**, original
   author email and subject, plus the canonical DCO 1.1 attestation statement.
2. A later non-merge descendant commit by the same normalized author contains
   `DCO-Attests: <exact target SHA>` and the author's genuine `Signed-off-by`.
3. CI verifies that the attestation commit descends from the target commit and
   that no other author can certify it.

This is a provenance remediation for one exact contribution, not a copyright
assignment, not a blanket exception, and not permission for maintainers or tools
to sign on another person's behalf. Until the original author makes that signed
exact-SHA certification, the DCO gate must remain red. Inherited upstream release
commits are separately pinned by SHA, tree, parent, and author in the checker;
this is not a DCO certification for their authors.

### Merge mode: preserve sign-offs

GitHub's **squash merge** rewrites the commit: the author becomes the PR
opener's account and per-commit trailers, including `Signed-off-by`, are
dropped. A squash-merged commit therefore loses its certification and fails
this check. Merge pull requests with **merge commits** (or rebase merges),
which carry the signed commits over unchanged. Do not "repair" a lost
sign-off by adding the line afterward on someone else's behalf — have the
real author produce the signed commit.

## What to work on

Good first areas, matching the fork's structure:

- **Theme/brand surfaces** (`packages/ui`): the light-only `.theme-lumi` token layer
  and DESIGN.md compliance; check `pnpm lumi:drift` before submitting.
- **Docs and onboarding**: clearer setup, screenshots, translated docs.
- **Agent/provider integrations** (`packages/provider*`, `packages/services`):
  new providers, BYOK paths, bug fixes.
- **Desktop shell bugs** (`packages/desktop`): packaging, menus, About/Licenses,
  update UX.
- **Third-party compliance**: notice gaps and packaging audits in `third-party/`
  (see `third-party/README.md`).

When touching files inherited from upstream, add the `Modified for Lumi Agents`
notice if applicable (`pnpm lumi:notice` will tell you).

## Setup and test commands

```bash
pnpm install
pnpm typecheck            # TypeScript across the workspace
pnpm lint                 # oxlint
pnpm fmt:check            # oxfmt formatting check
pnpm architecture:check -- --changed   # architecture boundaries
pnpm test                 # workspace tests
```

Licensing/branding checks that must pass for docs + src changes:

```bash
pnpm lumi:notice          # Apache-2.0 §4(b) modification notices
pnpm lumi:drift           # branding/licensing integration-point drift
# DCO sign-offs (CI runs this on PR ranges):
node scripts/check-dco.mjs "$(git merge-base origin/main HEAD)..HEAD"
node scripts/licenses.mjs check --strict   # third-party material gate
```

For desktop E2E and packaging, see `AGENTS.md` and
`docs/upstream/UPSTREAM-SYNC.md`; run platform-specific checks where your
environment supports them and say so in the PR when it doesn't.

## Commit messages

Prefer concise, imperative subjects ("fix: …", "feat: …", "docs: …") with a body
explaining the _why_. Sign every commit (`-s`). One logical change per commit
makes review and backports easier.

## Review

A maintainer reviews each PR for correctness, scope and license/provenance
compliance. There are no published review-time commitments. Changes to license
scope, contribution terms or third-party material policy require documented
maintainer review (see ADR 0001) and are never merged silently.

---

## Developer Certificate of Origin — Version 1.1

The text below is the official, unmodified
[Developer Certificate of Origin 1.1](https://developercertificate.org/).

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.

Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    identified in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```
