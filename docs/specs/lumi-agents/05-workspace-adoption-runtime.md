# Lumi workspace adoption and credential choice

Status: candidate, not yet verified; acceptance not demonstrated. This spec
defines the behavior the workspace adoption cut implements. No acceptance
criterion below is claimed as met until evidence is recorded for it.

Scope: workspace adoption and binding, the account/org/session fence, the
three frozen credential-choice labels, and the Lumi-first startup and bootstrap
state-root rules that adoption depends on. Managed execution, tools,
automation and provider-routing changes are not part of this spec; adopting a
workspace here never starts, authorizes or configures any of them.

## Product boundary

Lumi sign-in and device enrollment never change workspace ownership. The user
starts adoption from the currently selected workspace, chooses an organization
and project, reviews the exact bounded metadata, and confirms. Existing local
workspaces, sessions, credentials, and provider selection remain usable in local
mode. A second workspace remains local unless separately adopted.

The control plane is authoritative for P03 workspace binding, P08 adoption
stage/ownership, and policy. The desktop owns only its local mapping from
workspace identity to opaque external reference and device credentials. A
renderer projection is never authority.

## Privacy boundary

A local filesystem path, remote connection string, workspace contents, prompt,
session history, credential, or provider secret never enters an adoption
request. Main creates a random opaque workspace key and retains a per-install
identifier in a dedicated mapping vault encrypted by the approved OS boundary.
The encrypted local mapping associates the canonical workspace identity with
the random key; neither the path nor that identity is sent. Both external IDs
contain no path separators. Only the user-approved display name, environment
kind, organization, project, device and opaque identifiers are sent. The UI
previews that metadata immediately before the first write.

The mapping remains in the main process and separate from the account/device
credential record. Corrupt or unavailable secure storage fails closed for
adoption writes while local-only work remains available.

## State ownership and sequence

1. Settings supplies the active local workspace identity to a fixed main-process
   command. Main validates its shape, derives the opaque external reference,
   and resolves an existing server record before offering a new adoption.
2. The user explicitly confirms organization, project, device, display name and
   that only bounded metadata will be sent.
3. Main creates or resumes the P03 device/project workspace binding using the
   opaque workspace key as `workspace_identity`. It creates the P08 record at
   `local_unmanaged` with the selected project/device identifiers, then makes
   only the stage transition the user requested. This accommodates the frozen
   P08 creation route, whose stage-update route cannot add binding identifiers.
   Idempotency and server-owned version readback make a lost response resumable.
4. Each later ladder transition is a separate user action. The UI renders only
   server-returned stage and ownership. `workspace_bound` requires a stored P03
   binding plus active device/project and acknowledged current policy.
5. Rollback calls the frozen P08 rollback route and removes the matching P03
   binding. If either step is interrupted, local work stays intact and the next
   read reconciles the partial remote state before retry.
6. Local-only work never depends on network availability. History sync remains
   unavailable under `p08-cg-v1`.

P03-CR-003 retains removed binding rows for run attribution and hides them from
active lookup/policy. Explicit rebind uses a new P03 ID. P08-CR-002 supplies
rebind_version only for an unbound local adoption record, preserving its stable
identity and historical events; stage still starts at zero. Stage-zero binding
metadata can be unbound without changing local ownership or contents.

## Invariants

- One authoritative main-process owner for opaque workspace mappings; P03/P08
  server state remains authoritative for binding and ownership.
- Never infer ownership from account sign-in, device enrollment, local cache, or
  a successful response not read back from the server.
- Bind exactly the selected workspace and project. A different workspace has
  no adopted state and must keep using its existing local provider selection.
- No request contains a filesystem path or content. Local credentials remain
  local by default; org-managed credentials require the existing secure P04
  provisioning path and explicit destination consent.
- Policy expiry, revocation, minimum-version refusal, stale context, or an
  incomplete binding blocks the adoption step before any server write.
- Rollback removes server binding/authority without deleting or rewriting local
  files, sessions or credentials.
- No P08 stage-5 request or history upload is built.

## Failure and recovery

A timeout after P03 creation or P08 transition is resolved by fetching server
state and replaying the same idempotent operation; do not create a new workspace
identity. A partial rollback retries only the missing remote cleanup and keeps
the workspace visibly local-only until readback confirms the server state.
Missing or unreadable mapping, mismatched org/device/project, expired policy,
offline state, or unsupported client compatibility never falls through to a
server write. The local provider path remains available.

## Account, organization and session fence

Adoption commands (read, bind, advance, rollback, credential choice) run under
one fence owned by Main (`lumiSessionFence`). The scope is
`{session generation, selected-org epoch}`:

- The session generation is bumped when sign-in begins, at the start of
  completion, again when it settles, and around sign-out (including failure).
  Session restore does not bump.
- The selected-org epoch is per workspace key. `read-workspace` for a
  different org (including A to B to A) bumps it; a same-org re-read does not.
  The org the command names must still be the selected one, else
  `lumi_workspace_org_changed`, refused before the owner is reached.
- The scope is captured at admission, before the first await, and every
  command is re-checked (epoch plus live membership) before each server write,
  each local mapping save, and before the projection is returned.
- A write that already committed is never undone or retried. The stale
  command only has its later writes, mapping save and projection refused with
  `lumi_account_changed`, `lumi_workspace_org_changed` or
  `lumi_workspace_org_unavailable`. The local mapping is a cache of the server
  row and is re-derived by the next read in the current scope.
- Workspaces do not interfere with each other; provider credentials are never
  touched by the fence.

## Lumi-first startup and bootstrap state root

Startup (behavior detail in `04-control-plane-account.md`): when the Lumi
bridge exists, Lumi restore alone owns automatic login entry. The visible z.ai /
BigModel OAuth provider login is hidden on the entry screen; the existing BYOK
API-key form and an explicit per-launch "Continue locally" remain, so local use
never requires a Lumi account. ZCode auth/session custody, BYOK keys, the
active provider and local workspaces are not removed or altered.

State root and OS identity (behavior implemented by this cut): Main resolves
its bootstrap home and `setting.json` through one boundary, in the order
`ZCODE_DATA_BASE_DIR`, `ZCODE_DESKTOP_HOME_DIR`, `HOME`, `USERPROFILE`,
`homedir()`. An explicit `ZCODE_DATA_BASE_DIR` also wins over a `dataBaseDir`
stored in settings. With no explicit root, installed behavior is unchanged.
Main's own process `HOME` is never rewritten: `safeStorage` / the OS keychain
use the real OS account HOME, an explicit app root never replaces or bypasses
them, and unavailable encryption stays fail-closed with no plaintext fallback.
Adoption mapping and account/device vaults therefore live under the app root
while their encryption keys stay with the OS identity.

## Credential choice

Status: client behavior specified from the frozen `p08-cg-v1` wire; candidate,
not yet verified. Persistence of a mode that keeps the stage depends on
control-plane P08-CR-003 and is verified by readback, never assumed.

The P08 `credential_mode` is a **label** stored with the adoption record. It is
separate from the P04 execution policy `credential_mode` and from any
`credentials` row, and it does not enforce, provision or route anything. No P08
route accepts a secret and P08 never exports a local provider key. An adopted
workspace shows its server-returned mode beside ownership and stage and lets the
user choose among exactly the three frozen labels (`P08_CREDENTIAL_MODES` in
`packages/shared/src/p08-migration-adoption.ts`):

| Mode                         | What the user is told                                                                                                                                         | What is sent   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `local_credential` (default) | The key stays on this computer and is not sent.                                                                                                               | the label only |
| `metadata_only`              | This workspace is marked as using a key you keep yourself. Nothing about the key is sent.                                                                     | the label only |
| `org_managed_credential`     | The workspace is marked as using a credential stored by the organization. This app never uploads your local key and never receives the organization's secret. | the label only |

### State owner and sequence

```text
server adoption row (authority: stage, ownership, credential_mode, version)
  -> main workspace owner (serialized; re-reads the row for every operation)
  -> projection {credentialMode, adoptionVersion, stage, ownership} (read-only to renderer)
renderer: select a label -> read destination copy -> confirm
  -> set-workspace-credential-mode {expectedStage, expectedVersion, credentialMode}
main: account fence -> fresh server read -> compare stage/version -> validate with the
      shared P08 mirror -> ONE PATCH (current stage + chosen mode + version)
      -> re-read the row -> project the server row, or refuse if it did not persist
```

- The server row is the only authority. The renderer never supplies a mode main
  has not validated; the stage and version it sends are fences, not truth. If
  either differs from the row main just read, main refuses with
  `lumi_workspace_stale` and sends nothing.
- A stage advance carries the mode **read from the server in the same operation**,
  never a default. Creation keeps `local_credential` (the server refuses any
  other mode on creation).
- A mode-only change sends the current stage and the chosen mode. Success is the
  re-read row showing the requested mode; otherwise main throws
  `lumi_workspace_credential_not_persisted`. A response body alone is never
  trusted. Choosing the mode the row already has sends nothing.
- `org_managed_credential` requires `ownership: org_managed` (`workspace_bound`
  or later), mirroring `credential_mode_requires_managed`; main refuses locally
  with `lumi_workspace_credential_mode_invalid` before any request otherwise. The
  label does not require a credential row to exist (the contract defines no such
  link), and the UI says choosing it is not provisioning and claims nothing about
  routing status.
- Providing an organization credential is a separate, explicit action in the
  existing web console (P04 secure provisioning). The desktop opens the control
  plane origin only; it has no secret field, never reads a local provider key and
  never receives an organization secret. Cancelling sends nothing.
- No automatic binding, enrollment or export follows a choice. Stage 5 and
  history sync remain unavailable and are not constructible.
- Rollback returns the workspace to `local_credential` (server rule). Credential
  rows already stored by the organization are not deleted by rollback or by
  switching labels; the copy says so and the web console revokes them.
- `metadata_only` claims no fingerprint or provider registration: the frozen
  contract stores only the label.
- The fence described above is re-run after every await boundary (before the
  PATCH, after it before the confirming read, and before the projection is
  returned). A PATCH already sent is never undone or retried; a stale owner
  only has its completion refused.
- The adoption row parser is exact about the replayed full server row: `version >= 1`,
  `org_managed_credential` only with `ownership: org_managed`, and a mode-only response must be the
  requested `adoption_state_id` and `org_id`, else `lumi_response_invalid`. Verification status and
  remaining obligations: [credential-choice-handoff.md](credential-choice-handoff.md).
- Stable client codes: `lumi_command_invalid`, `lumi_workspace_stale`,
  `lumi_workspace_credential_mode_invalid`, `lumi_workspace_stage_invalid`,
  `lumi_workspace_credential_not_persisted`, `lumi_workspace_binding_missing`.
  Server refusals keep the existing adoption transport's generic mapping (the
  P08 conflict reason is a server 409, not a client status switch).
- UI: a native fieldset/radio group in the existing General settings workspace
  section (no `docs/screens/` reference exists for this control; the existing
  section and `DESIGN.md` tokens are the reference). Keyboard reachable, visible
  focus, one destination sentence per option, loading and error reuse the
  section's status regions, EN and ZH strings.

## Client states: startup wait, incomplete lists and failures

Renderer-only behavior; the host stays the owner of session and adoption state.

- **Page cap is fail-closed, not supported scale.** The control plane caps a list
  page at 100. A full page cannot prove completeness, so Main returns
  `lumi_page_incomplete` and the UI shows dedicated copy (EN/ZH) saying nothing
  was loaded or changed and that lists this large are not supported yet. It never
  claims 100+ support, hides the code, shows a partial list, or offers a plain
  retry (the outcome is deterministic until the organization's data changes).
  Local workspaces and BYOK stay usable.
- **Startup wait.** The startup gate opens the entry screen after 5 s without a
  restore answer (the host may take up to 30 s per request). Local/BYOK entry is
  never gated on Lumi. The gate and the entry panel share one launch `restore`
  request, so the host sees one call. The panel shows a "taking longer" notice
  at 5 s and gives up at 35 s with `lumi_request_timeout`. The abandoned
  request is superseded by sequence, so its late host answer is dropped and can
  never replace a newer result. Only an explicit "Check saved session again"
  re-issues a restore (never glued to a hung attempt); a failed restore is never
  retried as a sign-in. A restored session still needs an explicit Continue.
- **After a failed or interrupted command** (bind, advance, rollback, credential
  choice; including a dropped IPC reply) the on-screen projection is untrusted:
  the UI re-reads the server row, and if that also fails it clears the projection
  so bind/advance stay disabled until an explicit "Reload workspace state"
  proves the state. Nothing is retried automatically, so a failed bind can never
  silently create a second binding.
- Loading shows a status with a spinner (static under reduced motion); empty
  project lists show their own copy; every error shows user copy plus the stable
  code. Buttons with long labels wrap instead of clipping at 320 px.

## Acceptance (not yet demonstrated)

Each item needs recorded evidence before this spec's status can change.

- Rendered UI evidence (screenshots at desktop and 320 px, keyboard focus walk,
  reduced motion) for the entry panel states (restoring, slow, restore failed,
  signed-in, sign-in code) and the workspace section states (loading, empty,
  `lumi_page_incomplete`, retryable failure, credential choice).

- The real Electron app adopts one synthetic workspace against Worker/D1,
  restarts and reads back its server-owned stage, runs a second workspace
  locally, and rolls back while local state is proven unchanged.
- D1 binding/adoption rows and the exact SHA pair are inspected; paths and
  content are proven absent from requests and logs.
- In a disposable verifier run, mutating the selected project, workspace key,
  org, device, policy version, and authorization state makes the affected write
  refuse before dispatch.
- Org switch, A to B to A, sign-in and sign-out during an in-flight command
  are refused as specified under the fence section.
- Each of the three credential labels persists only through server readback;
  `org_managed_credential` is refused locally on an unmanaged row.
- First open with the Lumi bridge shows no z.ai OAuth provider button, keeps
  BYOK and Continue locally, and no Lumi account is required for local use.
- With explicit `ZCODE_DATA_BASE_DIR` and a different fake OS HOME, bootstrap
  settings, logs and vaults land under the explicit root, nothing is created
  under the fake OS HOME, and `safeStorage` still uses the OS identity.
