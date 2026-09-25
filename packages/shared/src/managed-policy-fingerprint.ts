/**
 * P05-INT-04 — exact invocation binding for managed browser/computer policy.
 *
 * A control-plane decision authorizes one exact invocation. These helpers build
 * the bounded, redacted pre-image of that invocation; the caller hashes it. The
 * browser argument summary deliberately carries no page content: only the
 * command identity and, for navigation, the destination host reach the gate.
 *
 * Contract: `p05-browser-computer-v1`, Contract Gate `p05-cg-v1`.
 */

import type { BrowserCommand } from "./browser-use/commands.js";
import {
  P05_BROWSER_COMPUTER_POLICY_CONTRACT_VERSION,
  type ManagedPolicySurface,
} from "./p05-browser-computer-policy.js";

const MAX_SUMMARY_LENGTH = 1_024;
const MAX_HOST_LENGTH = 253;

function isSafeText(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return false;
  }
  return true;
}

/** Strip a URL down to its host so domain policy can be reported without leaking paths. */
function summarizeUrlHost(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.length > 0 && host.length <= MAX_HOST_LENGTH && isSafeText(host) ? host : "invalid";
  } catch {
    return "invalid";
  }
}

function appendToken(summary: string, key: string, value: string): string {
  const token = `${key}=${value}`;
  return summary.length + token.length + 2 > MAX_SUMMARY_LENGTH ? summary : `${summary}; ${token}`;
}

/**
 * Build a bounded, redacted policy summary for a browser command.
 *
 * Page content, form values, typed text, dialog prompt text, and page
 * expressions are never included: only the command identity and, for
 * navigation, the destination host reach the policy gate.
 */
export function summarizeBrowserPolicyCommand(command: BrowserCommand): string {
  let summary = `method=${command.method}`;
  if ("tabId" in command && typeof command.tabId === "string" && command.tabId) {
    summary = appendToken(summary, "tab", "controlled");
  }
  switch (command.method) {
    case "navigate":
      summary = appendToken(summary, "host", summarizeUrlHost(command.url));
      break;
    case "playwright": {
      summary = appendToken(summary, "action", command.action.name);
      if (command.action.name === "locator") {
        summary = appendToken(summary, "operation", command.action.operation);
      }
      if (command.action.name === "evaluate" || command.action.name === "locator") {
        if (typeof command.action.expressionKind === "string") {
          summary = appendToken(summary, "expression_kind", command.action.expressionKind);
        }
      }
      break;
    }
    case "newTab":
    case "recordingStart":
    case "handleDialog":
      summary = appendToken(summary, "sensitive", "redacted");
      break;
    default:
      break;
  }
  return summary;
}

/**
 * Canonical, deterministic pre-image for the invocation fingerprint.
 *
 * The caller hashes this with SHA-256; keeping hashing out of this module
 * avoids pulling a Node builtin into the shared browser bundle.
 */
export function managedInvocationFingerprintInput(input: {
  readonly surface: ManagedPolicySurface;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly toolName: string;
  readonly argumentsSummary: string;
  readonly payload: unknown;
}): string {
  return [
    `contract=${P05_BROWSER_COMPUTER_POLICY_CONTRACT_VERSION}`,
    `surface=${input.surface}`,
    `session=${input.sessionId}`,
    `turn=${input.turnId ?? ""}`,
    `tool=${input.toolName}`,
    `summary=${input.argumentsSummary}`,
    `payload=${stableStringify(input.payload)}`,
  ].join("\n");
}

/** Deterministic JSON with sorted object keys so equal payloads fingerprint equally. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
