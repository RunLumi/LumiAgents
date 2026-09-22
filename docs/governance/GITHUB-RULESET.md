# Required GitHub ruleset for `main`

This repository's CI is only a control if GitHub is configured to require it.
The repository currently has no branch protection / required status checks on
`main`; a red compliance workflow can therefore be merged.

Configure a repository ruleset targeting the default branch with:

1. **Require a pull request before merging.**
2. **Require status checks to pass before merging**, with the branch up to date:
   - `DCO and licensing docs / dco`
   - `DCO and licensing docs / licensing-docs`
   - `DCO and licensing docs / license-gates`
3. **Block force pushes** and **block branch deletion**.
4. Do not allow a general bypass for ordinary maintainers. Keep emergency admin
   bypass narrow, auditable, and exceptional.
5. Prefer **merge commits** or a rebase mode that preserves the contributor's
   signed-off commits. Do not use GitHub squash merge for DCO-governed PRs unless
   the resulting commit is genuinely re-certified by its actual author.
6. Require review for changes to:
   - `LICENSE`, `NOTICE.md`, `RIGHTS.md`, `LICENSING.md`,
     `TRADEMARKS.md`, `CONTRIBUTING.md`;
   - `.github/workflows/dco-license.yml`;
   - `scripts/check-dco.mjs`, `scripts/licenses.mjs`,
     `scripts/third-party-npm.mjs`;
   - `docs/licensing/dco-legacy-exceptions.json`;
   - `docs/licensing/dco-attestations.json`.

## Why this is an owner action

The repository workflows can report failure, but workflow YAML cannot grant
itself merge-blocking authority. GitHub repository/ruleset administration must
enable required checks. This document is the intended configuration and the
compliance record should continue to report the ruleset as unresolved until the
GitHub settings show it is active.

## Verification after enabling

Open the `main` rules/rulesets page and confirm that a deliberately failing
test PR cannot be merged by a normal maintainer. Then record the ruleset name and
date in `docs/licensing/COMPLIANCE.md`.
