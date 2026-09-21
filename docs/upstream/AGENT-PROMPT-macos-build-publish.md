# Agent prompt: build + publish a signed & notarized Lumi Agents macOS release (computer use)

Use this prompt with an agent that has computer-use (GUI + terminal) capability on a macOS
machine. It is written to be self-contained and fail-closed.

---

You are a release engineer operating this macOS machine with **computer use**. Your goal is a
**Developer ID-signed, hardened-runtime, notarized, staple-verified** release of **Lumi Agents**,
then publishing it to an authorized channel. Fail closed: never publish an unsigned or ad-hoc
artifact, and never bypass the verification gate.

## Repository context

- Repo: this checkout. Product name **Lumi Agents**; bundle id **app.lumi.agents**
  (preview: `app.lumi.agents.preview`).
- Runbook: `docs/upstream/MACOS-SIGNING-AND-NOTARIZATION.md`.
- Fork differences: `docs/upstream/FORK-DIFFERENCES.md`.
- Node/pnpm versions are pinned in `mise.toml` (Node 24.14.0, pnpm 10.33.2). Prefer `mise exec`;
  if mise is unavailable, using the host Node is a known deviation — report it.

## Prerequisites — verify, never invent

1. **Developer ID Application certificate** in your login keychain:
   `security find-identity -v -p codesigning | grep "Developer ID Application"`
   - If missing, install it with computer use: open **Xcode → Settings → Accounts → (team) →
     Manage Certificates… → + → Developer ID Application**, or download it from
     **developer.apple.com → Certificates, Identifiers & Profiles → + → Developer ID
     Application**. Approve any keychain "Always Allow" prompts.
   - Do **not** use a `3rd Party Mac Developer Application` (Mac App Store) certificate. It is not
     valid for Developer ID distribution: electron-builder falls back to an ad-hoc signature and
     the notary service will not validate a direct-distribution build.
2. **Notarization credential** — create a keychain profile (or export env credentials):
   `xcrun notarytool store-credentials "lumi-notary" --apple-id "<apple-id>" --team-id "<TEAMID>" --password "<app-specific-password>"`
   - Alternatives the scripts accept: `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`,
     or `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`.
   - Never print, log, or commit secrets, `.p12` files, or app-specific passwords.

## Build, sign, notarize, verify

One-shot (all stages):

```bash
ZCODE_ENV=production \
ZCODE_ENABLE_MAC_SIGN=1 \
APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)" \
NOTARYTOOL_KEYCHAIN_PROFILE="lumi-notary" \
pnpm bundle:desktop -- --os mac --arch arm64
```

If a single command exceeds your time limit, run the same pipeline in stages:
`pnpm --filter @zcode/desktop prepare:runtime-assets`, then `build:no-runtime-assets`, then
`ZCODE_ENV=production ZCODE_ENABLE_MAC_SIGN=1 APPLE_SIGNING_IDENTITY="…" NOTARYTOOL_KEYCHAIN_PROFILE="…" node packages/desktop/scripts/bundle.mjs --skip-prepare --skip-build`.
When signing is enabled, `bundle.mjs` already runs notarization and the gate; do not skip them.

If you must re-run only the gate/notarizer by hand:

```bash
pnpm verify:macos-release-signing -- --app "packages/desktop/dist/mac-arm64/Lumi Agents.app" \
  --artifact "packages/desktop/dist/Lumi Agents-3.14.0-mac-arm64.dmg" --require-staple
pnpm doctor:macos-release "/Applications/Lumi Agents.app"
```

Capture the **verbatim** gate output. If the gate fails, stop and diagnose — common causes:
nested binaries without a valid signature, missing hardened-runtime/entitlements, or stapling a
zip (stapler cannot staple zip; the gate skips zips by design). Do not edit the gate to pass.

## Publish

Publish only to a channel the human has authorized for this release — for example a GitHub
Release on `origin` (`RunLumi/LumiAgents`) or an existing configured distribution/CDN. Do not
invent a publish target, credentials, or service. Upload the **`.dmg`** and **`.zip`** (not the
raw `.app`, and never an unsigned artifact). Confirm with the human before publishing anything
externally.

## Evidence to record

Append to `docs/upstream/LUMI-REBRAND-VALIDATION.md`: the exact commands, the gate output, the
codesign authority/TeamIdentifier, the artifact names and sizes (and checksums if a release was
published). Report limitations honestly.

## Hard rules

- Never invent credentials or redirect services.
- Never commit secrets or signed artifacts to git.
- Do not push to `main`; land changes as a PR.
- If blocked (no Developer ID cert, no notarization credential, no network, no authorized publish
  target), stop and report exactly what is missing — do not fabricate success.
