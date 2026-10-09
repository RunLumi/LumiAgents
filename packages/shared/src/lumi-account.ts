/* Modified for Lumi Agents (https://github.com/RunLumi/LumiAgents). Apache-2.0 §4(b) modification notice. */
export const LUMI_ACCOUNT_CHANNEL = "lumi-account";
export type LumiAccountCommand =
  | "begin"
  | "complete"
  | "cancel"
  | "read"
  | "restore"
  | "logout"
  | {
      action: "enroll-device" | "read-device" | "sync-device" | "refresh-device" | "recover-device";
      orgId: string;
      confirm?: true;
    };
export interface LumiDeviceStateProjection {
  status: "not_enrolled" | "pending" | "active" | "reauth_required";
  orgId: string;
  enrollmentId?: string | null;
  device?: { id: string; orgId: string; tokenExpiresAt: string; policyVersion: number };
}
export interface LumiAccountProjection {
  user: { id: string; email: string; displayName: string };
  organizations: {
    id: string;
    displayName: string;
    slug: string;
    state: string;
    role: string;
    status: string;
  }[];
}
export interface LumiSignInProjection {
  userCode: string;
  verificationUrl: string;
  expiresAt: string;
}
export type LumiAccountResult =
  | {
      ok: true;
      account?: LumiAccountProjection;
      signIn?: LumiSignInProjection;
      restored?: boolean;
      device?: LumiDeviceStateProjection;
    }
  | { ok: false; code: string };
export interface LumiAccountBridge {
  request(command: LumiAccountCommand): Promise<LumiAccountResult>;
}
