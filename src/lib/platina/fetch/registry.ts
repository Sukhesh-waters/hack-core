import type { PlatinaScanTarget } from "@/db/platina-schema";

/** Any spec the caller might hand the registry, approved or not. */
export type ScanSpecCandidate = {
  id: string;
  workspaceId: string;
  status: "draft" | "approved" | "running" | "done" | "failed";
  targets: PlatinaScanTarget[];
};

/** Only this shape may reach an adapter. */
export type ApprovedScanSpec = ScanSpecCandidate & {
  status: "approved" | "running";
};

export type RawSignalDoc = {
  sourceUrl: string;
  title?: string;
  body: string;
  adapter: string;
  sourceKind?: string;
  canonicalUrl?: string;
  contentHash?: string;
  raw?: unknown;
};

/** A target that produced nothing usable. Never stored as a signal doc. */
export type FetchFailure = { target: string; error: string };

export type FetchOutcome = {
  docs: RawSignalDoc[];
  failures: FetchFailure[];
};

export type SignalAdapter = {
  key: string;
  fetch(spec: ApprovedScanSpec): Promise<FetchOutcome>;
};

const adapters = new Map<string, SignalAdapter>();

/** The own-code web adapter is not shipped; content fetches go through
 *  Apify until the constitution is explicitly updated. */
const UNSHIPPED_ADAPTERS = new Set(["web"]);

export function registerAdapter(adapter: SignalAdapter) {
  if (UNSHIPPED_ADAPTERS.has(adapter.key)) {
    throw new Error(`adapter "${adapter.key}" is not shipped and cannot be registered`);
  }
  adapters.set(adapter.key, adapter);
}

export function getAdapter(key: string): SignalAdapter | undefined {
  return adapters.get(key);
}

export function listAdapterKeys(): string[] {
  return Array.from(adapters.keys());
}

export function assertApproved(
  spec: ScanSpecCandidate,
): asserts spec is ApprovedScanSpec {
  if (spec.status !== "approved" && spec.status !== "running") {
    throw new Error("scan spec is not approved — no fetch may run");
  }
}

export async function runApprovedScan(
  spec: ScanSpecCandidate,
  adapterKey = "apify",
): Promise<FetchOutcome> {
  assertApproved(spec);
  if (UNSHIPPED_ADAPTERS.has(adapterKey)) {
    throw new Error(`adapter "${adapterKey}" is not shipped — content fetches go through Apify`);
  }
  const adapter = getAdapter(adapterKey);
  if (!adapter) {
    throw new Error(`unknown signal adapter: ${adapterKey}`);
  }
  return adapter.fetch(spec);
}
