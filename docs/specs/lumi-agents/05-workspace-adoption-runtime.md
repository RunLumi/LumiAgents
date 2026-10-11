# Lumi workspace adoption and managed runtime ownership

Status: implementation in progress for DE2E-INT-03. Full managed-run
wiring remains unproven.

## Product boundary

Lumi sign-in and device enrollment never change workspace ownership. The user
starts adoption from the currently selected workspace, chooses an organization
and project, reviews the exact bounded metadata, and confirms. Existing local
workspaces, sessions, credentials, and provider selection remain usable in local
mode. A second workspace remains local unless separately adopted.

The control plane is authoritative for P03 workspace binding, P08 adoption
stage/ownership, P05 session/run, and policy. The desktop owns only its local
mapping from workspace identity to opaque external reference and device
credentials. A renderer projection is never authority.

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
managed work while local-only work remains available.

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
5. Managed execution may start only after current device, membership, binding,
   compatibility, policy and project checks pass. The backend creates the
   session/run and supplies server-owned run identifiers. The desktop supplies
   those identifiers to the existing per-request model-auth seam; it never
   invents organization authority from renderer fields.
6. Rollback calls the frozen P08 rollback route and removes the matching P03
   binding. If either step is interrupted, local work stays intact and the next
   read reconciles the partial remote state before retry.
7. Local-only work never depends on network availability. History sync remains
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
  incomplete binding blocks managed work before any provider/tool side effect.
- Rollback removes server binding/authority without deleting or rewriting local
  files, sessions, credentials, or automation.
- No P08 stage-5 request or history upload is built.

## Failure and recovery

A timeout after P03 creation or P08 transition is resolved by fetching server
state and replaying the same idempotent operation; do not create a new workspace
identity. A partial rollback retries only the missing remote cleanup and keeps
the workspace visibly local-only until readback confirms the server state.
Missing or unreadable mapping, mismatched org/device/project, expired policy,
offline state, or unsupported client compatibility never falls through to a
managed request. The local provider path remains available.

## Credential choice

Status: client source implemented from the frozen `p08-cg-v1` wire. Persistence
of a mode that keeps the stage depends on control-plane P08-CR-003 and is
verified by readback, never assumed. Control-plane packet:
`docs/implementation/packets/DE2E-INT-03-CRED.md` in the parent repository.

The P08 `credential_mode` is a **label** stored with the adoption record. It is
separate from the P04 execution policy `credential_mode` and from any
`credentials` row, and it does not enforce, provision or route anything. No P08
route accepts a secret and P08 never exports a local provider key. An adopted
workspace shows its server-returned mode beside ownership and stage and lets the
user choose among the three frozen labels:

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
- The account/org/session fence is re-run after every await boundary (before the PATCH, after it
  before the confirming read, and before the projection is returned). The scope is
  `{session generation, selected-org epoch}` from `lumiSessionFence`, captured at admission before
  the first await. A new login bumps the session when it begins and again when it settles, and
  `read-workspace` for a different org (including A→B→A) bumps the org epoch, so an old-org owner
  cannot complete even while that org's membership is still valid. A PATCH already sent is never
  undone or retried and provider credentials are untouched; a stale owner only has its completion
  refused with `lumi_account_changed`, `lumi_workspace_org_changed` or
  `lumi_workspace_org_unavailable`.
- The same scope applies to `read`, `bind`, `advance` and `rollback`: the epoch is captured at
  admission, the command's own org must still be the selected one for that workspace key, and the fence
  runs before every server write (binding, adoption, policy sync), before each local mapping save and
  before the projection is returned. A write that already committed stays; the stale command's later
  writes, mapping save and projection are refused, and the local mapping (a cache of the server row) is
  re-derived by the next read. Selections are per workspace key, so workspaces do not interfere.
- The adoption row parser is exact about the replayed full server row: `version >= 1`,
  `org_managed_credential` only with `ownership: org_managed`, and a mode-only response must be the
  requested `adoption_state_id` and `org_id`, else `lumi_response_invalid`. Verification status and
  remaining runtime obligations: [credential-choice-handoff.md](credential-choice-handoff.md).
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

## Acceptance evidence

The real Electron app must adopt one synthetic workspace against Worker/D1,
restart and read back its server-owned stage, run a second workspace locally,
and roll back while proving local state unchanged. Inspect D1 binding/adoption
rows and exact SHA pair; prove paths and content are absent from requests and
logs. Mutate the selected project, workspace key, org, device, policy version,
and authorization state in a disposable verifier run; the affected managed
action must refuse before dispatch. No P05 or P04 behavior is credited until an
actual Electron agent request crosses that boundary.
