# macOS signing and notarization (Lumi Agents)

Bundle identity: `app.lumi.agents` (production) / `app.lumi.agents.preview` (preview).

This documents the Developer ID signing + hardened runtime + entitlements + notarization
flow and its **fail-closed verification gate**. No credentials are stored in this
repository; every secret is read from the environment at build time.

## Design: two-stage, fail-closed

1. **Build stage** — `electron-builder` signs with a Developer ID identity, applies the
   hardened runtime and `build/entitlements.mac.plist` / `entitlements.mac.inherit.plist`.
2. **Notarize stage** — `scripts/notarize-macos-release.mjs` submits the produced
   `.dmg`/`.zip` to `notarytool` and staples the `.app` and `.dmg`.
3. **Gate** — `scripts/verify-macos-release-signing.mjs` mechanically verifies the
   signed/notarized product and **fails the build** if anything is missing.

`mac.notarize` stays `false` in `electron-builder.config.js` on purpose: inlining
notarization inside the build stage forces `APPLE_APP_SPECIFIC_PASSWORD` and can fail
before an artifact is produced. The standalone stage is what makes the gate possible.

## Required environment (release owners provision; not committed)

Signing (one of):

| Variable                               | Meaning                                       |
| -------------------------------------- | --------------------------------------------- |
| `APPLE_SIGNING_IDENTITY` or `CSC_NAME` | `Developer ID Application: <Name> (<TEAMID>)` |
| `CSC_LINK` + `CSC_KEY_PASSWORD`        | base64 `.p12` and its password (alternative)  |

Signing is only activated when **both** `ZCODE_ENABLE_MAC_SIGN=1` and an identity exist.
If `ZCODE_ENABLE_MAC_SIGN=1` is set without an identity, the build **fails immediately**
for any flavor (see the guard in `electron-builder.config.js`).

Notarization (choose one scheme):

| Scheme                    | Variables                                                                 |
| ------------------------- | ------------------------------------------------------------------------- |
| Keychain profile          | `NOTARYTOOL_KEYCHAIN_PROFILE` (from `xcrun notarytool store-credentials`) |
| App Store Connect API key | `APPLE_API_KEY` (path to `.p8`) + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER` |
| Apple ID                  | `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`              |

A partial credential set is an error (the scripts do not guess missing values).

## Commands

Signed build (all stages):

```bash
ZCODE_ENV=production \
ZCODE_ENABLE_MAC_SIGN=1 \
APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)" \
NOTARYTOOL_KEYCHAIN_PROFILE="lumi-notary" \
pnpm bundle:desktop -- --os mac --arch arm64
```

When signing is enabled, `bundle.mjs` automatically runs the notarize stage and the gate
after `electron-builder`. You can also run them by hand:

```bash
pnpm notarize:macos-release -- \
  --artifact "packages/desktop/dist/Lumi Agents-3.14.0-mac-arm64.dmg" \
  --artifact "packages/desktop/dist/Lumi Agents-3.14.0-mac-arm64.zip" \
  --app "packages/desktop/dist/mac-arm64/Lumi Agents.app"

pnpm verify:macos-release-signing -- \
  --app "packages/desktop/dist/mac-arm64/Lumi Agents.app" \
  --artifact "packages/desktop/dist/Lumi Agents-3.14.0-mac-arm64.dmg" \
  --require-staple
```

Installed-app check (existing, unchanged logic):

```bash
pnpm doctor:macos-release "/Applications/Lumi Agents.app"
```

## CI (tagged releases)

`.github/workflows/macos-release.yml` runs the whole flow on a macOS arm64 runner and is
**fail-closed**: it uploads artifacts and creates a GitHub Release only after the gate passes.

- **Triggers:** push of a `v*` tag, or manual `workflow_dispatch` (manual runs verify but do not
  publish, because the release job is gated on a tag ref).
- **Jobs:** `build-sign-notarize` (checkout → pnpm/Node → require secrets → install →
  typecheck+lint → build/sign/notarize → gate → upload artifact), then `release`
  (`needs: build-sign-notarize`, downloads the verified artifact, `gh release create`).
- **Publish target:** GitHub Releases on `origin` (`RunLumi/LumiAgents`). This deliberately does
  **not** reuse the upstream ZCode CDN/update feed.

Required repository secrets:

| Secret                        | Purpose                                       |
| ----------------------------- | --------------------------------------------- |
| `MACOS_CERT_P12`              | base64 of the Developer ID Application `.p12` |
| `MACOS_CERT_PASSWORD`         | password for that `.p12`                      |
| `MACOS_SIGNING_IDENTITY`      | `Developer ID Application: <Name> (<TEAMID>)` |
| `APPLE_ID`                    | Apple ID for notarization                     |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for that Apple ID       |
| `APPLE_TEAM_ID`               | team id (also asserted by the gate)           |

A dedicated first step asserts every secret is non-empty, so a missing credential fails the job
before any build runs rather than quietly producing an unsigned artifact.

## What the gate checks

`verify-macos-release-signing.mjs` fails unless **all** hold:

- `codesign --verify --deep --strict` passes.
- Authority is `Developer ID Application…` (an ad-hoc/unsigned build fails).
- `TeamIdentifier` equals `--expect-team-id` / `APPLE_TEAM_ID` when provided.
- Hardened runtime flag (`flags=0x…10000(runtime)`) is set.
- Entitlement `com.apple.security.cs.allow-jit` is present (Electron needs it).
- `CFBundleIdentifier` starts with `--expect-bundle-id` (default `app.lumi.agents`).
- `spctl -a -vv -t exec` accepts the bundle with `source=Developer ID`.
- With `--require-staple`: `xcrun stapler validate` passes on the `.app` and on each
  `.dmg`. `.zip` archives are skipped because `stapler` cannot staple a zip (the
  notary submission still covers the app inside it).

## Proving the gate is not a no-op

On an unsigned local build the gate must fail (verified on 2026-09-21):

```
$ node scripts/verify-macos-release-signing.mjs --app "…/Lumi Agents.app" --require-staple
[macos-signing-gate] FAILED:
  - not Developer ID signed (ad-hoc or unsigned): …
  - hardened runtime flag missing on …
  - required entitlement com.apple.security.cs.allow-jit missing on …
  - notarization staple missing/invalid: … does not have a ticket stapled to it.
$ echo $?   # 1
```

And the notarizer refuses to run without credentials:

```
$ node scripts/notarize-macos-release.mjs --artifact "…/Lumi Agents-3.14.0-mac-arm64.dmg"
[notarize] no notarization credentials found; set NOTARYTOOL_KEYCHAIN_PROFILE, or …
$ echo $?   # 1
```

## Known caveats

- **Staple vs. distributed zip order.** Stapling rewrites the `.app`, so a zip built
  _before_ stapling no longer matches the stapled app. If you must ship a zip whose
  embedded app carries the ticket, regenerate the zip after the staple step (or ship
  only the stapled `.dmg`). The gate validates the staples that exist; it does not
  re-stitch archives.
- **Entitlements scope.** `allow-jit` / `allow-unsigned-executable-memory` /
  `disable-library-validation` are required for Electron plus the bundled Node runtime.
  Tightening them requires re-running the gate.
- **Network + Apple account.** Notarization needs outbound access to Apple and a valid
  team. Neither was available while wiring this, so the signed/notarized path was **not
  executed here** — only its fail-closed behavior was verified.
- **Gate is opt-in.** It runs automatically only when `ZCODE_ENABLE_MAC_SIGN=1` and an
  identity are present, so ordinary unsigned local builds are unaffected.
