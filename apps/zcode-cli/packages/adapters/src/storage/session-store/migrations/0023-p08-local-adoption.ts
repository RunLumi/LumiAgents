/**
 * `0023_p08_local_adoption` — local record of one workspace's adoption progress.
 *
 * The control plane owns the adoption record. This table exists so the *wizard*
 * survives a restart and so a client that has never reached the network still
 * knows which stage it last saw. It is a cache of a server decision, not a
 * second authority: nothing here can make a workspace org-managed, because
 * `stage` is only ever written from a server response and the client refuses to
 * construct a request for a stage the ladder does not allow.
 *
 * Two deliberate omissions, both privacy invariants rather than tidiness:
 *
 * - There is no column for a prompt, a response, a file path, a directory
 *   listing, an API key, or an automation body. The client never had them to
 *   store, so a local SQLite file cannot leak what the cloud was never told.
 * - There is no `secret`, `token`, or `credential` column. The client stores the
 *   credential *mode* label only, mirroring `p08-cg-v1`: a managed credential is
 *   a P04 row the organization holds, never something this process keeps a copy
 *   of. After a rollback the mode returns to `local_credential` precisely so no
 *   local residue suggests the organization still holds a secret.
 *
 * `installation_id` and `workspace_key` are the opaque pair from
 * `p08ExternalWorkspaceRefSchema`. Neither may contain a path separator, and the
 * `CHECK` below enforces that in the database rather than trusting the caller —
 * the same defence-in-depth the control plane's `0019` migration uses.
 */
export const P08_LOCAL_ADOPTION_MIGRATION_SQL = `
  create table if not exists p08_local_adoption (
    workspace_key text primary key,
    installation_id text not null,
    adoption_state_id text,
    org_id text,
    stage text not null default 'local_unmanaged'
      check (stage in (
        'local_unmanaged',
        'account_optional',
        'device_enrolled',
        'workspace_bound',
        'managed_policy',
        'history_sync'
      )),
    ownership text not null default 'local_unmanaged'
      check (ownership in ('local_unmanaged', 'org_managed')),
    credential_mode text not null default 'local_credential'
      check (credential_mode in (
        'local_credential',
        'metadata_only',
        'org_managed_credential'
      )),
    version integer not null default 0,
    reversion_count integer not null default 0,
    time_created integer not null,
    time_updated integer not null,
    check (workspace_key <> '' and length(workspace_key) <= 256),
    check (installation_id <> '' and length(installation_id) <= 128),
    check (workspace_key not glob '*[/\\]*'),
    check (installation_id not glob '*[/\\]*')
  );

  create index if not exists p08_local_adoption_org_idx
    on p08_local_adoption(org_id);

  create index if not exists p08_local_adoption_managed_idx
    on p08_local_adoption(ownership, stage);
`;
