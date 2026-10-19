// The typed error envelope on every MCP reply that has isError: true.
//
// The `error` string stays exactly as it was (dottie-os parses `{ error }`);
// next to it every error reply now carries:
//   code         a stable id from ERROR_CODES (closed: a new one is a deliberate edit here)
//   category     one of four kinds eye can actually produce
//   retryable    true only when the same call can succeed later unchanged
//   remediation  one short sentence on what the caller should do next
//
// Shape after morluto/rea `docs/error-contract.schema.json` (MIT, (c) 2026
// morluto): a code, a fixed category enum, a retryable flag and a remediation.
// Clean-room and much smaller: four of rea's nine categories, one remediation
// string instead of an object; no text or code copied.
//
// Relative imports only (see ./tools.ts for why).

import { z } from "zod";

export const ERROR_CATEGORIES = ["invalid_input", "unavailable", "timeout", "execution_failure"] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/** Every code, with the category and retry answer it always carries. */
export const ERROR_CODES = {
  /** Arguments failed the tool's input schema or its own check. */
  invalid_arguments: { category: "invalid_input", retryable: false, remediation: "Fix the arguments named in error; the tool's inputSchema lists what each one accepts." },
  /** The route rejected the request (HTTP 400 or another 4xx). */
  bad_request: { category: "invalid_input", retryable: false, remediation: "Change the request as error describes; the same call will fail the same way." },
  /** The route answered 404 itself: the id is well formed but has no row. */
  not_found: { category: "invalid_input", retryable: false, remediation: "Check the id or code; this source has no row for it, which is not the same as a zero." },
  /** This server does not have the route the tool calls (it is older than the tool list). */
  route_not_deployed: { category: "unavailable", retryable: false, remediation: "Point the client at a server that has this route; retrying this one will not help." },
  /** The route or its upstream said too many requests. */
  rate_limited: { category: "unavailable", retryable: true, remediation: "Wait a minute and retry the same call." },
  /** An upstream public API failed or did not answer (HTTP 502 or 503). */
  upstream_failure: { category: "unavailable", retryable: true, remediation: "Retry the same call later; the upstream named in error did not answer this time." },
  /** An upstream rejected the request the route sent it (an upstream 4xx). */
  upstream_rejected: { category: "execution_failure", retryable: false, remediation: "Narrow or change the request; the upstream refused it and will refuse it again." },
  /** The call or an upstream ran out of time. */
  timeout: { category: "timeout", retryable: true, remediation: "Retry the same call; a cold cache can take longer the first time. A smaller box helps." },
  /** The MCP server could not reach the HTTP server at all. */
  server_unreachable: { category: "unavailable", retryable: true, remediation: "Check that the HTTP server behind this MCP is up, then retry." },
  /** Anything else: a route's 500 or an error thrown inside the tool. */
  internal_error: { category: "execution_failure", retryable: false, remediation: "Report it with the tool name and arguments; retrying the same call is unlikely to help." },
} as const satisfies Record<string, { category: ErrorCategory; retryable: boolean; remediation: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorEnvelope {
  error: string;
  code: ErrorCode;
  category: ErrorCategory;
  retryable: boolean;
  remediation: string;
}

/**
 * JSON Schema for the envelope fields of an isError reply. Other keys (the
 * route's own payload: note, details, upstream, status, text) are allowed.
 * Plain draft-07 keywords so any validator reads it.
 */
export const ERROR_ENVELOPE_SCHEMA = {
  title: "Embedding Atlas MCP error envelope",
  type: "object",
  required: ["error", "code", "category", "retryable", "remediation"],
  properties: {
    error: { type: "string", minLength: 1 },
    code: { type: "string", enum: Object.keys(ERROR_CODES) },
    category: { type: "string", enum: [...ERROR_CATEGORIES] },
    retryable: { type: "boolean" },
    remediation: { type: "string", minLength: 1, maxLength: 200 },
  },
  additionalProperties: true,
} as const;

/** Thrown by a tool handler for a bad combination of arguments the schema cannot express. */
export class InvalidArguments extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidArguments";
  }
}

function envelope(error: string, code: ErrorCode): ErrorEnvelope {
  const c = ERROR_CODES[code];
  return { error, code, category: c.category, retryable: c.retryable, remediation: c.remediation };
}

/** The message the MCP has always sent for a thrown error (unchanged: clients match on it). */
export function thrownMessage(err: unknown): string {
  if (err instanceof z.ZodError) return "invalid arguments: " + err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  return err instanceof Error ? err.message : String(err);
}

const ABORTED = /\babort|timed? ?out\b/i;

/** Classify an error thrown while running a tool: bad arguments, the fetch, or a bug. */
export function envelopeForThrown(err: unknown): ErrorEnvelope {
  const message = thrownMessage(err);
  if (err instanceof z.ZodError || err instanceof InvalidArguments) return envelope(message, "invalid_arguments");
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) return envelope(message, "timeout");
  // Node's fetch rejects with TypeError("fetch failed") and the socket error as `cause` when the server is unreachable.
  if (err instanceof TypeError && /fetch failed|network/i.test(err.message)) return envelope(message, "server_unreachable");
  return envelope(message, "internal_error");
}

/**
 * Classify a reply the route answered with HTTP >= 400. `notDeployed` is true
 * when the MCP saw Next's own not-found page rather than a route's 404.
 * Keeps the route's `error` string when it sent one.
 */
export function envelopeForStatus(status: number, payload: Record<string, unknown>, notDeployed: boolean): ErrorEnvelope {
  const error = typeof payload.error === "string" && payload.error ? payload.error : `the route answered HTTP ${status}`;
  // lib/server/upstream.ts jsonError: { error, upstream, status } where status is the upstream's own.
  const upstreamStatus = typeof payload.upstream === "string" && typeof payload.status === "number" ? payload.status : null;
  if (status === 404) return envelope(error, notDeployed ? "route_not_deployed" : "not_found");
  if (status === 429) return envelope(error, "rate_limited");
  if (status === 408 || status === 504) return envelope(error, "timeout");
  if (status === 502 || status === 503) {
    if (upstreamStatus === 429) return envelope(error, "rate_limited");
    if (upstreamStatus === 408 || upstreamStatus === 504) return envelope(error, "timeout");
    if (upstreamStatus != null && upstreamStatus >= 400 && upstreamStatus < 500) return envelope(error, "upstream_rejected");
    if (upstreamStatus == null && ABORTED.test(error)) return envelope(error, "timeout");
    return envelope(error, "upstream_failure");
  }
  if (status >= 400 && status < 500) return envelope(error, "bad_request");
  return envelope(error, "internal_error");
}
