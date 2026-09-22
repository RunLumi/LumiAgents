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

## Current follow-up state

The original maintainer-credit and keyboard/legal-material access fixes are merged.
A later 2026-09 compliance audit found broader repository issues outside the
original scope and addresses them in the dedicated compliance repair:

- package metadata must identify Cloudjet/Lumi rather than ZCode product contacts;
- the trademark policy must distinguish copyright permission in Apache-covered
  artwork from trademark permission;
- the strict dependency scanner must treat absent cross-platform optional native
  packages as optional rather than silently allowlisting package names;
- historical unsigned commits are frozen as exact legacy exceptions rather than
  retroactively signed; all new commits still require genuine DCO;
- inherited ZCode DMG background assets are removed rather than carried forward;
- branch protection remains a repository-admin setting and must require the DCO,
  licensing-docs, and license-gates jobs before future merges.

The authoritative current status is
[`docs/licensing/COMPLIANCE.md`](../../licensing/COMPLIANCE.md), not the
historical CI results recorded earlier in this spec.

Authoritative license: https://www.apache.org/licenses/LICENSE-2.0 (sections 4 and 6).
