# GitHub Desktop Release Runbook

This is the operator runbook for releasing Lumi Agents desktop artifacts through
GitHub Actions and GitHub Releases.

## Current platform coverage

| Platform | Workflow | Runner/target | Published artifacts | Status |
| --- | --- | --- | --- | --- |
| macOS | `.github/workflows/macos-release.yml` | `macos-14`, arm64 | `.dmg`, `.zip` | Automated, signed and notarized |
| Linux | `.github/workflows/linux-release.yml` | `ubuntu-24.04`, x64 | `.AppImage`, `.deb`, `.rpm`, `.pkg.tar.zst` when produced | Automated, unsigned |
| Windows | None | None | None | Not automated yet |

The desktop packager supports Windows locally, but there is currently no Windows
GitHub Actions workflow. Do not describe a release as cross-platform until a
Windows workflow has been added and verified.

## How a tagged release works

Both existing workflows listen for a pushed tag matching `v*`:

```text
push v3.14.1
       ↓
macOS build/sign/notarize/gate ──┐
                                  ├─ upload artifacts → create GitHub Release
Linux build/validate ────────────┘
```

Each platform workflow has two jobs:

1. `build` checks out the tag, installs dependencies with the lockfile, runs
   typecheck and lint, and invokes `pnpm bundle:desktop` for its target.
2. `release` downloads the verified artifacts and runs `gh release create`.
   This job runs only for a tag ref; manual workflow runs never publish a
   GitHub Release.

The workflows publish independently. A macOS failure does not make the Linux
workflow fail, but the GitHub Release may be missing one platform's artifacts.
Check both workflow runs before announcing a release.

## One-time GitHub configuration

### macOS Actions secrets

Configure these under the repository's **Settings → Secrets and variables →
Actions**:

| Secret | Value |
| --- | --- |
| `MACOS_CERT_P12` | Base64-encoded Developer ID Application `.p12` |
| `MACOS_CERT_PASSWORD` | Password for the `.p12` |
| `MACOS_SIGNING_IDENTITY` | Full `Developer ID Application: ...` identity |
| `APPLE_ID` | Apple ID used by `notarytool` |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple app-specific password |
| `APPLE_TEAM_ID` | Apple Developer team ID |

The macOS job fails before building if any of these values is missing. Keep
certificates, passwords, API keys, and `.p8` files out of Git.

See [macOS signing and notarization](../upstream/MACOS-SIGNING-AND-NOTARIZATION.md)
for credential preparation and gate details.

### Linux configuration

The Linux workflow currently requires no repository secrets. It does not sign
Linux packages.

## Release procedure

### 1. Prepare and validate the release commit

Run from a clean checkout of `main`:

```bash
git switch main
git pull --ff-only
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
```

Resolve failures before tagging. The version comes from the root
`package.json`.

### 2. Create and push the version tag

The repository's `release-it` configuration creates the version commit and tag,
then pushes them. It deliberately does not create the GitHub Release itself;
the Actions workflows do that after successful builds.

Preview the release first:

```bash
pnpm exec release-it --dry-run
```

When the preview is correct:

```bash
pnpm release
```

Confirm that the command pushed a tag such as `v3.14.1`:

```bash
git ls-remote --tags origin 'v*' | tail -n 5
```

Do not create the GitHub Release manually before the workflows finish. The
release jobs use the tag name and may fail if the same release already exists.

### 3. Monitor both workflows

Open the repository's **Actions** page and inspect the runs for the pushed tag:

- **macOS release (signed + notarized)**
  - requires all macOS secrets;
  - runs the signing/notarization gate;
  - uploads only after the gate passes.
- **Linux release**
  - builds Linux x64;
  - uploads only after bundle completion;
  - does not perform package signing.

Both workflows run typecheck and lint before packaging. A manual
`workflow_dispatch` run is useful for verifying credentials and packaging, but
its `release` job is intentionally skipped.

### 4. Verify the GitHub Release

After both release jobs succeed, open the GitHub Release for the tag and verify
that it contains:

- macOS arm64 `.dmg` and `.zip` files;
- Linux x64 artifacts produced by the workflow;
- generated release notes for the tag.

If one platform failed, fix that workflow and rerun it or rebuild the tag from
a corrected commit. Do not silently announce a partial release as complete.

## Local packaging checks

The same packaging entrypoint can be used for a local smoke test:

```bash
pnpm bundle:desktop -- --os mac --arch arm64
pnpm bundle:desktop -- --os linux --arch x64
pnpm bundle:desktop -- --os win --arch x64
```

Local builds do not replace the GitHub release workflow. In particular, local
macOS builds are normally unsigned unless the signing environment is explicitly
configured, and a local Windows build does not publish anything.

## Failure handling

- **Missing macOS secret:** add or correct the protected secret, then rerun the
  failed macOS workflow for the tag.
- **macOS signing or notarization gate failure:** inspect the gate output before
  uploading anything; the workflow is designed to fail closed.
- **Linux build failure:** inspect dependency installation, native package
  preparation, and `bundle:desktop` output, then rerun after correction.
- **Only one platform published:** treat the GitHub Release as incomplete until
  the missing platform artifact is attached and verified.
- **No Windows artifact:** expected with the current repository state; add a
  dedicated Windows runner workflow before promising Windows releases.

## Release safety rules

- Release only from an reviewed, tagged commit on `main`.
- Use a signed-off commit; repository DCO checks require `Signed-off-by`.
- Never put signing credentials or personal access tokens in workflow files,
  `.env` files committed to Git, release notes, or command output.
- Do not bypass the macOS signing gate to publish an unsigned production build.
- Keep the upstream attribution, licensing files, and Lumi modification notices
  intact.
