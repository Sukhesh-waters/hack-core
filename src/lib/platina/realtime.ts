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
  | "alerts";

export const PLATINA_REALTIME_SCOPES: readonly PlatinaRealtimeScope[] = [
  "audits",
  "findings",
  "solutions",
  "outcomes",
  "alerts",
];

export const PLATINA_BROADCAST_EVENT = "platina";

export function platinaChannelName(topicToken: string): string {
  return `platina:${topicToken}:live`;
}
