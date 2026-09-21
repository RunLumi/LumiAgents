# macOS App Store / TestFlight release

The App Store Connect credentials are loaded from the ignored root `.env`:

```dotenv
APPLE_API_KEY="AuthKey_3XJ664VDDN.p8"
APPLE_API_KEY_ID="3XJ664VDDN"
APPLE_API_ISSUER="d984cd40-432a-4d7a-86aa-84417c778a28"
```

`APPLE_API_KEY` is a path, not the private-key contents. Keep the `.p8` file
outside Git and restrict it with `chmod 600`. The key has App Manager access.

## Prerequisites

The MAS build also requires protected local/CI signing material:

```bash
export MAS_APP_SIGNING_IDENTITY="Apple Distribution: <Team Name> (<TEAMID>)"
export MAS_INSTALLER_IDENTITY="3rd Party Mac Developer Installer: <Team Name> (<TEAMID>)"
export MAS_PROVISIONING_PROFILE="/secure/path/app.lumi.agents.provisionprofile"
```

The app identity may use the older `3rd Party Mac Developer Application` name
where that is what the team’s keychain exposes. The installer identity must be
the Mac App Store installer certificate. Do not substitute a Developer ID
certificate; that produces a direct-distribution package, not a MAS package.

## Build and upload

Run from the repository root:

```bash
pnpm build:macos:mas
pnpm release:macos:mas
```

The first command builds and signature-checks one `.pkg`. The second also calls
`iTMSTransporter` with the App Store Connect API key. Upload acceptance is not
TestFlight availability: wait for Apple processing and verify the build in the
Lumi Agents TestFlight page before distributing it to testers.

The script fails closed if the host, production environment, API key, signing
identities, provisioning profile, or package signature is missing. It never
prints the `.p8` contents, creates a review submission, or activates testers.

## Current release evidence

As of 2026-09-21:

- App Store Connect API key: `3XJ664VDDN` with App Manager access; issuer ID is
  configured in the ignored `.env`.
- Bundle ID: `7MBXZKYSY4.app.lumi.agents`.
- Provisioning profile: `Lumi Agents Mac App Store 2026-09-21`, profile UUID
  `06ce3e3e-bc1c-4bbb-b5db-7cd5f15598b9`, expires 2027-06-24.
- Local signing admission: **blocked**; `security find-identity -v -p
codesigning` returned `0 valid identities found`.
- Upload status: not attempted; no `.pkg` was built or submitted.

The first signed package upload was attempted on 2026-09-21 and rejected by
Apple with `STATE_ERROR.VALIDATION_ERROR`. Apple reported that the main app and
nested Electron/node-pty/helper binaries were not signed with the certificate
embedded in the provisioning profile, several nested executables lacked the
`com.apple.security.app-sandbox` entitlement, and some package files were root-only
readable. Subsequent local packaging also exposed that the app bundle signature
reported `Authority=(unavailable)` (ad-hoc), so no second upload was attempted.

The current blocker is MAS signing correctness, not the App Store Connect API
credential or bundle ID. The package must be rebuilt with a non-ad-hoc
`3rd Party Mac Developer Application` signature on every nested executable, MAS
entitlements on every executable, readable package permissions, and the matching
`3rd Party Mac Developer Installer` package signature before retrying Transporter.

Install the matching Apple Distribution/Mac App Distribution certificate and
the Mac App Store Installer certificate, including their private keys, into the
login keychain. Then rerun `pnpm build:macos:mas` and `pnpm release:macos:mas`.
