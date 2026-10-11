// Synthetic projections. Every id, URL and path is fictional (.invalid / /synthetic); nothing here
// is a token, a real organization, or a real workspace.

export const CONSOLE_URL = "https://console.example.invalid/";
export const SIGN_IN_URL = "https://app.example.invalid/device";
export const WORKSPACE_PATH_A = "/synthetic/workspace-alpha";
export const WORKSPACE_PATH_B = "/synthetic/workspace-beta";

export const ACCOUNT = {
  user: { id: "usr_proof", email: "proof@example.invalid", displayName: "Proof User" },
  organizations: [
    {
      id: "org_a",
      displayName: "Acme Labs",
      slug: "acme",
      state: "active",
      role: "owner",
      status: "active",
    },
  ],
};

export const PROJECTS = [
  { id: "prj_1", name: "Platform", slug: "platform", archived: false, visibility: "org" },
  {
    id: "prj_2",
    name: "Long-running evaluation harness for multilingual retrieval quality regressions",
    slug: "evals",
    archived: false,
    visibility: "restricted",
  },
  { id: "prj_3", name: "Archived pilot", slug: "pilot", archived: true, visibility: "org" },
];

export const PROJECTS_B = [
  { id: "prj_b", name: "Beta Only Project", slug: "beta", archived: false, visibility: "org" },
];

/** A bound, org-managed workspace row at adoption version 3 (credential label local). */
export function boundWorkspace(over = {}) {
  return {
    status: "org_managed",
    orgId: "org_a",
    workspaceKey: "wk_proof_a",
    stage: "workspace_bound",
    ownership: "org_managed",
    credentialMode: "local_credential",
    adoptionVersion: 3,
    credentialConsoleUrl: CONSOLE_URL,
    deviceUsable: true,
    projectId: "prj_1",
    deviceId: "dev_1",
    adoptionStateId: "ads_a",
    workspaceBindingId: "wsb_a",
    displayName: "Alpha service",
    ...over,
  };
}

/** A workspace the server has no binding for yet. */
export function unboundWorkspace(over = {}) {
  return boundWorkspace({
    status: "local_unmanaged",
    stage: "local_unmanaged",
    ownership: "local_unmanaged",
    adoptionVersion: null,
    projectId: null,
    adoptionStateId: null,
    workspaceBindingId: null,
    displayName: null,
    ...over,
  });
}

export const ok = (extra = {}) => ({ ok: true, ...extra });
export const fail = (code) => ({ ok: false, code });
export const withAccount = () => ok({ account: ACCOUNT });
export const withSignIn = () =>
  ok({
    signIn: {
      userCode: "LUMI-4Q7K",
      verificationUrl: SIGN_IN_URL,
      expiresAt: "2026-10-09T09:10:00Z",
    },
  });
