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

Use the repository-pinned Node `24.14.0` runtime (`mise exec -- pnpm ...` on a
machine with mise). Node 26 can fail while electron-builder loads this ESM
configuration because it contains top-level await.

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

If the login keychain cannot authorize `productbuild`, provide an explicit
temporary keychain through `CSC_KEYCHAIN`. It must contain both private keys,
be unlocked for the build, and grant access only to `/usr/bin/codesign` and
`/usr/bin/productbuild`. Do not put the keychain password or PKCS#12 password
in Git. The release script uses certificate-type auto-discovery so the app and
installer certificates are selected independently.

## Current release evidence

As of 2026-09-22:

- App Store Connect API key: `3XJ664VDDN` with App Manager access; issuer ID is
  configured in the ignored `.env`.
- Bundle ID: `7MBXZKYSY4.app.lumi.agents`.
- Provisioning profile: `Lumi Agents Mac App Store 2026-09-21`, profile UUID
  `920c6ba8-3807-4e7c-9329-cdc19e8e6cbb`, expires 2027-09-21.
- Local keychain now contains the Mac App Distribution and Mac Installer
  Distribution identities. Certificate backups are `mac_app.cer` and
  `mac_installer.cer`; private keys must remain in the login keychain and in
  an encrypted/offline backup.
- A launch-fixed signed `.pkg` was built and verified in an isolated release
  worktree at `packages/desktop/dist/mas-arm64/Lumi Agents-3.14.0-mac-arm64.pkg`.
- Transporter accepted build `3.14.1` on 2026-09-22.
- App Store Connect API readback: build ID
  `a7295efc-3620-41ad-b84d-a848a69f8563`, build number `3.14.1`, processing
  state `VALID`, audience `APP_STORE_ELIGIBLE`. The editable App Store version
  record remains `3.14.0`; the build number was advanced independently to
  replace the launch-broken upload.
- App Review submission ID `9d2e5dab-384d-4ccc-9d49-21842fd21fa2` is
  `WAITING_FOR_REVIEW`.
- Four macOS screenshots were uploaded to the `APP_DESKTOP` display set after
  resizing the supplied images to `2560x1600`. The originals remain in
  `screenshots/`; generated store copies are in `screenshots/app-store/`.
- Store metadata is complete: free price, `DEVELOPER_TOOLS` category, no
  third-party content, privacy policy
  `https://runlumi.app/store/en/privacy/`, and App Privacy published as
  `Data Not Collected` based on the current local-first, telemetry-disabled
  product behavior.
- Age-rating declarations enable messaging/chat and unrestricted web access,
  declare no mature-content categories, and use the `18+` override requested
  for this release. Review contact is Hong Le at `apple@runlumi.app`; no
  sign-in or demo credentials are required.

The failed attempts and corrective actions are recorded in
`docs/upstream/MACOS-APP-STORE-POSTMORTEM.md`.

## Backup inventory for the release owner

Back up each item separately and encrypt the private material. Never commit the
contents of any private key, certificate bundle, password, or profile to the
application repository.

| Item                              | Required backup                                                                          | Safe handling                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| App Store Connect API private key | `AuthKey_3XJ664VDDN.p8`                                                                  | Store encrypted/offline; local mode `0600`; key ID `3XJ664VDDN`.               |
| App Store Connect metadata        | Issuer ID `d984cd40-432a-4d7a-86aa-84417c778a28`, key ID, role `App Manager`             | Store as non-secret metadata next to the encrypted key backup.                 |
| Mac app certificate               | `mac_app.cer` and its matching private key                                               | The `.cer` is public; back up the private key or `.p12` encrypted.             |
| Mac installer certificate         | `mac_installer.cer` and its matching private key                                         | The `.cer` is public; back up the private key or `.p12` encrypted.             |
| Mac App Store profile             | `Lumi_Agents_Mac_App_Store_20260921.provisionprofile`                                    | Keep the profile with the certificate inventory; it targets `app.lumi.agents`. |
| Certificate/profile identifiers   | App certificate serial, installer certificate serial, profile UUID, Team ID `7MBXZKYSY4` | Record for matching/recovery; these are not substitutes for private keys.      |
| Local release configuration       | Ignored `.env` values, excluding private contents from chat/Git                          | Recreate on the replacement Mac; do not copy into the app repository.          |

The replacement Mac also needs Xcode command-line tools, Transporter, the
pinned Node/pnpm toolchain, the login-keychain identities, and the profile
installed under `~/Library/MobileDevice/Provisioning Profiles/`. The release
owner must independently verify `security find-identity -v -p codesigning`,
`codesign -d --entitlements :-`, `pkgutil --check-signature`, and App Store
Connect processing before distributing to testers.
