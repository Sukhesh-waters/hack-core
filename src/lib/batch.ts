/** Split a list into consecutive chunks of at most `size` items. Used by
 * cron sweeps to run work in small concurrent batches — bounded parallelism
 * without a dependency. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Cutoff timestamp for a stall sweep: `minutes` before `now`. Pure so the
 * "N minutes ago" math (including crossing midnight/month/year boundaries)
 * is unit-testable without a clock. */
export function stallCutoff(now: Date, minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}
