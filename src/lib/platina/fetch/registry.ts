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
  raw?: unknown;
};

export type SignalAdapter = {
  key: string;
  fetch(spec: ApprovedScanSpec): Promise<RawSignalDoc[]>;
};

const adapters = new Map<string, SignalAdapter>();

export function registerAdapter(adapter: SignalAdapter) {
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
): Promise<RawSignalDoc[]> {
  assertApproved(spec);
  const adapter = getAdapter(adapterKey);
  if (!adapter) {
    throw new Error(`unknown signal adapter: ${adapterKey}`);
  }
  return adapter.fetch(spec);
}
