// ============================================================
// HTTP Client Port - network I/O boundary
// ============================================================

import type { ExecutionContext, TraceContext } from "../tracing/tracer.js";

// `PATCH` was added for the P08 adoption contract
// (`PATCH /api/v1/orgs/{org_id}/adoption/bindings/{id}`, `p08-cg-v1`). It is
// deliberately the only addition: advancing one adoption stage is a partial
// update of a resource the client already holds a version for, which is what
// `PATCH` means, and the contract gate froze it as PATCH rather than as a
// POST-with-an-action so the compare-and-set on `version` stays visible in the
// method. `DELETE` is still absent — nothing in the frozen contracts unbinds by
// deletion; P08 rolls back to `local_unmanaged` instead.
export type HttpClientMethod = "GET" | "HEAD" | "POST" | "PATCH";
export type HttpClientRedirectPolicy = "manual" | "follow";
export type HttpClientEgressPolicy = "public";

export type HttpClientErrorCode =
  | "invalid_url"
  | "unsupported_protocol"
  | "timeout"
  | "cancelled"
  | "too_large"
  | "egress_blocked"
  | "network_error"
  | "proxy_error";

export interface HttpClientErrorDetails {
  code: HttpClientErrorCode;
  url?: string;
  status?: number;
  message: string;
  cause?: unknown;
}

export class HttpClientPortError extends Error {
  readonly code: HttpClientErrorCode;
  readonly url?: string;
  readonly status?: number;
  override readonly cause?: unknown;

  constructor(details: HttpClientErrorDetails) {
    super(details.message);
    this.name = "HttpClientPortError";
    this.code = details.code;
    this.url = details.url;
    this.status = details.status;
    this.cause = details.cause;
  }
}

export function createHttpClientError(details: HttpClientErrorDetails): HttpClientPortError {
  return new HttpClientPortError(details);
}

export function isHttpClientPortError(error: unknown): error is HttpClientPortError {
  return error instanceof HttpClientPortError;
}

export interface HttpClientRequest {
  url: string;
  method?: HttpClientMethod;
  headers?: Record<string, string>;
  body?: Uint8Array;
  timeoutMs?: number;
  maxResponseBytes?: number;
  redirect?: HttpClientRedirectPolicy;
  egressPolicy?: HttpClientEgressPolicy;
  trace?: TraceContext;
}

export interface HttpClientEgressInfo {
  proxied: boolean;
  proxySource?: string;
  proxyHost?: string;
  noProxyMatched?: boolean;
  customCa?: boolean;
}

export interface HttpClientResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Uint8Array;
  bytes: number;
  durationMs: number;
  egress?: HttpClientEgressInfo;
}

export interface HttpClientRunOptions {
  signal?: AbortSignal;
  context?: ExecutionContext;
}

export interface HttpClientPort {
  request(
    request: HttpClientRequest,
    options?: HttpClientRunOptions,
  ): Promise<HttpClientResponse>;
}
