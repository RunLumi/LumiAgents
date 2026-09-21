# Spec: Lumi Agents desktop GitHub releases

Status: implemented
Owner: desktop-release

## 1. Problem

The repository has a macOS signed/notarized release workflow, but no Linux
workflow. A tagged release should produce downloadable desktop artifacts from
GitHub Actions for every platform that has an explicitly supported release
pipeline.

## 2. Scope

In scope:

- Keep the existing macOS arm64 signed/notarized release workflow.
- Add a Linux x64 release workflow using the repository's `bundle:desktop`
  entrypoint.
- Trigger both workflows from `v*` tags and allow manual verification with
  `workflow_dispatch`.
- Upload only artifacts produced by the corresponding build job.
- Publish a GitHub Release only for tag-triggered runs, after the build job
  succeeds.

Out of scope:

- Windows packaging; it requires a separate runner and release workflow.
- Cross-compiling Linux arm64 or macOS x64 in this change.
- Signing Linux artifacts or changing the desktop packaging implementation.

## 3. Ownership and invariants

| Concern | Single owner | Invariant |
| --- | --- | --- |
| Desktop packaging | `packages/desktop/scripts/bundle.mjs` | Workflows invoke `pnpm bundle:desktop` and do not duplicate packaging logic. |
| Platform selection | Workflow job environment and bundle CLI flags | Linux uses `--os linux --arch x64`; macOS uses `--os mac --arch arm64`. |
| Release admission | Each platform workflow's build job | Artifacts are uploaded only after build and validation steps succeed. |
| GitHub Release publication | Each workflow's `release` job | Publication runs only for `refs/tags/v*` and only after the platform build job succeeds. |

## 4. Release flow

```text
v* tag or manual dispatch
        ↓
checkout → pnpm/node setup → frozen install → typecheck + lint
        ↓
platform bundle:desktop build
        ↓
upload platform artifacts
        ↓
tag run only: create GitHub Release and attach artifacts
```

The macOS workflow additionally requires Developer ID signing and Apple
notarization credentials and runs its existing signing gate. The Linux workflow
does not claim artifact signing.

## 5. Acceptance scenarios

1. A manual Linux workflow run builds and uploads Linux x64 artifacts without
   publishing a GitHub Release.
2. A `v*` tag runs the Linux workflow and publishes its verified artifacts to a
   GitHub Release.
3. A missing dependency, typecheck, lint, or bundle failure prevents artifact
   upload and release publication.
4. A missing macOS signing/notarization secret still fails the macOS workflow
   closed before producing a release artifact.
5. No workflow claims Windows support until a Windows runner workflow exists.
