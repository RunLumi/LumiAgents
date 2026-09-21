# Cloudjet maintainer credit and upstream attribution

Status: implemented; maintainer attribution and access fixes are merged. This document also records the Cloudjet rights/stewardship boundary.
Scope: desktop About, offline Credits and Licenses, and repository introductions.
Baseline: `143ed56ab15f638339685357f5537e5784b09214`.
Reviewed PR head: `32c517a1fccc2b24ec29a6f96a9db4072029031e`.

## Decision

The repository owner identifies **CLOUDJET SOLUTIONS PTE. LTD.** (Singapore UEN
**201708398E**) as the developer, maintainer, and project steward of the Lumi
Agents fork. This is not a claim that the company owns ZCode, every contribution,
or all inherited code. Copyright follows actual authorship and valid assignments;
see [RIGHTS.md](../../../RIGHTS.md).

The normal About panel displays:

> Developed and maintained by CLOUDJET SOLUTIONS PTE. LTD.

The Chinese locale conveys the same meaning without translating the legal name.
The existing offline legal entry is labelled **Credits and Licenses** (with a
Chinese equivalent). It explicitly identifies the independent ZCode fork,
retains **Copyright 2026 Z.AI Co., Ltd**, credits other contributors under their
applicable licenses, and states that Lumi Agents is not an official ZCode or
Z.AI distribution. Preserve the upstream copyright year rather than replacing
it with the current calendar year.

## Boundaries and invariants

- Keep the root `LICENSE` and inherited/third-party legal notices intact.
  `NOTICE.md` may add Cloudjet attribution alongside, not instead of, upstream
  attribution. No upstream copyright transfer is introduced.
- Preserve applicable source notices and the existing `Modified for Lumi Agents`
  markers. Product copy is not a global replacement of Z.AI or ZCode.
- Keep model/provider names, internal identifiers, update configuration, signing,
  storage paths and other runtime behavior unchanged.
- Continue reading the existing packaged legal files offline. An in-app entry
  is our discoverability choice, not an extra requirement invented for Apache.
- Keep the HTML renderer's existing copyright input compatible for other callers;
  the new maintainer input must be escaped and distinct from a copyright claim.
- Use the Singapore **UEN** for legal-entity disambiguation. Do not copy changing
  registry status, addresses, financial-directory data, registered-trademark
  claims, or an all-code Cloudjet copyright into licensing metadata.
- English and Chinese READMEs identify the maintainer without removing upstream
  provenance, attribution or links to legal materials.

## Review corrections and acceptance scenarios

1. **Keyboard access:** Enter activates the focused native button. A global
   Enter handler must not close About at the same time that Credits opens.
   Escape and the OK button still close About.
2. **Development legal files:** `packages/desktop/out/main` and
   `packages/desktop/src/main` are four levels below the repository root, not
   three. An explicit development workspace root takes precedence.
3. **Packaged provenance:** packaged lookup reads only the shipped resources.
   Missing materials remain visibly unavailable; a source checkout must not
   conceal missing files in the distributable.
4. **Trademark CI:** whitespace normalization accepts a line-wrapped declaration
   without weakening the requirement that the declaration be present.

These are narrow corrections to existing presentation and file-lookup paths.
No new state owner, service, dependency or module boundary is introduced.

## Verification

Run using the repository toolchain:

```sh
node --experimental-strip-types --test \
  scripts/lumi-maintainer-credit.test.mjs \
  scripts/lumi-credits-access.test.mjs
```

The original 15 maintainer-attribution tests passed in GitHub Actions run
`35665054913` on Node 24.20.0. That run used `.nvmrc` (`24`), not the exact
24.14.0 pin documented elsewhere. Its installation step succeeded, but the
complete workflow failed; the focused tests were not an overall green result.

The follow-up review added nine access regressions. All nine passed locally on
Node 22.16.0. Five fail against the original reviewed implementations, proving
coverage of the discovered defects. The tests use byte-for-byte copies of the
actual legal module with only the shared locale constant stubbed; real fixture
files are read and rendered. They do not launch Electron or inspect installers.

A separate Chromium check reproduced the original Enter event opening Credits
and also closing About. With the correction, Enter opens Credits without closing
About; Escape and OK still close it. This exercised generated HTML at the actual
256 x 312 window dimensions with window open/close instrumented, not an Electron
parent/child-window integration. TypeScript syntax/emit checks passed for both
corrected source files. Workflow YAML and shell syntax checks passed.

Before editing, the three mirrored original files were verified against their
Git blob hashes. The original Apache license and legal materials are not edited.
The CI test step now includes both regression suites; inspect its result on the
new PR head rather than assuming a rerun is green.

## Remaining merge and release blockers

The reviewed run also exposed two independent blockers:

- **DCO:** its two implementation commits lack author certification. Any review
  follow-up commit also needs genuine human certification before merge. No tool
  creates sign-offs on an author's behalf, and the DCO gate is not disabled.
- **Strict material gate:** it stops at missing installed dependency
  `@napi-rs/canvas-linux-arm64-musl@0.1.100`. The unchanged workspace configuration
  lists `current` and `glibc`, while the license scanner expects that musl package.
  Reconcile the distribution matrix, installed graph and generated inventory in
  a complete dependency environment. Do not skip the component or replace the
  strict check with a weaker one merely to make CI green.

The trademark failure was a separate false positive caused by a newline in
`TRADEMARKS.md`; the declaration itself was present. Its corrected predicate has
positive wrapped-text and negative missing-text tests.

**Not verified locally:** full repository typecheck, lint, formatting,
architecture, drift, third-party gates or platform packaging. The local
environment lacks the complete checkout and dependency installation. In the
reviewed CI run, modification-notice and drift steps were skipped after the
material gate failed. These are unverified, not passes. Separately documented
ownership and commercial-release blockers remain open.

Authoritative license: https://www.apache.org/licenses/LICENSE-2.0 (sections 4 and 6).
