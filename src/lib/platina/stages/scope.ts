/**
 * Which evidence belongs to which client (core spine R3). Pure.
 *
 * A workspace holds many clients. Brain chunks are workspace-wide by
 * construction — they rest on signal documents — so "this client's evidence"
 * means "chunks resting on signals collected for this client or one of its
 * competitors". Without this filter, client A's declared standard was compared
 * against client B's competitors: isolation held, the comparison was nonsense.
 */
export type ScopableChunk = {
  id: string;
  content: string;
  sourceSignalIds: string[];
};

/**
 * Chunks resting on at least one of the scope's signals, newest-first order
 * preserved, bounded by `take`.
 *
 * An empty scope returns nothing — never everything. "I have no signals for
 * this client" must not silently widen to "use the whole workspace"; that is
 * the exact bug this function exists to prevent.
 */
export function chunksForScope<T extends ScopableChunk>(
  pool: T[],
  signalIds: ReadonlySet<string>,
  take: number,
): T[] {
  if (signalIds.size === 0) return [];
  return pool
    .filter((chunk) => chunk.sourceSignalIds.some((id) => signalIds.has(id)))
    .slice(0, take);
}
