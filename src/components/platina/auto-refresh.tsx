"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-reads the page's server data every few seconds while work is in flight
 * (a scrape or an analysis), then stops by itself — the live header pill
 * covers the long-term case. Renders nothing; `active` is decided on the
 * server from real run state, so it never spins on an idle page.
 */
export function AutoRefresh({
  active,
  intervalMs = 4_000,
  maxMs = 240_000,
}: {
  active: boolean;
  intervalMs?: number;
  maxMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => router.refresh(), intervalMs);
    const stop = setTimeout(() => clearInterval(tick), maxMs);
    return () => {
      clearInterval(tick);
      clearTimeout(stop);
    };
  }, [active, intervalMs, maxMs, router]);
  return null;
}
