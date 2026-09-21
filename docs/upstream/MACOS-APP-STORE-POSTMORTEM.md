# macOS App Store / TestFlight release postmortem

Date: 2026-09-21

## Outcome

Lumi Agents macOS build `3.14.1` is processed by App Store Connect and has been
submitted to App Review with the launch-fix package.

- App: `Lumi Agents` (`6814426786`)
- Bundle ID: `app.lumi.agents`
- Build ID: `a7295efc-3620-41ad-b84d-a848a69f8563`
- Processing state: `VALID`
- Audience: `APP_STORE_ELIGIBLE`
- Uploaded through Transporter with API key `3XJ664VDDN`
- Review submission ID: `9d2e5dab-384d-4ccc-9d49-21842fd21fa2`
- Review state: `WAITING_FOR_REVIEW`

No tester activation was performed.

## Timeline

1. The first MAS package reached Transporter but Apple rejected it with HTTP 409. The app signature was ad hoc, nested executables were not consistently
   sandboxed, and package readability was incomplete.
2. The app and installer certificates were cleaned up and the build was moved
   to independent certificate-type discovery.
3. The next package was correctly team-signed, but Apple still rejected helper
   and bundled-tool entitlements and the embedded profile mode.
4. The final package signed every MAS executable, embedded the sandbox
   entitlement, made the embedded profile readable, and passed local recursive
   signature checks.
5. Transporter accepted the final package. The App Store Connect API then
   reported the build as `VALID` and `APP_STORE_ELIGIBLE`.
6. macOS launch testing found an unprovisioned auto-generated App Group
   entitlement in the installed bundle. MAS pre-auto-entitlements were
   disabled, build `3.14.1` was uploaded, and the old review submission was
   canceled and resubmitted with the corrected build.

## Root causes and fixes

| Cause                                                                                                            | Fix                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| electron-builder 26 reused one `CSC_NAME` qualifier for both MAS app and installer lookup.                       | Validate both requested identities, then use certificate-type auto-discovery independently.               |
| MAS inherited entitlements lacked `com.apple.security.app-sandbox`.                                              | Add the sandbox entitlement to `entitlements.mas.inherit.plist`.                                          |
| `glm`/`tools` were in the normal macOS `signIgnore` set and bundled tools remained ad hoc.                       | Disable those ignores for the MAS target.                                                                 |
| The source profile was mode `0600`, and osx-sign copied that mode into the app.                                  | Temporarily add read bits only while electron-builder embeds the profile, then restore the original mode. |
| Node 26 triggered electron-builder’s synchronous ESM configuration-loader failure.                               | Use the repository-pinned Node `24.14.0` runtime.                                                         |
| The host login keychain could enumerate the installer certificate but blocked `productbuild` private-key access. | Use an explicit protected temporary keychain when required; grant access only to signing tools.           |
| App Store Connect’s initial macOS version record was `1.0`, while the bundle declared `3.14.0`.                  | Update the editable macOS version record to `3.14.0` before processing.                                   |
| The installed bundle received an auto-generated App Group entitlement absent from the provisioning profile.      | Disable MAS pre-auto-entitlements; the app has no App Group/shared-container requirement.                 |

## Verification evidence

The final artifact passed:

- `codesign --verify --deep --strict`
- app certificate authority `3rd Party Mac Developer Application`
- Team ID `7MBXZKYSY4`
- `com.apple.security.app-sandbox=true` on the main app, helpers, node-pty,
  `zcode-window-bounds`, `bfs`, `rg`, and `ugrep`
- embedded profile mode `0644` inside the bundle
- `pkgutil --check-signature` with the Mac Installer Distribution certificate
- Transporter upload with no validation errors
- App Store Connect API processing state `VALID`
- Installed-bundle launch must be checked separately from Transporter processing;
  a profile/signature mismatch can still be rejected by macOS launch services.

## Prevention

Every future release should use `pnpm release:macos:mas` under Node `24.14.0`,
verify the package locally, and query App Store Connect until the build is
`VALID` and `APP_STORE_ELIGIBLE`. A successful Transporter transfer alone is
not sufficient evidence of TestFlight readiness.
