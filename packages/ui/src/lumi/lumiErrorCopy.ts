/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */

/**
 * Maps stable host error codes to user-facing copy ids (`lumiError.*`). The code itself is still
 * shown next to the copy so support can identify it; an unknown code gets the generic message.
 */
const COPY_BY_CODE: Readonly<Record<string, string>> = {
  // The control plane returned a full page, so completeness cannot be proven. We fail closed
  // instead of showing a partial list or binding against it (spec 05); >100 is not supported.
  lumi_page_incomplete: "pageIncomplete",
  lumi_request_timeout: "timeout",
  lumi_workspace_stale: "changed",
  lumi_workspace_mismatch: "changed",
  lumi_workspace_org_changed: "changed",
  lumi_workspace_org_unavailable: "changed",
  lumi_account_changed: "changed",
  lumi_workspace_credential_not_persisted: "notPersisted",
  lumi_sender_denied: "denied",
};

export function lumiErrorCopyId(code: string): string {
  return `lumiError.${COPY_BY_CODE[code] ?? "generic"}`;
}

/**
 * Whether the same request could succeed if repeated. A fail-closed incomplete page is
 * deterministic until the organization's data changes, so it is not offered as a plain retry.
 */
export function isLumiErrorRetryable(code: string): boolean {
  return code !== "lumi_page_incomplete" && code !== "lumi_sender_denied";
}

export const LUMI_ERROR_COPY_IDS: readonly string[] = [
  ...new Set(["generic", ...Object.values(COPY_BY_CODE)]),
].map((name) => `lumiError.${name}`);
