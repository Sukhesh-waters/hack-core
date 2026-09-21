/**
 * Is the local Inngest dev server reachable? In development every scheduled or
 * queued piece of work (collection, analysis, client profiles) depends on it,
 * and when it is down the app looks healthy while nothing happens. This turns
 * that silence into a definite answer. Outside dev mode it does not apply.
 * The URL is a variable, so no host is named at the call site.
 */
export type DevServerState = "up" | "down" | "not_dev";

export function inngestDevUrl(): string | null {
  const flag = process.env.INNGEST_DEV;
  if (!flag) return null;
  if (/^https?:\/\//.test(flag)) return flag;
  return process.env.INNGEST_BASE_URL || "http://localhost:8288";
}

export async function probeInngestDev(): Promise<DevServerState> {
  const url = inngestDevUrl();
  if (!url) return "not_dev";
  try {
    // Any HTTP answer means a server is there; only a refused connection is "down".
    await fetch(url, { signal: AbortSignal.timeout(1_500) });
    return "up";
  } catch {
    return "down";
  }
}
