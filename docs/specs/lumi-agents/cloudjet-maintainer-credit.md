# Cloudjet maintainer credit and upstream attribution

Status: implementation and verification required
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

Add dependency-free regression tests for maintainer rendering, legacy copyright
rendering, escaping, both locale copies, the legal entry label, explicit upstream
credit, and preservation of the legal-material list. Include an assertion that
the inherited root license is unchanged.

Run the focused tests, available repository checks, and review the complete diff.
Record exactly which checks ran. Full Electron interaction, platform packaging,
legal-material availability in produced installers, and human DCO attestation
remain separate checks when the environment cannot verify them. Do not claim a
release or legal certification based on source-level tests alone.

Authoritative license: https://www.apache.org/licenses/LICENSE-2.0 (sections 4 and 6).
