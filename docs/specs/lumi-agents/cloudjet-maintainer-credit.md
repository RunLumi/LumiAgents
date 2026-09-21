# Cloudjet maintainer credit and upstream attribution

Status: implemented; focused checks passed; full-repository and release checks pending.
Scope: desktop About, offline Credits and Licenses, and repository introductions.
Baseline: `143ed56ab15f638339685357f5537e5784b09214`.

## Decision

The repository owner identifies **CLOUDJET SOLUTIONS PTE. LTD.** as the developer
and maintainer of the Lumi Agents fork. This is a maintenance credit, not a claim
that the company owns ZCode, every contribution, or all inherited code.

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

- Keep root `LICENSE`, `NOTICE.md`, `THIRD-PARTY-NOTICES.md`, and third-party
  materials unchanged. No license or copyright transfer is introduced.
- Preserve applicable source notices and the existing `Modified for Lumi Agents`
  markers. Product copy is not a global replacement of Z.AI or ZCode.
- Keep model/provider names, internal identifiers, update configuration, signing,
  storage paths and other runtime behavior unchanged.
- Continue reading the existing packaged legal files offline. An in-app entry
  is our discoverability choice, not an extra requirement invented for Apache.
- Keep the HTML renderer's existing copyright input compatible for other callers;
  the new maintainer input must be escaped and distinct from a copyright claim.
- Do not add registration status, incorporation dates, addresses, registered
  trademark claims or an all-code Cloudjet copyright based on a directory entry.
- English and Chinese READMEs identify the maintainer without removing upstream
  provenance, attribution or links to legal materials.

## Verification

Dependency-free checks:

```sh
node --experimental-strip-types --test scripts/lumi-maintainer-credit.test.mjs
```

Results from the isolated source mirror, using Node 22.16.0 (not the pinned
repository toolchain): **15 tests passed**. The mirrored original source and
LICENSE were checked against their Git blob hashes before editing. Tests cover
actual About HTML rendering and escaping, legacy copyright inputs, localized
source contracts, offline routing, and a byte-for-byte LICENSE hash check.
Three temporary negative mutations (maintainer removal, upstream copyright
removal, and root LICENSE modification) were rejected; original files were
restored. An isolated no-emit typecheck of `aboutWindow.ts` and TypeScript
syntax/emit checks of the three touched source files also passed.

The existing licensing CI runs the focused tests before dependency installation,
using its configured Node version. Its actual result must be checked on the PR;
adding the step is not a claim that CI passed. Checkouts do not persist
credentials, and the workflow correctly states that merge-result scripts execute
PR-supplied code on unprivileged GitHub-hosted runners.

**Not verified locally:** full repository typecheck, lint, formatting,
architecture, drift and third-party gates. The environment had no pnpm,
repository dependencies or complete checkout. No Electron UI was launched and
no installer was built or inspected. Source-contract tests do not prove actual
packaged legal-material availability or platform behavior.

Human DCO attestation is still required; no sign-offs are added on behalf of an
author. This change does not resolve the repository's separately documented
ownership or release blockers. Do not merge or publish on the basis of these
focused results alone.

Authoritative license: https://www.apache.org/licenses/LICENSE-2.0 (sections 4 and 6).
