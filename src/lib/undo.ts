import type { ActivitySubjectType } from "@/lib/activity";

export type UndoToken = {
  subjectType: ActivitySubjectType;
  subjectId: string;
  verb: string;
  priorFields: Record<string, unknown>;
  expiresAtIso: string;
};

export type CreateUndoTokenInput = {
  subjectType: ActivitySubjectType;
  subjectId: string;
  verb: string;
  priorFields: Record<string, unknown>;
  /** Default TTL in seconds before an undo window closes. Default: 30s */
  ttlSeconds?: number;
};

/**
 * Creates an UndoToken carrying the prior field state and expiration timestamp.
 * Pure logic — no database access, unit testable in isolation.
 */
export function createUndoToken(
  input: CreateUndoTokenInput,
  now: Date = new Date(),
): UndoToken {
  const ttlSeconds = input.ttlSeconds ?? 30;
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  return {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    verb: input.verb,
    priorFields: input.priorFields,
    expiresAtIso: expiresAt.toISOString(),
  };
}

/**
 * Checks whether an undo token is active and unexpired.
 */
export function isUndoable(
  token: UndoToken | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!token) return false;
  if (!token.expiresAtIso) return false;
  const expiresAt = new Date(token.expiresAtIso);
  if (Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() > now.getTime();
}

/**
 * Verbs that mark crossing an external boundary (e.g. published to Instagram,
 * email sent to client). Crossing an external boundary invalidates undo availability.
 */
const EXTERNAL_BOUNDARY_VERBS = new Set([
  "posted",
  "published",
  "emailed",
  "sent",
  "dispatched",
]);

export function isExternalBoundaryVerb(verb: string): boolean {
  return EXTERNAL_BOUNDARY_VERBS.has(verb.toLowerCase());
}
