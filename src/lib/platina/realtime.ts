/**
 * Platina Realtime spine — isomorphic half (safe for client bundles).
 * Server-only pieces (HMAC token derivation, broadcast) live in
 * realtime-server.ts. Separate from InstaMedia's realtime by constitution:
 * own topic, own scopes, own hooks.
 *
 * The raw workspace id never names a channel: the browser receives an opaque
 * token from the membership-checked layout and subscribes to
 * `platina:<token>:live`. Payloads are signal-only ({ scope, id? }) — tenant
 * content never crosses the broadcast channel; subscribers refetch through
 * authenticated, workspace-scoped server paths.
 */

export type PlatinaRealtimeScope =
  | "audits"
  | "findings"
  | "solutions"
  | "outcomes"
  | "alerts"
  // Campaign intelligence: measured insights written to the Brain, events read.
  | "insights"
  | "events"
  // C6: own-site pages read (first-party knowledge); creatives, results,
  // reviews and learning changes.
  | "knowledge"
  | "results"
  // C7.1: the ops board ran its checks.
  | "ops";

export const PLATINA_REALTIME_SCOPES: readonly PlatinaRealtimeScope[] = [
  "audits",
  "findings",
  "solutions",
  "outcomes",
  "alerts",
  "insights",
  "events",
  "knowledge",
  "results",
  "ops",
];

export const PLATINA_BROADCAST_EVENT = "platina";

export function platinaChannelName(topicToken: string): string {
  return `platina:${topicToken}:live`;
}
